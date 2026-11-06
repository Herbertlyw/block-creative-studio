import { compileTake, evaluateCompiledTake } from '../../../director/presentationCompiler';
import { blastPraiseTier, type PresentationFrame, type RhythmProfile, type Take } from '../../../domain/types';
import type { CompiledFrameSource, PresentationCompilerAdapter } from '../../../game-runtime/frameSource';
import type { GameProjectEnvelope } from '../../../game-runtime/projectEnvelope';
import {
  PRESENTATION_PACKET_CONTRACT,
  PRESENTATION_PACKET_CONTRACT_VERSION,
  presentationHashIdentity,
  type PresentationPacket,
  type SemanticGameEvent,
} from '../../../game-runtime/presentationPacket';
import type { GameReplayEnvelope } from '../../../game-runtime/replayEnvelope';
import { stableHash } from '../../../headless/stableHash';
import { parsePraiseWords, resolvePraiseWord, type PraiseWordMap } from '../../../domain/praiseWords';
import { hashBlockPlacementState } from '../legacyRuntime';
import { BLOCK_PLACEMENT_GAME_ID, BLOCK_PLACEMENT_MODULE_VERSION } from '../manifest';
import { takeFromBlockPlacementReplay } from '../migrations/blockPlacementV1';

export const BLOCK_PLACEMENT_PRESENTATION_SCHEMA_ID = 'bcs.block-placement.presentation-frame.v1';

function eventsFromFrame(frame: PresentationFrame): SemanticGameEvent[] {
  const events: SemanticGameEvent[] = [];
  // Compiler-authored frames carry the source action id. The turn fallback
  // keeps manually-authored/live frames stable without merging adjacent moves.
  const actionIdentity = frame.currentActionId ?? `turn-${frame.snapshot.turn}`;
  if (frame.draggedPiece) {
    events.push({
      id: `drag-${actionIdentity}-${frame.draggedPiece.piece.id}`,
      type: 'block-placement.drag',
      category: 'interaction',
      tags: ['pointer'],
      entityIds: [frame.draggedPiece.piece.id],
    });
  }
  if (frame.placementFeedback) {
    events.push({
      id: `commit-${actionIdentity}`,
      type: 'block-placement.placement-committed',
      category: 'commit',
      tags: ['placement'],
      entityIds: frame.placementFeedback.cells.map((cell) => `${cell.row}:${cell.col}`),
      payload: { placementPoints: frame.placementFeedback.placementPoints },
    });
  }
  if (frame.clearing) {
    const clear = frame.clearing.clear;
    if (clear.rows.length > 0 && clear.cols.length > 0) {
      events.push({
        id: `cross-${actionIdentity}`,
        type: 'block-placement.cross-cleared',
        category: 'resolve',
        tags: ['clear', 'cross'],
        entityIds: [...clear.rows.map((row) => `row:${row}`), ...clear.cols.map((col) => `col:${col}`)],
      });
    } else if (clear.rows.length > 0 || clear.cols.length > 0) {
      events.push({
        id: `line-${actionIdentity}`,
        type: 'block-placement.line-cleared',
        category: 'resolve',
        tags: ['clear'],
        entityIds: [
          ...clear.rows.map((row) => `row:${row}`),
          ...clear.cols.map((col) => `col:${col}`),
        ],
      });
    }
    // 评价语音事件(与 candy-blast 评价词同一档位判定; 未绑定音频时静默)
    if (clear.rows.length > 0 || clear.cols.length > 0) {
      const tier = blastPraiseTier(
        frame.snapshot.combo,
        clear.rows.length + clear.cols.length,
      );
      events.push({
        id: `praise-${actionIdentity}`,
        type: `block-placement.praise-${tier}`,
        category: 'resolve',
        tags: ['clear', 'praise'],
        entityIds: [],
        payload: { tier, combo: frame.snapshot.combo },
      });
    }
  }
  if (frame.snapshot.status === 'game-over') {
    events.push({
      id: 'over-terminal',
      type: 'block-placement.game-over',
      category: 'outcome',
      tags: ['terminal'],
      entityIds: [],
    });
  }
  return events;
}

