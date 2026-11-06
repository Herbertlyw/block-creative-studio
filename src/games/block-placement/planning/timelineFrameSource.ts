import type { CompiledFrameSource } from '../../../nativeReference/game-runtime/frameSource';
import {
  PRESENTATION_PACKET_CONTRACT,
  PRESENTATION_PACKET_CONTRACT_VERSION,
  presentationHashIdentity,
  type PresentationPacket,
} from '../../../nativeReference/game-runtime/presentationPacket';
import { stableHash } from '../../../nativeReference/headless/stableHash';
import {
  BLOCK_PLACEMENT_GAME_ID,
  BLOCK_PLACEMENT_MODULE_VERSION,
} from '../../../nativeReference/games/block-placement/manifest';
import { evaluateBBTimeline, type BBTimelinePlan, type BBTimelineFrame } from './bbTimelinePlan';

export const BB_FRAME_SCHEMA = 'bcs.workbench.block-placement.bb-frame.v5';

/** The checked packet contains the actual shared frame, not a source-specific scene payload. */
export function readBBFrame(packet: PresentationPacket): BBTimelineFrame {
  const payload = packet.payload as { time?: unknown; frame?: BBTimelineFrame } | null,
    frame = payload?.frame;
  if (
    packet.payloadSchemaId !== BB_FRAME_SCHEMA ||
    !frame ||
    frame.takeId !== packet.identity.takeId ||
    frame.frameIndex !== packet.identity.frameIndex ||
    frame.fps !== packet.identity.fps ||
    frame.totalFrames !== packet.identity.totalFrames ||
    frame.timeSeconds !== packet.identity.frameIndex / packet.identity.fps ||
    payload?.time !== frame.timeSeconds ||
    frame.rules?.logicalStateHash !== packet.identity.stateHash ||
    !frame.geometry?.canvas ||
    !frame.geometry.board ||
    !Array.isArray(frame.board) ||
    !Array.isArray(frame.renderBoard) ||
    !Array.isArray(frame.boardDrawables) ||
    frame.boardDrawables.length !== frame.geometry.board.rows * frame.geometry.board.cols ||
    !Array.isArray(frame.rackDrawables) ||
    !Array.isArray(frame.clearRenders) ||
    !Array.isArray(frame.events) ||
    (frame.preview !== null &&
      (!frame.preview?.piece ||
        frame.preview.piece.id !== frame.preview.event?.pieceId ||
        !Array.isArray(frame.preview.piece.cells) ||
        !frame.preview.piece.cells.length)) ||
    [frame.selectionGlow, frame.previewSelectionGlow].some(
      (glow) =>
        glow !== null &&
        (!glow ||
          !glow.config ||
          typeof glow.config.enabled !== 'boolean' ||
          !Number.isFinite(glow.amount) ||
          glow.amount < 0),
    )
  )
    throw new Error('BB_FRAME_CONTRACT_INVALID');
  const grid = frame.geometry.board;
  const surface = frame.boardSurface;
  if (
    surface !== null &&
    (!surface ||
      !Number.isFinite(surface.start) ||
      !Number.isFinite(surface.end) ||
      frame.timeSeconds < surface.start ||
      frame.timeSeconds >= surface.end ||
      !Array.isArray(surface.faces) ||
      surface.faces.length !== grid.rows ||
      surface.faces.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== grid.cols ||
          row.some((face) => !Number.isInteger(face) || face < 0),
      ))
  )
    throw new Error('BB_FRAME_SURFACE_INVALID');
  if (
    frame.renderBoard.length !== grid.rows ||
    frame.renderBoard.some(
      (row, r) =>
        !Array.isArray(row) ||
        row.length !== grid.cols ||
        row.some((color, c) => {
          const original = frame.board[r]?.[c];
          return (
            color !==
            (original !== null && surface ? `observed-face:${surface.faces[r]![c]}` : original)
          );
        }),
    )
  )
    throw new Error('BB_FRAME_RENDER_BOARD_INVALID');
  if (
    frame.recolorFlash !== null &&
    (!frame.recolorFlash ||
      frame.recolorFlash.actionId !== frame.activeAction?.actionId ||
      !Number.isFinite(frame.recolorFlash.opacity) ||
      frame.recolorFlash.opacity < 0 ||
      frame.recolorFlash.opacity > 0.85 ||
      !Array.isArray(frame.recolorFlash.cells) ||
      frame.recolorFlash.cells.length < grid.rows ||
      frame.recolorFlash.cells.some(
        (cell) =>
          !Number.isInteger(cell.row) ||
          !Number.isInteger(cell.col) ||
          cell.row < 0 ||
          cell.row >= grid.rows ||
          cell.col < 0 ||
          cell.col >= grid.cols,
      ))
  )
    throw new Error('BB_FRAME_RECOLOR_FLASH_INVALID');
  if (
    frame.board.length !== grid.rows ||
    frame.board.some((row) => !Array.isArray(row) || row.length !== grid.cols) ||
    frame.boardDrawables.some((cell, index) => {
      const row = Math.floor(index / grid.cols),
        col = index % grid.cols;
      return (
        !cell ||
        cell.row !== row ||
        cell.col !== col ||
        cell.x !== grid.x + col * grid.pitch ||
        cell.y !== grid.y + row * grid.pitch ||
        cell.size !== grid.cell ||
        cell.color !== frame.board[row]?.[col]
      );
    })
  )
    throw new Error('BB_FRAME_BOARD_INVALID');
  return frame;
}

