import { AGENT_RESULT_SCHEMA, type AgentOperationInput, type AgentOperationResult, type GameAgentOperation } from '../game-runtime/agentOperations';
import { parseStudioProjectDocumentV2 } from '../game-runtime/projectParser';
import type { StudioProjectDocumentV2 } from '../game-runtime/projectEnvelope';
import { stableHash } from '../headless/stableHash';
import type { RuntimeImageBlendMode, RuntimeImageFit } from '../assets/runtimeAssetBindings';
import {
  agentAssetTotalByteBudget, AGENT_SEQUENCE_DEFAULT_PLAYBACK, isAgentSequenceAsset,
  type AgentAssetGameDeclaration, type AgentImageAsset, type AgentImageMimeType,
  type AgentSequenceAsset, type AgentSequenceFrame,
} from './contracts';
import { decodeBase64Image, inspectImageBytes, sha256Hex } from './image';
import { agentSequenceBytes, readAgentAssetExtension, withAgentAssetExtension } from './storage';
import { AGENT_SEQUENCE_PLAYBACK_SCHEMA, parseAgentSequencePlayback, validateAgentSequenceBinding } from './sequences';

import { AGENT_IMAGE_TRANSFORM_SCHEMA, parseAgentImageTransform, validateAgentImageBinding } from './transforms';
import { AGENT_ASSET_PROVENANCE_SCHEMA, parseAgentAssetProvenance } from './provenance';

type JsonRecord = Record<string, unknown>;

function options(input: AgentOperationInput, allowed: readonly string[]): JsonRecord {
  const value = input.options ?? input.recipe;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AGENT_ASSET_OPTIONS_REQUIRED');
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`AGENT_ASSET_OPTION_UNKNOWN: ${unknown}`);
  return value as JsonRecord;
}

function project(value: unknown, declaration: AgentAssetGameDeclaration): StudioProjectDocumentV2 {
  const document = parseStudioProjectDocumentV2(value);
  if (document.game.game.id !== declaration.gameId) {
    throw new Error(`AGENT_ASSET_GAME_MISMATCH: expected ${declaration.gameId}, got ${document.game.game.id}`);
  }
  readAgentAssetExtension(document);
  return document;
}

function requiredText(value: unknown, name: string, maximum = 240): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) throw new Error(`${name}_INVALID`);
  return value;
}

