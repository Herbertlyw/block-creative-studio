import * as THREE from 'three';
import type { DiagnosticViewId, MaterialRuntimeDescriptor, NormalYConvention } from '../headless/contracts';
import { combineFactorAndSample } from '../headless/materialRuntime';
import { seededFloat } from '../domain/rng';
import type { TileColor } from '../domain/types';
import { TILE_COLOR_HEX } from './materialPresets';

export interface RuntimeTextureSet {
  baseColor?: THREE.Texture;
  normal?: THREE.Texture;
  roughness?: THREE.Texture;
  metallic?: THREE.Texture;
  ao?: THREE.Texture;
  emission?: THREE.Texture;
}

/** OpenGL keeps +Y; DirectX flips Y once. Strength is applied on both axes. */
export function normalScaleForConvention(
  strength: number,
  convention: NormalYConvention | undefined,
): { x: number; y: number } {
  const sign = convention === 'directx' ? -1 : 1;
  return { x: strength, y: strength * sign };
}

export function cellUvJitter(row: number, col: number): {
  offset: [number, number];
  rotationRadians: number;
} {
  const seed = (row + 1) * 1_000_003 + (col + 1);
  return {
    offset: [seededFloat(seed, 1) * 0.41, seededFloat(seed, 2) * 0.41],
    rotationRadians: (seededFloat(seed, 3) - 0.5) * 0.55,
  };
}

function applyUv(
  texture: THREE.Texture,
  descriptor: MaterialRuntimeDescriptor,
  jitter?: { offset: [number, number]; rotationRadians: number },
): void {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(descriptor.uv.repeat[0], descriptor.uv.repeat[1]);
  texture.offset.set(
    descriptor.uv.offset[0] + (jitter?.offset[0] ?? 0),
    descriptor.uv.offset[1] + (jitter?.offset[1] ?? 0),
  );
  texture.rotation = descriptor.uv.rotationRadians + (jitter?.rotationRadians ?? 0);
  texture.needsUpdate = true;
}

function cloneTextureSet(textures: RuntimeTextureSet): RuntimeTextureSet {
  const next: RuntimeTextureSet = {};
  if (textures.baseColor) next.baseColor = textures.baseColor.clone();
  if (textures.normal) next.normal = textures.normal.clone();
  if (textures.roughness) next.roughness = textures.roughness.clone();
  if (textures.metallic) next.metallic = textures.metallic.clone();
  if (textures.ao) next.ao = textures.ao.clone();
  if (textures.emission) next.emission = textures.emission.clone();
  return next;
}

function texturesForCell(
  textures: RuntimeTextureSet | undefined,
  cell?: { row: number; col: number },
): RuntimeTextureSet | undefined {
  if (!textures) return textures;
  return cell ? cloneTextureSet(textures) : textures;
}

function hasMap(
  textures: RuntimeTextureSet | undefined,
  slot: keyof RuntimeTextureSet,
): boolean {
  return Boolean(textures?.[slot]);
}

/**
 * Three.js multiplies factor * map. `replace` therefore sets the factor to 1 (or
 * white for baseColor) so the sample is not scaled again. `multiply-factor` keeps
 * the descriptor factor so the GPU multiply is the intended combine.
 */
function factorForMappedProperty(
  factor: number,
  mapped: boolean,
  combine: MaterialRuntimeDescriptor['combine'],
): number {
  return combineFactorAndSample(factor, mapped ? 1 : undefined, combine);
}

/**
 * Frozen GPU semantics: visible emission = emissiveColor × emissiveMap.
 * A missing factor with a map defaults to 1 so the map is visible. An explicit
 * 0 stays 0 (the map is bound but contributes nothing). `replace` otherwise
 * uses white so the map is not scaled twice.
 */
function emissionMultiplier(
  emission: number | undefined,
  mapped: boolean,
  combine: MaterialRuntimeDescriptor['combine'],
): number {
  if (!mapped) return emission ?? 0;
  const factor = emission ?? 1;
  if (combine === 'replace') return factor === 0 ? 0 : 1;
  return factor;
}

function beautyColor(
  descriptor: MaterialRuntimeDescriptor,
  tile: THREE.Color,
  textures: RuntimeTextureSet | undefined,
): THREE.Color {
  const packColor = new THREE.Color(descriptor.baseColor);
  if (descriptor.combine === 'replace') {
    return hasMap(textures, 'baseColor') ? new THREE.Color(1, 1, 1) : packColor.clone();
  }
  return tile.clone().multiply(packColor);
}

