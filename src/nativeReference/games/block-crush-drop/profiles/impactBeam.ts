/** A native, numerical landing effect attached to one existing clear wave. */
export interface DropImpactBeamCue {
  id: string;
  actionIndex: number;
  cycleIndex: number;
  canonicalFps: number;
  coordinateSpace: 'source-stage-pixels';
  x: number;
  topY: number;
  bottomY: number;
  color: string;
  opacity: number;
  horizontalFalloff: Array<{ distancePixels: number; value: number }>;
  opacityKeys: Array<{ frameOffset: number; value: number }>;
  bloom?: {
    centerY: number;
    radiusX: number;
    radiusY: number;
    opacity: number;
    color: string;
    /** Independent canonical clear age; omission retains the shaft envelope. */
    envelopeKeys?: Array<{ frameOffset: number; value: number }>;
    /** Normalized ellipse radius with constant light before the soft edge. */
    plateauRadiusFraction?: number;
  };
}

export const DROP_IMPACT_BEAM_MAX_CUES = 2048;
export const DROP_IMPACT_BEAM_MAX_KEYS = 64;
export const DROP_IMPACT_BEAM_MAX_TOTAL_KEYS = 32768;
const fail = (path: string): never => {
  throw new Error(`DROP_IMPACT_BEAM_INVALID: ${path}`);
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
function color(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) fail(path);
  return value as string;
}
function array(value: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path);
  return value as unknown[];
}

function envelopeKeys(
  value: unknown,
  path: string,
  requireAgeZero: boolean,
): DropImpactBeamCue['opacityKeys'] {
  const keys = array(value, path, 2, DROP_IMPACT_BEAM_MAX_KEYS).map((value, i) => {
    const key = `${path}.${i}`,
      row = object(value, key, ['frameOffset', 'value']);
    return {
      frameOffset: number(row.frameOffset, key + '.frameOffset', -30, 864000, true),
      value: number(row.value, key + '.value', 0, 1),
    };
  });
  if (
    keys.at(-1)!.value !== 0 ||
    keys.some((row, i) => i > 0 && row.frameOffset <= keys[i - 1]!.frameOffset) ||
    (requireAgeZero && !keys.some((row) => row.frameOffset === 0))
  )
    fail(path + '.order');
  return keys;
}

