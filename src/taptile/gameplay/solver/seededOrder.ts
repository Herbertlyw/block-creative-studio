export function createSeededPathState(seed: number): number {
  return (seed | 0) ^ 0x9e3779b9;
}

export function extendSeededPathState(state: number, segment: string, hasPrefix: boolean): number {
  let value = state;
  if (hasPrefix) {
    value = Math.imul(value, 0x45d9f3b);
    value ^= value >>> 16;
  }
  for (let index = 0; index < segment.length; index += 1) {
    value = Math.imul(value ^ segment.charCodeAt(index), 0x45d9f3b);
    value ^= value >>> 16;
  }
  return value;
}

export function rankSeededPathState(state: number): number {
  let value = state;
  value += 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return (value ^ (value >>> 14)) >>> 0;
}

/** A path-derived PRNG rank. It is deterministic and independent of expansion order. */
export function seededPathRank(seed: number, path: readonly string[]): number {
  let state = createSeededPathState(seed);
  for (let index = 0; index < path.length; index += 1) {
    state = extendSeededPathState(state, path[index]!, index > 0);
  }
  return rankSeededPathState(state);
}
