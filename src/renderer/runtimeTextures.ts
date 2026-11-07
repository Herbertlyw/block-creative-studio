import * as THREE from 'three';
import type { MaterialMapBinding, TextureChannel } from '../headless/contracts';
import { needsThreeJsChannelSwizzle, remapChannelsForThreeJsSlot } from '../headless/materialRuntime';
import { assetUriToContentHash } from '../assets/browserAssetStore';
import type { RuntimeAssetBindings } from '../assets/runtimeAssetBindings';
import type { RuntimeTextureSet } from './pbrMaterialFactory';

export const MAX_RUNTIME_TEXTURE_BYTES = 16 * 1024 * 1024;
export const MAX_RUNTIME_TEXTURE_DIMENSION = 4096;

function slotTexture(set: RuntimeTextureSet, slot: MaterialMapBinding['slot'], texture: THREE.Texture): void {
  if (slot === 'baseColor') set.baseColor = texture;
  else if (slot === 'normal') set.normal = texture;
  else if (slot === 'roughness') set.roughness = texture;
  else if (slot === 'metallic') set.metallic = texture;
  else if (slot === 'ao') set.ao = texture;
  else if (slot === 'emission') set.emission = texture;
  else if (slot === 'orm') {
    set.ao = texture;
    set.roughness = texture;
    set.metallic = texture;
  }
}

/** Identity of GPU texture objects (reload when this changes). */
export function runtimeTextureResourceKey(
  maps: readonly MaterialMapBinding[],
  bindings?: RuntimeAssetBindings | null,
): string {
  return maps
    .map((map) => {
      const source = resolvePreparedTextureUrl(map, bindings) ?? map.uri;
      return `${map.slot}:${map.contentHash}:${source}:${map.channels}:${map.colorSpace}`;
    })
    .sort()
    .join('|');
}

/** @deprecated Use runtimeTextureResourceKey. Kept for existing call sites. */
export function runtimeTextureCacheKey(maps: readonly MaterialMapBinding[]): string {
  return runtimeTextureResourceKey(maps);
}

