import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { BcsHeadlessError } from '../headless/errors.js';

const decoder = new TextDecoder();

export interface ExtractedBlenderSceneBundle {
  directory: string;
  scenePath: string;
  packageId: string;
  assetCount: number;
  cleanup(): Promise<void>;
}

interface BlenderBundleManifest {
  format: 'bcs-blender-scene-bundle';
  version: '1.0.0';
  packageId: string;
  scenePath: string;
  assetCount: number;
  sceneSha256: string;
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

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeBundlePath(input: string): string {
  if (!input || input.includes('\\') || input.startsWith('/') || /^[a-z]:/iu.test(input)) {
    throw new BcsHeadlessError('BLENDER_BUNDLE_PATH_UNSAFE', `Unsafe bundle path: ${input}`, { path: input });
  }
  const normalized = posix.normalize(input);
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../') || normalized.endsWith('/')) {
    throw new BcsHeadlessError('BLENDER_BUNDLE_PATH_UNSAFE', `Unsafe bundle path: ${input}`, { path: input });
  }
  return normalized;
}

function decodeStoredZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.byteLength > 256 * 1024 * 1024) throw new BcsHeadlessError('BLENDER_BUNDLE_TOO_LARGE', 'Blender bundle exceeds 256 MiB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { endOffset = offset; break; }
  }
  if (endOffset < 0) throw new BcsHeadlessError('BLENDER_BUNDLE_ZIP_INVALID', 'ZIP end record is missing.');
  const entryCount = view.getUint16(endOffset + 10, true);
  if (entryCount <= 0 || entryCount > 512) throw new BcsHeadlessError('BLENDER_BUNDLE_ENTRY_LIMIT', `Bundle has ${entryCount} entries; allowed range is 1..512.`);
  let centralOffset = view.getUint32(endOffset + 16, true);
  const files = new Map<string, Uint8Array>();
  let extractedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (centralOffset + 46 > bytes.length || view.getUint32(centralOffset, true) !== 0x02014b50) {
      throw new BcsHeadlessError('BLENDER_BUNDLE_ZIP_INVALID', `Invalid ZIP central entry ${index}.`);
    }
    const method = view.getUint16(centralOffset + 10, true);
    if (method !== 0) throw new BcsHeadlessError('BLENDER_BUNDLE_COMPRESSION_UNSUPPORTED', 'Only deterministic stored ZIP bundles are supported.');
    const expectedCrc = view.getUint32(centralOffset + 16, true);
    const size = view.getUint32(centralOffset + 20, true);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const name = safeBundlePath(decoder.decode(bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength)));
    if (files.has(name)) throw new BcsHeadlessError('BLENDER_BUNDLE_DUPLICATE_PATH', `Duplicate bundle path: ${name}`, { path: name });
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new BcsHeadlessError('BLENDER_BUNDLE_ZIP_INVALID', `Invalid local ZIP entry: ${name}`, { path: name });
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) throw new BcsHeadlessError('BLENDER_BUNDLE_ZIP_INVALID', `Truncated ZIP entry: ${name}`, { path: name });
    const data = bytes.slice(dataStart, dataEnd);
    if (crc32(data) !== expectedCrc) throw new BcsHeadlessError('BLENDER_BUNDLE_CRC_MISMATCH', `CRC mismatch: ${name}`, { path: name });
    extractedBytes += data.byteLength;
    if (extractedBytes > 256 * 1024 * 1024) throw new BcsHeadlessError('BLENDER_BUNDLE_TOO_LARGE', 'Extracted Blender bundle exceeds 256 MiB.');
    files.set(name, data);
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function parseJson<T>(files: Map<string, Uint8Array>, path: string): T {
  const bytes = files.get(path);
  if (!bytes) throw new BcsHeadlessError('BLENDER_BUNDLE_FILE_MISSING', `Bundle file is missing: ${path}`, { path });
  try { return JSON.parse(decoder.decode(bytes)) as T; }
  catch { throw new BcsHeadlessError('BLENDER_BUNDLE_JSON_INVALID', `Bundle JSON is invalid: ${path}`, { path }); }
}

export async function extractBlenderSceneBundle(bundlePath: string): Promise<ExtractedBlenderSceneBundle> {
  const absoluteBundle = resolve(bundlePath);
  const files = decodeStoredZip(new Uint8Array(await readFile(absoluteBundle)));
  const checksums = parseJson<Record<string, string>>(files, 'checksums.json');
  const payloadPaths = [...files.keys()].filter((path) => path !== 'checksums.json').sort();
  if (Object.keys(checksums).sort().join('\n') !== payloadPaths.join('\n')) {
    throw new BcsHeadlessError('BLENDER_BUNDLE_CHECKSUM_SET_MISMATCH', 'Bundle checksums do not cover exactly every payload file.', { path: absoluteBundle });
  }
  for (const path of payloadPaths) {
    const expected = checksums[path];
    const bytes = files.get(path)!;
    if (!expected || !/^[a-f0-9]{64}$/iu.test(expected) || digest(bytes) !== expected.toLowerCase()) {
      throw new BcsHeadlessError('BLENDER_BUNDLE_HASH_MISMATCH', `Bundle hash mismatch: ${path}`, { path });
    }
  }
  const manifest = parseJson<BlenderBundleManifest>(files, 'manifests/blender-bundle.json');
  if (manifest.format !== 'bcs-blender-scene-bundle' || manifest.version !== '1.0.0') {
    throw new BcsHeadlessError('BLENDER_BUNDLE_VERSION_UNSUPPORTED', 'Unsupported Blender scene bundle version.', { path: absoluteBundle });
  }
  const scenePath = safeBundlePath(manifest.scenePath);
  const scene = files.get(scenePath);
  if (!scene || digest(scene) !== manifest.sceneSha256.toLowerCase()) {
    throw new BcsHeadlessError('BLENDER_BUNDLE_SCENE_HASH_MISMATCH', 'Scene exchange does not match the bundle manifest.', { path: scenePath });
  }
  const assetCount = payloadPaths.filter((path) => path.startsWith('assets/')).length;
  if (assetCount !== manifest.assetCount) {
    throw new BcsHeadlessError('BLENDER_BUNDLE_ASSET_COUNT_MISMATCH', `Manifest declares ${manifest.assetCount} assets, bundle contains ${assetCount}.`, { path: absoluteBundle });
  }
  const directory = await mkdtemp(join(tmpdir(), 'bcs-blender-bundle-'));
  try {
    for (const [path, data] of files) {
      const destination = join(directory, ...path.split('/'));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, data);
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    directory,
    scenePath: join(directory, ...scenePath.split('/')),
    packageId: manifest.packageId,
    assetCount,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
