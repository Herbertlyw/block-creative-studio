import type {
  AssetManifest,
  AssetRef,
  ContractIssue,
  CreativeMaster,
  EffectPackManifest,
  MaterialAppearanceProfile,
  MaterialBehaviorProfile,
  OutputSpec,
  VariantRecipe,
} from './contracts.js';
import { BCS_CONTRACT_VERSION } from './contracts.js';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const CONTENT_HASH_PATTERN = /^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$/i;
const HASH_PATTERN = CONTENT_HASH_PATTERN;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function issue(
  code: string,
  message: string,
  path: string,
  severity: ContractIssue['severity'] = 'error',
  recoverable = true,
): ContractIssue {
  return { code, message, path, severity, recoverable };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteInRange(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function validateRef(ref: AssetRef, path: string): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!ref.id?.trim()) issues.push(issue('ASSET_REF_ID_REQUIRED', 'Asset reference id is required.', `${path}.id`));
  if (!SEMVER_PATTERN.test(ref.version ?? '')) {
    issues.push(issue('ASSET_REF_VERSION_INVALID', 'Asset reference version must use semantic versioning.', `${path}.version`));
  }
  if (!ref.kind) issues.push(issue('ASSET_REF_KIND_REQUIRED', 'Asset reference kind is required.', `${path}.kind`));
  if (ref.contentHash !== undefined && !HASH_PATTERN.test(ref.contentHash)) {
    issues.push(issue('ASSET_REF_HASH_INVALID', 'Asset reference contentHash must be sha256:… or fnv1a32:….', `${path}.contentHash`));
  }
  return issues;
}

function validateOutput(output: OutputSpec, path: string): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!Number.isInteger(output.width) || output.width <= 0) {
    issues.push(issue('OUTPUT_WIDTH_INVALID', 'Output width must be a positive integer.', `${path}.width`));
  }
  if (!Number.isInteger(output.height) || output.height <= 0) {
    issues.push(issue('OUTPUT_HEIGHT_INVALID', 'Output height must be a positive integer.', `${path}.height`));
  }
  if (!Number.isFinite(output.fps) || output.fps <= 0 || output.fps > 240) {
    issues.push(issue('OUTPUT_FPS_INVALID', 'Output fps must be between 0 and 240.', `${path}.fps`));
  }
  if (!['preview', 'standard', 'cinematic'].includes(output.quality)) {
    issues.push(issue('OUTPUT_QUALITY_INVALID', 'Output quality is not supported.', `${path}.quality`));
  }
  return issues;
}

function validateAppearance(profile: MaterialAppearanceProfile): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!HEX_COLOR.test(profile.baseColor)) {
    issues.push(issue('MATERIAL_BASE_COLOR_INVALID', 'Material baseColor must be #RRGGBB.', '$.appearance.baseColor'));
  }
  for (const [key, value] of Object.entries(profile)) {
    if (key === 'baseColor' || key === 'ior' || key === 'thickness' || key === 'textureRefs') continue;
    if (!finiteInRange(value, 0, 1)) {
      issues.push(issue('MATERIAL_APPEARANCE_RANGE', `${key} must be between 0 and 1.`, `$.appearance.${key}`));
    }
  }
  if (profile.ior !== undefined && !finiteInRange(profile.ior, 1, 3)) {
    issues.push(issue('MATERIAL_IOR_RANGE', 'ior must be between 1 and 3.', '$.appearance.ior'));
  }
  if (profile.thickness !== undefined && (!Number.isFinite(profile.thickness) || profile.thickness < 0)) {
    issues.push(issue('MATERIAL_THICKNESS_RANGE', 'thickness must be non-negative.', '$.appearance.thickness'));
  }
  if (profile.textureRefs) {
    for (const [slot, ref] of Object.entries(profile.textureRefs)) {
      if (ref) issues.push(...validateRef(ref, `$.appearance.textureRefs.${slot}`));
    }
  }
  return issues;
}

