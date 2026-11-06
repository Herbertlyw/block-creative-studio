export type RGB = readonly [number, number, number];
export const rgb = (hex: string): RGB => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as unknown as RGB;
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const lerp = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => v + (b[i]! - v) * clamp(t)) as unknown as RGB;
const noise = (x: number, y: number, seed: number) => {
  let h = Math.imul(x + seed, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295 - .5;
};
export { encodeBase64Bytes as base64 } from './image';
function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
/** Portable PNG transport; no browser screenshot, native addon or external renderer. */
export async function rgbaPng(pixels: Uint8ClampedArray, width: number, height: number): Promise<Uint8Array> {
  if (pixels.length !== width * height * 4) throw new Error('PNG_PIXEL_LENGTH_MISMATCH');
  const rows = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const at = y * (width * 4 + 1); rows[at] = 1;
    for (let x = 0; x < width * 4; x++) rows[at + 1 + x] = (pixels[y * width * 4 + x]! - (x >= 4 ? pixels[y * width * 4 + x - 4]! : 0)) & 255;
  }
  const compressed = new Uint8Array(await new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6;
  function chunk(type: string, data: Uint8Array) {
    const out = new Uint8Array(data.length + 12), v = new DataView(out.buffer);
    v.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
    v.setUint32(out.length - 4, crc(out.subarray(4, out.length - 4))); return out;
  }
  const chunks = [new Uint8Array([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', compressed), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let cursor = 0;
  chunks.forEach(c => { out.set(c, cursor); cursor += c.length; }); return out;
}

export interface MaterialRecipe {
  finish: 'ceramic' | 'satin' | 'honed'; face: string; side: string;
  grain: number; cloud: number; radius: number; bevel: number; depth: number; resolution: number;
}
/** Game-neutral rounded material swatch used by any package with a material asset slot. */
export function materialPixels(recipe: MaterialRecipe): Uint8ClampedArray {
  const n = recipe.resolution, pixels = new Uint8ClampedArray(n * n * 4);
  const face = rgb(recipe.face), side = rgb(recipe.side), center = (n - 1) / 2;
  const pad = Math.max(2, n * .03), half = center - pad, radius = recipe.radius * n;
  const bevel = Math.max(1, recipe.bevel * n), depth = Math.max(1, recipe.depth * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const qx = Math.abs(x - center) - (half - radius), qy = Math.abs(y - center) - (half - radius);
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
    const signedDistance = outside + Math.min(Math.max(qx, qy), 0) - radius;
    if (signedDistance > 0) continue;
    const edgeDistance = -signedDistance, bevelWeight = clamp(1 - edgeDistance / bevel);
    const sideWeight = clamp((y - (center + half - depth * 2)) / (depth * 1.5));
    const tint = lerp(face, side, sideWeight);
    const nx = (x - center) / half, ny = (y - center) / half;
    const reflection = recipe.finish === 'satin' ? 8 : recipe.finish === 'ceramic' ? 5 : 2;
    const cloud = Math.sin(nx * 5.3 + ny * 2.1) * Math.sin(ny * 4.7 - nx * 1.6) * recipe.cloud;
    const highlight = bevelWeight * (-nx - ny) * reflection;
    const shade = 1 - sideWeight * .18;
    const grain = noise(x, y, 37) * recipe.grain;
    const i = (y * n + x) * 4;
    for (let c = 0; c < 3; c++) pixels[i + c] = tint[c]! * shade + highlight + cloud + grain;
    pixels[i + 3] = 255;
  }
  return pixels;
}

export interface BackgroundRecipe { top: string; bottom: string; accent: string; style: 'silk' | 'dunes' | 'arches' | 'halo'; seed: number; texture: number; }
/** Quiet center and detailed perimeter leave room for readable tiles and praise. */
export function backgroundPixels(recipe: BackgroundRecipe, width = 720, height = 1280): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4), top = rgb(recipe.top), bottom = rgb(recipe.bottom), accent = rgb(recipe.accent);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height, edge = Math.pow(Math.abs(u - .5) * 2, 2);
    let col = lerp(top, bottom, v), light = 0;
    if (recipe.style === 'silk') {
      const wave = Math.sin(u * 9 + v * 5 + recipe.seed * .13) + Math.sin(u * 18 - v * 3) * .27;
      light = wave * (6 + edge * 7);
      col = lerp(col, accent, Math.pow(clamp((wave + .9) / 2.3), 3) * (.1 + edge * .2));
    } else if (recipe.style === 'dunes') {
      for (let k = 0; k < 4; k++) {
        const ridge = .73 + k * .08 + Math.sin(u * 4.5 + k * .8 + recipe.seed * .04) * .075;
        const d = v - ridge;
        col = lerp(col, accent, clamp(d * 140) * (.1 + k * .04));
        light += 5 * Math.exp(-Math.pow(d / .008, 2));
      }
    } else if (recipe.style === 'arches') {
      const d = Math.hypot((u - .5) * 1.35, (v - .69) * .8);
      for (let k = 0; k < 4; k++) {
        const ring = Math.exp(-Math.pow((d - .55 - k * .072) / .006, 2));
        col = lerp(col, accent, ring * .38); light += ring * 5;
      }
    } else {
      const halo = Math.exp(-((u - .5) ** 2 / .12 + (v - .36) ** 2 / .07));
      col = lerp(col, accent, halo * .28); light = halo * 8;
      const orbit = Math.hypot((u - .5) * 1.1, (v - .42) * .65);
      col = lerp(col, accent, Math.exp(-Math.pow((orbit - .43) / .003, 2)) * .35);
    }
    const vignette = (u - .5) ** 2 * 17 + Math.max(0, v - .85) * 22;
    const n = noise(x, y, recipe.seed) * recipe.texture;
    const i = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) pixels[i + c] = col[c]! + light - vignette + n;
    pixels[i + 3] = 255;
  }
  return pixels;
}