function packetFromFrame(input: {
  takeId: string;
  frame: PresentationFrame;
}): PresentationPacket {
  const totalFrames = input.frame.totalFrames ?? 1;
  const semanticEvents = eventsFromFrame(input.frame);
  const feedback: PresentationPacket['feedback'] = { cameraPunch: input.frame.cameraPunch };
  const identityBody = presentationHashIdentity({
    frameIndex: input.frame.frame,
    fps: input.frame.fps,
    totalFrames,
    payload: input.frame,
    semanticEvents,
    cameraPunch: input.frame.cameraPunch,
  });
  return {
    contract: PRESENTATION_PACKET_CONTRACT,
    contractVersion: PRESENTATION_PACKET_CONTRACT_VERSION,
    identity: {
      gameId: BLOCK_PLACEMENT_GAME_ID,
      moduleVersion: BLOCK_PLACEMENT_MODULE_VERSION,
      takeId: input.takeId,
      frameIndex: input.frame.frame,
      fps: input.frame.fps,
      totalFrames,
      stateHash: hashBlockPlacementState(input.frame.snapshot),
      presentationHash: stableHash(identityBody),
    },
    semanticEvents,
    feedback,
    payloadSchemaId: BLOCK_PLACEMENT_PRESENTATION_SCHEMA_ID,
    payload: input.frame,
  };
}

export function blockPlacementFrameFromPacket(packet: PresentationPacket): PresentationFrame {
  if (packet.payloadSchemaId !== BLOCK_PLACEMENT_PRESENTATION_SCHEMA_ID) {
    throw new Error(`Unsupported presentation schema ${packet.payloadSchemaId}`);
  }
  return packet.payload as PresentationFrame;
}

export function blockPlacementPacketFromFrame(takeId: string, frame: PresentationFrame): PresentationPacket {
  return packetFromFrame({ takeId, frame });
}

export function compileBlockPlacementFrameSource(input: {
  take: Take;
  rhythm: RhythmProfile;
  fps: number;
  praiseWords?: PraiseWordMap | undefined;
}): CompiledFrameSource {
  const compiled = compileTake(input.take, input.rhythm, input.fps);
  const frameSourceHash = stableHash({
    gameId: BLOCK_PLACEMENT_GAME_ID,
    takeId: input.take.id,
    fps: compiled.fps,
    totalFrames: compiled.totalFrames,
    initialStateHash: hashBlockPlacementState(compiled.initial),
    finalStateHash: hashBlockPlacementState(compiled.final),
    actions: compiled.actions.map((item) => ({
      id: item.action.id,
      startFrame: item.startFrame,
      releaseFrame: item.releaseFrame,
      clearStartFrame: item.clearStartFrame,
      clearEndFrame: item.clearEndFrame,
      endFrame: item.endFrame,
    })),
  });
  const source: CompiledFrameSource = {
    gameId: BLOCK_PLACEMENT_GAME_ID,
    takeId: input.take.id,
    fps: compiled.fps,
    totalFrames: compiled.totalFrames,
    frameSourceHash,
    evaluate(frameIndex) {
      const frame = evaluateCompiledTake(compiled, frameIndex, input.rhythm);
      return packetFromFrame({ takeId: input.take.id, frame });
    },
  };
  return withBlockPlacementPraiseWords(source, input.praiseWords);
}

/** Presentation-only vocabulary: state, action identities and timings remain unchanged. */
export function withBlockPlacementPraiseWords(source: CompiledFrameSource, input?: PraiseWordMap): CompiledFrameSource {
  if (!input || Object.keys(input).length === 0) return source;
  const words = parsePraiseWords(input);
  return {
    ...source,
    frameSourceHash: stableHash({ source: source.frameSourceHash, praiseWords: words }),
    evaluate(frameIndex) {
      const packet = source.evaluate(frameIndex);
      const frame = blockPlacementFrameFromPacket(packet);
      if (!frame.clearing) return packet;
      const word = resolvePraiseWord(frame.snapshot.combo, frame.clearing.clear.rows.length + frame.clearing.clear.cols.length, words);
      const payload = { ...frame, praiseWord: word };
      const semanticEvents = packet.semanticEvents.map(event => event.tags.includes('praise')
        ? { ...event, type: `block-placement.praise-${word}`, payload: { ...(event.payload && typeof event.payload === 'object' ? event.payload : {}), word } }
        : event);
      return { ...packet, payload, semanticEvents, identity: { ...packet.identity,
        presentationHash: stableHash(presentationHashIdentity({ frameIndex: packet.identity.frameIndex, fps: packet.identity.fps,
          totalFrames: packet.identity.totalFrames, payload, semanticEvents, cameraPunch: frame.cameraPunch })),
      } };
    },
  };
}

export const blockPlacementPresentationAdapter: PresentationCompilerAdapter = {
  gameId: BLOCK_PLACEMENT_GAME_ID,
  compile(input: {
    project: GameProjectEnvelope;
    replay: GameReplayEnvelope;
    directorProfile: unknown;
    fps: number;
  }) {
    const take = takeFromBlockPlacementReplay(input.project, input.replay);
    return compileBlockPlacementFrameSource({
      take,
      rhythm: input.directorProfile as RhythmProfile,
      fps: input.fps,
    });
  },
};
