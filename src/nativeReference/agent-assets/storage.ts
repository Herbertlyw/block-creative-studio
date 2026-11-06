import {
  createRuntimeAssetBindings,
  type RuntimeAssetBindings,
  type RuntimeImageAssetBinding,
  type RuntimeImageBlendMode,
  type RuntimeImageFit,
} from '../assets/runtimeAssetBindings';
import type { StudioProjectDocumentV2 } from '../game-runtime/projectEnvelope';
import { stableHash } from '../headless/stableHash';
import {
  AGENT_ASSET_EXTENSION_VERSION,
  agentAssetTotalByteBudget,
  emptyAgentAssetExtension,
  type AgentAssetExtensionV1,
  type AgentAssetGameDeclaration,
  type AgentAssetSlotDeclaration,
  isAgentSequenceAsset,
  requireInlineAgentAsset,
  type AgentAssetEntry,
  type AgentAssetRefEntry,
  type AgentImageAsset,
  type AgentImageBinding,
  type AgentImageMimeType,
  type AgentImageRole,
  type AgentSequenceAsset,
  type AgentSequenceFrame,
} from './contracts';
import { parseAgentSequencePlayback, validateAgentSequenceBinding } from './sequences';
import type { AgentSequencePlayback } from './contracts';
import { agentAssetExtensionContentIdentity } from './canonical';
import { parseAgentAssetRef } from './refs';
import { decodeBase64Image, inspectImageBytes, sha256Hex } from './image';

import { parseAgentImageTransform, validateAgentImageBinding } from './transforms';
import { parseAgentAssetProvenance } from './provenance';

type JsonRecord = Record<string, unknown>;

function record(value: unknown, code: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value as JsonRecord;
}

