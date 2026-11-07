import { parseTapTileProjectV2, stableHash, stableStringify, type AssetManifestEntry, type TapTileProjectV2 } from '../project';
import { safeFileName } from '../../utils/download';
import { sha256Bytes } from './manifest';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface TapTileProjectBundleManifest {
  format: 'taptile-project-bundle';
  version: '1.0.0';
  projectId: string;
  projectHash: string;
  takeIds: string[];
  assetIds: string[];
  embeddedAssetIds: string[];
}

export interface TapTileProjectBundleResult {
  blob: Blob;
  fileName: string;
  manifest: TapTileProjectBundleManifest;
  checksums: Record<string, string>;
}

export interface ImportedTapTileProjectBundle {
  project: TapTileProjectV2;
  manifest: TapTileProjectBundleManifest;
  checksums: Record<string, string>;
  embeddedAssets: Record<string, Uint8Array>;
}

export type TapTileBundleAssetReader = (entry: AssetManifestEntry) => Promise<Blob | Uint8Array>;

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(`${stableStringify(value)}\n`);
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let current = value;
    for (let bit = 0; bit < 8; bit += 1) current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
    table[value] = current >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export function encodeStoredZip(entries: Record<string, Uint8Array>): Uint8Array {
  const names = Object.keys(entries).sort((left, right) => left.localeCompare(right));
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const name of names) {
    const nameBytes = encoder.encode(name);
    const data = entries[name]!;
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, 0);
    writeUint16(localView, 12, 0);
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, data.length);
    writeUint32(localView, 22, data.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x0800);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, 0);
    writeUint16(centralView, 14, 0);
    writeUint32(centralView, 16, crc);
    writeUint32(centralView, 20, data.length);
    writeUint32(centralView, 24, data.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, localOffset);
    central.set(nameBytes, 46);
    centralParts.push(central);
    localOffset += local.length;
  }
  const centralDirectory = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, names.length);
  writeUint16(endView, 10, names.length);
  writeUint32(endView, 12, centralDirectory.length);
  writeUint32(endView, 16, localOffset);
  writeUint16(endView, 20, 0);
  return concatBytes([...localParts, centralDirectory, end]);
}

export function decodeStoredZip(bytes: Uint8Array): Record<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { endOffset = offset; break; }
  }
  if (endOffset < 0) throw new Error('BUNDLE_ZIP_END_MISSING');
  const entryCount = view.getUint16(endOffset + 10, true);
  let centralOffset = view.getUint32(endOffset + 16, true);
  const files: Record<string, Uint8Array> = {};
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) throw new Error('BUNDLE_ZIP_CENTRAL_INVALID');
    const method = view.getUint16(centralOffset + 10, true);
    if (method !== 0) throw new Error('BUNDLE_ZIP_COMPRESSION_UNSUPPORTED');
    const expectedCrc = view.getUint32(centralOffset + 16, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localHeaderOffset = view.getUint32(centralOffset + 42, true);
    const name = decoder.decode(bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength));
    if (files[name]) throw new Error(`BUNDLE_DUPLICATE_PATH: ${name}`);
    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) throw new Error(`BUNDLE_ZIP_LOCAL_INVALID: ${name}`);
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.slice(dataStart, dataStart + compressedSize);
    if (crc32(data) !== expectedCrc) throw new Error(`BUNDLE_CRC_MISMATCH: ${name}`);
    files[name] = data;
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function assetPath(entry: AssetManifestEntry): string {
  return `assets/${safeFileName(entry.id)}.bin`;
}

