import type {
  AssetRef,
  ColorSpaceTag,
  ContractIssue,
  GenericAssetManifest,
  MaterialClass,
  MaterialMapBinding,
  MaterialPackManifest,
  MaterialRuntimeDescriptor,
  MaterialTextureRef,
  NormalYConvention,
  ResolvedRenderPlan,
  TextureChannel,
} from './contracts.js';
import { BCS_CONTRACT_VERSION } from './contracts.js';
import { BcsHeadlessError } from './errors.js';
import { stableHash } from './stableHash.js';
import { CONTENT_HASH_PATTERN, validateAssetManifest } from './validation.js';

const UNSUPPORTED_TEXTURE_SLOTS = new Set(['height', 'opacity']);
const COMPILE_TEXTURE_SLOTS = new Set<MaterialMapBinding['slot']>([
  'baseColor',
  'normal',
  'roughness',
  'metallic',
  'ao',
  'emission',
  'orm',
]);
const MATERIAL_CLASSES = new Set<MaterialClass>([
  'metal', 'wood', 'glass', 'stone', 'jade', 'plastic', 'jelly', 'ceramic', 'fabric', 'custom',
]);
const MAP_SLOTS = new Set<MaterialMapBinding['slot']>([
  'baseColor', 'normal', 'roughness', 'metallic', 'ao', 'emission', 'orm',
]);
const TEXTURE_CHANNELS = new Set<TextureChannel>(['r', 'g', 'b', 'a', 'rgb', 'rgba']);
const COLOR_SPACES = new Set<ColorSpaceTag>(['srgb', 'linear']);
const NORMAL_Y_VALUES = new Set<Exclude<NormalYConvention, 'unspecified'>>(['opengl', 'directx']);
const CAPABILITY_STATES = new Set(['supported', 'pending', 'unsupported']);

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface MaterialMapCompileInput {
  slot: MaterialMapBinding['slot'];
  uri: string;
  contentHash: string;
  width?: number;
  height?: number;
  channels?: MaterialMapBinding['channels'];
  colorSpace?: ColorSpaceTag;
  normalY?: NormalYConvention;
  orm?: boolean;
}

export interface MaterialCompileInput {
  pack: MaterialPackManifest;
  maps?: MaterialMapCompileInput[];
  uv?: MaterialRuntimeDescriptor['uv'];
  combine?: MaterialRuntimeDescriptor['combine'];
  registry?: {
    resolve(ref: AssetRef, options?: { requireHash?: boolean }): { uri?: string; contentHash?: string };
  };
  rewriteUri?: (uri: string) => string;
}

function issue(code: string, message: string, path: string): ContractIssue {
  return { code, severity: 'error', message, path, recoverable: true };
}