function exactKeys(source: JsonRecord, keys: readonly string[], code: string): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(source).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${code}: ${unknown}`);
}

function imageAsset(value: unknown, id: string): AgentImageAsset {
  const source = record(value, `AGENT_ASSET_ENTRY_INVALID: ${id}`);
  exactKeys(source, ['id', 'kind', 'sourceName', 'mimeType', 'encoding', 'data', 'sha256', 'width', 'height', 'byteLength', 'provenance'], 'AGENT_ASSET_ENTRY_FIELD_UNKNOWN');
  if (source.id !== id || source.kind !== 'image' || source.encoding !== 'base64') throw new Error(`AGENT_ASSET_ENTRY_INVALID: ${id}`);
  if (source.mimeType !== 'image/png' && source.mimeType !== 'image/jpeg') throw new Error(`AGENT_ASSET_MIME_UNSUPPORTED: ${String(source.mimeType)}`);
  if (typeof source.sourceName !== 'string' || source.sourceName.length < 1 || source.sourceName.length > 240
    || typeof source.data !== 'string' || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)
    || !Number.isInteger(source.width) || Number(source.width) < 1
    || !Number.isInteger(source.height) || Number(source.height) < 1
    || !Number.isInteger(source.byteLength) || Number(source.byteLength) < 1) {
    throw new Error(`AGENT_ASSET_ENTRY_INVALID: ${id}`);
  }
  const bytes = decodeBase64Image(source.data as string);
  const inspected = inspectImageBytes(bytes);
  if (bytes.byteLength !== source.byteLength || inspected.mimeType !== source.mimeType
    || inspected.width !== source.width || inspected.height !== source.height) {
    throw new Error(`AGENT_ASSET_ENTRY_DERIVED_METADATA_MISMATCH: ${id}`);
  }
  parseAgentAssetProvenance(source.provenance);
  return source as unknown as AgentImageAsset;
}

function sequenceAsset(value: unknown, id: string): AgentSequenceAsset {
  const source = record(value, `AGENT_ASSET_ENTRY_INVALID: ${id}`);
  exactKeys(source, ['id', 'kind', 'sourceName', 'mimeType', 'encoding', 'fps', 'width', 'height', 'byteLength', 'sha256', 'frames', 'provenance'], 'AGENT_ASSET_ENTRY_FIELD_UNKNOWN');
  if (source.id !== id || source.kind !== 'sequence' || source.encoding !== 'base64') throw new Error(`AGENT_ASSET_ENTRY_INVALID: ${id}`);
  if (source.mimeType !== 'image/png') throw new Error(`AGENT_SEQUENCE_MIME_UNSUPPORTED: ${String(source.mimeType)}`);
  if (typeof source.sourceName !== 'string' || source.sourceName.length < 1 || source.sourceName.length > 240
    || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)
    || !Number.isInteger(source.fps) || Number(source.fps) < 1 || Number(source.fps) > 120
    || !Number.isInteger(source.width) || Number(source.width) < 1
    || !Number.isInteger(source.height) || Number(source.height) < 1
    || !Number.isInteger(source.byteLength) || Number(source.byteLength) < 1
    || !Array.isArray(source.frames) || source.frames.length < 2 || source.frames.length > 240) {
    throw new Error(`AGENT_ASSET_ENTRY_INVALID: ${id}`);
  }
  let total = 0;
  for (const [index, raw] of (source.frames as unknown[]).entries()) {
    const frame = record(raw, `AGENT_SEQUENCE_FRAME_INVALID: ${id}#${index}`);
    exactKeys(frame, ['data', 'sha256', 'byteLength'], 'AGENT_SEQUENCE_FRAME_FIELD_UNKNOWN');
    if (typeof frame.data !== 'string' || typeof frame.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(frame.sha256)
      || !Number.isInteger(frame.byteLength) || Number(frame.byteLength) < 1) throw new Error(`AGENT_SEQUENCE_FRAME_INVALID: ${id}#${index}`);
    const bytes = decodeBase64Image(frame.data as string);
    const inspected = inspectImageBytes(bytes);
    if (bytes.byteLength !== frame.byteLength || inspected.mimeType !== 'image/png'
      || inspected.width !== source.width || inspected.height !== source.height) {
      throw new Error(`AGENT_SEQUENCE_FRAME_DERIVED_METADATA_MISMATCH: ${id}#${index}`);
    }
    total += bytes.byteLength;
  }
  if (total !== source.byteLength) throw new Error(`AGENT_ASSET_ENTRY_DERIVED_METADATA_MISMATCH: ${id}`);
  parseAgentAssetProvenance(source.provenance);
  return source as unknown as AgentSequenceAsset;
}

/** Sequence identity is the ordered concatenation of its frame bytes. */
export function agentSequenceBytes(asset: AgentSequenceAsset): Uint8Array {
  const frames = asset.frames.map((frame) => decodeBase64Image(frame.data));
  const bytes = new Uint8Array(frames.reduce((sum, frame) => sum + frame.byteLength, 0));
  let offset = 0;
  for (const frame of frames) { bytes.set(frame, offset); offset += frame.byteLength; }
  return bytes;
}

/**
 * A referenced asset declares the same metadata as an inline one but holds no bytes,
 * so the derived-metadata cross-checks that decode `data` cannot run here. The
 * declared `sha256` is verified against the real bytes when the reference is
 * resolved (see inlineTapTileProject), which is the only point they exist.
 */