/** Actual common state/event source, not a full visual frame or scene. */
export function createBBTimelineSource(
  plan: BBTimelinePlan,
  identityHash?: string,
): CompiledFrameSource {
  const frameSourceHash =
    identityHash ??
    stableHash({
      contract: BB_FRAME_SCHEMA,
      takeId: plan.takeId,
      fps: plan.fps,
      totalFrames: plan.totalFrames,
      rules: plan.rules,
      display: plan.display,
      events: plan.events.spans,
      score: plan.score,
      actions: plan.actions,
      pointers: plan.pointers,
      pieces: plan.pieces,
      rack: plan.rack,
      rackLayout: plan.rackLayout,
      clears: plan.clears,
      ghosts: plan.ghosts,
      placements: plan.placements,
      visualStatePolicy: plan.visualStatePolicy,
      camera: plan.camera,
      atmosphere: plan.atmosphere,
      scorePopups: plan.scorePopups,
      preview: plan.preview,
      renderActions: plan.renderActions,
      geometry: plan.geometry,
      selectionGlow: plan.selectionGlow,
      recolorFlash: plan.recolorFlash,
      boardSurface: plan.boardSurface,
      previousClearActions: plan.previousClearActions,
    });
  return {
    gameId: BLOCK_PLACEMENT_GAME_ID,
    takeId: plan.takeId,
    fps: plan.fps,
    totalFrames: plan.totalFrames,
    frameSourceHash,
    evaluate(frameIndex) {
      const sampled = evaluateBBTimeline(plan, frameIndex);
      const payload = { time: sampled.timeSeconds, frame: sampled };
      const feedback = { cameraPunch: sampled.cameraPunch };
      return {
        contract: PRESENTATION_PACKET_CONTRACT,
        contractVersion: PRESENTATION_PACKET_CONTRACT_VERSION,
        identity: {
          gameId: BLOCK_PLACEMENT_GAME_ID,
          moduleVersion: BLOCK_PLACEMENT_MODULE_VERSION,
          takeId: plan.takeId,
          frameIndex,
          fps: plan.fps,
          totalFrames: plan.totalFrames,
          stateHash: sampled.rules.logicalStateHash,
          presentationHash: stableHash(
            presentationHashIdentity({
              frameIndex,
              fps: plan.fps,
              totalFrames: plan.totalFrames,
              payload,
              semanticEvents: sampled.events,
              cameraPunch: feedback.cameraPunch,
            }),
          ),
        },
        payloadSchemaId: BB_FRAME_SCHEMA,
        payload,
        semanticEvents: sampled.events,
        feedback,
      };
    },
  };
}
