import type { AgentAssetEntry, AgentAssetExtensionV1 } from './contracts';

/**
 * Where a payload is stored, as opposed to what it is. An asset inlined as base64
 * and the same asset held as a reference differ only in these keys, so a content
 * identity drops them and keeps `sha256`.
 */
const STORAGE_KEYS: readonly string[] = ['data', 'ref', 'encoding'];

/** Shallow copy without the storage-location keys; nested values stay shared. */
export function stripStoredPayload(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (STORAGE_KEYS.includes(key)) continue;
    output[key] = value[key];
  }
  return output;
}

/**
 * Content identity of one stored asset. Sequence frames are projected too, since
 * each frame carries its own `sha256` next to its own payload.
 */
export function agentAssetContentIdentity(entry: AgentAssetEntry): unknown {
  const record = entry as unknown as Record<string, unknown>;
  const projected = stripStoredPayload(record);
  const frames = record.frames;
  if (Array.isArray(frames)) {
    projected.frames = frames.map((frame) => (frame && typeof frame === 'object' && !Array.isArray(frame)
      ? stripStoredPayload(frame as Record<string, unknown>)
      : frame));
  }
  return projected;
}

/** Content identity of the whole extension. Bindings hold no payload, so they pass through. */
export function agentAssetExtensionContentIdentity(extension: AgentAssetExtensionV1): unknown {
  return {
    version: extension.version,
    bindings: extension.bindings,
    entries: Object.fromEntries(Object.entries(extension.entries)
      .map(([id, entry]) => [id, agentAssetContentIdentity(entry)])),
  };
}

/** Audio `{ assets }` containers: keep cues/gains, drop `data`/`ref`/`encoding`. */
export function audioContainerContentIdentity(container: unknown): unknown {
  if (!container || typeof container !== 'object' || Array.isArray(container)) return container;
  const source = container as Record<string, unknown>;
  if (source.assets === undefined || !source.assets || typeof source.assets !== 'object' || Array.isArray(source.assets)) {
    return container;
  }
  return {
    ...source,
    assets: Object.fromEntries(Object.entries(source.assets as Record<string, unknown>).map(([id, entry]) => [
      id,
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? stripStoredPayload(entry as Record<string, unknown>)
        : entry,
    ])),
  };
}