function validateBehavior(profile: MaterialBehaviorProfile): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const normalizedKeys: Array<keyof MaterialBehaviorProfile> = [
    'density',
    'brittleness',
    'ductility',
    'elasticity',
    'hardness',
    'largeFragmentRatio',
    'dustAmount',
    'sparkAmount',
    'dropletAmount',
    'drag',
  ];
  for (const key of normalizedKeys) {
    if (!finiteInRange(profile[key], 0, 1)) {
      issues.push(issue('MATERIAL_BEHAVIOR_RANGE', `${key} must be between 0 and 1.`, `$.behavior.${key}`));
    }
  }
  if (!Number.isFinite(profile.gravityScale) || profile.gravityScale < 0 || profile.gravityScale > 4) {
    issues.push(issue('MATERIAL_GRAVITY_RANGE', 'gravityScale must be between 0 and 4.', '$.behavior.gravityScale'));
  }
  return issues;
}

export function validateAssetManifest(value: unknown): ContractIssue[] {
  if (!isObject(value)) return [issue('ASSET_MANIFEST_INVALID', 'Asset manifest must be an object.', '$')];
  const manifest = value as unknown as AssetManifest;
  const issues: ContractIssue[] = [];
  if (manifest.contract !== 'bcs.asset-manifest') {
    issues.push(issue('ASSET_CONTRACT_INVALID', 'contract must be bcs.asset-manifest.', '$.contract'));
  }
  if (manifest.contractVersion !== BCS_CONTRACT_VERSION) {
    issues.push(issue('CONTRACT_VERSION_UNSUPPORTED', `Expected contractVersion ${BCS_CONTRACT_VERSION}.`, '$.contractVersion'));
  }
  if (!manifest.id?.trim()) issues.push(issue('ASSET_ID_REQUIRED', 'Asset id is required.', '$.id'));
  if (!SEMVER_PATTERN.test(manifest.version ?? '')) {
    issues.push(issue('ASSET_VERSION_INVALID', 'Asset version must use semantic versioning.', '$.version'));
  }
  if (!manifest.kind) issues.push(issue('ASSET_KIND_REQUIRED', 'Asset kind is required.', '$.kind'));
  if (!manifest.origin) issues.push(issue('ASSET_ORIGIN_REQUIRED', 'Asset origin is required.', '$.origin'));
  if (manifest.contentHash !== undefined && !HASH_PATTERN.test(manifest.contentHash)) {
    issues.push(issue('ASSET_HASH_INVALID', 'contentHash must be sha256:… or fnv1a32:….', '$.contentHash'));
  }
  if (!manifest.runtime || !Array.isArray(manifest.runtime.renderers) || manifest.runtime.renderers.length === 0) {
    issues.push(issue('ASSET_RENDERERS_REQUIRED', 'At least one compatible renderer is required.', '$.runtime.renderers'));
  }
  if (manifest.runtime && typeof manifest.runtime.deterministic !== 'boolean') {
    issues.push(issue('ASSET_DETERMINISM_REQUIRED', 'runtime.deterministic must be boolean.', '$.runtime.deterministic'));
  }

  if (manifest.dependencies !== undefined) {
    if (!Array.isArray(manifest.dependencies)) {
      issues.push(issue('ASSET_DEPENDENCIES_INVALID', 'dependencies must be an array of AssetRef values.', '$.dependencies'));
    } else {
      manifest.dependencies.forEach((ref, index) => {
        issues.push(...validateRef(ref, `$.dependencies[${index}]`));
      });
    }
  }

  if (manifest.kind === 'material-pack') {
    if (!isObject((manifest as unknown as Record<string, unknown>).appearance)) {
      issues.push(issue('MATERIAL_APPEARANCE_REQUIRED', 'Material appearance profile is required.', '$.appearance'));
    } else {
      issues.push(...validateAppearance(manifest.appearance));
    }
    if (!isObject((manifest as unknown as Record<string, unknown>).behavior)) {
      issues.push(issue('MATERIAL_BEHAVIOR_REQUIRED', 'Material behavior profile is required.', '$.behavior'));
    } else {
      issues.push(...validateBehavior(manifest.behavior));
    }
  }
  if (manifest.kind === 'effect-pack') {
    const effect = manifest as EffectPackManifest;
    if (!Array.isArray(effect.supportedEvents) || !effect.supportedEvents.length) {
      issues.push(issue('EFFECT_EVENTS_REQUIRED', 'Effect pack must support at least one event.', '$.supportedEvents'));
    }
    if (!Array.isArray(effect.compatibleMaterialClasses) || !effect.compatibleMaterialClasses.length) {
      issues.push(issue('EFFECT_MATERIALS_REQUIRED', 'Effect pack must declare compatible material classes.', '$.compatibleMaterialClasses'));
    }
    if (!Array.isArray(effect.layers) || !effect.layers.length) {
      issues.push(issue('EFFECT_LAYERS_REQUIRED', 'Effect pack must contain at least one layer.', '$.layers'));
    } else {
      effect.layers.forEach((layer, index) => {
        if (!layer || typeof layer.id !== 'string' || !layer.id.trim()) {
          issues.push(issue('EFFECT_LAYER_ID_REQUIRED', 'Effect layer id is required.', `$.layers[${index}].id`));
        }
        if (layer?.assetRef) issues.push(...validateRef(layer.assetRef, `$.layers[${index}].assetRef`));
      });
    }
  }
  if (manifest.kind === 'look-pack') {
    if (!isObject((manifest as unknown as Record<string, unknown>).slots)) {
      issues.push(issue('LOOK_SLOTS_REQUIRED', 'Look pack must define asset slots.', '$.slots'));
    } else {
      const entries = Object.entries(manifest.slots);
      if (!entries.length) issues.push(issue('LOOK_SLOTS_REQUIRED', 'Look pack must define asset slots.', '$.slots'));
      for (const [slot, ref] of entries) issues.push(...validateRef(ref, `$.slots.${slot}`));
    }
  }
  if (manifest.kind === 'plugin-package') {
    if (typeof manifest.entry !== 'string' || !manifest.entry.trim()) issues.push(issue('PLUGIN_ENTRY_REQUIRED', 'Plugin entry is required.', '$.entry'));
    if (typeof manifest.inputSchemaRef !== 'string' || !manifest.inputSchemaRef.trim() || typeof manifest.outputSchemaRef !== 'string' || !manifest.outputSchemaRef.trim()) {
      issues.push(issue('PLUGIN_SCHEMA_REQUIRED', 'Plugin input/output schemas are required.', '$.inputSchemaRef'));
    }
    if (!Number.isFinite(manifest.timeoutMs) || manifest.timeoutMs <= 0 || manifest.timeoutMs > 120_000) {
      issues.push(issue('PLUGIN_TIMEOUT_INVALID', 'Plugin timeout must be between 1 and 120000 ms.', '$.timeoutMs'));
    }
    if (!Array.isArray(manifest.permissions)) issues.push(issue('PLUGIN_PERMISSIONS_REQUIRED', 'Plugin permissions must be an array.', '$.permissions'));
  }
  return issues;
}