function refAsset(value: unknown, id: string): AgentAssetRefEntry {
  const source = record(value, `AGENT_ASSET_ENTRY_INVALID: ${id}`);
  exactKeys(source, ['id', 'kind', 'sourceName', 'mimeType', 'encoding', 'ref', 'sha256', 'width', 'height', 'byteLength', 'fps', 'frames', 'provenance'], 'AGENT_ASSET_ENTRY_FIELD_UNKNOWN');
  const sequence = source.kind === 'sequence';
  if (source.id !== id || source.encoding !== 'ref' || (source.kind !== 'image' && !sequence)) throw new Error(`AGENT_ASSET_ENTRY_INVALID: ${id}`);
  if (source.mimeType !== 'image/png' && source.mimeType !== 'image/jpeg') throw new Error(`AGENT_ASSET_MIME_UNSUPPORTED: ${String(source.mimeType)}`);
  if (typeof source.sourceName !== 'string' || source.sourceName.length < 1 || source.sourceName.length > 240
    || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)
    || !Number.isInteger(source.width) || Number(source.width) < 1
    || !Number.isInteger(source.height) || Number(source.height) < 1
    || !Number.isInteger(source.byteLength) || Number(source.byteLength) < 1) {
    throw new Error(`AGENT_ASSET_ENTRY_INVALID: ${id}`);
  }
  if (sequence) {
    // Frames carry the references; a top-level one would be a second, conflicting source.
    if (source.ref !== undefined) throw new Error(`AGENT_ASSET_ENTRY_INVALID: ${id}`);
    if (!Number.isInteger(source.fps) || Number(source.fps) < 1 || Number(source.fps) > 120) throw new Error(`AGENT_ASSET_ENTRY_INVALID: ${id}`);
    if (!Array.isArray(source.frames) || source.frames.length < 2 || source.frames.length > 240) throw new Error(`AGENT_ASSET_ENTRY_INVALID: ${id}`);
    let total = 0;
    for (const [index, raw] of (source.frames as unknown[]).entries()) {
      const frame = record(raw, `AGENT_SEQUENCE_FRAME_INVALID: ${id}#${index}`);
      // Historical HD bridge exports repeated the container's storage tag on
      // each frame. Accept that redundant tag only when it agrees with the ref.
      exactKeys(frame, ['ref', 'sha256', 'byteLength', 'encoding'], 'AGENT_SEQUENCE_FRAME_FIELD_UNKNOWN');
      if (frame.encoding !== undefined && frame.encoding !== 'ref') throw new Error(`AGENT_SEQUENCE_FRAME_INVALID: ${id}#${index}`);
      if (typeof frame.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(frame.sha256)
        || !Number.isInteger(frame.byteLength) || Number(frame.byteLength) < 1) throw new Error(`AGENT_SEQUENCE_FRAME_INVALID: ${id}#${index}`);
      parseAgentAssetRef(frame.ref);
      total += Number(frame.byteLength);
    }
    // Keeps the byte budget honest: byteLength stays the resolved total, as inline.
    if (total !== source.byteLength) throw new Error(`AGENT_ASSET_ENTRY_DERIVED_METADATA_MISMATCH: ${id}`);
  } else {
    if (source.frames !== undefined || source.fps !== undefined) throw new Error(`AGENT_ASSET_ENTRY_INVALID: ${id}`);
    parseAgentAssetRef(source.ref);
  }
  parseAgentAssetProvenance(source.provenance);
  return source as unknown as AgentAssetRefEntry;
}

function assetEntry(value: unknown, id: string): AgentAssetEntry {
  const source = value as JsonRecord | null;
  if (source?.encoding === 'ref') return refAsset(value, id);
  return source?.kind === 'sequence' ? sequenceAsset(value, id) : imageAsset(value, id);
}

const roles = new Set<AgentImageRole>(['background-image', 'tile-face-image', 'board-atlas-image', 'texture-map', 'particle-sprite', 'tile-material-image', 'ui-image', 'effect-sequence']);
const fits = new Set<RuntimeImageFit>(['cover', 'contain', 'stretch']);
const blends = new Set<RuntimeImageBlendMode>(['source-over', 'multiply', 'screen', 'overlay', 'soft-light']);

function imageBinding(value: unknown, slotId: string): AgentImageBinding {
  const source = record(value, `AGENT_ASSET_BINDING_INVALID: ${slotId}`);
  exactKeys(source, ['slotId', 'assetId', 'role', 'fit', 'opacity', 'blendMode', 'inset', 'transform', 'playback'], 'AGENT_ASSET_BINDING_FIELD_UNKNOWN');
  if (source.slotId !== slotId || typeof source.assetId !== 'string' || !roles.has(source.role as AgentImageRole)
    || !fits.has(source.fit as RuntimeImageFit) || !blends.has(source.blendMode as RuntimeImageBlendMode)
    || typeof source.opacity !== 'number' || source.opacity < 0 || source.opacity > 1
    || typeof source.inset !== 'number' || source.inset < 0 || source.inset > 0.45) {
    throw new Error(`AGENT_ASSET_BINDING_INVALID: ${slotId}`);
  }
  parseAgentImageTransform(source.transform);
  parseAgentSequencePlayback(source.playback);
  return source as unknown as AgentImageBinding;
}

