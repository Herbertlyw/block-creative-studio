import type { BlastFaceSwatch, BlastRgb, ReferenceTilePalette } from '../../../reference2d/referenceProfile';
import type { MaterialThemeId } from './materialThemes';

/** Display material colors, independent of hidden gameplay color identities. */
const BASE: Record<MaterialThemeId, string> = {
  watermelon: '#e95b65', orange: '#ee963c', kiwi: '#91b74b', dragonfruit: '#eee5db',
  cheese: '#edc550', chocolate: '#77452d', ice: '#8bd3e9', gold: '#e6b94f',
  celadon: '#80c6b1', amethyst: '#b28de5', pearl: '#e2e9f0', midnight: '#81a6db',
};
function shade(hex: string, amount: number): string {
  const target = amount < 0 ? 0 : 255;
  return '#' + [1, 3, 5].map(i => {
    const value = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(value + (target - value) * Math.abs(amount)).toString(16).padStart(2, '0');
  }).join('');
}
export function materialClearPalette(id: unknown): ReferenceTilePalette | undefined {
  if (typeof id !== 'string' || !Object.hasOwn(BASE, id)) return undefined;
  const base = BASE[id as MaterialThemeId];
  return { base, top: shade(base, .32), bottom: shade(base, -.28),
    edge: shade(base, -.48), glow: shade(base, .58), motif: shade(base, .8) };
}

export function materialFaceSwatch(id: unknown): BlastFaceSwatch | undefined {
  const palette = materialClearPalette(id);
  if (!palette) return undefined;
  const rgb = (hex: string): BlastRgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  return { outline: rgb(palette.edge), bevelTop: rgb(palette.top), bevelLeft: rgb(palette.base),
    bevelRight: rgb(palette.bottom), bevelBottom: rgb(palette.edge),
    faceTop: rgb(palette.top), faceMid: rgb(palette.base), faceBottom: rgb(palette.bottom) };
}
