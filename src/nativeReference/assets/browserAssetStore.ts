export const BROWSER_ASSET_DB_NAME = 'block-creative-studio-assets';
export const BROWSER_ASSET_DB_VERSION = 1;
export const BROWSER_ASSET_URI_PREFIX = 'bcs-asset://sha256/';
export const DEFAULT_BROWSER_ASSET_MAX_BYTES = 256 * 1024 * 1024;

const BLOBS_STORE = 'blobs';
const METADATA_STORE = 'metadata';
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export type BrowserAssetMediaClass = 'image' | 'audio' | 'video' | 'model' | 'binary';

export interface BrowserAssetMetadata {
  contentHash: string;
  uri: string;
  fileName: string;
  mimeType: string;
  byteLength: number;
  createdAt: string;
  mediaClass: BrowserAssetMediaClass;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export interface BrowserAssetRecord extends BrowserAssetMetadata {
  blob: Blob;
}

export interface BrowserAssetStoreEstimate {
  assetCount: number;
  storedBytes: number;
  quotaBytes?: number;
  usageBytes?: number;
}

export interface PutBrowserAssetOptions {
  fileName?: string;
  mimeType?: string;
  maximumBytes?: number;
  inspectMedia?: boolean;
}

export interface AssetBlobRepository {
  put(record: BrowserAssetRecord): Promise<void>;
  get(contentHash: string): Promise<BrowserAssetRecord | null>;
  getMetadata(contentHash: string): Promise<BrowserAssetMetadata | null>;
  listMetadata(): Promise<BrowserAssetMetadata[]>;
  delete(contentHash: string): Promise<void>;
  clear(): Promise<void>;
  close?(): void;
}

function cloneMetadata(metadata: BrowserAssetMetadata): BrowserAssetMetadata {
  return {
    contentHash: metadata.contentHash,
    uri: metadata.uri,
    fileName: metadata.fileName,
    mimeType: metadata.mimeType,
    byteLength: metadata.byteLength,
    createdAt: metadata.createdAt,
    mediaClass: metadata.mediaClass,
    ...(metadata.width !== undefined ? { width: metadata.width } : {}),
    ...(metadata.height !== undefined ? { height: metadata.height } : {}),
    ...(metadata.durationSeconds !== undefined ? { durationSeconds: metadata.durationSeconds } : {}),
  };
}

function normalizeMimeType(value: string | undefined): string {
  return value?.trim().toLowerCase() || 'application/octet-stream';
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

export function classifyBrowserAssetMedia(
  mimeType: string,
  fileName = '',
): BrowserAssetMediaClass {
  const normalized = normalizeMimeType(mimeType);
  const extension = extensionOf(fileName);
  if (normalized.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'svg'].includes(extension)) {
    return 'image';
  }
  if (normalized.startsWith('audio/') || ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac'].includes(extension)) {
    return 'audio';
  }
  if (normalized.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv'].includes(extension)) {
    return 'video';
  }
  if (
    normalized === 'model/gltf-binary'
    || normalized === 'model/gltf+json'
    || ['glb', 'gltf'].includes(extension)
  ) {
    return 'model';
  }
  return 'binary';
}

export function contentHashToAssetUri(contentHash: string): string {
  if (!SHA256_PATTERN.test(contentHash)) {
    throw new Error('Browser asset contentHash must be sha256:<64 lowercase hex characters>.');
  }
  return `${BROWSER_ASSET_URI_PREFIX}${contentHash.slice('sha256:'.length)}`;
}

export function assetUriToContentHash(uri: string): string | null {
  if (!uri.startsWith(BROWSER_ASSET_URI_PREFIX)) return null;
  const digest = uri.slice(BROWSER_ASSET_URI_PREFIX.length).toLowerCase();
  const contentHash = `sha256:${digest}`;
  return SHA256_PATTERN.test(contentHash) ? contentHash : null;
}

export function normalizeBrowserAssetAddress(value: string): string {
  const fromUri = assetUriToContentHash(value);
  if (fromUri) return fromUri;
  if (!SHA256_PATTERN.test(value)) {
    throw new Error('Expected a sha256 content hash or bcs-asset://sha256 URI.');
  }
  return value;
}

export async function sha256Blob(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SHA-256 is unavailable in this runtime.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const hexadecimal = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hexadecimal}`;
}

async function inspectImage(blob: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    } catch {
      return null;
    }
  }
  return null;
}

async function enrichMetadata(
  blob: Blob,
  metadata: Omit<BrowserAssetMetadata, 'width' | 'height'>,
  inspectMedia: boolean,
): Promise<BrowserAssetMetadata> {
  if (!inspectMedia || metadata.mediaClass !== 'image') return metadata;
  const dimensions = await inspectImage(blob);
  return dimensions ? { ...metadata, ...dimensions } : metadata;
}

export class MemoryAssetBlobRepository implements AssetBlobRepository {
  private readonly records = new Map<string, BrowserAssetRecord>();

  async put(record: BrowserAssetRecord): Promise<void> {
    this.records.set(record.contentHash, {
      ...cloneMetadata(record),
      blob: record.blob.slice(0, record.blob.size, record.blob.type),
    });
  }

  async get(contentHash: string): Promise<BrowserAssetRecord | null> {
    const record = this.records.get(normalizeBrowserAssetAddress(contentHash));
    if (!record) return null;
    return {
      ...cloneMetadata(record),
      blob: record.blob.slice(0, record.blob.size, record.blob.type),
    };
  }

  async getMetadata(contentHash: string): Promise<BrowserAssetMetadata | null> {
    const record = this.records.get(normalizeBrowserAssetAddress(contentHash));
    return record ? cloneMetadata(record) : null;
  }

  async listMetadata(): Promise<BrowserAssetMetadata[]> {
    return [...this.records.values()]
      .map(cloneMetadata)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async delete(contentHash: string): Promise<void> {
    this.records.delete(normalizeBrowserAssetAddress(contentHash));
  }

  async clear(): Promise<void> {
    this.records.clear();
  }

  close(): void {
    // In-memory repository has no external resources.
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
  });
}

export class IndexedDbAssetBlobRepository implements AssetBlobRepository {
  private constructor(private readonly database: IDBDatabase) {}

  static async open(): Promise<IndexedDbAssetBlobRepository> {
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is unavailable. Browser binary assets cannot be persisted.');
    }
    const request = indexedDB.open(BROWSER_ASSET_DB_NAME, BROWSER_ASSET_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BLOBS_STORE)) {
        database.createObjectStore(BLOBS_STORE);
      }
      if (!database.objectStoreNames.contains(METADATA_STORE)) {
        const metadata = database.createObjectStore(METADATA_STORE, { keyPath: 'contentHash' });
        metadata.createIndex('createdAt', 'createdAt');
        metadata.createIndex('mediaClass', 'mediaClass');
      }
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      let blocked = false;
      request.onsuccess = () => {
        if (blocked) {
          request.result.close();
          return;
        }
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error('Unable to open Browser Asset Store.'));
      request.onblocked = () => {
        blocked = true;
        reject(new Error('Browser Asset Store upgrade is blocked by another open tab. Close other tabs and retry.'));
      };
    });
    database.onversionchange = () => database.close();
    return new IndexedDbAssetBlobRepository(database);
  }

  async put(record: BrowserAssetRecord): Promise<void> {
    const transaction = this.database.transaction([BLOBS_STORE, METADATA_STORE], 'readwrite');
    transaction.objectStore(BLOBS_STORE).put(record.blob, record.contentHash);
    transaction.objectStore(METADATA_STORE).put(cloneMetadata(record));
    await transactionComplete(transaction);
  }

  async get(contentHash: string): Promise<BrowserAssetRecord | null> {
    const normalized = normalizeBrowserAssetAddress(contentHash);
    const transaction = this.database.transaction([BLOBS_STORE, METADATA_STORE], 'readonly');
    const blobRequest = transaction.objectStore(BLOBS_STORE).get(normalized) as IDBRequest<Blob | undefined>;
    const metadataRequest = transaction.objectStore(METADATA_STORE).get(normalized) as IDBRequest<BrowserAssetMetadata | undefined>;
    const [blob, metadata] = await Promise.all([
      requestResult(blobRequest),
      requestResult(metadataRequest),
      transactionComplete(transaction),
    ]);
    return blob && metadata ? { ...metadata, blob } : null;
  }

  async getMetadata(contentHash: string): Promise<BrowserAssetMetadata | null> {
    const normalized = normalizeBrowserAssetAddress(contentHash);
    const transaction = this.database.transaction(METADATA_STORE, 'readonly');
    const request = transaction.objectStore(METADATA_STORE).get(normalized) as IDBRequest<BrowserAssetMetadata | undefined>;
    const [metadata] = await Promise.all([requestResult(request), transactionComplete(transaction)]);
    return metadata ? cloneMetadata(metadata) : null;
  }

  async listMetadata(): Promise<BrowserAssetMetadata[]> {
    const transaction = this.database.transaction(METADATA_STORE, 'readonly');
    const request = transaction.objectStore(METADATA_STORE).getAll() as IDBRequest<BrowserAssetMetadata[]>;
    const [records] = await Promise.all([requestResult(request), transactionComplete(transaction)]);
    return records
      .map(cloneMetadata)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async delete(contentHash: string): Promise<void> {
    const normalized = normalizeBrowserAssetAddress(contentHash);
    const transaction = this.database.transaction([BLOBS_STORE, METADATA_STORE], 'readwrite');
    transaction.objectStore(BLOBS_STORE).delete(normalized);
    transaction.objectStore(METADATA_STORE).delete(normalized);
    await transactionComplete(transaction);
  }

  async clear(): Promise<void> {
    const transaction = this.database.transaction([BLOBS_STORE, METADATA_STORE], 'readwrite');
    transaction.objectStore(BLOBS_STORE).clear();
    transaction.objectStore(METADATA_STORE).clear();
    await transactionComplete(transaction);
  }

  close(): void {
    this.database.close();
  }
}

export class BrowserAssetStore {
  constructor(private readonly repository: AssetBlobRepository) {}

  static async openIndexedDb(): Promise<BrowserAssetStore> {
    return new BrowserAssetStore(await IndexedDbAssetBlobRepository.open());
  }

  async putBlob(blob: Blob, options: PutBrowserAssetOptions = {}): Promise<BrowserAssetMetadata> {
    const maximumBytes = options.maximumBytes ?? DEFAULT_BROWSER_ASSET_MAX_BYTES;
    if (!Number.isFinite(maximumBytes) || maximumBytes <= 0) {
      throw new Error('maximumBytes must be a positive finite number.');
    }
    if (blob.size <= 0) throw new Error('Empty files cannot be imported.');
    if (blob.size > maximumBytes) {
      throw new Error(`Asset is ${(blob.size / 1024 / 1024).toFixed(1)} MiB; the limit is ${(maximumBytes / 1024 / 1024).toFixed(1)} MiB.`);
    }

    const fileName = options.fileName?.trim() || 'unnamed-asset';
    const mimeType = normalizeMimeType(options.mimeType || blob.type);
    const contentHash = await sha256Blob(blob);
    const metadata = await enrichMetadata(
      blob,
      {
        contentHash,
        uri: contentHashToAssetUri(contentHash),
        fileName,
        mimeType,
        byteLength: blob.size,
        createdAt: new Date().toISOString(),
        mediaClass: classifyBrowserAssetMedia(mimeType, fileName),
      },
      options.inspectMedia ?? true,
    );
    const existing = await this.repository.getMetadata(contentHash);
    if (!existing) await this.repository.put({ ...metadata, blob });
    return existing ?? metadata;
  }

  async putFile(file: File, options: Omit<PutBrowserAssetOptions, 'fileName' | 'mimeType'> = {}): Promise<BrowserAssetMetadata> {
    return this.putBlob(file, {
      ...options,
      fileName: file.name,
      mimeType: file.type,
    });
  }

  async get(value: string): Promise<BrowserAssetRecord | null> {
    return this.repository.get(normalizeBrowserAssetAddress(value));
  }

  async getMetadata(value: string): Promise<BrowserAssetMetadata | null> {
    return this.repository.getMetadata(normalizeBrowserAssetAddress(value));
  }

  async has(value: string): Promise<boolean> {
    return (await this.getMetadata(value)) !== null;
  }

  async list(): Promise<BrowserAssetMetadata[]> {
    return this.repository.listMetadata();
  }

  async delete(value: string): Promise<void> {
    await this.repository.delete(normalizeBrowserAssetAddress(value));
  }

  async clear(): Promise<void> {
    await this.repository.clear();
  }

  close(): void {
    this.repository.close?.();
  }

  async estimate(): Promise<BrowserAssetStoreEstimate> {
    const records = await this.list();
    const base: BrowserAssetStoreEstimate = {
      assetCount: records.length,
      storedBytes: records.reduce((total, record) => total + record.byteLength, 0),
    };
    if (!globalThis.navigator?.storage?.estimate) return base;
    try {
      const estimate = await globalThis.navigator.storage.estimate();
      return {
        ...base,
        ...(estimate.quota !== undefined ? { quotaBytes: estimate.quota } : {}),
        ...(estimate.usage !== undefined ? { usageBytes: estimate.usage } : {}),
      };
    } catch {
      return base;
    }
  }
}