export function parseDropImpactBeamCues(value: unknown): DropImpactBeamCue[] {
  const ids = new Set<string>();
  let totalKeys = 0;
  return array(value, 'cues', 0, DROP_IMPACT_BEAM_MAX_CUES).map((value, index) => {
    const path = `cues.${index}`;
    const cue = object(value, path, [
      'id',
      'actionIndex',
      'cycleIndex',
      'canonicalFps',
      'coordinateSpace',
      'x',
      'topY',
      'bottomY',
      'color',
      'opacity',
      'horizontalFalloff',
      'opacityKeys',
      'bloom',
    ]);
    if (
      typeof cue.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(cue.id) ||
      ids.has(cue.id)
    )
      fail(path + '.id');
    const id = cue.id as string;
    ids.add(id);
    if (cue.coordinateSpace !== 'source-stage-pixels') fail(path + '.coordinateSpace');
    const horizontalFalloff = array(
      cue.horizontalFalloff,
      path + '.horizontalFalloff',
      2,
      DROP_IMPACT_BEAM_MAX_KEYS,
    ).map((value, i) => {
      const key = `${path}.horizontalFalloff.${i}`,
        row = object(value, key, ['distancePixels', 'value']);
      return {
        distancePixels: number(row.distancePixels, key + '.distancePixels', 0, 1080),
        value: number(row.value, key + '.value', 0, 1),
      };
    });
    if (
      horizontalFalloff[0]!.distancePixels !== 0 ||
      horizontalFalloff[0]!.value !== 1 ||
      horizontalFalloff.at(-1)!.value !== 0 ||
      horizontalFalloff.some(
        (row, i) =>
          i > 0 &&
          (row.distancePixels <= horizontalFalloff[i - 1]!.distancePixels ||
            row.value > horizontalFalloff[i - 1]!.value),
      )
    )
      fail(path + '.horizontalFalloff.order');
    const opacityKeys = envelopeKeys(cue.opacityKeys, path + '.opacityKeys', false);
    const topY = number(cue.topY, path + '.topY', -1920, 3840),
      bottomY = number(cue.bottomY, path + '.bottomY', -1920, 3840);
    if (bottomY <= topY) fail(path + '.verticalRange');
    let bloom: DropImpactBeamCue['bloom'];
    if (cue.bloom !== undefined) {
      const row = object(cue.bloom, path + '.bloom', [
        'centerY',
        'radiusX',
        'radiusY',
        'opacity',
        'color',
        'envelopeKeys',
        'plateauRadiusFraction',
      ]);
      bloom = {
        centerY: number(row.centerY, path + '.bloom.centerY', -1920, 3840),
        radiusX: number(row.radiusX, path + '.bloom.radiusX', 0.1, 1080),
        radiusY: number(row.radiusY, path + '.bloom.radiusY', 0.1, 1920),
        opacity: number(row.opacity, path + '.bloom.opacity', 0, 1),
        color: color(row.color, path + '.bloom.color'),
        ...(row.envelopeKeys === undefined
          ? {}
          : { envelopeKeys: envelopeKeys(row.envelopeKeys, path + '.bloom.envelopeKeys', true) }),
        ...(row.plateauRadiusFraction === undefined
          ? {}
          : {
              plateauRadiusFraction: number(
                row.plateauRadiusFraction,
                path + '.bloom.plateauRadiusFraction',
                0,
                0.95,
              ),
            }),
      };
    }
    totalKeys += horizontalFalloff.length + opacityKeys.length + (bloom?.envelopeKeys?.length ?? 0);
    if (totalKeys > DROP_IMPACT_BEAM_MAX_TOTAL_KEYS) fail('totalKeys');
    return {
      id,
      actionIndex: number(cue.actionIndex, path + '.actionIndex', 0, 999, true),
      cycleIndex: number(cue.cycleIndex, path + '.cycleIndex', 0, 63, true),
      canonicalFps: number(cue.canonicalFps, path + '.canonicalFps', 1, 240, true),
      coordinateSpace: 'source-stage-pixels' as const,
      x: number(cue.x, path + '.x', -1080, 2160),
      topY,
      bottomY,
      color: color(cue.color, path + '.color'),
      opacity: number(cue.opacity, path + '.opacity', 0, 1),
      horizontalFalloff,
      opacityKeys,
      ...(bloom ? { bloom } : {}),
    };
  });
}

/** Independent of render order, clip offset, fragment lifetime and normalized progress. */
export function sampleDropImpactBeamOpacity(
  cue: DropImpactBeamCue,
  elapsedFrames: number,
  outputFps: number,
): number {
  return sampleEnvelope(cue.opacityKeys, cue.canonicalFps, elapsedFrames, outputFps);
}

/** Bloom has its own clear-age clock only when explicitly authored. */
export function sampleDropImpactBloomOpacity(
  cue: DropImpactBeamCue,
  elapsedFrames: number,
  outputFps: number,
): number {
  return sampleEnvelope(
    cue.bloom?.envelopeKeys ?? cue.opacityKeys,
    cue.canonicalFps,
    elapsedFrames,
    outputFps,
  );
}

function sampleEnvelope(
  keys: DropImpactBeamCue['opacityKeys'],
  canonicalFps: number,
  elapsedFrames: number,
  outputFps: number,
): number {
  if (!Number.isFinite(elapsedFrames) || !Number.isFinite(outputFps) || outputFps <= 0) return 0;
  const offset = (elapsedFrames * canonicalFps) / outputFps;
  if (offset < keys[0]!.frameOffset - 1e-8 || offset > keys.at(-1)!.frameOffset + 1e-8) return 0;
  const index = keys.findIndex((key) => key.frameOffset >= offset - 1e-8);
  const end = keys[index < 0 ? keys.length - 1 : index]!,
    start = keys[Math.max(0, (index < 0 ? keys.length - 1 : index) - 1)]!;
  const u =
    end.frameOffset === start.frameOffset
      ? 0
      : Math.max(
          0,
          Math.min(1, (offset - start.frameOffset) / (end.frameOffset - start.frameOffset)),
        );
  return start.value + (end.value - start.value) * u;
}