function assignMaps(
  material: THREE.MeshPhysicalMaterial,
  textures: RuntimeTextureSet | undefined,
  descriptor: MaterialRuntimeDescriptor,
  mode: 'beauty' | 'albedo' | 'data' = 'beauty',
  jitter?: { offset: [number, number]; rotationRadians: number },
): void {
  if (!textures) return;
  if (mode === 'albedo') {
    if (textures.baseColor) {
      material.map = textures.baseColor;
      applyUv(textures.baseColor, descriptor, jitter);
    }
    return;
  }
  if (mode === 'data') return;
  if (textures.baseColor) {
    material.map = textures.baseColor;
    applyUv(textures.baseColor, descriptor, jitter);
  }
  if (textures.normal) {
    material.normalMap = textures.normal;
    applyUv(textures.normal, descriptor, jitter);
  }
  if (textures.roughness) {
    material.roughnessMap = textures.roughness;
    applyUv(textures.roughness, descriptor, jitter);
  }
  if (textures.metallic) {
    material.metalnessMap = textures.metallic;
    applyUv(textures.metallic, descriptor, jitter);
  }
  if (textures.ao) {
    material.aoMap = textures.ao;
    applyUv(textures.ao, descriptor, jitter);
  }
  if (textures.emission) {
    material.emissiveMap = textures.emission;
    applyUv(textures.emission, descriptor, jitter);
  }
}

export function createPbrTileMaterial(options: {
  descriptor: MaterialRuntimeDescriptor;
  color: TileColor;
  opacity?: number;
  environmentIntensity?: number;
  textures?: RuntimeTextureSet;
  diagnosticView?: DiagnosticViewId;
  cell?: { row: number; col: number };
}): THREE.MeshPhysicalMaterial {
  const opacity = options.opacity ?? 1;
  const ghosted = opacity < 0.99;
  const textures = texturesForCell(options.textures, options.cell);
  const jitter = options.cell ? cellUvJitter(options.cell.row, options.cell.col) : undefined;
  const tile = new THREE.Color(TILE_COLOR_HEX[options.color]);
  const color = beautyColor(options.descriptor, tile, textures);
  const roughness = factorForMappedProperty(
    options.descriptor.roughness,
    hasMap(textures, 'roughness'),
    options.descriptor.combine,
  );
  const metalness = factorForMappedProperty(
    options.descriptor.metalness,
    hasMap(textures, 'metallic'),
    options.descriptor.combine,
  );
  const emissionMapped = hasMap(textures, 'emission');
  const emission = emissionMultiplier(
    options.descriptor.emission,
    emissionMapped,
    options.descriptor.combine,
  );
  const diagnostic = options.diagnosticView ?? 'beauty';

  if (diagnostic === 'albedo') {
    const material = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0,
      emissive: 0x000000,
      transparent: ghosted,
      opacity,
    });
    assignMaps(material, textures, options.descriptor, 'albedo', jitter);
    return material;
  }
  if (diagnostic === 'roughness' || diagnostic === 'metalness') {
    const value = diagnostic === 'roughness' ? roughness : metalness;
    const dataMap = diagnostic === 'roughness' ? textures?.roughness : textures?.metallic;
    const gray = dataMap ? new THREE.Color(1, 1, 1) : new THREE.Color(value, value, value);
    const material = new THREE.MeshPhysicalMaterial({
      color: gray,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0,
    });
    if (dataMap) {
      material.map = dataMap;
      applyUv(dataMap, options.descriptor, jitter);
    }
    return material;
  }
  if (diagnostic === 'emission' || diagnostic === 'world-normal') {
    return new THREE.MeshPhysicalMaterial({
      color: diagnostic === 'emission' ? new THREE.Color(emission, emission, emission) : color,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0,
      emissive: diagnostic === 'emission' ? color.clone().multiplyScalar(Math.max(0.05, emission)) : 0x000000,
      // Proxy: flatShading stands in for a world-normal buffer; this is not a G-buffer view.
      flatShading: diagnostic === 'world-normal',
    });
  }
  if (diagnostic === 'highlight-clip' || diagnostic === 'bloom-contribution') {
    return new THREE.MeshPhysicalMaterial({
      color,
      roughness,
      metalness,
      envMapIntensity: 0.2,
      // Proxy: extra emissive / LDR near-white, not an HDR clip or bloom buffer.
      emissive: diagnostic === 'bloom-contribution' ? color.clone().multiplyScalar(0.15) : 0x000000,
    });
  }

  const materialParameters: THREE.MeshPhysicalMaterialParameters = {
    color,
    roughness,
    metalness,
    transparent: ghosted,
    opacity,
    depthWrite: opacity >= 0.85,
    envMapIntensity: Math.max(0, options.environmentIntensity ?? 1),
    clearcoat: options.descriptor.clearcoat ?? 0,
    transmission: ghosted ? 0 : options.descriptor.transmission ?? 0,
    ior: options.descriptor.ior ?? 1.5,
    thickness: options.descriptor.thickness ?? 0,
    emissive: color.clone().multiplyScalar(emission),
  };
  if (options.descriptor.specular !== undefined) {
    materialParameters.specularIntensity = options.descriptor.specular;
  }
  const material = new THREE.MeshPhysicalMaterial(materialParameters);
  const convention = options.descriptor.maps.find((map) => map.slot === 'normal')?.normalY;
  if (textures?.normal || options.descriptor.normalStrength !== undefined) {
    const scale = normalScaleForConvention(options.descriptor.normalStrength ?? 1, convention);
    material.normalScale = new THREE.Vector2(scale.x, scale.y);
  }
  assignMaps(material, textures, options.descriptor, 'beauty', jitter);
  return material;
}