function imageSize(image: TexImageSource): { width: number; height: number } {
  if ('naturalWidth' in image && typeof image.naturalWidth === 'number') {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  if ('width' in image && 'height' in image) {
    return { width: Number(image.width) || 0, height: Number(image.height) || 0 };
  }
  return { width: 0, height: 0 };
}

export function swizzleImageDataForThreeSlot(
  source: ImageData,
  slot: MaterialMapBinding['slot'],
  channels: TextureChannel,
): ImageData {
  if (!needsThreeJsChannelSwizzle(slot, channels)) return source;
  const output = new ImageData(source.width, source.height);
  const src = source.data;
  const dst = output.data;
  for (let index = 0; index < src.length; index += 4) {
    const remapped = remapChannelsForThreeJsSlot({
      r: src[index] ?? 0,
      g: src[index + 1] ?? 0,
      b: src[index + 2] ?? 0,
      a: src[index + 3] ?? 255,
    }, slot, channels);
    dst[index] = remapped.r;
    dst[index + 1] = remapped.g;
    dst[index + 2] = remapped.b;
    dst[index + 3] = remapped.a;
  }
  return output;
}

function swizzleTextureIfNeeded(texture: THREE.Texture, map: MaterialMapBinding): THREE.Texture {
  if (map.slot === 'orm' || !needsThreeJsChannelSwizzle(map.slot, map.channels)) return texture;
  const image = texture.image as TexImageSource | undefined;
  if (!image) return texture;
  const { width, height } = imageSize(image);
  if (width <= 0 || height <= 0) return texture;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return texture;
  context.drawImage(image as CanvasImageSource, 0, 0);
  const swizzled = swizzleImageDataForThreeSlot(
    context.getImageData(0, 0, width, height),
    map.slot,
    map.channels,
  );
  context.putImageData(swizzled, 0, 0);
  texture.dispose();
  const next = new THREE.CanvasTexture(canvas);
  next.colorSpace = map.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  next.anisotropy = 4;
  next.needsUpdate = true;
  return next;
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function assertSha256ContentHash(contentHash: string, digestHex: string): void {
  if (!/^sha256:[0-9a-f]{64}$/i.test(contentHash)) {
    throw new Error(`Hash 不符：renderer 只接受 sha256 内容哈希，收到 ${contentHash}`);
  }
  const expected = contentHash.slice('sha256:'.length).toLowerCase();
  if (expected !== digestHex.toLowerCase()) {
    throw new Error(`Hash 不符：声明 ${contentHash}，实际 sha256:${digestHex}`);
  }
}

export function assertTextureBudget(byteLength: number, width = 0, height = 0): void {
  if (byteLength > MAX_RUNTIME_TEXTURE_BYTES) {
    throw new Error(`纹理超过字节上限 (${byteLength} > ${MAX_RUNTIME_TEXTURE_BYTES})`);
  }
  if (width > MAX_RUNTIME_TEXTURE_DIMENSION || height > MAX_RUNTIME_TEXTURE_DIMENSION) {
    throw new Error(`纹理尺寸超过上限 ${width}×${height}`);
  }
}

export function isBrowserAssetMapUri(uri: string): boolean {
  return Boolean(assetUriToContentHash(uri));
}

export function resolvePreparedTextureUrl(
  map: MaterialMapBinding,
  bindings?: RuntimeAssetBindings | null,
): string | null {
  if (!bindings) return null;
  const prepared = bindings.textureMaps.find((item) => item.contentHash === map.contentHash)
    ?? bindings.textureMaps.find((item) => item.sourceUri === map.uri);
  return prepared?.objectUrl ?? null;
}

/**
 * Fetch URL for a material map. `bcs-asset://` must be resolved from
 * PreparedResources / `runtimeAssets.textureMaps` first; the custom scheme is
 * not fetchable.
 */
export function resolveMaterialMapFetchUrl(
  map: MaterialMapBinding,
  bindings?: RuntimeAssetBindings | null,
): string {
  const prepared = resolvePreparedTextureUrl(map, bindings);
  if (prepared) return prepared;
  if (isBrowserAssetMapUri(map.uri)) {
    throw new Error(
      `PBR map ${map.contentHash} (${map.uri}) is not in PreparedResources/runtimeAssets.textureMaps`,
    );
  }
  return map.uri;
}

async function fetchTextureBytes(uri: string): Promise<ArrayBuffer> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`PBR map failed to load: ${uri} ${response.status}`);
  }
  return response.arrayBuffer();
}

export async function loadRuntimeTextureSet(
  maps: readonly MaterialMapBinding[],
  bindings?: RuntimeAssetBindings | null,
): Promise<RuntimeTextureSet> {
  if (maps.length === 0) return {};
  const ordered = [...maps].sort((left, right) => left.slot.localeCompare(right.slot));
  const loader = new THREE.TextureLoader();
  const jobs = ordered.map(async (map) => {
    const sourceUrl = resolveMaterialMapFetchUrl(map, bindings);
    const bytes = await fetchTextureBytes(sourceUrl);
    assertTextureBudget(bytes.byteLength);
    const digest = await sha256Hex(bytes);
    assertSha256ContentHash(map.contentHash, digest);
    const blob = new Blob([bytes]);
    const objectUrl = URL.createObjectURL(blob);
    try {
      const loaded = await loader.loadAsync(objectUrl);
      const texture = swizzleTextureIfNeeded(loaded, map);
      texture.colorSpace = map.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      const { width, height } = imageSize(texture.image as TexImageSource);
      assertTextureBudget(bytes.byteLength, width, height);
      return { map, texture };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  });
  const settled = await Promise.allSettled(jobs);
  const textures: THREE.Texture[] = [];
  const failures: string[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      textures.push(result.value.texture);
    } else {
      failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }
  if (failures.length > 0) {
    for (const texture of textures) texture.dispose();
    throw new Error(`PBR map failed to load: ${failures.join('; ')}`);
  }
  const set: RuntimeTextureSet = {};
  for (const result of settled) {
    if (result.status === 'fulfilled') slotTexture(set, result.value.map.slot, result.value.texture);
  }
  return set;
}

export function disposeRuntimeTextureSet(set: RuntimeTextureSet | undefined): void {
  if (!set) return;
  const seen = new Set<THREE.Texture>();
  for (const texture of Object.values(set)) {
    if (!texture || seen.has(texture)) continue;
    seen.add(texture);
    texture.dispose();
  }
}
