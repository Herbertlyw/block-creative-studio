/** A material state on native landed cells, never a screen-position overlay. */
export interface DropLandingSurfaceFlashCue {
  actionIndex: number;
  canonicalFps: 30;
  color: string;
  /** Indices in this action's native piece commit.spawn list, excluding rising terrain. Omission selects the piece. */
  cellIndices?: number[];
  opacityKeys: Array<{ frameOffset: number; value: number }>;
}

export interface DropLandingSurfaceFlashActionWindow {
  actionIndex: number;
  /** End of airborne commit, the existing piece-landed event frame. */
  originFrame: number;
  endFrame: number;
  cellIds: readonly string[];
}

export interface DropLandingSurfaceFlashBinding {
  cueIndex: number;
  actionIndex: number;
  originFrame: number;
  endFrame: number;
  cellIds: string[];
}

export interface DropLandingSurfaceFlashFrame {
  cueIndex: number;
  elapsedFrames: number;
  cellIds: string[];
}

export const DROP_LANDING_SURFACE_FLASH_MAX_CUES = 2048;
export const DROP_LANDING_SURFACE_FLASH_MAX_KEYS = 64;
export const DROP_LANDING_SURFACE_FLASH_MAX_TOTAL_KEYS = 32768;
const MAX_CELL_INDICES = 4096;
const fail = (path: string): never => {
  throw new Error(`DROP_LANDING_SURFACE_FLASH_INVALID: ${path}`);
};
function object(value: unknown, path: string, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    fail(path);
  return value as Record<string, unknown>;
}
function number(value: unknown, path: string, min: number, max: number, integer = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    fail(path);
  return value as number;
}
function array(value: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path);
  return value as unknown[];
}