export function readAgentAssetExtension(document: StudioProjectDocumentV2): AgentAssetExtensionV1 {
  const style = document.direction?.style;
  if (!style || typeof style !== 'object' || Array.isArray(style)) return emptyAgentAssetExtension();
  const raw = (style as JsonRecord).agentAssets;
  if (raw === undefined) return emptyAgentAssetExtension();
  const source = record(raw, 'AGENT_ASSET_EXTENSION_INVALID');
  exactKeys(source, ['version', 'entries', 'bindings'], 'AGENT_ASSET_EXTENSION_FIELD_UNKNOWN');
  // Early offline bridge writers used the numeric V1 tag with the same payload.
  if (source.version !== AGENT_ASSET_EXTENSION_VERSION && source.version !== 1) throw new Error(`AGENT_ASSET_EXTENSION_VERSION_UNSUPPORTED: ${String(source.version)}`);
  const entriesSource = record(source.entries, 'AGENT_ASSET_ENTRIES_INVALID');
  const bindingsSource = record(source.bindings, 'AGENT_ASSET_BINDINGS_INVALID');
  if (Object.keys(entriesSource).length > 64 || Object.keys(bindingsSource).length > 64) throw new Error('AGENT_ASSET_EXTENSION_BUDGET_EXCEEDED');
  const entries = Object.fromEntries(Object.entries(entriesSource).map(([id, value]) => [id, assetEntry(value, id)]));
  if (Object.values(entries).reduce((sum, entry) => sum + entry.byteLength, 0) > agentAssetTotalByteBudget(document.game?.game?.id ?? '')) {
    throw new Error('AGENT_ASSET_EXTENSION_BYTE_BUDGET_EXCEEDED');
  }
  const bindings = Object.fromEntries(Object.entries(bindingsSource).map(([slotId, value]) => [slotId, imageBinding(value, slotId)]));
  for (const binding of Object.values(bindings)) if (!entries[binding.assetId]) throw new Error(`AGENT_ASSET_BINDING_ASSET_UNKNOWN: ${binding.assetId}`);
  return { version: AGENT_ASSET_EXTENSION_VERSION, entries, bindings };
}

export function withAgentAssetExtension(
  document: StudioProjectDocumentV2,
  extension: AgentAssetExtensionV1,
): StudioProjectDocumentV2 {
  const next = structuredClone(document);
  const style = next.direction?.style;
  if (style !== undefined && (!style || typeof style !== 'object' || Array.isArray(style))) {
    throw new Error('AGENT_ASSET_STYLE_OBJECT_REQUIRED');
  }
  next.direction = {
    ...(next.direction ?? { rhythm: {} }),
    style: { ...(style as JsonRecord | undefined), agentAssets: structuredClone(extension) },
  };
  return next;
}

export function resolveAgentImageBindings(
  document: StudioProjectDocumentV2,
  declaration: AgentAssetGameDeclaration,
): Array<{ asset: AgentImageAsset; binding: AgentImageBinding; dataUri: string }> {
  return resolveAgentAssetBindings(document, declaration)
    .filter((item): item is { asset: AgentImageAsset; binding: AgentImageBinding; slot: AgentAssetSlotDeclaration; dataUri: string } => item.asset.kind === 'image')
    .map(({ asset, binding, dataUri }) => ({ asset, binding, dataUri }));
}