export async function exportTapTileProjectBundle(
  project: TapTileProjectV2,
  readAsset?: TapTileBundleAssetReader,
): Promise<TapTileProjectBundleResult> {
  const snapshot = structuredClone(project);
  const files: Record<string, Uint8Array> = {
    'project.json': jsonBytes(snapshot),
    'assets/manifest.json': jsonBytes(snapshot.assets),
  };
  for (const take of [...snapshot.takes].sort((left, right) => left.id.localeCompare(right.id))) {
    files[`takes/${safeFileName(take.id)}.json`] = jsonBytes(take);
  }
  const embeddedAssetIds: string[] = [];
  for (const entry of Object.values(snapshot.assets.entries).sort((left, right) => left.id.localeCompare(right.id))) {
    if (entry.source.type !== 'indexeddb') continue;
    if (!readAsset) throw new Error(`BUNDLE_LOCAL_ASSET_READER_REQUIRED: ${entry.id}`);
    const source = await readAsset(entry);
    const data = source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : new Uint8Array(source);
    const digest = await sha256Bytes(data);
    if (entry.contentHash && /^[a-f0-9]{64}$/i.test(entry.contentHash) && digest.toLowerCase() !== entry.contentHash.toLowerCase()) {
      throw new Error(`BUNDLE_ASSET_HASH_MISMATCH: ${entry.id}`);
    }
    files[assetPath(entry)] = data;
    embeddedAssetIds.push(entry.id);
  }
  const manifest: TapTileProjectBundleManifest = {
    format: 'taptile-project-bundle',
    version: '1.0.0',
    projectId: snapshot.id,
    projectHash: stableHash(snapshot, 'project'),
    takeIds: snapshot.takes.map((take) => take.id).sort(),
    assetIds: Object.keys(snapshot.assets.entries).sort(),
    embeddedAssetIds: embeddedAssetIds.sort(),
  };
  files['manifests/project-manifest.json'] = jsonBytes(manifest);
  const checksums: Record<string, string> = {};
  for (const path of Object.keys(files).sort()) checksums[path] = await sha256Bytes(files[path]!);
  files['checksums.json'] = jsonBytes(checksums);
  const zip = encodeStoredZip(files);
  return {
    blob: new Blob([zip], { type: 'application/zip' }),
    fileName: `${safeFileName(snapshot.name)}.taptile-project.zip`,
    manifest,
    checksums,
  };
}

function parseJson<T>(files: Record<string, Uint8Array>, path: string): T {
  const bytes = files[path];
  if (!bytes) throw new Error(`BUNDLE_REQUIRED_FILE_MISSING: ${path}`);
  try { return JSON.parse(decoder.decode(bytes)) as T; }
  catch { throw new Error(`BUNDLE_JSON_INVALID: ${path}`); }
}

export async function importTapTileProjectBundle(blob: Blob): Promise<ImportedTapTileProjectBundle> {
  const files = decodeStoredZip(new Uint8Array(await blob.arrayBuffer()));
  const checksums = parseJson<Record<string, string>>(files, 'checksums.json');
  for (const [path, expected] of Object.entries(checksums)) {
    const data = files[path];
    if (!data) throw new Error(`BUNDLE_CHECKSUM_FILE_MISSING: ${path}`);
    const actual = await sha256Bytes(data);
    if (actual !== expected) throw new Error(`BUNDLE_CHECKSUM_MISMATCH: ${path}`);
  }
  const project = parseTapTileProjectV2(parseJson<unknown>(files, 'project.json'));
  const manifest = parseJson<TapTileProjectBundleManifest>(files, 'manifests/project-manifest.json');
  if (manifest.format !== 'taptile-project-bundle' || manifest.version !== '1.0.0') throw new Error('BUNDLE_MANIFEST_VERSION_UNSUPPORTED');
  if (manifest.projectId !== project.id || manifest.projectHash !== stableHash(project, 'project')) throw new Error('BUNDLE_PROJECT_HASH_MISMATCH');
  const assetManifest = parseJson<TapTileProjectV2['assets']>(files, 'assets/manifest.json');
  if (stableStringify(assetManifest) !== stableStringify(project.assets)) throw new Error('BUNDLE_ASSET_MANIFEST_MISMATCH');
  for (const take of project.takes) {
    const bundled = parseJson<unknown>(files, `takes/${safeFileName(take.id)}.json`);
    if (stableStringify(bundled) !== stableStringify(take)) throw new Error(`BUNDLE_TAKE_MISMATCH: ${take.id}`);
  }
  const embeddedAssets: Record<string, Uint8Array> = {};
  for (const assetId of manifest.embeddedAssetIds) {
    const entry = project.assets.entries[assetId];
    if (!entry || entry.source.type !== 'indexeddb') throw new Error(`BUNDLE_EMBEDDED_ASSET_UNDECLARED: ${assetId}`);
    const data = files[assetPath(entry)];
    if (!data) throw new Error(`BUNDLE_EMBEDDED_ASSET_MISSING: ${assetId}`);
    const digest = await sha256Bytes(data);
    if (entry.contentHash && /^[a-f0-9]{64}$/i.test(entry.contentHash) && digest.toLowerCase() !== entry.contentHash.toLowerCase()) {
      throw new Error(`BUNDLE_ASSET_HASH_MISMATCH: ${assetId}`);
    }
    embeddedAssets[assetId] = data;
  }
  return { project, manifest, checksums, embeddedAssets };
}
