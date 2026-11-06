export const GAME_REPLAY_CONTRACT = 'bcs.game-replay' as const;
export const GAME_REPLAY_CONTRACT_VERSION = '1.0.0' as const;

export interface GameActionEnvelope {
  id: string;
  actor: 'human' | 'agent';
  schemaId: string;
  action: unknown;
}

export interface InteractionSample {
  frameOffset: number;
  x: number;
  y: number;
}

export interface InteractionRecord {
  id: string;
  modality: 'pointer' | 'touch' | 'tap' | 'system';
  startFrame: number;
  endFrame: number;
  samples?: InteractionSample[];
  committedActionId?: string;
  metadata?: Record<string, unknown>;
}

export interface GameReplayEnvelope {
  contract: typeof GAME_REPLAY_CONTRACT;
  contractVersion: typeof GAME_REPLAY_CONTRACT_VERSION;
  gameId: string;
  moduleVersion: string;
  takeId: string;
  initialStateHash: string;
  seed: number;
  actions: GameActionEnvelope[];
  interactions: InteractionRecord[];
}

export function semanticReplayIdentity(replay: GameReplayEnvelope): unknown {
  return {
    contract: replay.contract,
    contractVersion: replay.contractVersion,
    gameId: replay.gameId,
    moduleVersion: replay.moduleVersion,
    takeId: replay.takeId,
    seed: replay.seed,
    initialStateHash: replay.initialStateHash,
    actions: replay.actions.map((item) => ({
      id: item.id,
      actor: item.actor,
      schemaId: item.schemaId,
      action: item.action,
    })),
  };
}

export function frameReplayIdentity(
  replay: GameReplayEnvelope,
  extras: { rhythm: unknown; fps: number; totalFrames: number },
): unknown {
  return {
    semantic: semanticReplayIdentity(replay),
    interactions: replay.interactions,
    rhythm: extras.rhythm,
    fps: extras.fps,
    totalFrames: extras.totalFrames,
  };
}

export function splitPointerPlacement(action: {
  id: string;
  actor: 'human' | 'agent';
  pieceId: string;
  anchor: { row: number; col: number };
  durationFrames: number;
  pointerPath: InteractionSample[];
  actionSchemaId: string;
}): { semantic: GameActionEnvelope; interaction: InteractionRecord } {
  const interaction: InteractionRecord = {
    id: `interaction-${action.id}`,
    modality: 'pointer',
    startFrame: 0,
    endFrame: action.durationFrames,
    samples: action.pointerPath.map((sample) => ({ ...sample })),
    committedActionId: action.id,
  };
  return {
    semantic: {
      id: action.id,
      actor: action.actor,
      schemaId: action.actionSchemaId,
      action: {
        pieceId: action.pieceId,
        anchor: { ...action.anchor },
      },
    },
    interaction,
  };
}
