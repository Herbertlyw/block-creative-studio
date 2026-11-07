import type { StudioProjectDocumentV2 } from '../../../game-runtime/projectEnvelope';
import { readAgentAssetExtension } from '../../../agent-assets/storage';
import { requireInlineAgentAsset, type AgentSequenceAsset } from '../../../agent-assets/contracts';
import { decodeBase64Image } from '../../../agent-assets/image';
import { stableHash } from '../../../headless/stableHash';

export const CLEAR_SEQUENCE_MODEL = 'block-crush-drop.png-sequence.v1' as const;
export const CLEAR_SEQUENCE_SLOT = 'effect.clear.sequence';
export interface ClearSequenceReference {
  assetId: string;
  coordinateSpace: 'stage-1080x1920';
  alpha: 'straight';
  timing: 'cue-window';
}
export const clearSequenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['assetId'],
  properties: {
    assetId: { type: 'string', minLength: 1, maxLength: 64 },
    coordinateSpace: { const: 'stage-1080x1920' },
    alpha: { const: 'straight' },
    timing: { const: 'cue-window' },
  },
};
export function parseClearSequence(value: unknown): ClearSequenceReference {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('CRUSH_SEQUENCE_OBJECT_REQUIRED');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !['assetId', 'coordinateSpace', 'alpha', 'timing'].includes(k)))
    throw new Error('CRUSH_SEQUENCE_FIELD_UNKNOWN');
  if (typeof v.assetId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(v.assetId))
    throw new Error('CRUSH_SEQUENCE_ASSET_ID_INVALID');
  for (const [k, expected] of Object.entries({
    coordinateSpace: 'stage-1080x1920',
    alpha: 'straight',
    timing: 'cue-window',
  }))
    if (v[k] !== undefined && v[k] !== expected) throw new Error(`CRUSH_SEQUENCE_${k}_UNSUPPORTED`);
  return {
    assetId: v.assetId,
    coordinateSpace: 'stage-1080x1920',
    alpha: 'straight',
    timing: 'cue-window',
  };
}
/** Metadata validation also works before referenced assets are materialized. */
export function validateClearSequenceAsset(
  document: StudioProjectDocumentV2,
  reference: ClearSequenceReference,
): void {
  const a = readAgentAssetExtension(document).entries[reference.assetId];
  if (!a || a.kind !== 'sequence')
    throw new Error(`CRUSH_SEQUENCE_ASSET_REQUIRED: ${reference.assetId}`);
  if (a.width !== 1080 || a.height !== 1920)
    throw new Error('CRUSH_SEQUENCE_CANVAS_MUST_BE_1080_1920');
  if (
    !a.frames?.length ||
    a.frames.length > 240 ||
    a.byteLength > 96 * 1024 * 1024 ||
    !Number.isInteger(a.fps) ||
    a.fps! < 4 ||
    a.fps! > 60
  )
    throw new Error('CRUSH_SEQUENCE_BUDGET_EXCEEDED');
  if (a.encoding === 'base64') validateClearSequencePixels(a);
}
export function validateClearSequencePixels(asset: AgentSequenceAsset): void {
  for (const [index, frame] of asset.frames.entries()) {
    const bytes = decodeBase64Image(frame.data);
    // PNG IHDR color type 6 is true RGBA; straight alpha is the PNG convention.
    if (bytes[25] !== 6 || bytes[24] !== 8)
      throw new Error(`CRUSH_SEQUENCE_RGBA8_REQUIRED: ${asset.id}#${index}`);
  }
}
export function inlineClearSequence(
  document: StudioProjectDocumentV2,
  ref: ClearSequenceReference,
): AgentSequenceAsset {
  validateClearSequenceAsset(document, ref);
  const asset = requireInlineAgentAsset(
    readAgentAssetExtension(document).entries[ref.assetId]!,
  ) as AgentSequenceAsset;
  validateClearSequencePixels(asset);
  return asset;
}
export function makeClearSequenceEffect(id: string, sequence: unknown) {
  const data = {
    id,
    version: '1.0.0' as const,
    model: CLEAR_SEQUENCE_MODEL,
    sequence: parseClearSequence(sequence),
  };
  return { ...data, contentHash: stableHash(data) };
}
