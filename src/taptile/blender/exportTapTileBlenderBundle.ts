import type { BlenderExchangeImageAsset, BlenderSceneExchange } from '../../headless/blenderContracts';
import { safeFileName } from '../../utils/download';
import { resolveTapTileBuiltinAssetUrl } from '../assetUrl';
import { stableStringify } from '../project';
import { sha256Bytes } from '../production/manifest';
import { encodeStoredZip } from '../production/projectBundle';

const encoder = new TextEncoder();

export interface TapTileBlenderBundleManifest {
  format: 'bcs-blender-scene-bundle';
  version: '1.0.0';
  packageId: string;
  scenePath: 'scene-exchange.json';
  assetCount: number;
  assetIds: string[];
  sceneSha256: string;
}

export interface TapTileBlenderBundleResult {
  blob: Blob;
  fileName: string;
  manifest: TapTileBlenderBundleManifest;
  checksums: Record<string, string>;
  exchange: BlenderSceneExchange;
}

export type TapTileBlenderAssetReader = (asset: BlenderExchangeImageAsset) => Promise<Uint8Array | Blob>;

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(`${stableStringify(value)}\n`);
}

function extensionFor(asset: BlenderExchangeImageAsset): string {
  const source = asset.source.type === 'builtin-uri' ? asset.source.uri : asset.source.path;
  const match = source.match(/\.(png|jpe?g|webp)$/iu);
  return match ? `.${match[1]!.toLowerCase().replace('jpeg', 'jpg')}` : '.image';
}

function bundleAssetPath(asset: BlenderExchangeImageAsset): string {
  return `assets/${safeFileName(asset.id)}${extensionFor(asset)}`;
}

async function defaultAssetReader(asset: BlenderExchangeImageAsset): Promise<Uint8Array> {
  if (asset.source.type !== 'builtin-uri') {
    throw new Error(`BLENDER_BUNDLE_ASSET_READER_REQUIRED: ${asset.id}`);
  }
  const response = await fetch(resolveTapTileBuiltinAssetUrl(asset.source.uri));
  if (!response.ok) throw new Error(`BLENDER_BUNDLE_ASSET_FETCH_FAILED: ${asset.id} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

function readmeText(): Uint8Array {
  return encoder.encode([
    'Block Creative Studio · Blender Scene Bundle',
    '',
    '1. Compile this bundle directly (no manual extraction):',
    '   bcs dcc compile-blender <this-file>.bcs-blender.zip --output compiled',
    '2. The CLI verifies every bundled checksum before Blender is launched.',
    '3. The compiler verifies scene data, asset hashes, GLB structure and triangle budgets.',
    '4. Open compiled/scene.normalized.blend for editable Blender work.',
    '5. Import compiled/scene.vfx.glb back into Studio for the smallest production overlay; scene.glb remains the full review scene.',
    '',
  ].join('\n'));
}

export async function exportTapTileBlenderBundle(
  sourceExchange: BlenderSceneExchange,
  options: { fileNameBase?: string; readAsset?: TapTileBlenderAssetReader } = {},
): Promise<TapTileBlenderBundleResult> {
  const exchange = structuredClone(sourceExchange);
  const files: Record<string, Uint8Array> = {};
  const readAsset = options.readAsset ?? defaultAssetReader;
  for (const asset of exchange.assets) {
    const source = await readAsset(asset);
    const bytes = source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : new Uint8Array(source);
    if (bytes.byteLength === 0) throw new Error(`BLENDER_BUNDLE_ASSET_EMPTY: ${asset.id}`);
    const digest = await sha256Bytes(bytes);
    if (asset.contentHash && digest.toLowerCase() !== asset.contentHash.toLowerCase()) {
      throw new Error(`BLENDER_BUNDLE_ASSET_HASH_MISMATCH: ${asset.id}`);
    }
    const path = bundleAssetPath(asset);
    files[path] = bytes;
    asset.source = { type: 'package-path', path };
    asset.contentHash = digest;
  }
  files['scene-exchange.json'] = jsonBytes(exchange);
  const sceneSha256 = await sha256Bytes(files['scene-exchange.json']!);
  const manifest: TapTileBlenderBundleManifest = {
    format: 'bcs-blender-scene-bundle',
    version: '1.0.0',
    packageId: exchange.id,
    scenePath: 'scene-exchange.json',
    assetCount: exchange.assets.length,
    assetIds: exchange.assets.map((asset) => asset.id).sort((left, right) => left.localeCompare(right)),
    sceneSha256,
  };
  files['manifests/blender-bundle.json'] = jsonBytes(manifest);
  files['README.txt'] = readmeText();
  const checksums: Record<string, string> = {};
  for (const path of Object.keys(files).sort((left, right) => left.localeCompare(right))) {
    checksums[path] = await sha256Bytes(files[path]!);
  }
  files['checksums.json'] = jsonBytes(checksums);
  const zip = encodeStoredZip(files);
  return {
    blob: new Blob([zip], { type: 'application/zip' }),
    fileName: `${safeFileName(options.fileNameBase ?? exchange.id)}.bcs-blender.zip`,
    manifest,
    checksums,
    exchange,
  };
}
