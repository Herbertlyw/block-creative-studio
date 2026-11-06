import type { StudioProjectDirectionV2, StudioProjectDocumentV2 } from '../game-runtime/projectEnvelope';
import { decodeBase64Image, encodeBase64Bytes, sha256Hex } from './image';
import {
  agentAssetExtension,
  parseAgentAssetRef,
  type AgentAssetRefReader,
  type AgentAssetRefWriter,
} from './refs';

/**
 * Moves stored bytes between JSON payloads and an external location. Shared by
 * TapTile (inner project) and other games that keep bytes on the studio document
 * (`direction.style.agentAssets` and `direction.production.audio`).
 */

export interface ExternalizeReport {
  movedAssets: number;
  movedFrames: number;
  writtenFiles: number;
  /** Bytes taken out of the JSON, before base64 expansion. */
  movedBytes: number;
  skipped: Array<{ site: string; id: string; reason: string }>;
}

export interface InlineReport {
  resolvedAssets: number;
  resolvedFrames: number;
  resolvedBytes: number;
}

export interface WriteContext {
  write: AgentAssetRefWriter;
  used: Map<string, string>;
  report: ExternalizeReport;
}

export function emptyExternalizeReport(): ExternalizeReport {
  return { movedAssets: 0, movedFrames: 0, writtenFiles: 0, movedBytes: 0, skipped: [] };
}

export function emptyInlineReport(): InlineReport {
  return { resolvedAssets: 0, resolvedFrames: 0, resolvedBytes: 0 };
}