function assetId(value: unknown): string {
  const id = requiredText(value, 'AGENT_ASSET_ID', 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new Error('AGENT_ASSET_ID_INVALID');
  return id;
}

function preservation(before: StudioProjectDocumentV2, after: StudioProjectDocumentV2): Record<string, boolean> {
  return {
    game: stableHash(before.game) === stableHash(after.game),
    takes: stableHash(before.takes) === stableHash(after.takes),
    timeline: stableHash(before.takes.map((take) => ({ takeId: take.takeId, actions: take.actions, interactions: take.interactions })))
      === stableHash(after.takes.map((take) => ({ takeId: take.takeId, actions: take.actions, interactions: take.interactions }))),
    production: stableHash(before.production) === stableHash(after.production),
    productionDirection: stableHash(before.direction?.production ?? null) === stableHash(after.direction?.production ?? null),
    rhythm: stableHash(before.direction?.rhythm ?? null) === stableHash(after.direction?.rhythm ?? null),
  };
}

function inputSchema(optionProperties: JsonRecord, requiresProject = true, requiredOptions: string[] = []): JsonRecord {
  return {
    type: 'object',
    ...(requiresProject ? { required: ['project', 'options'] } : {}),
    properties: {
      project: { type: 'object' },
      options: {
        type: 'object',
        required: requiredOptions,
        properties: optionProperties,
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  };
}

function operation(
  declaration: AgentAssetGameDeclaration,
  spec: Pick<GameAgentOperation, 'id' | 'title' | 'description' | 'kind' | 'requires' | 'preserves' | 'invalidates' | 'inputSchema'>,
  execute: (input: AgentOperationInput) => AgentOperationResult | Promise<AgentOperationResult>,
): GameAgentOperation {
  return {
    ...spec,
    version: '1.0.0',
    familyId: `asset.${spec.id.replace(/\s+/g, '-')}`,
    familyVersion: '1.0.0',
    support: 'shared',
    familyCore: {
      kind: spec.kind === 'query' ? 'query' : 'mutation',
      project: spec.requires.includes('project') ? 'required' : 'optional',
      recipe: 'unsupported', options: 'optional', result: 'ok+report',
    },
    outputSchema: AGENT_RESULT_SCHEMA,
    async execute(input) {
      try {
        return await execute(input);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${declaration.gameId} ${spec.id}: ${message}`);
      }
    },
  };
}

/**
 * Imports ordered transparent PNG frames as one sequence entry. Every frame keeps its
 * own digest, and the sequence digest covers the ordered concatenation, so a reordered
 * or swapped frame is a different asset instead of a silent visual change.
 */
async function importSequence(
  declaration: AgentAssetGameDeclaration,
  input: AgentOperationInput,
  controls: JsonRecord,
): Promise<AgentOperationResult> {
  const source = project(input.project, declaration);
  if (controls.data !== undefined) throw new Error('AGENT_SEQUENCE_DATA_UNSUPPORTED');
  if (controls.mimeType !== 'image/png') throw new Error('AGENT_SEQUENCE_MIME_UNSUPPORTED');
  if (controls.encoding !== 'base64') throw new Error('AGENT_ASSET_ENCODING_UNSUPPORTED');
  const provenance = parseAgentAssetProvenance(controls.provenance);
  const id = assetId(controls.id);
  const sourceName = requiredText(controls.sourceName, 'AGENT_ASSET_SOURCE_NAME');
  const fps = controls.fps ?? 30;
  if (!Number.isInteger(fps) || Number(fps) < 1 || Number(fps) > 120) throw new Error('AGENT_SEQUENCE_FPS_INVALID');
  const declaredSha = requiredText(controls.sha256, 'AGENT_ASSET_SHA256', 64);
  if (!/^[a-f0-9]{64}$/.test(declaredSha)) throw new Error('AGENT_ASSET_SHA256_INVALID');
  const raw = controls.frames;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 240) throw new Error('AGENT_SEQUENCE_FRAMES_INVALID');
  const sequenceSlots = declaration.slots.filter((slot) => slot.assetKind === 'sequence');
  if (sequenceSlots.length === 0) throw new Error(`AGENT_SEQUENCE_UNSUPPORTED_BY_GAME: ${declaration.gameId}`);
  const frames: AgentSequenceFrame[] = [];
  let width = 0, height = 0, byteLength = 0;
  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`AGENT_SEQUENCE_FRAME_INVALID: ${index}`);
    const frame = entry as JsonRecord;
    const unknown = Object.keys(frame).find((key) => !['data', 'sha256'].includes(key));
    if (unknown) throw new Error(`AGENT_SEQUENCE_FRAME_FIELD_UNKNOWN: ${unknown}`);
    const data = requiredText(frame.data, 'AGENT_SEQUENCE_FRAME_DATA', 8 * 1024 * 1024);
    const bytes = decodeBase64Image(data);
    const inspected = inspectImageBytes(bytes);
    if (inspected.mimeType !== 'image/png') throw new Error(`AGENT_SEQUENCE_FRAME_MIME_MISMATCH: ${index}`);
    if (index === 0) { width = inspected.width; height = inspected.height; }
    else if (inspected.width !== width || inspected.height !== height) throw new Error(`AGENT_SEQUENCE_FRAME_DIMENSIONS_MISMATCH: ${index} is ${inspected.width}x${inspected.height}, expected ${width}x${height}`);
    const actual = await sha256Hex(bytes);
    if (typeof frame.sha256 === 'string' && frame.sha256 !== actual) throw new Error(`AGENT_SEQUENCE_FRAME_SHA256_MISMATCH: ${index}`);
    frames.push({ data, sha256: actual, byteLength: bytes.byteLength });
    byteLength += bytes.byteLength;
  }
  const candidate: AgentSequenceAsset = {
    id, kind: 'sequence', sourceName, mimeType: 'image/png', encoding: 'base64',
    fps: Number(fps), width, height, byteLength, sha256: declaredSha, frames,
    ...(provenance ? { provenance } : {}),
  };
  const actualSha = await sha256Hex(agentSequenceBytes(candidate));
  if (actualSha !== declaredSha) throw new Error(`AGENT_ASSET_SHA256_MISMATCH: expected ${declaredSha}, actual ${actualSha}`);
  const compatibleSlots = sequenceSlots.filter((slot) => frames.length <= (slot.sequence?.maxFrames ?? 0)
    && byteLength <= slot.maxBytes && width <= slot.maxWidth && height <= slot.maxHeight && width * height <= slot.maxPixels
    && Number(fps) >= (slot.sequence?.minFps ?? 1) && Number(fps) <= (slot.sequence?.maxFps ?? 120));
  if (compatibleSlots.length === 0) throw new Error(`AGENT_SEQUENCE_BUDGET_EXCEEDED: ${frames.length} frames, ${width}x${height}, ${byteLength} bytes, ${fps} fps`);
  const extension = readAgentAssetExtension(source);
  const prior = extension.entries[id];
  if (prior && stableHash(prior) !== stableHash(candidate)) throw new Error(`AGENT_ASSET_ID_CONFLICT: ${id}`);
  extension.entries[id] = candidate;
  if (Object.values(extension.entries).reduce((sum, entry) => sum + entry.byteLength, 0) > agentAssetTotalByteBudget(declaration.gameId)) {
    throw new Error('AGENT_ASSET_EXTENSION_BYTE_BUDGET_EXCEEDED');
  }
  const document = withAgentAssetExtension(source, extension);
  return {
    ok: true,
    document,
    report: {
      operation: 'asset import',
      asset: { id, kind: 'sequence', sourceName, mimeType: 'image/png', sha256: actualSha, frameCount: frames.length, fps: Number(fps), width, height, byteLength },
      frameDigests: frames.map((frame) => frame.sha256),
      integrityValidation: 'Every frame validated as PNG structure with identical dimensions; per-frame and ordered-sequence SHA-256 recomputed from the supplied bytes',
      decodeValidation: 'Pixel decoding happens in the browser decoder during render warmup; import does not claim a decoded frame.',
      playbackNote: 'Playback timing is chosen at asset bind. Import alone changes no pixels.',
      idempotent: Boolean(prior), compatibleSlots: compatibleSlots.map((slot) => slot.slotId), preserved: preservation(source, document),
    },
  };
}

export function createAgentAssetOperations(declaration: AgentAssetGameDeclaration): GameAgentOperation[] {
  const importOperation = operation(declaration, {
    id: 'asset import',
    title: 'Import embedded image asset',
    description: 'Validates and embeds a PNG or JPEG by content, declared SHA-256, actual header dimensions, and game slot budgets.',
    kind: 'edit',
    requires: ['project', 'options.id', 'options.sourceName', 'options.mimeType', 'options.encoding', 'options.data or options.frames', 'options.sha256'],
    preserves: ['game', 'takes', 'timeline', 'production', 'direction.production', 'direction.rhythm'],
    invalidates: ['render artifacts', 'visual previews'],
    inputSchema: inputSchema({
      id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' },
      sourceName: { type: 'string', minLength: 1, maxLength: 240 },
      mimeType: { enum: ['image/png', 'image/jpeg'] },
      encoding: { const: 'base64' },
      data: { type: 'string', minLength: 4 },
      sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      kind: { enum: ['image', 'sequence'] },
      fps: { type: 'integer', minimum: 1, maximum: 120 },
      frames: {
        type: 'array', minItems: 2, maxItems: 240,
        items: { type: 'object', additionalProperties: false, required: ['data', 'sha256'], properties: { data: { type: 'string', minLength: 4 }, sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' } } },
      },
      provenance: AGENT_ASSET_PROVENANCE_SCHEMA,
    }, true, ['id', 'sourceName', 'mimeType', 'encoding', 'sha256']),
  }, async (input) => {
    const source = project(input.project, declaration);
    const controls = options(input, ['id', 'sourceName', 'mimeType', 'encoding', 'data', 'sha256', 'provenance', 'kind', 'fps', 'frames']);
    if (controls.kind !== undefined && controls.kind !== 'image' && controls.kind !== 'sequence') throw new Error('AGENT_ASSET_KIND_UNSUPPORTED');
    const sequenceRequested = controls.kind === 'sequence' || controls.frames !== undefined;
    if (sequenceRequested) return await importSequence(declaration, input, controls);
    if (controls.fps !== undefined) throw new Error('AGENT_ASSET_FPS_UNSUPPORTED_FOR_IMAGE');
    const provenance = parseAgentAssetProvenance(controls.provenance);
    const id = assetId(controls.id);
    const sourceName = requiredText(controls.sourceName, 'AGENT_ASSET_SOURCE_NAME');
    if (controls.encoding !== 'base64') throw new Error('AGENT_ASSET_ENCODING_UNSUPPORTED');
    if (controls.mimeType !== 'image/png' && controls.mimeType !== 'image/jpeg') throw new Error(`AGENT_ASSET_MIME_UNSUPPORTED: ${String(controls.mimeType)}`);
    const declaredMime = controls.mimeType as AgentImageMimeType;
    const declaredSha = requiredText(controls.sha256, 'AGENT_ASSET_SHA256', 64);
    if (!/^[a-f0-9]{64}$/.test(declaredSha)) throw new Error('AGENT_ASSET_SHA256_INVALID');
    const data = requiredText(controls.data, 'AGENT_ASSET_DATA', 16 * 1024 * 1024);
    const bytes = decodeBase64Image(data);
    const inspected = inspectImageBytes(bytes);
    if (inspected.mimeType !== declaredMime) throw new Error(`AGENT_ASSET_MIME_MISMATCH: declared ${declaredMime}, actual ${inspected.mimeType}`);
    const actualSha = await sha256Hex(bytes);
    if (actualSha !== declaredSha) throw new Error(`AGENT_ASSET_SHA256_MISMATCH: expected ${declaredSha}, actual ${actualSha}`);
    const compatibleSlots = declaration.slots.filter((slot) => slot.acceptedMimeTypes.includes(declaredMime));
    if (compatibleSlots.length === 0) throw new Error(`AGENT_ASSET_MIME_UNSUPPORTED_BY_GAME: ${declaredMime}`);
    if (!compatibleSlots.some((slot) => bytes.byteLength <= slot.maxBytes
      && inspected.width <= slot.maxWidth && inspected.height <= slot.maxHeight
      && inspected.width * inspected.height <= slot.maxPixels)) {
      throw new Error(`AGENT_ASSET_IMAGE_BUDGET_EXCEEDED: ${bytes.byteLength} bytes, ${inspected.width}x${inspected.height}`);
    }
    const extension = readAgentAssetExtension(source);
    const entry: AgentImageAsset = {
      id, kind: 'image', sourceName, mimeType: declaredMime, encoding: 'base64', data,
      sha256: actualSha, width: inspected.width, height: inspected.height, byteLength: bytes.byteLength,
      ...(provenance ? { provenance } : {}),
    };
    const prior = extension.entries[id];
    if (prior && stableHash(prior) !== stableHash(entry)) throw new Error(`AGENT_ASSET_ID_CONFLICT: ${id}`);
    extension.entries[id] = entry;
    if (Object.values(extension.entries).reduce((sum, candidate) => sum + candidate.byteLength, 0) > agentAssetTotalByteBudget(declaration.gameId)) {
      throw new Error('AGENT_ASSET_EXTENSION_BYTE_BUDGET_EXCEEDED');
    }
    const document = withAgentAssetExtension(source, extension);
    return {
      ok: true,
      document,
      report: {
        operation: 'asset import', asset: { id, sourceName, mimeType: declaredMime, sha256: actualSha, width: inspected.width, height: inspected.height, byteLength: bytes.byteLength },
        integrityValidation: declaredMime === 'image/png'
          ? 'PNG signature, ordered chunk bounds, chunk CRCs, IHDR fields, non-empty IDAT, and terminal IEND validated'
          : 'JPEG marker and segment bounds, SOF dimensions, SOS scan, entropy payload, and terminal EOI validated',
        decodeValidation: 'Pixel decoding is performed by the browser image decoder during render warmup; import does not claim a decoded frame.',
        idempotent: Boolean(prior), compatibleSlots: compatibleSlots.map((slot) => slot.slotId), preserved: preservation(source, document),
      },
    };
  });

  const bindOperation = operation(declaration, {
    id: 'asset bind',
    title: 'Bind imported image to render slot',
    description: 'Binds an imported image ID to one declared renderer-consumed slot with validated compositing controls.',
    kind: 'edit',
    requires: ['project', 'options.assetId', 'options.slotId'],
    preserves: ['game', 'takes', 'timeline', 'production', 'direction.production', 'direction.rhythm', 'embedded asset entries'],
    invalidates: ['render artifacts', 'visual previews'],
    inputSchema: inputSchema({
      assetId: { type: 'string' }, slotId: { type: 'string' },
      fit: { enum: ['cover', 'contain', 'stretch'] }, opacity: { type: 'number', minimum: 0, maximum: 1 },
      blendMode: { enum: ['source-over', 'multiply', 'screen', 'overlay', 'soft-light'] },
      inset: { type: 'number', minimum: 0, maximum: 0.45 },
      transform: AGENT_IMAGE_TRANSFORM_SCHEMA,
      playback: AGENT_SEQUENCE_PLAYBACK_SCHEMA,
    }, true, ['assetId', 'slotId']),
  }, async (input) => {
    const source = project(input.project, declaration);
    const controls = options(input, ['assetId', 'slotId', 'fit', 'opacity', 'blendMode', 'inset', 'transform', 'playback']);
    const requestedAssetId = assetId(controls.assetId);
    const slotId = requiredText(controls.slotId, 'AGENT_ASSET_SLOT_ID', 120);
    const slot = declaration.slots.find((candidate) => candidate.slotId === slotId);
    if (!slot) throw new Error(`AGENT_ASSET_SLOT_UNSUPPORTED: ${slotId}`);
    const extension = readAgentAssetExtension(source);
    const asset = extension.entries[requestedAssetId];
    if (!asset) throw new Error(`AGENT_ASSET_UNKNOWN: ${requestedAssetId}`);
    const sequence = isAgentSequenceAsset(asset) ? asset : undefined;
    if (Boolean(sequence) !== (slot.assetKind === 'sequence')) throw new Error(`AGENT_ASSET_KIND_UNSUPPORTED_FOR_SLOT: ${slotId}`);
    if (await sha256Hex(sequence ? agentSequenceBytes(sequence) : decodeBase64Image((asset as AgentImageAsset).data)) !== asset.sha256) {
      throw new Error(`AGENT_ASSET_STORED_SHA256_MISMATCH: ${requestedAssetId}`);
    }
    if (!slot.acceptedMimeTypes.includes(asset.mimeType as AgentImageMimeType)) throw new Error(`AGENT_ASSET_MIME_UNSUPPORTED_FOR_SLOT: ${slotId}`);
    if (asset.byteLength > slot.maxBytes || asset.width > slot.maxWidth || asset.height > slot.maxHeight || asset.width * asset.height > slot.maxPixels) {
      throw new Error(`AGENT_ASSET_IMAGE_BUDGET_EXCEEDED_FOR_SLOT: ${slotId}`);
    }
    const fit = (controls.fit ?? slot.defaultFit) as RuntimeImageFit;
    const blendMode = (controls.blendMode ?? 'source-over') as RuntimeImageBlendMode;
    const opacity = controls.opacity ?? 1;
    const inset = controls.inset ?? 0;
    if (!slot.allowedFits.includes(fit)) throw new Error(`AGENT_ASSET_FIT_UNSUPPORTED_FOR_SLOT: ${slotId}`);
    if (!slot.allowedBlendModes.includes(blendMode)) throw new Error(`AGENT_ASSET_BLEND_UNSUPPORTED_FOR_SLOT: ${slotId}`);
    if (typeof opacity !== 'number' || opacity < 0 || opacity > 1) throw new Error('AGENT_ASSET_OPACITY_INVALID');
    if (typeof inset !== 'number' || inset < 0 || inset > 0.45) throw new Error('AGENT_ASSET_INSET_INVALID');
    if (!slot.allowInset && inset !== 0) throw new Error(`AGENT_ASSET_INSET_UNSUPPORTED_FOR_SLOT: ${slotId}`);
    const transform = parseAgentImageTransform(controls.transform);
    if (!sequence && controls.playback !== undefined) throw new Error(`AGENT_ASSET_PLAYBACK_UNSUPPORTED_FOR_SLOT: ${slotId}`);
    // A sequence always stores a complete resolved playback, so a later render never
    // has to guess a default that differs from the one the Agent reviewed.
    const playback = sequence ? { ...(slot.sequence?.playbackDefaults ?? AGENT_SEQUENCE_DEFAULT_PLAYBACK), ...(parseAgentSequencePlayback(controls.playback) ?? {}) } : undefined;
    const binding = { slotId, assetId: requestedAssetId, role: slot.role, fit, opacity, blendMode, inset, ...(transform ? { transform } : {}), ...(playback ? { playback } : {}) };
    validateAgentImageBinding(binding, slot);
    if (sequence) validateAgentSequenceBinding(binding, slot, sequence);
    extension.bindings[slotId] = binding;
    const document = withAgentAssetExtension(source, extension);
    return {
      ok: true,
      document,
      report: {
        operation: 'asset bind', binding: extension.bindings[slotId], consumer: slot.consumer,
        ...(sequence ? { sequence: { frameCount: sequence.frames.length, fps: sequence.fps, anchor: slot.sequence?.anchor, naturalDurationFrames: Math.ceil(sequence.frames.length * 30 / sequence.fps) } } : {}),
        actualPixelConsumption: slot.consumer.actualPixels, preserved: preservation(source, document),
      },
    };
  });

  const catalogOperation = operation(declaration, {
    id: 'asset catalog',
    title: 'List importable image slots',
    description: 'Lists only image slots with an implemented pixel consumer and their exact import and compositing limits.',
    kind: 'query',
    requires: [],
    preserves: ['project'],
    invalidates: [],
    inputSchema: inputSchema({}, false),
  }, () => ({
    ok: true,
    report: {
      operation: 'asset catalog', gameId: declaration.gameId, version: declaration.version,
      storage: 'direction.style.agentAssets', importEncoding: 'base64', digest: 'sha256 lowercase hex',
      slots: declaration.slots.map((slot) => ({ ...slot, acceptedMimeTypes: [...slot.acceptedMimeTypes], allowedFits: [...slot.allowedFits], allowedBlendModes: [...slot.allowedBlendModes] })),
      examples: {
        import: { operation: 'asset import', options: { id: 'campaign-background', sourceName: 'campaign.png', mimeType: 'image/png', encoding: 'base64', data: '<base64>', sha256: '<64 lowercase hex>' } },
        bind: { operation: 'asset bind', options: { assetId: 'campaign-background', slotId: declaration.slots[0]?.slotId, fit: declaration.slots[0]?.defaultFit } },
      },
      sequences: declaration.slots.some((slot) => slot.assetKind === 'sequence') ? {
        importOptions: { kind: 'sequence', mimeType: 'image/png', encoding: 'base64', fps: 'integer 1-120', frames: '[{ data, sha256 }] in playback order, identical dimensions' },
        bindOptions: { playback: AGENT_SEQUENCE_PLAYBACK_SCHEMA.properties },
        slots: declaration.slots.filter((slot) => slot.assetKind === 'sequence').map((slot) => ({ slotId: slot.slotId, anchor: slot.sequence?.anchor, maxFrames: slot.sequence?.maxFrames, playbackDefaults: slot.sequence?.playbackDefaults })),
        limits: 'Transparent PNG frames only. Deterministic frame selection comes from the bound event window; this is neither a physics simulation nor per-fragment control.',
      } : undefined,
      limits: 'PNG and JPEG only for still slots; sequence slots take ordered PNG frames. Format structure, dimensions, and SHA-256 are validated at import; pixel decode is validated during render warmup. No model, mesh, or arbitrary texture-map support is claimed.',
    },
  }));

  const unbindOperation = operation(declaration, {
    id: 'asset unbind', title: 'Restore a render slot default',
    description: 'Removes one slot binding without deleting embedded source assets or changing gameplay and timing.',
    kind: 'edit', requires: ['project', 'options.slotId'],
    preserves: ['game', 'takes', 'timeline', 'production', 'direction.production', 'direction.rhythm', 'embedded asset entries'],
    invalidates: ['render artifacts', 'visual previews'],
    inputSchema: inputSchema({ slotId: { type: 'string' } }, true, ['slotId']),
  }, input => {
    const source = project(input.project, declaration), controls = options(input, ['slotId']);
    const slotId = requiredText(controls.slotId, 'AGENT_ASSET_SLOT_ID', 120);
    if (!declaration.slots.some(slot => slot.slotId === slotId)) throw new Error(`AGENT_ASSET_SLOT_UNSUPPORTED: ${slotId}`);
    const extension = readAgentAssetExtension(source), removed = Boolean(extension.bindings[slotId]);
    delete extension.bindings[slotId];
    const document = withAgentAssetExtension(source, extension);
    return { ok: true, document, report: { operation: 'asset unbind', slotId, removed, preserved: preservation(source, document) } };
  });
  const pruneOperation = operation(declaration, {
    id: 'asset prune', title: 'Remove unreferenced imported assets from a copy',
    description: 'Conservatively retains every imported ID mentioned anywhere outside the imported-entry table, including native faces, sequences and action effects. Does not delete files.',
    kind: 'edit', requires: ['project'],
    preserves: ['game', 'takes', 'timeline', 'referenced assets', 'native visual themes', 'audio'],
    invalidates: [],
    inputSchema: inputSchema({ dryRun: { type: 'boolean' } }, true),
  }, input => {
    const source = project(input.project, declaration), controls = options(input, ['dryRun']);
    if (controls.dryRun !== undefined && typeof controls.dryRun !== 'boolean') throw new Error('AGENT_ASSET_PRUNE_DRY_RUN_INVALID');
    const extension = readAgentAssetExtension(source);
    const ids = new Set(Object.keys(extension.entries)), used = new Set<string>();
    const inspect = (value: unknown, path: string[]): void => {
      if (path.join('.') === 'direction.style.agentAssets.entries') return;
      if (typeof value === 'string') { if (ids.has(value)) used.add(value); return; }
      if (Array.isArray(value)) { value.forEach((item, index) => inspect(item, [...path, String(index)])); return; }
      if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
        if (ids.has(key)) used.add(key);
        inspect(item, [...path, key]);
      }
    };
    inspect(source, []);
    const removedIds = [...ids].filter(id => !used.has(id));
    const removedBytes = removedIds.reduce((sum, id) => sum + extension.entries[id]!.byteLength, 0);
    for (const id of removedIds) delete extension.entries[id];
    const dryRun = controls.dryRun === true;
    const document = dryRun ? structuredClone(source) : withAgentAssetExtension(source, extension);
    return { ok: true, document, report: { operation: 'asset prune', dryRun, removedIds, removedBytes, retainedIds: [...used], filesDeleted: 0, preserved: preservation(source, document) } };
  });
  return [catalogOperation, importOperation, bindOperation, unbindOperation, pruneOperation];
}
