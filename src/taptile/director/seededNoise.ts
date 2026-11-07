function mix(value: number): number {
  let result = value | 0;
  result = Math.imul(result ^ (result >>> 16), 0x45d9f3b);
  result = Math.imul(result ^ (result >>> 16), 0x45d9f3b);
  return (result ^ (result >>> 16)) >>> 0;
}

export function seededUnit(seed: number, frame: number, channel: number): number {
  return mix((seed | 0) ^ Math.imul(frame + 1, 0x9e3779b1) ^ Math.imul(channel + 17, 0x85ebca6b)) / 0xffffffff;
}

export function seededSigned(seed: number, frame: number, channel: number): number {
  return seededUnit(seed, frame, channel) * 2 - 1;
}