export interface MusicRecipe { bpm: number; rootMidi: number; mode: 'major' | 'minor' | 'pentatonic'; instrument: 'felt' | 'marimba' | 'bell'; bars: number; seed: number; }
/** An original, deterministic chord/arpeggio loop. Decays wrap across the seam. */
export function composeMusic(recipe: MusicRecipe): { bytes: Uint8Array; seconds: number; peak: number } {
  const rate = 24000, beat = 60 / recipe.bpm, seconds = recipe.bars * 4 * beat, length = Math.round(seconds * rate);
  const left = new Float32Array(length), right = new Float32Array(length);
  const scale = recipe.mode === 'minor' ? [0,2,3,5,7,8,10] : recipe.mode === 'pentatonic' ? [0,2,4,7,9,12,14] : [0,2,4,5,7,9,11];
  function note(midi: number, start: number, gain: number, pan: number, bass = false) {
    const f = 440 * 2 ** ((midi - 69) / 12), decay = bass ? 1.2 : recipe.instrument === 'bell' ? 1.35 : recipe.instrument === 'felt' ? 1.0 : .65;
    const count = Math.ceil(decay * 5 * rate), begin = Math.round(start * rate);
    for (let j = 0; j < count; j++) {
      const t = j / rate, a = Math.sin(2 * Math.PI * f * t), second = Math.sin(2 * Math.PI * f * 2 * t);
      const harmonic = bass ? a : recipe.instrument === 'bell' ? a + .2 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 3) : a + .24 * second * Math.exp(-t * 5) + .06 * Math.sin(2 * Math.PI * f * 3 * t);
      const sample = harmonic * (1 - Math.exp(-t * (bass ? 60 : 170))) * Math.exp(-t / decay) * gain;
      const at = (begin + j) % length;
      left[at] = left[at]! + sample * Math.sqrt((1 - pan) / 2); right[at] = right[at]! + sample * Math.sqrt((1 + pan) / 2);
    }
  }
  const progression = recipe.mode === 'minor' ? [0,5,3,6] : [0,5,3,4];
  for (let bar = 0; bar < recipe.bars; bar++) {
    const root = progression[(bar + recipe.seed) % 4]!;
    const chord = [root, root + 2, root + 4].map(degree => recipe.rootMidi + scale[degree % 7]! + Math.floor(degree / 7) * 12);
    note(chord[0]! - 12, bar * 4 * beat, .15, 0, true);
    for (let step = 0; step < 8; step++) {
      const which = (step + bar + recipe.seed) % 3;
      note(chord[which]! + (step % 4 === 3 ? 12 : 0), (bar * 4 + step / 2) * beat, .095 * (step % 2 ? .72 : 1), which === 0 ? -.25 : .25);
    }
  }
  let peak = 0; for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
  const gain = peak ? .68 / peak : 1, bytes = new Uint8Array(44 + length * 4), view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => bytes.set(new TextEncoder().encode(text), offset);
  write(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, length * 4, true);
  for (let i = 0; i < length; i++) { view.setInt16(44 + i * 4, Math.round(clamp(left[i]! * gain, -1, 1) * 32767), true); view.setInt16(46 + i * 4, Math.round(clamp(right[i]! * gain, -1, 1) * 32767), true); }
  return { bytes, seconds: length / rate, peak: peak * gain };
}