export function validateCreativeMaster(value: unknown): ContractIssue[] {
  if (!isObject(value)) return [issue('MASTER_INVALID', 'Creative master must be an object.', '$')];
  const master = value as unknown as CreativeMaster;
  const issues: ContractIssue[] = [];
  if (master.contract !== 'bcs.creative-master') issues.push(issue('MASTER_CONTRACT_INVALID', 'contract must be bcs.creative-master.', '$.contract'));
  if (master.contractVersion !== BCS_CONTRACT_VERSION) issues.push(issue('CONTRACT_VERSION_UNSUPPORTED', `Expected contractVersion ${BCS_CONTRACT_VERSION}.`, '$.contractVersion'));
  if (!master.id?.trim()) issues.push(issue('MASTER_ID_REQUIRED', 'Master id is required.', '$.id'));
  if (!master.ruleProfile?.trim()) issues.push(issue('MASTER_RULE_REQUIRED', 'ruleProfile is required.', '$.ruleProfile'));
  if (!Number.isInteger(master.board?.rows) || master.board.rows <= 0 || !Number.isInteger(master.board?.cols) || master.board.cols <= 0) {
    issues.push(issue('MASTER_BOARD_INVALID', 'Board rows and cols must be positive integers.', '$.board'));
  }
  if (!master.replay?.takeId?.trim() || !master.replay?.semanticHash?.trim()) {
    issues.push(issue('MASTER_REPLAY_INVALID', 'Replay takeId and semanticHash are required.', '$.replay'));
  }
  if (!Number.isInteger(master.replay?.totalFrames) || master.replay.totalFrames <= 0 || !Number.isFinite(master.replay?.fps) || master.replay.fps <= 0) {
    issues.push(issue('MASTER_REPLAY_TIMING_INVALID', 'Replay fps and totalFrames must be positive.', '$.replay'));
  }
  if (!master.layoutProfileRef) issues.push(issue('MASTER_LAYOUT_REQUIRED', 'layoutProfileRef is required.', '$.layoutProfileRef'));
  else issues.push(...validateRef(master.layoutProfileRef, '$.layoutProfileRef'));
  if (!master.cameraProfileRef) issues.push(issue('MASTER_CAMERA_REQUIRED', 'cameraProfileRef is required.', '$.cameraProfileRef'));
  else issues.push(...validateRef(master.cameraProfileRef, '$.cameraProfileRef'));
  if (!master.baseOutput) issues.push(issue('MASTER_OUTPUT_REQUIRED', 'baseOutput is required.', '$.baseOutput'));
  else issues.push(...validateOutput(master.baseOutput, '$.baseOutput'));
  return issues;
}