/** Sequence bindings carry every frame as its own data URI, in playback order. */
export function resolveAgentSequenceBindings(
  document: StudioProjectDocumentV2,
  declaration: AgentAssetGameDeclaration,
): Array<{ asset: AgentSequenceAsset; binding: AgentImageBinding; slot: AgentAssetSlotDeclaration; frameDataUris: string[] }> {
  return resolveAgentAssetBindings(document, declaration)
    .filter((item): item is { asset: AgentSequenceAsset; binding: AgentImageBinding; slot: AgentAssetSlotDeclaration; dataUri: string } => item.asset.kind === 'sequence')
    .map(({ asset, binding, slot }) => ({
      asset, binding, slot,
      frameDataUris: asset.frames.map((frame) => `data:${asset.mimeType};base64,${frame.data}`),
    }));
}

export function resolveAgentAssetBindings(
  document: StudioProjectDocumentV2,
  declaration: AgentAssetGameDeclaration,
): Array<{ asset: AgentAssetEntry; binding: AgentImageBinding; slot: AgentAssetSlotDeclaration; dataUri: string }> {
  if (document.game.game.id !== declaration.gameId) throw new Error(`AGENT_ASSET_GAME_MISMATCH: expected ${declaration.gameId}, got ${document.game.game.id}`);
  const extension = readAgentAssetExtension(document);
  const slots = new Map(declaration.slots.map((slot) => [slot.slotId, slot]));
  return Object.values(extension.bindings).sort((a, b) => a.slotId.localeCompare(b.slotId)).map((binding) => {
    const slot = slots.get(binding.slotId);
    if (!slot || slot.role !== binding.role) throw new Error(`AGENT_ASSET_SLOT_UNSUPPORTED: ${binding.slotId}`);
    const asset = extension.entries[binding.assetId]!;
    if (isAgentSequenceAsset(asset) !== (slot.assetKind === 'sequence')) throw new Error(`AGENT_ASSET_KIND_UNSUPPORTED_FOR_SLOT: ${binding.slotId}`);
    validateAgentImageBinding(binding, slot);
    if (isAgentSequenceAsset(asset)) {
      validateAgentSequenceBinding(binding, slot, asset);
      return { asset, binding, slot, dataUri: `data:${asset.mimeType};base64,${asset.frames[0]!.data}` };
    }
    if (binding.playback !== undefined) throw new Error(`AGENT_ASSET_PLAYBACK_UNSUPPORTED_FOR_SLOT: ${binding.slotId}`);
    if (asset.byteLength > slot.maxBytes || asset.width > slot.maxWidth || asset.height > slot.maxHeight || asset.width * asset.height > slot.maxPixels) throw new Error(`AGENT_ASSET_IMAGE_BUDGET_EXCEEDED_FOR_SLOT: ${binding.slotId}`);
    if (!slot.acceptedMimeTypes.includes(asset.mimeType as AgentImageMimeType)) throw new Error(`AGENT_ASSET_MIME_UNSUPPORTED_FOR_SLOT: ${binding.slotId}`);
    return { asset, binding, slot, dataUri: `data:${asset.mimeType};base64,${requireInlineAgentAsset(asset).data}` };
  });
}

/** Recomputes provenance for every bound embedded asset before render materialization. */
export async function verifyAgentAssetBindings(
  document: StudioProjectDocumentV2,
  declaration: AgentAssetGameDeclaration,
): Promise<{ verifiedAssetIds: string[] }> {
  const resolved = resolveAgentAssetBindings(document, declaration);
  const unique = [...new Map(resolved.map((item) => [item.asset.id, item.asset])).values()];
  for (const asset of unique) {
    if (isAgentSequenceAsset(asset)) {
      for (const [index, frame] of asset.frames.entries()) {
        if (await sha256Hex(decodeBase64Image(frame.data)) !== frame.sha256) throw new Error(`AGENT_SEQUENCE_FRAME_SHA256_MISMATCH: ${asset.id}#${index}`);
      }
      if (await sha256Hex(agentSequenceBytes(asset)) !== asset.sha256) throw new Error(`AGENT_ASSET_STORED_SHA256_MISMATCH: ${asset.id}`);
      continue;
    }
    const actual = await sha256Hex(decodeBase64Image(requireInlineAgentAsset(asset).data));
    if (actual !== asset.sha256) throw new Error(`AGENT_ASSET_STORED_SHA256_MISMATCH: ${asset.id}`);
  }
  return { verifiedAssetIds: unique.map((asset) => asset.id).sort() };
}

