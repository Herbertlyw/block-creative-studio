import {
  AGENT_SEQUENCE_DEFAULT_PLAYBACK,
  type AgentAssetSlotDeclaration,
  type AgentImageBinding,
  type AgentSequenceAsset,
  type AgentSequencePlayback,
} from './contracts';

export const AGENT_SEQUENCE_PLAYBACK_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    startOffsetFrames: { type: 'integer', minimum: 0, maximum: 900 },
    durationFrames: { type: ['integer', 'null'], minimum: 1, maximum: 900 },
    speed: { type: 'number', minimum: 0.25, maximum: 4 },
    loop: { type: 'boolean' },
    holdLastFrame: { type: 'boolean' },
  },
} as const;

export function parseAgentSequencePlayback(value: unknown): AgentSequencePlayback | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AGENT_SEQUENCE_PLAYBACK_INVALID');
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!Object.hasOwn(AGENT_SEQUENCE_PLAYBACK_SCHEMA.properties, key)) throw new Error(`AGENT_SEQUENCE_PLAYBACK_FIELD_UNKNOWN: ${key}`);
  }
  const playback = { ...AGENT_SEQUENCE_DEFAULT_PLAYBACK, ...source } as AgentSequencePlayback;
  if (!Number.isInteger(playback.startOffsetFrames) || playback.startOffsetFrames < 0 || playback.startOffsetFrames > 900) throw new Error('AGENT_SEQUENCE_START_OFFSET_INVALID');
  if (playback.durationFrames !== null && (!Number.isInteger(playback.durationFrames) || playback.durationFrames < 1 || playback.durationFrames > 900)) throw new Error('AGENT_SEQUENCE_DURATION_INVALID');
  if (typeof playback.speed !== 'number' || !Number.isFinite(playback.speed) || playback.speed < 0.25 || playback.speed > 4) throw new Error('AGENT_SEQUENCE_SPEED_INVALID');
  if (typeof playback.loop !== 'boolean' || typeof playback.holdLastFrame !== 'boolean') throw new Error('AGENT_SEQUENCE_PLAYBACK_FLAG_INVALID');
  if (playback.loop && playback.holdLastFrame) throw new Error('AGENT_SEQUENCE_LOOP_AND_HOLD_CONFLICT');
  return playback;
}

/** Shared by mutation and render resolution so a hand-edited project cannot bypass slot limits. */
export function validateAgentSequenceBinding(binding: AgentImageBinding, slot: AgentAssetSlotDeclaration, asset: AgentSequenceAsset): void {
  if (slot.assetKind !== 'sequence' || !slot.sequence) throw new Error(`AGENT_SEQUENCE_SLOT_UNSUPPORTED: ${slot.slotId}`);
  if (asset.frames.length > slot.sequence.maxFrames) throw new Error(`AGENT_SEQUENCE_FRAME_BUDGET_EXCEEDED_FOR_SLOT: ${slot.slotId}`);
  if (asset.fps < slot.sequence.minFps || asset.fps > slot.sequence.maxFps) throw new Error(`AGENT_SEQUENCE_FPS_UNSUPPORTED_FOR_SLOT: ${slot.slotId}`);
  if (asset.byteLength > slot.maxBytes || asset.width > slot.maxWidth || asset.height > slot.maxHeight
    || asset.width * asset.height > slot.maxPixels) throw new Error(`AGENT_SEQUENCE_BUDGET_EXCEEDED_FOR_SLOT: ${slot.slotId}`);
  if (binding.inset !== 0) throw new Error(`AGENT_SEQUENCE_INSET_UNSUPPORTED: ${slot.slotId}`);
  parseAgentSequencePlayback(binding.playback);
}

export interface AgentSequenceTiming {
  /** Frames elapsed since the bound event's own presentation start. */
  elapsedFrames: number;
  /** Presentation frames per second of the render, not of the source sequence. */
  presentationFps: number;
  frameCount: number;
  sequenceFps: number;
  playback: AgentSequencePlayback;
}

/**
 * Deterministic source-frame selection. Returns null when nothing should be drawn,
 * so a bound sequence never silently holds a stale frame outside its window.
 */
export function agentSequenceFrameIndex(timing: AgentSequenceTiming): number | null {
  const { elapsedFrames, presentationFps, frameCount, sequenceFps, playback } = timing;
  if (frameCount < 1 || presentationFps <= 0) return null;
  const local = elapsedFrames - playback.startOffsetFrames;
  if (local < 0) return null;
  if (playback.durationFrames !== null && local >= playback.durationFrames) return null;
  const advanced = Math.floor(local * sequenceFps * playback.speed / presentationFps);
  if (advanced < frameCount) return advanced;
  if (playback.loop) return advanced % frameCount;
  if (playback.holdLastFrame) return frameCount - 1;
  return null;
}