export function validateVariantRecipe(value: unknown): ContractIssue[] {
  if (!isObject(value)) return [issue('VARIANT_INVALID', 'Variant recipe must be an object.', '$')];
  const recipe = value as unknown as VariantRecipe;
  const issues: ContractIssue[] = [];
  if (recipe.contract !== 'bcs.variant-recipe') issues.push(issue('VARIANT_CONTRACT_INVALID', 'contract must be bcs.variant-recipe.', '$.contract'));
  if (recipe.contractVersion !== BCS_CONTRACT_VERSION) issues.push(issue('CONTRACT_VERSION_UNSUPPORTED', `Expected contractVersion ${BCS_CONTRACT_VERSION}.`, '$.contractVersion'));
  if (!recipe.id?.trim()) issues.push(issue('VARIANT_ID_REQUIRED', 'Variant id is required.', '$.id'));
  if (!recipe.masterId?.trim()) issues.push(issue('VARIANT_MASTER_REQUIRED', 'masterId is required.', '$.masterId'));
  if (!['frame-exact', 'semantic', 'rule-only'].includes(recipe.lockMode)) {
    issues.push(issue('VARIANT_LOCK_INVALID', 'lockMode is not supported.', '$.lockMode'));
  }
  if (!recipe.lookPackRef) issues.push(issue('VARIANT_LOOK_REQUIRED', 'lookPackRef is required.', '$.lookPackRef'));
  else issues.push(...validateRef(recipe.lookPackRef, '$.lookPackRef'));
  if (recipe.slotOverrides) {
    for (const [slot, ref] of Object.entries(recipe.slotOverrides)) issues.push(...validateRef(ref, `$.slotOverrides.${slot}`));
  }
  if (!Number.isInteger(recipe.seed) || recipe.seed < 0) issues.push(issue('VARIANT_SEED_INVALID', 'seed must be a non-negative integer.', '$.seed'));
  if (recipe.outputOverrides) {
    const output = recipe.outputOverrides;
    if (output.width !== undefined && (!Number.isInteger(output.width) || output.width <= 0)) issues.push(issue('OUTPUT_WIDTH_INVALID', 'Output width must be a positive integer.', '$.outputOverrides.width'));
    if (output.height !== undefined && (!Number.isInteger(output.height) || output.height <= 0)) issues.push(issue('OUTPUT_HEIGHT_INVALID', 'Output height must be a positive integer.', '$.outputOverrides.height'));
    if (output.fps !== undefined && (!Number.isFinite(output.fps) || output.fps <= 0 || output.fps > 240)) issues.push(issue('OUTPUT_FPS_INVALID', 'Output fps must be between 0 and 240.', '$.outputOverrides.fps'));
  }
  return issues;
}

export function assertNoContractErrors(issues: ContractIssue[], message: string): void {
  const errors = issues.filter((candidate) => candidate.severity === 'error');
  if (errors.length) {
    const first = errors[0]!;
    throw new Error(`${message}: ${first.code}: ${first.message}`);
  }
}