export function createRuntimeAgentAssetBindings(
  document: StudioProjectDocumentV2,
  declaration: AgentAssetGameDeclaration,
): RuntimeAssetBindings {
  const resolved = resolveAgentImageBindings(document, declaration);
  const bySlot: Record<string, RuntimeImageAssetBinding[]> = {};
  for (const item of resolved) {
    bySlot[item.binding.slotId] = [{
      slotId: item.binding.slotId,
      role: item.binding.role as RuntimeImageAssetBinding['role'],
      contentHash: `sha256:${item.asset.sha256}`,
      sourceUri: `embedded:${item.asset.id}`,
      objectUrl: item.dataUri,
      fileName: item.asset.sourceName,
      mimeType: item.asset.mimeType,
      width: item.asset.width,
      height: item.asset.height,
      fit: item.binding.fit,
      opacity: item.binding.opacity,
      blendMode: item.binding.blendMode,
      inset: item.binding.inset,
      ...(item.binding.transform ? {transform: structuredClone(item.binding.transform)} : {}),
    }];
  }
  // Content identity, matching how the sequence revision below is already computed:
  // the revision must not change when an asset moves between inline and reference form.
  return createRuntimeAssetBindings({
    revision: stableHash(agentAssetExtensionContentIdentity(readAgentAssetExtension(document))),
    bySlot,
  });
}

export interface AgentAssetRuntimeEnvelope extends JsonRecord {
  agentImageBindings: RuntimeAssetBindings;
  agentSequenceBindings?: RuntimeAgentSequenceBindings;
}

export interface RuntimeAgentSequenceBinding {
  slotId: string;
  fps: number;
  playback: AgentSequencePlayback;
  frames: RuntimeImageAssetBinding[];
}
export interface RuntimeAgentSequenceBindings {
  revision: string;
  bySlot: Record<string, RuntimeAgentSequenceBinding>;
}

export function createRuntimeAgentSequenceBindings(document: StudioProjectDocumentV2, declaration: AgentAssetGameDeclaration): RuntimeAgentSequenceBindings {
  const bySlot: Record<string, RuntimeAgentSequenceBinding> = {};
  for (const item of resolveAgentSequenceBindings(document,declaration)) {
    bySlot[item.binding.slotId] = {
      slotId:item.binding.slotId,fps:item.asset.fps,playback:item.binding.playback!,
      frames:item.asset.frames.map((frame,index)=>({slotId:item.binding.slotId,role:'particle-sprite',contentHash:`sha256:${frame.sha256}`,sourceUri:`embedded:${item.asset.id}#${index}`,objectUrl:item.frameDataUris[index]!,fileName:`${item.asset.sourceName}#${index}`,mimeType:item.asset.mimeType,width:item.asset.width,height:item.asset.height,fit:item.binding.fit,opacity:item.binding.opacity,blendMode:item.binding.blendMode,inset:0,...(item.binding.transform?{transform:structuredClone(item.binding.transform)}:{})})),
    };
  }
  return {revision:stableHash(Object.values(bySlot).map(item=>item.frames.map(frame=>frame.contentHash))),bySlot};
}

