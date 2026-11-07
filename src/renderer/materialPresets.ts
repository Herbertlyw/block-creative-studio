import * as THREE from 'three';
import type { MaterialPresetId, TileColor } from '../domain/types';

export const TILE_COLOR_HEX: Record<TileColor, number> = {
  coral: 0xff5f6d,
  amber: 0xffb341,
  lime: 0x83e35c,
  cyan: 0x42d9dd,
  blue: 0x4b7cff,
  violet: 0x9d62ff,
  rose: 0xe85f98,
};

export { BLOCK_MATERIAL_OPTICS, LIGHTING_VALUES } from './materialProfiles';
import { BLOCK_MATERIAL_OPTICS } from './materialProfiles';

export function createBlockMaterial(
  color: TileColor,
  preset: MaterialPresetId,
  opacity = 1,
  environmentIntensity = 1,
): THREE.MeshPhysicalMaterial {
  const base = new THREE.Color(TILE_COLOR_HEX[color]);
  const optics = BLOCK_MATERIAL_OPTICS[preset];
  const ghosted = opacity < 0.99;
  const common: THREE.MeshPhysicalMaterialParameters = {
    color: base,
    roughness: optics.roughness,
    metalness: optics.metalness,
    transparent: ghosted,
    opacity,
    depthWrite: opacity >= 0.85,
    side: THREE.FrontSide,
    envMapIntensity: optics.environmentScale * Math.max(0, environmentIntensity),
    clearcoat: optics.clearcoat,
    clearcoatRoughness: optics.clearcoatRoughness,
    sheen: optics.sheen,
    sheenColor: base.clone().lerp(new THREE.Color(0xffffff), 0.24),
    emissive: base.clone().multiplyScalar(optics.emissiveScale),
    ior: optics.ior,
  };

  if (preset === 'glossy-plastic') {
    return new THREE.MeshPhysicalMaterial(common);
  }

  if (preset === 'candy-resin') {
    return new THREE.MeshPhysicalMaterial({
      ...common,
      // Transparent placement ghosts use alpha only. Combining low opacity and
      // transmission produces unstable sorting and excessive brightening.
      transmission: ghosted ? 0 : optics.transmission,
      thickness: optics.thickness,
      attenuationColor: base,
      attenuationDistance: 3.4,
    });
  }

  return new THREE.MeshPhysicalMaterial({
    ...common,
    transmission: ghosted ? 0 : optics.transmission,
    thickness: optics.thickness,
    iridescence: optics.iridescence,
    iridescenceIOR: 1.3,
    attenuationColor: base.clone().lerp(new THREE.Color(0xffffff), 0.12),
    attenuationDistance: 2.2,
  });
}
