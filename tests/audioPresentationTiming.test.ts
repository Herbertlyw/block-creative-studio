import { describe, expect, it } from 'vitest';
import { trimMp4AudioPresentation } from '../src/exporter/audioTiming';

// Minimal in-memory MP4 box trees: no external media or fixture assets are required.
const box = (type: string, ...parts: Uint8Array[]): Uint8Array => {
  const size = 8 + parts.reduce((sum, part) => sum + part.length, 0),
    bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, size);
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i);
  let pos = 8;
  for (const part of parts) {
    bytes.set(part, pos);
    pos += part.length;
  }
  return bytes;
};
const clock = (scale: number, duration: number) => {
  const data = new Uint8Array(20),
    view = new DataView(data.buffer);
  view.setUint32(12, scale);
  view.setUint32(16, duration);
  return data;
};
const header = () => new Uint8Array(24);
const handler = (type: string) => {
  const data = new Uint8Array(12);
  for (let i = 0; i < 4; i++) data[8 + i] = type.charCodeAt(i);
  return data;
};
const track = (type: string, edits = false) =>
  box(
    'trak',
    box('tkhd', header()),
    ...(edits ? [box('edts')] : []),
    box('mdia', box('mdhd', clock(48000, 120000)), box('hdlr', handler(type))),
  );
const movie = (
  options: { front?: boolean; audio?: boolean; edits?: boolean; fragmented?: boolean } = {},
) => {
  const moov = box(
    'moov',
    box('mvhd', clock(1000, 2500)),
    track('vide'),
    ...(options.audio === false ? [] : [track('soun', options.edits)]),
  );
  const ftyp = box('ftyp'),
    mdat = box('mdat', new Uint8Array(24)),
    fragment = options.fragmented ? [box('moof')] : [];
  const root = options.front ? [ftyp, moov, mdat, ...fragment] : [ftyp, mdat, moov, ...fragment];
  const out = new Uint8Array(root.reduce((n, item) => n + item.length, 0));
  let offset = 0;
  for (const item of root) {
    out.set(item, offset);
    offset += item.length;
  }
  return out.buffer;
};

describe('MP4 audio presentation timing', () => {
  it('writes the measured media offset and exact presentation duration while preserving packets', () => {
    const original = movie(),
      result = trimMp4AudioPresentation(original, 2112, 48000, 2);
    const bytes = Buffer.from(result),
      old = Buffer.from(original),
      elst = bytes.indexOf('elst'),
      mdat = bytes.indexOf('mdat');
    expect(elst).toBeGreaterThan(0);
    expect(bytes.readBigUInt64BE(elst + 12)).toBe(2000n);
    expect(bytes.readBigInt64BE(elst + 20)).toBe(2112n);
    expect(bytes.subarray(mdat - 4, mdat + 28)).toEqual(old.subarray(mdat - 4, mdat + 28));
    expect(result.byteLength).toBe(original.byteLength + 44);
  });
  it('uses the supplied measurement rather than a fixed encoder constant', () => {
    for (const delay of [0, 1, 1024, 3072]) {
      const bytes = Buffer.from(trimMp4AudioPresentation(movie(), delay, 48000, 1.5));
      const elst = bytes.indexOf('elst');
      expect(bytes.readBigInt64BE(elst + 20)).toBe(BigInt(delay));
      expect(bytes.readBigUInt64BE(elst + 12)).toBe(1500n);
    }
  });
  it('rejects layouts that cannot be rewritten safely', () => {
    expect(() => trimMp4AudioPresentation(movie({ front: true }), 0, 48000, 2)).toThrow();
    expect(() => trimMp4AudioPresentation(movie({ fragmented: true }), 0, 48000, 2)).toThrow();
    expect(() => trimMp4AudioPresentation(movie({ audio: false }), 0, 48000, 2)).toThrow();
    expect(() => trimMp4AudioPresentation(movie({ edits: true }), 0, 48000, 2)).toThrow();
    expect(() => trimMp4AudioPresentation(movie(), -1, 48000, 2)).toThrow();
  });
});