export function attachRuntimeAgentAssetBindings(
  runtimeAssets: unknown,
  document: StudioProjectDocumentV2,
  declaration: AgentAssetGameDeclaration,
): RuntimeAssetBindings | AgentAssetRuntimeEnvelope {
  const agentImageBindings = createRuntimeAgentAssetBindings(document, declaration);
  const agentSequenceBindings = createRuntimeAgentSequenceBindings(document,declaration);
  const hasSequences=Object.keys(agentSequenceBindings.bySlot).length>0;
  if (!runtimeAssets || typeof runtimeAssets !== 'object' || Array.isArray(runtimeAssets)) return hasSequences?{agentImageBindings,agentSequenceBindings}:agentImageBindings;
  if ('bySlot' in runtimeAssets && 'revision' in runtimeAssets) {
    const prior = runtimeAssets as RuntimeAssetBindings;
    const merged=createRuntimeAssetBindings({
      revision: stableHash([prior.revision, agentImageBindings.revision]),
      bySlot: { ...prior.bySlot, ...agentImageBindings.bySlot },
      missing: [...prior.missing, ...agentImageBindings.missing],
    });
    return hasSequences?{agentImageBindings:merged,agentSequenceBindings}:merged;
  }
  return { ...(runtimeAssets as JsonRecord), agentImageBindings, ...(hasSequences?{agentSequenceBindings}:{}) };
}

export function runtimeAgentImageBindings(value: unknown): RuntimeAssetBindings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if ('bySlot' in value && 'revision' in value) return value as RuntimeAssetBindings;
  const nested = (value as JsonRecord).agentImageBindings;
  return nested && typeof nested === 'object' && 'bySlot' in nested && 'revision' in nested
    ? nested as RuntimeAssetBindings
    : null;
}

export function runtimeAgentSequenceBindings(value: unknown): RuntimeAgentSequenceBindings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const nested=(value as JsonRecord).agentSequenceBindings;
  return nested&&typeof nested==='object'&&'bySlot'in nested&&'revision'in nested?nested as unknown as RuntimeAgentSequenceBindings:null;
}

export async function verifyRuntimeAgentSequenceBindings(value:unknown):Promise<{verifiedFrameUris:string[]}>{
  const runtime=runtimeAgentSequenceBindings(value);if(!runtime)return{verifiedFrameUris:[]};
  const verifiedFrameUris:string[]=[];
  for(const sequence of Object.values(runtime.bySlot))for(const frame of sequence.frames){
    const comma=frame.objectUrl.indexOf(',');if(comma<0)throw new Error(`AGENT_SEQUENCE_RUNTIME_URI_INVALID: ${frame.sourceUri}`);
    const actual=await sha256Hex(decodeBase64Image(frame.objectUrl.slice(comma+1)));
    if(frame.contentHash!==`sha256:${actual}`)throw new Error(`AGENT_SEQUENCE_RUNTIME_SHA256_MISMATCH: ${frame.sourceUri}`);
    verifiedFrameUris.push(frame.sourceUri);
  }
  return{verifiedFrameUris};
}

/** Verifies embedded runtime bindings immediately before the browser decodes them. */
export async function verifyRuntimeAgentImageBindings(value: unknown): Promise<{ verifiedSourceUris: string[] }> {
  const runtime = runtimeAgentImageBindings(value);
  if (!runtime) return { verifiedSourceUris: [] };
  const embedded = Object.values(runtime.bySlot).flat().filter((binding): binding is RuntimeImageAssetBinding => (
    binding.role !== 'audio' && binding.role !== 'flipbook' && binding.role !== 'geometry-3d'
      && binding.sourceUri.startsWith('embedded:')
  ));
  const unique = [...new Map(embedded.map((binding) => [binding.sourceUri, binding])).values()];
  for (const binding of unique) {
    const prefix = `data:${binding.mimeType};base64,`;
    if (!binding.objectUrl.startsWith(prefix)) throw new Error(`AGENT_ASSET_RUNTIME_DATA_URI_INVALID: ${binding.sourceUri}`);
    const bytes = decodeBase64Image(binding.objectUrl.slice(prefix.length));
    const actual = await sha256Hex(bytes);
    if (binding.contentHash !== `sha256:${actual}`) throw new Error(`AGENT_ASSET_RUNTIME_SHA256_MISMATCH: ${binding.sourceUri}`);
  }
  return { verifiedSourceUris: unique.map((binding) => binding.sourceUri).sort() };
}
