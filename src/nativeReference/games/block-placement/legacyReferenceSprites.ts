import type { StudioProjectDocumentV2 } from '../../game-runtime/projectEnvelope';
import { decodeBase64Image, sha256Hex } from '../../agent-assets/image';

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Explicit migration bindings keep old, frozen renderers on their original image URIs. */
export async function hydrateLegacyReferenceSprites(document: StudioProjectDocumentV2): Promise<number> {
  const style = record(document.direction?.style);
  const calibration = record(style?.referenceCalibration);
  const bindings = record(calibration?.legacySpriteAssetIds);
  if (!bindings) return 0;
  const sprites = record(calibration?.sprites);
  const entries = record(record(style?.agentAssets)?.entries);
  if (!sprites || !entries) throw new Error('LEGACY_REFERENCE_SPRITE_BINDINGS_MISSING');
  let count = 0;
  for (const [name, id] of Object.entries(bindings)) {
    if (typeof id !== 'string' || !id) throw new Error(`LEGACY_REFERENCE_SPRITE_BINDING_INVALID: ${name}`);
    const entry = record(entries[id]);
    if (!entry || entry.kind !== 'image' || entry.encoding !== 'base64' || typeof entry.data !== 'string'
      || typeof entry.mimeType !== 'string' || !entry.mimeType.startsWith('image/') || typeof entry.sha256 !== 'string') {
      throw new Error(`LEGACY_REFERENCE_SPRITE_UNRESOLVED: ${name}`);
    }
    const uri = `data:${entry.mimeType};base64,${entry.data}`;
    if (sprites[name] !== `asset:${id}` && sprites[name] !== uri) {
      throw new Error(`LEGACY_REFERENCE_SPRITE_BINDING_MISMATCH: ${name}`);
    }
    const bytes = decodeBase64Image(entry.data);
    if (await sha256Hex(bytes) !== entry.sha256.toLowerCase()
      || (typeof entry.byteLength === 'number' && entry.byteLength !== bytes.byteLength)) {
      throw new Error(`LEGACY_REFERENCE_SPRITE_SHA256_MISMATCH: ${name}`);
    }
    sprites[name] = uri;
    count += 1;
  }
  return count;
}

/** Only a matching alias or its exact inline bytes shares the migrated identity. */
export function legacyReferenceStyleContentIdentity(style: Record<string, unknown>): Record<string, unknown> {
  const calibration = record(style.referenceCalibration);
  const bindings = record(calibration?.legacySpriteAssetIds);
  const sprites = record(calibration?.sprites);
  const entries = record(record(style.agentAssets)?.entries);
  if (!bindings || !sprites || !entries) return style;
  const projected = { ...sprites };
  for (const [name, id] of Object.entries(bindings)) {
    if (typeof id !== 'string') continue;
    const entry = record(entries[id]);
    if (!entry) continue;
    const alias = `asset:${id}`;
    const uri = entry.encoding === 'base64' && typeof entry.data === 'string'
      ? `data:${entry.mimeType};base64,${entry.data}` : undefined;
    if (sprites[name] === alias || (uri !== undefined && sprites[name] === uri)) projected[name] = alias;
  }
  return { ...style, referenceCalibration: { ...calibration, sprites: projected } };
}