export function validateDropImpactBeamBindings(
  beams: readonly DropImpactBeamCue[] | undefined,
  waves: ReadonlyArray<{
    actionIndex?: number;
    cycleIndex?: number;
    startFrame: number;
    originFrame?: number;
    endFrame: number;
  }>,
  outputFps: number,
): void {
  for (const beam of beams ?? []) {
    const wave = waves.find(
      (wave) => wave.actionIndex === beam.actionIndex && wave.cycleIndex === beam.cycleIndex,
    );
    if (!wave) throw new Error(`DROP_IMPACT_BEAM_NATIVE_WAVE_MISSING: ${beam.id}`);
    const origin = wave.originFrame ?? wave.startFrame;
    const bloomKeys = beam.bloom?.envelopeKeys ?? beam.opacityKeys;
    const first =
      origin +
      (Math.min(beam.opacityKeys[0]!.frameOffset, bloomKeys[0]!.frameOffset) * outputFps) /
        beam.canonicalFps;
    const end =
      origin +
      (Math.max(beam.opacityKeys.at(-1)!.frameOffset, bloomKeys.at(-1)!.frameOffset) * outputFps) /
        beam.canonicalFps;
    if (Math.max(0, first) < wave.startFrame - 1e-8 || end > wave.endFrame + 1e-8)
      throw new Error(`DROP_IMPACT_BEAM_NATIVE_LIFETIME_EXCEEDED: ${beam.id}`);
  }
}

const n = (minimum: number, maximum: number) => ({ type: 'number', minimum, maximum });
const int = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum });
export const DROP_IMPACT_BEAM_CUES_SCHEMA = {
  type: 'array',
  maxItems: DROP_IMPACT_BEAM_MAX_CUES,
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'actionIndex',
      'cycleIndex',
      'canonicalFps',
      'coordinateSpace',
      'x',
      'topY',
      'bottomY',
      'color',
      'opacity',
      'horizontalFalloff',
      'opacityKeys',
    ],
    properties: {
      id: {
        type: 'string',
        minLength: 1,
        maxLength: 80,
        pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$',
      },
      actionIndex: int(0, 999),
      cycleIndex: int(0, 63),
      canonicalFps: int(1, 240),
      coordinateSpace: { const: 'source-stage-pixels' },
      x: n(-1080, 2160),
      topY: n(-1920, 3840),
      bottomY: n(-1920, 3840),
      color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
      opacity: n(0, 1),
      horizontalFalloff: {
        type: 'array',
        minItems: 2,
        maxItems: DROP_IMPACT_BEAM_MAX_KEYS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['distancePixels', 'value'],
          properties: { distancePixels: n(0, 1080), value: n(0, 1) },
        },
      },
      opacityKeys: {
        type: 'array',
        minItems: 2,
        maxItems: DROP_IMPACT_BEAM_MAX_KEYS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['frameOffset', 'value'],
          properties: { frameOffset: int(-30, 864000), value: n(0, 1) },
        },
      },
      bloom: {
        type: 'object',
        additionalProperties: false,
        required: ['centerY', 'radiusX', 'radiusY', 'opacity', 'color'],
        properties: {
          centerY: n(-1920, 3840),
          radiusX: n(0.1, 1080),
          radiusY: n(0.1, 1920),
          opacity: n(0, 1),
          color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          plateauRadiusFraction: n(0, 0.95),
          envelopeKeys: {
            type: 'array',
            minItems: 2,
            maxItems: DROP_IMPACT_BEAM_MAX_KEYS,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['frameOffset', 'value'],
              properties: { frameOffset: int(-30, 864000), value: n(0, 1) },
            },
          },
        },
      },
    },
  },
};
