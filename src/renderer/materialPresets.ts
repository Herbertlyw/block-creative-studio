import * as THREE from 'three';
import type { LightingPresetId, MaterialPresetId, TileColor } from '../domain/types';

export const TILE_COLOR_HEX: Record<TileColor, number> = {
  coral: 0xff5f6d,
  amber: 0xffb341,
  lime: 0x83e35c,
  cyan: 0x42d9dd,
  blue: 0x4b7cff,
  violet: 0x9d62ff,
  rose: 0xff4d8d,
};

export function createBlockMaterial(
  color: TileColor,
  preset: MaterialPresetId,
  opacity = 1,
): THREE.MeshPhysicalMaterial {
  const base = new THREE.Color(TILE_COLOR_HEX[color]);
  const common: THREE.MeshPhysicalMaterialParameters = {
    color: base,
    roughness: 0.25,
    metalness: 0,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 0.85,
    side: THREE.FrontSide,
    envMapIntensity: 1.35,
  };

  if (preset === 'glossy-plastic') {
    return new THREE.MeshPhysicalMaterial({
      ...common,
      roughness: 0.2,
      clearcoat: 0.78,
      clearcoatRoughness: 0.09,
      sheen: 0.14,
      sheenColor: base.clone().lerp(new THREE.Color(0xffffff), 0.42),
      emissive: base.clone().multiplyScalar(0.022),
    });
  }

  if (preset === 'candy-resin') {
    return new THREE.MeshPhysicalMaterial({
      ...common,
      roughness: 0.13,
      transmission: 0.2,
      thickness: 0.5,
      ior: 1.44,
      clearcoat: 0.92,
      clearcoatRoughness: 0.055,
      attenuationColor: base,
      attenuationDistance: 2.8,
      emissive: base.clone().multiplyScalar(0.038),
      transparent: true,
      opacity: Math.min(opacity, 0.97),
      depthWrite: true,
      envMapIntensity: 1.58,
    });
  }

  return new THREE.MeshPhysicalMaterial({
    ...common,
    roughness: 0.055,
    transmission: 0.64,
    thickness: 0.76,
    ior: 1.51,
    clearcoat: 1,
    clearcoatRoughness: 0.026,
    iridescence: 0.13,
    iridescenceIOR: 1.3,
    attenuationColor: base.clone().lerp(new THREE.Color(0xffffff), 0.18),
    attenuationDistance: 1.7,
    emissive: base.clone().multiplyScalar(0.05),
    transparent: true,
    opacity,
    depthWrite: true,
    envMapIntensity: 1.78,
  });
}

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

export const LIGHTING_VALUES: Record<LightingPresetId, LightingValues> = {
  'clean-studio': {
    ambient: 1.35,
    key: 4.4,
    fill: 2.0,
    rim: 3.1,
    exposure: 1.06,
    keyColor: 0xfff8ef,
    fillColor: 0xbfd7ff,
    rimColor: 0xffffff,
  },
  'soft-candy': {
    ambient: 1.55,
    key: 4.1,
    fill: 2.5,
    rim: 2.8,
    exposure: 1.1,
    keyColor: 0xffeee8,
    fillColor: 0xc8d9ff,
    rimColor: 0xffd3ef,
  },
  'neon-contrast': {
    ambient: 0.92,
    key: 5.3,
    fill: 2.2,
    rim: 5.0,
    exposure: 1.14,
    keyColor: 0xb8d7ff,
    fillColor: 0xff8fd8,
    rimColor: 0x73f5ff,
  },
};
