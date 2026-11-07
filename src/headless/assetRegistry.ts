import type { AssetManifest, AssetRef } from './contracts.js';
import { BcsHeadlessError } from './errors.js';
import { validateAssetManifest } from './validation.js';

function cloneManifest<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assetKey(ref: Pick<AssetRef, 'id' | 'version'>): string {
  return `${ref.id}@${ref.version}`;
}

export interface RegisterOptions {
  replace?: boolean;
}

export interface ResolveOptions {
  requireHash?: boolean;
}

export class AssetRegistry {
  private readonly manifests = new Map<string, AssetManifest>();

  constructor(initial: AssetManifest[] = []) {
    for (const manifest of initial) this.register(manifest);
  }

  register(manifest: AssetManifest, options: RegisterOptions = {}): void {
    const issues = validateAssetManifest(manifest).filter((candidate) => candidate.severity === 'error');
    if (issues.length) {
      throw new BcsHeadlessError('ASSET_MANIFEST_INVALID', 'Asset manifest failed validation.', {
        ...(issues[0]?.path !== undefined ? { path: issues[0].path } : {}),
        details: issues,
      });
    }

    const key = assetKey(manifest);
    if (this.manifests.has(key) && !options.replace) {
      throw new BcsHeadlessError('ASSET_ALREADY_REGISTERED', `Asset ${key} is already registered.`, {
        path: '$.id',
      });
    }
    this.manifests.set(key, cloneManifest(manifest));
  }

  has(ref: Pick<AssetRef, 'id' | 'version'>): boolean {
    return this.manifests.has(assetKey(ref));
  }

  resolve(ref: AssetRef, options: ResolveOptions = {}): AssetManifest {
    const key = assetKey(ref);
    const manifest = this.manifests.get(key);
    if (!manifest) {
      throw new BcsHeadlessError('ASSET_NOT_FOUND', `Asset ${key} is not registered.`, {
        path: '$.assetRef',
      });
    }
    if (manifest.kind !== ref.kind) {
      throw new BcsHeadlessError(
        'ASSET_KIND_MISMATCH',
        `Asset ${key} is ${manifest.kind}, but the reference expects ${ref.kind}.`,
        { path: '$.assetRef.kind' },
      );
    }
    if (options.requireHash && !manifest.contentHash) {
      throw new BcsHeadlessError('ASSET_HASH_REQUIRED', `Asset ${key} does not declare contentHash.`, {
        path: '$.contentHash',
      });
    }
    if (ref.contentHash && manifest.contentHash && ref.contentHash !== manifest.contentHash) {
      throw new BcsHeadlessError('ASSET_HASH_MISMATCH', `Asset ${key} content hash does not match its reference.`, {
        path: '$.contentHash',
      });
    }
    return cloneManifest(manifest);
  }

  list(): AssetManifest[] {
    return [...this.manifests.values()]
      .map((manifest) => cloneManifest(manifest))
      .sort((left, right) => assetKey(left).localeCompare(assetKey(right)));
  }

  get size(): number {
    return this.manifests.size;
  }
}
