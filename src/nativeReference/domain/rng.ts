export function hash32(input: number): number {
  let x = input | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function seededFloat(seed: number, index: number): number {
  return hash32(seed ^ Math.imul(index + 1, 0x9e3779b1)) / 0x1_0000_0000;
}

export function seededInt(seed: number, index: number, maxExclusive: number): number {
  if (maxExclusive <= 0) throw new Error('maxExclusive must be greater than zero.');
  return Math.floor(seededFloat(seed, index) * maxExclusive);
}
