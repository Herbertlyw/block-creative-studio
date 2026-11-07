import { BrowserAssetStore } from '../../assets/browserAssetStore';
import { createTapTileBlenderVfxAsset, type TapTileBlenderVfxAsset } from './blenderVfxAsset';

const POINTER_PREFIX = 'taptile-blender-vfx/v1/';

interface BlenderVfxPointer {
  version: 1;
  projectId: string;
  contentHash: string;
  fileName: string;
  byteLength: number;
}

export interface TapTileBlenderVfxPersistenceOptions {
  store?: BrowserAssetStore;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

function storageFor(options: TapTileBlenderVfxPersistenceOptions): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const storage = options.storage ?? globalThis.localStorage;
  if (!storage) throw new Error('BLENDER_VFX_LOCAL_STORAGE_UNAVAILABLE');
  return storage;
}

function pointerKey(projectId: string): string {
  return `${POINTER_PREFIX}${projectId}`;
}

function parsePointer(value: string | null, projectId: string): BlenderVfxPointer | null {
  if (!value) return null;
  try {
    const pointer = JSON.parse(value) as Partial<BlenderVfxPointer>;
    if (
      pointer.version !== 1
      || pointer.projectId !== projectId
      || typeof pointer.contentHash !== 'string'
      || !/^sha256:[a-f0-9]{64}$/u.test(pointer.contentHash)
      || typeof pointer.fileName !== 'string'
      || typeof pointer.byteLength !== 'number'
      || pointer.byteLength <= 0
    ) return null;
    return pointer as BlenderVfxPointer;
  } catch {
    return null;
  }
}

export async function persistTapTileBlenderVfxAsset(
  projectId: string,
  asset: TapTileBlenderVfxAsset,
  options: TapTileBlenderVfxPersistenceOptions = {},
): Promise<void> {
  const store = options.store ?? await BrowserAssetStore.openIndexedDb();
  const ownsStore = !options.store;
  try {
    const metadata = await store.putBlob(new Blob([asset.buffer], { type: 'model/gltf-binary' }), {
      fileName: asset.fileName,
      mimeType: 'model/gltf-binary',
      inspectMedia: false,
    });
    const expected = `sha256:${asset.sha256}`;
    if (metadata.contentHash !== expected) throw new Error('BLENDER_VFX_PERSISTED_HASH_MISMATCH');
    const pointer: BlenderVfxPointer = {
      version: 1,
      projectId,
      contentHash: metadata.contentHash,
      fileName: asset.fileName,
      byteLength: asset.byteLength,
    };
    storageFor(options).setItem(pointerKey(projectId), JSON.stringify(pointer));
  } finally {
    if (ownsStore) store.close();
  }
}

export async function restoreTapTileBlenderVfxAsset(
  projectId: string,
  options: TapTileBlenderVfxPersistenceOptions = {},
): Promise<TapTileBlenderVfxAsset | null> {
  const storage = storageFor(options);
  const key = pointerKey(projectId);
  const rawPointer = storage.getItem(key);
  const pointer = parsePointer(rawPointer, projectId);
  if (!pointer) {
    if (rawPointer !== null) storage.removeItem(key);
    return null;
  }
  const store = options.store ?? await BrowserAssetStore.openIndexedDb();
  const ownsStore = !options.store;
  try {
    const record = await store.get(pointer.contentHash);
    if (!record || record.byteLength !== pointer.byteLength) {
      storage.removeItem(key);
      return null;
    }
    const asset = await createTapTileBlenderVfxAsset(await record.blob.arrayBuffer(), pointer.fileName);
    if (`sha256:${asset.sha256}` !== pointer.contentHash) {
      storage.removeItem(key);
      throw new Error('BLENDER_VFX_RESTORED_HASH_MISMATCH');
    }
    return asset;
  } finally {
    if (ownsStore) store.close();
  }
}

export function forgetTapTileBlenderVfxAsset(
  projectId: string,
  options: Pick<TapTileBlenderVfxPersistenceOptions, 'storage'> = {},
): void {
  storageFor(options).removeItem(pointerKey(projectId));
}
