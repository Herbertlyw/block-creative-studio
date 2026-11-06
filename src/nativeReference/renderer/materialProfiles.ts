import type { LightingPresetId, MaterialPresetId } from '../domain/types';

export interface BlockMaterialOptics {
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  transmission: number;
  thickness: number;
  ior: number;
  iridescence: number;
  sheen: number;
  emissiveScale: number;
  environmentScale: number;
}

/**
 * Neutralized material baselines. Cinematic energy should come from clear-event
 * emission and dedicated VFX, not from every static tile behaving like a lamp.
 */
export const BLOCK_MATERIAL_OPTICS: Record<MaterialPresetId, BlockMaterialOptics> = {
  'glossy-plastic': {
    roughness: 0.34,
    metalness: 0,
    clearcoat: 0.26,
    clearcoatRoughness: 0.24,
    transmission: 0,
    thickness: 0,
    ior: 1.46,
    iridescence: 0,
    sheen: 0.06,
    emissiveScale: 0.004,
    environmentScale: 0.86,
  },
  'candy-resin': {
    roughness: 0.26,
    metalness: 0,
    clearcoat: 0.38,
    clearcoatRoughness: 0.18,
    transmission: 0.16,
    thickness: 0.42,
    ior: 1.44,
    iridescence: 0,
    sheen: 0.08,
    emissiveScale: 0.008,
    environmentScale: 0.94,
  },
  'crystal-glass': {
    roughness: 0.16,
    metalness: 0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.14,
    transmission: 0.7,
    thickness: 0.62,
    ior: 1.51,
    iridescence: 0.04,
    sheen: 0,
    emissiveScale: 0.006,
    environmentScale: 1.06,
  },
};

export interface LightingValues {
  ambient: number;
  key: number;
  fill: number;
  rim: number;
  exposure: number;
  keyColor: number;
  fillColor: number;
  rimColor: number;
}

/**
 * Light intensities are intentionally conservative. The previous experimental
 * values stacked strong PMREM reflections, clearcoat, rim lights, exposure and
 * full-screen bloom, which erased tile color and material readability.
 */
export const LIGHTING_VALUES: Record<LightingPresetId, LightingValues> = {
  'neutral-lookdev': {
    ambient: 0.82,
    key: 2.15,
    fill: 0.55,
    rim: 0.32,
    exposure: 0.94,
    keyColor: 0xffffff,
    fillColor: 0xd9e5ff,
    rimColor: 0xffffff,
  },
  'clean-studio': {
    ambient: 0.98,
    key: 2.65,
    fill: 0.82,
    rim: 1,
    exposure: 0.98,
    keyColor: 0xfff8ef,
    fillColor: 0xbfd7ff,
    rimColor: 0xffffff,
  },
  'soft-candy': {
    ambient: 1.04,
    key: 2.72,
    fill: 0.96,
    rim: 1.26,
    exposure: 1,
    keyColor: 0xffeee8,
    fillColor: 0xc8d9ff,
    rimColor: 0xffd3ef,
  },
  'neon-contrast': {
    ambient: 0.76,
    key: 3.15,
    fill: 1.05,
    rim: 2.15,
    exposure: 1.01,
    keyColor: 0xb8d7ff,
    fillColor: 0xff8fd8,
    rimColor: 0x73f5ff,
  },
};
