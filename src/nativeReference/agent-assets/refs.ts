import type { AgentAssetRefEntry } from './contracts';

/**
 * Reference schemes. Every one of them is resolved locally at author time; none of
 * them is fetched during a render, so a rendered frame never depends on the network.
 *
 * - `./assets/bg.png`               project-relative attachment (default, human-readable)
 * - `cas:sha256-<64 hex>`           local content-addressed store (dedupes automatically)
 * - `lib://<assetRef>@sha256-<hex>` element library element, pinned to its content
 */
export type AgentAssetRefKind = 'attachment' | 'cas' | 'library';

export interface ParsedAgentAssetRef {
  kind: AgentAssetRefKind;
  /** Attachment path, CAS digest, or library assetRef. */
  locator: string;
  /** Content digest a resolver must verify. Absent only for attachments. */
  sha256?: string;
}

const HEX64 = /^[a-f0-9]{64}$/;

export function parseAgentAssetRef(ref: unknown): ParsedAgentAssetRef {
  if (typeof ref !== 'string' || !ref || ref.length > 2048) throw new Error(`AGENT_ASSET_REF_INVALID: ${String(ref)}`);
  if (ref.startsWith('cas:sha256-')) {
    const digest = ref.slice('cas:sha256-'.length).toLowerCase();
    if (!HEX64.test(digest)) throw new Error(`AGENT_ASSET_REF_INVALID: ${ref}`);
    return { kind: 'cas', locator: digest, sha256: digest };
  }
  if (ref.startsWith('lib://')) {
    const body = ref.slice('lib://'.length);
    const at = body.lastIndexOf('@sha256-');
    // An unpinned library reference could silently resolve to different bytes later.
    if (at < 0) throw new Error(`AGENT_ASSET_REF_LIBRARY_UNPINNED: ${ref}`);
    const digest = body.slice(at + '@sha256-'.length).toLowerCase();
    const assetRef = body.slice(0, at);
    if (!HEX64.test(digest) || !assetRef) throw new Error(`AGENT_ASSET_REF_INVALID: ${ref}`);
    return { kind: 'library', locator: assetRef, sha256: digest };
  }
  if (!ref.startsWith('./') || ref.includes('..') || ref.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(ref)) {
    throw new Error(`AGENT_ASSET_REF_UNSUPPORTED: ${ref}`);
  }
  return { kind: 'attachment', locator: ref.slice(2) };
}

export function casRef(sha256: string): string {
  if (!HEX64.test(sha256.toLowerCase())) throw new Error(`AGENT_ASSET_REF_INVALID: cas:sha256-${sha256}`);
  return `cas:sha256-${sha256.toLowerCase()}`;
}

export function libraryRef(assetRef: string, sha256: string): string {
  if (!assetRef || assetRef.includes('@sha256-')) throw new Error(`AGENT_ASSET_REF_INVALID: ${assetRef}`);
  if (!HEX64.test(sha256.toLowerCase())) throw new Error(`AGENT_ASSET_REF_INVALID: ${sha256}`);
  return `lib://${assetRef}@sha256-${sha256.toLowerCase()}`;
}

/** Reads the bytes behind one reference. Implementations are local-only by contract. */
export type AgentAssetRefReader = (ref: ParsedAgentAssetRef) => Promise<Uint8Array>;

/** Writes bytes for one reference and returns the reference string to record. */
export type AgentAssetRefWriter = (
  suggestedName: string,
  sha256: string,
  bytes: Uint8Array,
) => Promise<string>;

export const AGENT_ASSET_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

/** Inverse of agentAssetExtension, for restoring a data: URI from an attachment path. */
export function agentAssetMimeTypeFromRef(ref: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(ref)?.[1]?.toLowerCase();
  for (const [mimeType, candidate] of Object.entries(AGENT_ASSET_EXTENSIONS)) {
    if (candidate === extension) return mimeType === 'audio/x-wav' ? 'audio/wav' : mimeType;
  }
  return 'application/octet-stream';
}

/**
 * Identifies a media type from the first bytes of a payload. `cas:` and `lib://`
 * references carry no filename, so extension guessing degrades to
 * `application/octet-stream` and breaks byte-identical inline round-trips; the
 * magic number is the authoritative signal whenever the bytes are available.
 */
export function sniffAgentAssetMimeType(bytes: Uint8Array): string | undefined {
  const startsWith = (magic: number[], offset = 0): boolean => {
    if (bytes.byteLength < offset + magic.length) return false;
    return magic.every((value, index) => bytes[offset + index] === value);
  };
  const ascii = (text: string, offset = 0): boolean =>
    startsWith(Array.from(text, (character) => character.charCodeAt(0)), offset);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii('RIFF') && ascii('WAVE', 8)) return 'audio/wav';
  if (ascii('RIFF') && ascii('WEBP', 8)) return 'image/webp';
  if (ascii('ID3')) return 'audio/mpeg';
  if (startsWith([0xff, 0xfb]) || startsWith([0xff, 0xf3]) || startsWith([0xff, 0xf2])) return 'audio/mpeg';
  // Hashed stores have no .svg suffix. Preserve the SVG media type after a
  // data URI round trip, including XML declarations and leading comments.
  const prefix = new TextDecoder().decode(bytes.subarray(0, 8192));
  if (/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(prefix)) return 'image/svg+xml';
  return undefined;
}

/**
 * MIME type to record when re-inlining resolved bytes. Prefers the byte magic
 * number, then the reference's filename extension, then `application/octet-stream`.
 */
export function agentAssetMimeTypeForBytes(ref: string, bytes: Uint8Array): string {
  return sniffAgentAssetMimeType(bytes) ?? agentAssetMimeTypeFromRef(ref);
}

export function agentAssetExtension(mimeType: string): string {
  return AGENT_ASSET_EXTENSIONS[mimeType] ?? 'bin';
}

/** Total resolved bytes of a stored entry, whether it is inlined or referenced. */
export function agentAssetResolvedBytes(entry: { byteLength?: number; frames?: Array<{ byteLength: number }> }): number {
  if (Array.isArray(entry.frames)) return entry.frames.reduce((sum, frame) => sum + (frame.byteLength ?? 0), 0);
  return entry.byteLength ?? 0;
}

export function isAgentAssetRefEntry(value: unknown): value is AgentAssetRefEntry {
  return !!value && typeof value === 'object' && (value as { encoding?: unknown }).encoding === 'ref';
}