export function createWriteContext(write: AgentAssetRefWriter): WriteContext {
  return { write, used: new Map(), report: emptyExternalizeReport() };
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function safeAssetFileName(value: string): string {
  return value.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'asset';
}

/** Stable, readable attachment name; the digest is only appended to break a collision. */
function suggestName(context: WriteContext, id: string, mimeType: string, sha256: string): string {
  const base = safeAssetFileName(id), extension = agentAssetExtension(mimeType);
  const plain = `${base}.${extension}`;
  const claimed = context.used.get(plain);
  if (claimed === undefined || claimed === sha256) {
    context.used.set(plain, sha256);
    return plain;
  }
  const unique = `${base}-${sha256.slice(0, 8)}.${extension}`;
  context.used.set(unique, sha256);
  return unique;
}

export async function writeInlinePayload(
  context: WriteContext,
  id: string,
  mimeType: string,
  data: string,
  declaredSha256: string | undefined,
): Promise<{ ref: string; sha256: string; byteLength: number }> {
  const bytes = decodeBase64Image(data);
  const sha256 = declaredSha256?.toLowerCase() ?? await sha256Hex(bytes);
  const actual = await sha256Hex(bytes);
  if (actual !== sha256) throw new Error(`ASSET_EXTERNALIZE_SHA256_MISMATCH: ${id}`);
  const ref = await context.write(suggestName(context, id, mimeType, sha256), sha256, bytes);
  context.report.writtenFiles += 1;
  context.report.movedBytes += bytes.byteLength;
  return { ref, sha256, byteLength: bytes.byteLength };
}

export async function externalizeStoredAsset(
  context: WriteContext,
  site: string,
  id: string,
  stored: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (stored.encoding === 'ref') return stored;
  const mimeType = String(stored.mimeType ?? 'application/octet-stream');
  const frames = stored.frames;
  if (Array.isArray(frames)) {
    const moved = await Promise.all(frames.map(async (frame, index) => {
      const source = record(frame);
      if (!source || typeof source.data !== 'string') return frame;
      const result = await writeInlinePayload(context, `${id}-${String(index).padStart(3, '0')}`, mimeType,
        source.data, typeof source.sha256 === 'string' ? source.sha256 : undefined);
      context.report.movedFrames += 1;
      const { data: _frameData, ...frameRest } = source;
      return { ...frameRest, ref: result.ref, sha256: result.sha256 };
    }));
    const { data: _data, ...rest } = stored;
    context.report.movedAssets += 1;
    // No top-level ref: the frames hold the references for a sequence.
    const { ref: _ref, ...withoutRef } = rest;
    return { ...withoutRef, encoding: 'ref', frames: moved };
  }
  if (typeof stored.data !== 'string') {
    context.report.skipped.push({ site, id, reason: 'NO_INLINE_PAYLOAD' });
    return stored;
  }
  const result = await writeInlinePayload(context, id, mimeType, stored.data,
    typeof stored.sha256 === 'string' ? stored.sha256 : undefined);
  const { data: _data, ...rest } = stored;
  context.report.movedAssets += 1;
  return { ...rest, encoding: 'ref', ref: result.ref, sha256: result.sha256 };
}

export async function externalizeAssetContainer(
  context: WriteContext,
  site: string,
  container: unknown,
): Promise<unknown> {
  const source = record(container);
  const assets = record(source?.assets);
  if (!source || !assets) return container;
  const output: Record<string, unknown> = {};
  for (const [id, stored] of Object.entries(assets)) {
    const value = record(stored);
    output[id] = value ? await externalizeStoredAsset(context, site, id, value) : stored;
  }
  return { ...source, assets: output };
}

export async function externalizeAgentAssetEntries(
  context: WriteContext,
  extension: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const entries = record(extension.entries);
  if (!entries) return extension;
  const projected: Record<string, unknown> = {};
  for (const [id, stored] of Object.entries(entries)) {
    const value = record(stored);
    projected[id] = value ? await externalizeStoredAsset(context, 'agentAssets.entries', id, value) : stored;
  }
  return { ...extension, entries: projected };
}

export async function inlineStoredAsset(
  read: AgentAssetRefReader,
  id: string,
  stored: Record<string, unknown>,
  report: InlineReport,
): Promise<Record<string, unknown>> {
  if (stored.encoding !== 'ref') return stored;
  const frames = stored.frames;
  if (Array.isArray(frames)) {
    const inlined = await Promise.all(frames.map(async (frame, index) => {
      const source = record(frame);
      if (!source || typeof source.ref !== 'string') return frame;
      const bytes = await read(parseAgentAssetRef(source.ref));
      const actual = await sha256Hex(bytes);
      if (typeof source.sha256 === 'string' && actual !== source.sha256.toLowerCase()) {
        throw new Error(`ASSET_INLINE_SHA256_MISMATCH: ${id}#${index}`);
      }
      report.resolvedFrames += 1;
      report.resolvedBytes += bytes.byteLength;
      const { ref: _frameRef, ...frameRest } = source;
      return { ...frameRest, data: encodeBase64Bytes(bytes), sha256: actual };
    }));
    const { ref: _ref, ...rest } = stored;
    report.resolvedAssets += 1;
    return { ...rest, encoding: 'base64', frames: inlined };
  }
  if (typeof stored.ref !== 'string') throw new Error(`ASSET_INLINE_REF_MISSING: ${id}`);
  const bytes = await read(parseAgentAssetRef(stored.ref));
  const actual = await sha256Hex(bytes);
  if (typeof stored.sha256 === 'string' && actual !== stored.sha256.toLowerCase()) {
    throw new Error(`ASSET_INLINE_SHA256_MISMATCH: ${id}`);
  }
  const { ref: _ref, ...rest } = stored;
  report.resolvedAssets += 1;
  report.resolvedBytes += bytes.byteLength;
  return { ...rest, encoding: 'base64', data: encodeBase64Bytes(bytes), sha256: actual };
}

export async function inlineAssetContainer(
  read: AgentAssetRefReader,
  container: unknown,
  report: InlineReport,
): Promise<unknown> {
  const source = record(container);
  const assets = record(source?.assets);
  if (!source || !assets) return container;
  const output: Record<string, unknown> = {};
  for (const [id, stored] of Object.entries(assets)) {
    const value = record(stored);
    output[id] = value ? await inlineStoredAsset(read, id, value, report) : stored;
  }
  return { ...source, assets: output };
}

export async function inlineAgentAssetEntries(
  read: AgentAssetRefReader,
  extension: Record<string, unknown>,
  report: InlineReport,
): Promise<Record<string, unknown>> {
  const entries = record(extension.entries);
  if (!entries) return extension;
  const projected: Record<string, unknown> = {};
  for (const [id, stored] of Object.entries(entries)) {
    const value = record(stored);
    projected[id] = value ? await inlineStoredAsset(read, id, value, report) : stored;
  }
  return { ...extension, entries: projected };
}

function ensureDirection(document: StudioProjectDocumentV2): StudioProjectDirectionV2 {
  const direction = document.direction ?? { rhythm: {} };
  document.direction = direction;
  return direction;
}

/** Studio-document sites shared by Mahjong and any later package on the V2 envelope. */
export async function externalizeStudioDocumentAssets(
  document: StudioProjectDocumentV2,
  write: AgentAssetRefWriter,
): Promise<{ document: StudioProjectDocumentV2; report: ExternalizeReport }> {
  const context = createWriteContext(write);
  const output = structuredClone(document);
  const direction = ensureDirection(output);
  const style = record(direction.style);
  const extension = record(style?.agentAssets);
  if (style && extension) {
    direction.style = { ...style, agentAssets: await externalizeAgentAssetEntries(context, extension) };
  }
  const production = record(direction.production);
  if (production?.audio !== undefined) {
    direction.production = { ...production, audio: await externalizeAssetContainer(context, 'direction.production.audio', production.audio) };
  }
  return { document: output, report: context.report };
}

export async function inlineStudioDocumentAssets(
  document: StudioProjectDocumentV2,
  read: AgentAssetRefReader,
): Promise<{ document: StudioProjectDocumentV2; report: InlineReport }> {
  const report = emptyInlineReport();
  const output = structuredClone(document);
  const direction = ensureDirection(output);
  const style = record(direction.style);
  const extension = record(style?.agentAssets);
  if (style && extension) {
    direction.style = { ...style, agentAssets: await inlineAgentAssetEntries(read, extension, report) };
  }
  const production = record(direction.production);
  if (production?.audio !== undefined) {
    direction.production = { ...production, audio: await inlineAssetContainer(read, production.audio, report) };
  }
  return { document: output, report };
}