export function parseDropLandingSurfaceFlashCues(value: unknown): DropLandingSurfaceFlashCue[] {
  let totalKeys = 0;
  const selected = new Map<number, Set<number> | 'all'>();
  return array(value, 'cues', 0, DROP_LANDING_SURFACE_FLASH_MAX_CUES).map((value, index) => {
    const path = `cues.${index}`,
      cue = object(value, path, [
        'actionIndex',
        'canonicalFps',
        'color',
        'cellIndices',
        'opacityKeys',
      ]);
    const actionIndex = number(cue.actionIndex, path + '.actionIndex', 0, 999, true);
    if (cue.canonicalFps !== 30) fail(path + '.canonicalFps');
    if (typeof cue.color !== 'string' || !/^#[\da-f]{6}$/i.test(cue.color)) fail(path + '.color');
    const cellIndices =
      cue.cellIndices === undefined
        ? undefined
        : array(cue.cellIndices, path + '.cellIndices', 1, MAX_CELL_INDICES).map((v, i) =>
            number(v, `${path}.cellIndices.${i}`, 0, MAX_CELL_INDICES - 1, true),
          );
    if (cellIndices && new Set(cellIndices).size !== cellIndices.length)
      fail(path + '.cellIndices.duplicate');
    const prior = selected.get(actionIndex);
    if (
      prior === 'all' ||
      (prior !== undefined && cellIndices === undefined) ||
      (prior instanceof Set && cellIndices?.some((i) => prior.has(i)))
    )
      fail(path + '.cellIndices.overlap');
    selected.set(
      actionIndex,
      cellIndices === undefined
        ? 'all'
        : new Set([...(prior instanceof Set ? prior : []), ...cellIndices]),
    );
    const opacityKeys = array(
      cue.opacityKeys,
      path + '.opacityKeys',
      2,
      DROP_LANDING_SURFACE_FLASH_MAX_KEYS,
    ).map((value, i) => {
      const key = `${path}.opacityKeys.${i}`,
        row = object(value, key, ['frameOffset', 'value']);
      return {
        frameOffset: number(row.frameOffset, key + '.frameOffset', 0, 864000, true),
        value: number(row.value, key + '.value', 0, 1),
      };
    });
    if (
      opacityKeys[0]!.frameOffset !== 0 ||
      opacityKeys.at(-1)!.value !== 0 ||
      opacityKeys.some((row, i) => i > 0 && row.frameOffset <= opacityKeys[i - 1]!.frameOffset)
    )
      fail(path + '.opacityKeys.order');
    totalKeys += opacityKeys.length;
    if (totalKeys > DROP_LANDING_SURFACE_FLASH_MAX_TOTAL_KEYS) fail('totalKeys');
    return {
      actionIndex,
      canonicalFps: 30,
      color: cue.color as string,
      ...(cellIndices === undefined ? {} : { cellIndices }),
      opacityKeys,
    };
  });
}

/** Pure canonical-time interpolation; nonnegative landed ages only, no pre-roll. */
export function sampleDropLandingSurfaceFlashOpacity(
  cue: DropLandingSurfaceFlashCue,
  elapsedFrames: number,
  outputFps: number,
): number {
  if (!Number.isFinite(elapsedFrames) || !Number.isFinite(outputFps) || outputFps <= 0) return 0;
  const offset = (elapsedFrames * cue.canonicalFps) / outputFps,
    keys = cue.opacityKeys;
  if (offset < 0 || offset >= keys.at(-1)!.frameOffset) return 0;
  const index = keys.findIndex((key) => key.frameOffset >= offset);
  const end = keys[index < 0 ? keys.length - 1 : index]!,
    start = keys[Math.max(0, index - 1)]!;
  const u =
    end.frameOffset === start.frameOffset
      ? 0
      : (offset - start.frameOffset) / (end.frameOffset - start.frameOffset);
  return start.value + (end.value - start.value) * u;
}

/** Bind authored indices to actual runtime spawn IDs and the unchanged action window. */
export function bindDropLandingSurfaceFlashCues(
  cues: readonly DropLandingSurfaceFlashCue[] | undefined,
  actions: readonly DropLandingSurfaceFlashActionWindow[],
  outputFps: number,
): DropLandingSurfaceFlashBinding[] {
  const occupied = new Map<number, Set<string>>();
  return (cues ?? []).map((cue, cueIndex) => {
    const action = actions.find((action) => action.actionIndex === cue.actionIndex);
    if (!action || !action.cellIds.length)
      throw new Error(`DROP_LANDING_SURFACE_FLASH_NATIVE_ACTION_MISSING: ${cueIndex}`);
    const cellIds =
      cue.cellIndices === undefined
        ? [...action.cellIds]
        : cue.cellIndices.map((i) => {
            const id = action.cellIds[i];
            if (id === undefined)
              throw new Error(`DROP_LANDING_SURFACE_FLASH_NATIVE_CELL_MISSING: ${cueIndex}/${i}`);
            return id;
          });
    const prior = occupied.get(cue.actionIndex) ?? new Set<string>();
    if (new Set(cellIds).size !== cellIds.length || cellIds.some((id) => prior.has(id)))
      throw new Error(`DROP_LANDING_SURFACE_FLASH_NATIVE_OVERLAP: ${cueIndex}`);
    for (const id of cellIds) prior.add(id);
    occupied.set(cue.actionIndex, prior);
    const endFrame =
      action.originFrame + (cue.opacityKeys.at(-1)!.frameOffset * outputFps) / cue.canonicalFps;
    if (endFrame > action.endFrame + 1e-8)
      throw new Error(`DROP_LANDING_SURFACE_FLASH_NATIVE_LIFETIME_EXCEEDED: ${cueIndex}`);
    return {
      cueIndex,
      actionIndex: cue.actionIndex,
      originFrame: action.originFrame,
      endFrame,
      cellIds,
    };
  });
}

const int = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum });
export const DROP_LANDING_SURFACE_FLASH_CUES_SCHEMA = {
  type: 'array',
  maxItems: DROP_LANDING_SURFACE_FLASH_MAX_CUES,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['actionIndex', 'canonicalFps', 'color', 'opacityKeys'],
    properties: {
      actionIndex: int(0, 999),
      canonicalFps: { const: 30 },
      color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
      cellIndices: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_CELL_INDICES,
        uniqueItems: true,
        items: int(0, MAX_CELL_INDICES - 1),
      },
      opacityKeys: {
        type: 'array',
        minItems: 2,
        maxItems: DROP_LANDING_SURFACE_FLASH_MAX_KEYS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['frameOffset', 'value'],
          properties: {
            frameOffset: int(0, 864000),
            value: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
    },
  },
};