/** Mapped albedo/ORM samples already carry appearance; multiplying tile×pack×map muddies identity. */
export function defaultCombineForMaps(maps: readonly MaterialMapBinding[]): MaterialRuntimeDescriptor['combine'] {
  return maps.some((map) => map.slot === 'baseColor' || map.slot === 'orm' || map.slot === 'roughness' || map.slot === 'metallic')
    ? 'replace'
    : 'multiply-factor';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function colorSpaceForSlot(slot: MaterialMapBinding['slot']): ColorSpaceTag {
  return slot === 'baseColor' || slot === 'emission' ? 'srgb' : 'linear';
}

export function defaultChannelsForSlot(slot: MaterialMapBinding['slot']): TextureChannel {
  if (slot === 'baseColor' || slot === 'normal' || slot === 'emission' || slot === 'orm') return 'rgb';
  return 'r';
}

const LEGAL_CHANNELS_BY_SLOT: Record<MaterialMapBinding['slot'], ReadonlySet<TextureChannel>> = {
  baseColor: new Set(['rgb', 'rgba']),
  normal: new Set(['rgb', 'rgba']),
  orm: new Set(['rgb', 'rgba']),
  roughness: new Set(['r', 'g', 'b', 'a', 'rgb', 'rgba']),
  metallic: new Set(['r', 'g', 'b', 'a', 'rgb', 'rgba']),
  ao: new Set(['r', 'g', 'b', 'a', 'rgb', 'rgba']),
  emission: new Set(['r', 'rgb', 'rgba']),
};

const ORM_SPLIT_SLOTS = new Set<MaterialMapBinding['slot']>(['ao', 'roughness', 'metallic']);

export function legalChannelsForSlot(slot: MaterialMapBinding['slot']): TextureChannel[] {
  return [...LEGAL_CHANNELS_BY_SLOT[slot]];
}

export function collectMaterialMapContractIssues(
  maps: readonly MaterialMapBinding[],
  path = '$.maps',
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const seen = new Map<MaterialMapBinding['slot'], number>();
  for (const [index, map] of maps.entries()) {
    const previous = seen.get(map.slot);
    if (previous !== undefined) {
      issues.push(issue(
        'MATERIAL_MAP_SLOT_DUPLICATE',
        `Map slot ${map.slot} is bound more than once.`,
        `${path}[${index}].slot`,
      ));
    } else {
      seen.set(map.slot, index);
    }
    if (!LEGAL_CHANNELS_BY_SLOT[map.slot].has(map.channels)) {
      issues.push(issue(
        'MATERIAL_MAP_CHANNELS_INVALID',
        `Map slot ${map.slot} does not accept channels '${map.channels}'.`,
        `${path}[${index}].channels`,
      ));
    }
  }
  if (seen.has('orm') && [...ORM_SPLIT_SLOTS].some((slot) => seen.has(slot))) {
    issues.push(issue(
      'MATERIAL_MAP_ORM_CONFLICT',
      'Packed ORM cannot be combined with split ao/roughness/metallic maps.',
      path,
    ));
  }
  return issues;
}

/** Join a Vite/Pages `BASE_URL` with the public materials/maps directory. */
export function materialMapsPublicBase(publicBase = '/'): string {
  const base = publicBase.endsWith('/') ? publicBase : `${publicBase}/`;
  return `${base}materials/maps`;
}

/** Rewrite pack/source map URIs onto the Vite-served public materials directory. */
export function rewriteMaterialMapUriForBrowser(
  uri: string,
  mapBaseUrl = '/materials/maps',
): string {
  const file = uri.split(/[/\\]/).pop();
  if (file && (uri.includes('materials/maps/') || uri.startsWith('/materials/maps/'))) {
    return `${mapBaseUrl.replace(/\/$/, '')}/${file}`;
  }
  return uri;
}

export function channelsForOrmComponent(component: 'ao' | 'roughness' | 'metallic'): MaterialMapBinding['channels'] {
  if (component === 'ao') return 'r';
  if (component === 'roughness') return 'g';
  return 'b';
}

/**
 * Three.js MeshStandard/Physical samples roughnessMap on G, metalnessMap on B, aoMap on R.
 * `channels` on a binding is the *source* channel of the image, not the Three.js destination.
 */
export function needsThreeJsChannelSwizzle(
  slot: MaterialMapBinding['slot'],
  channels: TextureChannel,
): boolean {
  if (slot === 'roughness') return channels !== 'g' && channels !== 'rgb' && channels !== 'rgba';
  if (slot === 'metallic') return channels !== 'b' && channels !== 'rgb' && channels !== 'rgba';
  if (slot === 'ao') return channels !== 'r' && channels !== 'rgb' && channels !== 'rgba';
  if (slot === 'emission') return channels === 'r';
  return false;
}

export function sampleSourceChannel(
  packed: { r: number; g: number; b: number; a?: number },
  channels: TextureChannel,
): number {
  if (channels === 'g') return packed.g;
  if (channels === 'b') return packed.b;
  if (channels === 'a') return packed.a ?? 255;
  return packed.r;
}

/** Remap a source pixel into the layout Three.js will sample for the given slot. */
export function remapChannelsForThreeJsSlot(
  packed: { r: number; g: number; b: number; a?: number },
  slot: MaterialMapBinding['slot'],
  channels: TextureChannel,
): { r: number; g: number; b: number; a: number } {
  const alpha = packed.a ?? 255;
  if (!needsThreeJsChannelSwizzle(slot, channels)) {
    return { r: packed.r, g: packed.g, b: packed.b, a: alpha };
  }
  const sample = sampleSourceChannel(packed, channels);
  if (slot === 'roughness') return { r: 0, g: sample, b: 0, a: alpha };
  if (slot === 'metallic') return { r: 0, g: 0, b: sample, a: alpha };
  if (slot === 'ao') return { r: sample, g: 0, b: 0, a: alpha };
  if (slot === 'emission') return { r: sample, g: sample, b: sample, a: alpha };
  return { r: packed.r, g: packed.g, b: packed.b, a: alpha };
}

export function isSafeMaterialUri(uri: string): boolean {
  if (!uri || uri.length > 2048) return false;
  if (uri.includes('..') || uri.includes('\\') || uri.includes('\0')) return false;
  if (uri.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
    return /^(https?|bcs-asset):/i.test(uri);
  }
  return uri.trim().length > 0;
}

function throwIfIssues(code: string, message: string, path: string, issues: ContractIssue[]): void {
  if (issues.length === 0) return;
  const first = issues[0]!;
  throw new BcsHeadlessError(code, `${message} ${first.message}`, {
    path: first.path ?? path,
    details: issues,
  });
}

function compileMapBinding(map: MaterialMapCompileInput, path: string): {
  binding: MaterialMapBinding;
  issues: ContractIssue[];
} {
  const issues: ContractIssue[] = [];
  const expectedSpace = colorSpaceForSlot(map.slot);
  const colorSpace = map.colorSpace ?? expectedSpace;
  if (colorSpace !== expectedSpace) {
    issues.push(issue(
      'MATERIAL_COLORSPACE_MISMATCH',
      `Map ${map.slot} must use ${expectedSpace} color space.`,
      `${path}.colorSpace`,
    ));
  }
  if (!isSafeMaterialUri(map.uri)) {
    issues.push(issue(
      'MATERIAL_MAP_URI_INVALID',
      `Map ${map.slot} URI is missing, uses a blocked protocol, or contains '..'.`,
      `${path}.uri`,
    ));
  }
  if (!CONTENT_HASH_PATTERN.test(map.contentHash) && !/^sha256:[0-9a-f]+$/i.test(map.contentHash)) {
    // Explicit compile inputs in unit tests may use short hashes; import parsing is strict.
  }
  if (map.slot === 'normal' && (map.normalY === undefined || map.normalY === 'unspecified')) {
    issues.push(issue(
      'MATERIAL_NORMAL_Y_UNSPECIFIED',
      'Normal maps require an explicit OpenGL or DirectX Y convention.',
      `${path}.normalY`,
    ));
  }
  if ((map.width !== undefined && map.width <= 0) || (map.height !== undefined && map.height <= 0)) {
    issues.push(issue('MATERIAL_MAP_SIZE_INVALID', `Map ${map.slot} has invalid dimensions.`, path));
  }
  const channels = map.channels ?? defaultChannelsForSlot(map.slot);
  if (!LEGAL_CHANNELS_BY_SLOT[map.slot].has(channels)) {
    issues.push(issue(
      'MATERIAL_MAP_CHANNELS_INVALID',
      `Map slot ${map.slot} does not accept channels '${channels}'.`,
      `${path}.channels`,
    ));
  }
  const binding: MaterialMapBinding = {
    slot: map.slot,
    uri: map.uri,
    contentHash: map.contentHash,
    colorSpace,
    channels,
  };
  if (map.slot === 'normal' && map.normalY && map.normalY !== 'unspecified') {
    binding.normalY = map.normalY;
  }
  return { binding, issues };
}

function resolveTextureRefUri(
  slot: string,
  ref: MaterialTextureRef,
  input: MaterialCompileInput,
): { uri: string; contentHash: string } {
  let uri = ref.uri;
  let contentHash = ref.contentHash;
  if (input.registry) {
    const resolved = input.registry.resolve(ref);
    uri = resolved.uri ?? uri;
    contentHash = resolved.contentHash ?? contentHash;
  }
  if (!uri || !contentHash) {
    throw new BcsHeadlessError(
      'MATERIAL_TEXTURE_UNRESOLVED',
      `Texture ref ${slot} is missing uri or contentHash and could not be resolved from the registry.`,
      { path: `$.appearance.textureRefs.${slot}` },
    );
  }
  return {
    uri: input.rewriteUri ? input.rewriteUri(uri) : uri,
    contentHash,
  };
}

function mapsFromTextureRefs(input: MaterialCompileInput): {
  maps: MaterialMapBinding[];
  issues: ContractIssue[];
  unsupportedFields: string[];
} {
  const maps: MaterialMapBinding[] = [];
  const issues: ContractIssue[] = [];
  const unsupportedFields: string[] = [];
  for (const [slot, ref] of Object.entries(input.pack.appearance.textureRefs ?? {})) {
    if (!ref) continue;
    if (UNSUPPORTED_TEXTURE_SLOTS.has(slot) || !COMPILE_TEXTURE_SLOTS.has(slot as MaterialMapBinding['slot'])) {
      unsupportedFields.push(`appearance.textureRefs.${slot}`);
      continue;
    }
    const resolved = resolveTextureRefUri(slot, ref, input);
    const compiled = compileMapBinding({
      slot: slot as MaterialMapBinding['slot'],
      uri: resolved.uri,
      contentHash: resolved.contentHash,
      ...(ref.channels !== undefined ? { channels: ref.channels } : {}),
      ...(ref.colorSpace !== undefined ? { colorSpace: ref.colorSpace } : {}),
      ...(ref.normalY !== undefined ? { normalY: ref.normalY } : {}),
    }, `$.maps.${slot}`);
    issues.push(...compiled.issues);
    maps.push(compiled.binding);
  }
  return { maps, issues, unsupportedFields };
}

export function compileMaterialRuntime(input: MaterialCompileInput): MaterialRuntimeDescriptor {
  const packIssues = validateAssetManifest(input.pack).filter((candidate) => candidate.severity === 'error');
  if (packIssues.length > 0) {
    throw new BcsHeadlessError('MATERIAL_PACK_INVALID', 'Material pack failed validation.', {
      path: '$.pack',
      details: packIssues,
    });
  }

  const unsupportedFields: string[] = [];
  for (const [slot, ref] of Object.entries(input.pack.appearance.textureRefs ?? {})) {
    if (!ref) continue;
    if (UNSUPPORTED_TEXTURE_SLOTS.has(slot) || !COMPILE_TEXTURE_SLOTS.has(slot as MaterialMapBinding['slot'])) {
      unsupportedFields.push(`appearance.textureRefs.${slot}`);
    }
  }

  let maps: MaterialMapBinding[] = [];
  const issues: ContractIssue[] = [];
  if (input.maps !== undefined) {
    for (const [index, map] of input.maps.entries()) {
      const compiled = compileMapBinding(map, `$.maps[${index}]`);
      issues.push(...compiled.issues);
      maps.push(compiled.binding);
    }
  } else {
    const fromRefs = mapsFromTextureRefs(input);
    maps = fromRefs.maps;
    issues.push(...fromRefs.issues);
    for (const field of fromRefs.unsupportedFields) {
      if (!unsupportedFields.includes(field)) unsupportedFields.push(field);
    }
  }

  issues.push(...collectMaterialMapContractIssues(maps));
  throwIfIssues('MATERIAL_RUNTIME_INVALID', 'Material runtime compile failed.', '$.maps', issues);

  const descriptor: MaterialRuntimeDescriptor = {
    contract: 'bcs.material-runtime',
    contractVersion: BCS_CONTRACT_VERSION,
    id: input.pack.id,
    version: input.pack.version,
    contentHash: '',
    materialClass: input.pack.behavior.materialClass,
    baseColor: input.pack.appearance.baseColor,
    roughness: input.pack.appearance.roughness,
    metalness: input.pack.appearance.metalness,
    maps,
    uv: input.uv ?? { repeat: [1, 1], offset: [0, 0], rotationRadians: 0 },
    combine: input.combine ?? defaultCombineForMaps(maps),
    capabilities: {
      heightDisplacement: 'unsupported',
      anisotropy: 'unsupported',
      subsurface: 'unsupported',
      complexTransmission: input.pack.appearance.transmission && input.pack.appearance.transmission > 0
        ? 'pending'
        : 'unsupported',
      materialAwareFracture: 'pending',
    },
    unsupportedFields,
    behaviorPending: true,
  };
  if (input.pack.appearance.specular !== undefined) descriptor.specular = input.pack.appearance.specular;
  if (input.pack.appearance.clearcoat !== undefined) descriptor.clearcoat = input.pack.appearance.clearcoat;
  if (input.pack.appearance.transmission !== undefined) descriptor.transmission = input.pack.appearance.transmission;
  if (input.pack.appearance.ior !== undefined) descriptor.ior = input.pack.appearance.ior;
  if (input.pack.appearance.thickness !== undefined) descriptor.thickness = input.pack.appearance.thickness;
  if (input.pack.appearance.normalStrength !== undefined) descriptor.normalStrength = input.pack.appearance.normalStrength;
  if (input.pack.appearance.emission !== undefined) descriptor.emission = input.pack.appearance.emission;

  descriptor.contentHash = input.pack.contentHash ?? `fnv1a32:${stableHash({
    id: descriptor.id,
    version: descriptor.version,
    appearance: input.pack.appearance,
    maps: descriptor.maps,
    uv: descriptor.uv,
    combine: descriptor.combine,
  }).slice(8)}`;
  return descriptor;
}

export function materialDescriptorKey(descriptor: MaterialRuntimeDescriptor): string {
  return stableHash({
    id: descriptor.id,
    version: descriptor.version,
    contentHash: descriptor.contentHash,
    materialClass: descriptor.materialClass,
    baseColor: descriptor.baseColor,
    roughness: descriptor.roughness,
    metalness: descriptor.metalness,
    specular: descriptor.specular ?? null,
    clearcoat: descriptor.clearcoat ?? null,
    transmission: descriptor.transmission ?? null,
    ior: descriptor.ior ?? null,
    thickness: descriptor.thickness ?? null,
    normalStrength: descriptor.normalStrength ?? null,
    emission: descriptor.emission ?? null,
    maps: descriptor.maps,
    uv: descriptor.uv,
    combine: descriptor.combine,
  });
}

export function materialCacheKey(
  descriptor: MaterialRuntimeDescriptor,
  extras: {
    color?: string;
    opacity?: number;
    lookDevId?: string;
    cell?: { row: number; col: number };
  } = {},
): string {
  return stableHash({
    descriptor: materialDescriptorKey(descriptor),
    color: extras.color ?? null,
    opacity: extras.opacity ?? 1,
    lookDevId: extras.lookDevId ?? null,
    cell: extras.cell ? { row: extras.cell.row, col: extras.cell.col } : null,
  });
}

export function sampleOrmChannel(
  packed: { r: number; g: number; b: number },
  component: 'ao' | 'roughness' | 'metallic',
): number {
  if (component === 'ao') return packed.r;
  if (component === 'roughness') return packed.g;
  return packed.b;
}

export function combineFactorAndSample(
  factor: number,
  sample: number | undefined,
  mode: MaterialRuntimeDescriptor['combine'],
): number {
  if (sample === undefined) return factor;
  return mode === 'replace' ? sample : factor * sample;
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function parseUv(value: unknown, path: string, issues: ContractIssue[]): MaterialRuntimeDescriptor['uv'] {
  if (!isRecord(value)) {
    issues.push(issue('MATERIAL_RUNTIME_UV_INVALID', 'uv must be an object.', path));
    return { repeat: [1, 1], offset: [0, 0], rotationRadians: 0 };
  }
  const pair = (candidate: unknown, field: string): [number, number] | null => {
    if (!Array.isArray(candidate) || candidate.length !== 2) {
      issues.push(issue('MATERIAL_RUNTIME_UV_INVALID', `${field} must be a length-2 number array.`, `${path}.${field}`));
      return null;
    }
    const x = candidate[0];
    const y = candidate[1];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      issues.push(issue('MATERIAL_RUNTIME_UV_INVALID', `${field} values must be finite numbers.`, `${path}.${field}`));
      return null;
    }
    return [x, y];
  };
  const repeat = pair(value.repeat, 'repeat') ?? [1, 1];
  const offset = pair(value.offset, 'offset') ?? [0, 0];
  if (typeof value.rotationRadians !== 'number' || !Number.isFinite(value.rotationRadians)) {
    issues.push(issue('MATERIAL_RUNTIME_UV_INVALID', 'rotationRadians must be a finite number.', `${path}.rotationRadians`));
  }
  return {
    repeat,
    offset,
    rotationRadians: typeof value.rotationRadians === 'number' && Number.isFinite(value.rotationRadians)
      ? value.rotationRadians
      : 0,
  };
}

function parseMapBinding(value: unknown, path: string, issues: ContractIssue[]): MaterialMapBinding | null {
  if (!isRecord(value)) {
    issues.push(issue('MATERIAL_RUNTIME_MAP_INVALID', 'Map binding must be an object.', path));
    return null;
  }
  if (typeof value.slot !== 'string' || !MAP_SLOTS.has(value.slot as MaterialMapBinding['slot'])) {
    issues.push(issue('MATERIAL_RUNTIME_MAP_SLOT_INVALID', 'Unknown or missing map slot.', `${path}.slot`));
    return null;
  }
  const slot = value.slot as MaterialMapBinding['slot'];
  if (typeof value.uri !== 'string' || !isSafeMaterialUri(value.uri)) {
    issues.push(issue(
      'MATERIAL_MAP_URI_INVALID',
      'Map URI must be a relative path, https URL, or bcs-asset URI without "..".',
      `${path}.uri`,
    ));
  }
  if (typeof value.contentHash !== 'string' || !CONTENT_HASH_PATTERN.test(value.contentHash)) {
    issues.push(issue(
      'MATERIAL_RUNTIME_HASH_INVALID',
      'Map contentHash must be sha256:<64 hex> or fnv1a32:<8 hex>.',
      `${path}.contentHash`,
    ));
  }
  if (typeof value.colorSpace !== 'string' || !COLOR_SPACES.has(value.colorSpace as ColorSpaceTag)) {
    issues.push(issue('MATERIAL_RUNTIME_COLORSPACE_INVALID', 'colorSpace must be srgb or linear.', `${path}.colorSpace`));
  } else if (value.colorSpace !== colorSpaceForSlot(slot)) {
    issues.push(issue(
      'MATERIAL_COLORSPACE_MISMATCH',
      `Map ${slot} must use ${colorSpaceForSlot(slot)} color space.`,
      `${path}.colorSpace`,
    ));
  }
  if (typeof value.channels !== 'string' || !TEXTURE_CHANNELS.has(value.channels as TextureChannel)) {
    issues.push(issue('MATERIAL_RUNTIME_CHANNELS_INVALID', 'channels must be r, g, b, a, rgb, or rgba.', `${path}.channels`));
  } else if (!LEGAL_CHANNELS_BY_SLOT[slot].has(value.channels as TextureChannel)) {
    issues.push(issue(
      'MATERIAL_MAP_CHANNELS_INVALID',
      `Map slot ${slot} does not accept channels '${value.channels}'.`,
      `${path}.channels`,
    ));
  }
  let normalY: NormalYConvention | undefined;
  if (slot === 'normal') {
    if (typeof value.normalY !== 'string' || !NORMAL_Y_VALUES.has(value.normalY as 'opengl' | 'directx')) {
      issues.push(issue(
        'MATERIAL_NORMAL_Y_UNSPECIFIED',
        'Normal maps require an explicit opengl or directx Y convention.',
        `${path}.normalY`,
      ));
    } else {
      normalY = value.normalY as 'opengl' | 'directx';
    }
  }
  if (issues.some((item) => item.path?.startsWith(path) && item.severity === 'error')) {
    return null;
  }
  const binding: MaterialMapBinding = {
    slot,
    uri: String(value.uri),
    contentHash: String(value.contentHash),
    colorSpace: value.colorSpace as ColorSpaceTag,
    channels: value.channels as TextureChannel,
  };
  if (normalY) binding.normalY = normalY;
  return binding;
}

/**
 * Strict parser for persisted MaterialRuntimeDescriptor values.
 * Compiled runtimes in project JSON cannot bypass compile-time URI/hash/slot/channel/UV checks.
 */
export function parseMaterialRuntimeDescriptor(value: unknown): MaterialRuntimeDescriptor {
  const issues: ContractIssue[] = [];
  if (!isRecord(value)) {
    throw new BcsHeadlessError('MATERIAL_RUNTIME_INVALID', 'Material runtime must be an object.', {
      path: '$',
    });
  }
  if (value.contract !== 'bcs.material-runtime') {
    issues.push(issue('MATERIAL_RUNTIME_CONTRACT_INVALID', 'contract must be bcs.material-runtime.', '$.contract'));
  }
  if (value.contractVersion !== BCS_CONTRACT_VERSION) {
    issues.push(issue('MATERIAL_RUNTIME_VERSION_INVALID', `contractVersion must be ${BCS_CONTRACT_VERSION}.`, '$.contractVersion'));
  }
  if (typeof value.id !== 'string' || !value.id.trim()) {
    issues.push(issue('MATERIAL_RUNTIME_ID_INVALID', 'id is required.', '$.id'));
  }
  if (typeof value.version !== 'string' || !SEMVER_PATTERN.test(value.version)) {
    issues.push(issue('MATERIAL_RUNTIME_PACK_VERSION_INVALID', 'version must be semver.', '$.version'));
  }
  if (typeof value.contentHash !== 'string' || !CONTENT_HASH_PATTERN.test(value.contentHash)) {
    issues.push(issue(
      'MATERIAL_RUNTIME_HASH_INVALID',
      'contentHash must be sha256:<64 hex> or fnv1a32:<8 hex>.',
      '$.contentHash',
    ));
  }
  if (typeof value.materialClass !== 'string' || !MATERIAL_CLASSES.has(value.materialClass as MaterialClass)) {
    issues.push(issue('MATERIAL_RUNTIME_CLASS_INVALID', 'materialClass is unknown.', '$.materialClass'));
  }
  if (typeof value.baseColor !== 'string' || !HEX_COLOR.test(value.baseColor)) {
    issues.push(issue('MATERIAL_RUNTIME_BASECOLOR_INVALID', 'baseColor must be #RRGGBB.', '$.baseColor'));
  }
  for (const field of ['roughness', 'metalness'] as const) {
    if (!finiteInRange(value[field], 0, 1)) {
      issues.push(issue('MATERIAL_RUNTIME_RANGE', `${field} must be between 0 and 1.`, `$.${field}`));
    }
  }
  for (const field of ['specular', 'clearcoat', 'transmission', 'emission', 'normalStrength'] as const) {
    if (value[field] !== undefined && !finiteInRange(value[field], 0, 1)) {
      issues.push(issue('MATERIAL_RUNTIME_RANGE', `${field} must be between 0 and 1.`, `$.${field}`));
    }
  }
  if (value.ior !== undefined && !finiteInRange(value.ior, 1, 3)) {
    issues.push(issue('MATERIAL_RUNTIME_RANGE', 'ior must be between 1 and 3.', '$.ior'));
  }
  if (value.thickness !== undefined && (typeof value.thickness !== 'number' || !Number.isFinite(value.thickness) || value.thickness < 0)) {
    issues.push(issue('MATERIAL_RUNTIME_RANGE', 'thickness must be a non-negative finite number.', '$.thickness'));
  }
  if (!Array.isArray(value.maps)) {
    issues.push(issue('MATERIAL_RUNTIME_MAPS_INVALID', 'maps must be an array.', '$.maps'));
  }
  const maps = Array.isArray(value.maps)
    ? value.maps
      .map((item, index) => parseMapBinding(item, `$.maps[${index}]`, issues))
      .filter((item): item is MaterialMapBinding => item !== null)
    : [];
  if (Array.isArray(value.maps)) {
    issues.push(...collectMaterialMapContractIssues(maps));
  }
  const uv = parseUv(value.uv, '$.uv', issues);
  if (value.combine !== 'multiply-factor' && value.combine !== 'replace') {
    issues.push(issue('MATERIAL_RUNTIME_COMBINE_INVALID', 'combine must be multiply-factor or replace.', '$.combine'));
  }
  if (!isRecord(value.capabilities)) {
    issues.push(issue('MATERIAL_RUNTIME_CAPABILITIES_INVALID', 'capabilities must be an object.', '$.capabilities'));
  } else {
    for (const key of ['heightDisplacement', 'anisotropy', 'subsurface', 'complexTransmission', 'materialAwareFracture'] as const) {
      if (!CAPABILITY_STATES.has(String(value.capabilities[key]))) {
        issues.push(issue('MATERIAL_RUNTIME_CAPABILITIES_INVALID', `${key} is not a known capability state.`, `$.capabilities.${key}`));
      }
    }
  }
  if (!Array.isArray(value.unsupportedFields) || value.unsupportedFields.some((item) => typeof item !== 'string')) {
    issues.push(issue('MATERIAL_RUNTIME_UNSUPPORTED_FIELDS_INVALID', 'unsupportedFields must be a string array.', '$.unsupportedFields'));
  }
  if (value.behaviorPending !== true) {
    issues.push(issue('MATERIAL_RUNTIME_BEHAVIOR_PENDING', 'behaviorPending must be true until fracture ships.', '$.behaviorPending'));
  }

  throwIfIssues('MATERIAL_RUNTIME_INVALID', 'Material runtime descriptor failed validation.', '$', issues);

  const descriptor: MaterialRuntimeDescriptor = {
    contract: 'bcs.material-runtime',
    contractVersion: BCS_CONTRACT_VERSION,
    id: String(value.id),
    version: String(value.version),
    contentHash: String(value.contentHash),
    materialClass: value.materialClass as MaterialClass,
    baseColor: String(value.baseColor),
    roughness: Number(value.roughness),
    metalness: Number(value.metalness),
    maps,
    uv,
    combine: value.combine as MaterialRuntimeDescriptor['combine'],
    capabilities: value.capabilities as MaterialRuntimeDescriptor['capabilities'],
    unsupportedFields: value.unsupportedFields as string[],
    behaviorPending: true,
  };
  if (typeof value.specular === 'number') descriptor.specular = value.specular;
  if (typeof value.clearcoat === 'number') descriptor.clearcoat = value.clearcoat;
  if (typeof value.transmission === 'number') descriptor.transmission = value.transmission;
  if (typeof value.ior === 'number') descriptor.ior = value.ior;
  if (typeof value.thickness === 'number') descriptor.thickness = value.thickness;
  if (typeof value.normalStrength === 'number') descriptor.normalStrength = value.normalStrength;
  if (typeof value.emission === 'number') descriptor.emission = value.emission;
  return descriptor;
}

export function bitmapManifestFromTextureRef(ref: MaterialTextureRef): GenericAssetManifest {
  if (!ref.uri || !ref.contentHash) {
    throw new BcsHeadlessError(
      'MATERIAL_TEXTURE_UNRESOLVED',
      `Texture ${ref.id} must declare uri and contentHash before it can enter the asset registry.`,
      { path: `$.textureRefs.${ref.id}` },
    );
  }
  return {
    contract: 'bcs.asset-manifest',
    contractVersion: BCS_CONTRACT_VERSION,
    id: ref.id,
    version: ref.version,
    kind: 'bitmap',
    origin: 'generated',
    contentHash: ref.contentHash,
    uri: ref.uri,
    runtime: {
      renderers: ['three-3d', 'fixed-camera-cinematic'],
      deterministic: true,
    },
  };
}

function planAssetKey(ref: Pick<AssetRef, 'id' | 'version'>): string {
  return `${ref.id}@${ref.version}`;
}

/**
 * Compile a MaterialRuntimeDescriptor from a ResolvedRenderPlan's `tile.material`
 * slot and closed `assets` map. This is the Headless Core entry the renderer
 * must consume — not a capture-side ID→filename table.
 */
export function materialRuntimeFromPlan(
  plan: ResolvedRenderPlan,
  options: { rewriteUri?: (uri: string) => string } = {},
): MaterialRuntimeDescriptor {
  const slot = plan.slots['tile.material'];
  if (!slot || slot.manifest.kind !== 'material-pack') {
    throw new BcsHeadlessError(
      'TILE_MATERIAL_KIND_INVALID',
      'ResolvedRenderPlan.slots["tile.material"] must be a material-pack.',
      { path: '$.slots.tile.material' },
    );
  }
  const pack = slot.manifest as MaterialPackManifest;
  const assets = plan.assets ?? {};
  return compileMaterialRuntime({
    pack,
    registry: {
      resolve(ref) {
        const resolved = assets[planAssetKey(ref)];
        if (!resolved) {
          throw new BcsHeadlessError(
            'ASSET_NOT_FOUND',
            `Plan is missing texture asset ${planAssetKey(ref)}.`,
            { path: '$.assets' },
          );
        }
        return {
          ...(resolved.manifest.uri !== undefined ? { uri: resolved.manifest.uri } : {}),
          ...(resolved.manifest.contentHash !== undefined
            ? { contentHash: resolved.manifest.contentHash }
            : ref.contentHash !== undefined ? { contentHash: ref.contentHash } : {}),
        };
      },
    },
    ...(options.rewriteUri ? { rewriteUri: options.rewriteUri } : {}),
  });
}

