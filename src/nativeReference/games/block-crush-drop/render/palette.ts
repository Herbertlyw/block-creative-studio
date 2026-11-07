export const BLOCK_CRUSH_DROP_PALETTES = [
  'classic-wood',
  'moonlit-slate',
  'honey-gold',
  'candy-pop',
  'arcade-bevel',
] as const;
export type BlockCrushDropPalette = (typeof BLOCK_CRUSH_DROP_PALETTES)[number];

export function resolveBlockCrushDropPalette(value: unknown): BlockCrushDropPalette {
  if (value === undefined) return 'classic-wood';
  if (BLOCK_CRUSH_DROP_PALETTES.includes(value as BlockCrushDropPalette))
    return value as BlockCrushDropPalette;
  throw new Error(`Unsupported Block Crush Drop palette ${String(value)}.`);
}

export function paletteFromCrushStyle(style: unknown): BlockCrushDropPalette {
  if (style === undefined) return 'classic-wood';
  if (!style || typeof style !== 'object' || Array.isArray(style))
    throw new Error('direction.style must be an object.');
  return resolveBlockCrushDropPalette((style as { palette?: unknown }).palette);
}

export function paletteFromCrushRuntimeAssets(runtimeAssets: unknown): BlockCrushDropPalette {
  if (!runtimeAssets || typeof runtimeAssets !== 'object') return 'classic-wood';
  return resolveBlockCrushDropPalette((runtimeAssets as { palette?: unknown }).palette);
}

export function crushCanvasFilter(palette: BlockCrushDropPalette): string {
  if (palette === 'moonlit-slate')
    return 'hue-rotate(154deg) saturate(0.72) brightness(0.86) contrast(1.05)';
  return 'none';
}
