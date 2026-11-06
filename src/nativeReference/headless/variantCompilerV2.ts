import type {
  AssetRef,
  EffectPackManifest,
  HeadlessRendererId,
  LookPackManifest,
  MaterialPackManifest,
  OutputSpec,
  ResolvedAsset,
  ResolvedRenderPlan,
  VariantRecipe,
} from './contracts.js';
import { BcsHeadlessError } from './errors.js';
import { AssetRegistry } from './assetRegistry.js';
import { stableHash } from './stableHash.js';
import { validateVariantRecipe } from './validation.js';
import type { GameRenderContract } from '../game-runtime/renderContract.js';
import { catalogAcceptsEvent, requiredSlotIds, slotRequirement } from '../game-runtime/renderContract.js';
import {
  CREATIVE_MASTER_V2_CONTRACT,
  CREATIVE_MASTER_V2_CONTRACT_VERSION,
  PLAN_SCHEMA_VERSION_V2,
  type CreativeMasterV2,
} from './creativeMasterV2.js';
import {
  cloneValue,
  resolveAsset,
  resolveDependencyClosure,
  type CompileVariantOptions,
} from './variantCompiler.js';

export interface ResolvedRenderPlanV2 extends ResolvedRenderPlan {
  planSchemaVersion: typeof PLAN_SCHEMA_VERSION_V2;
  renderContract: { id: string; version: string };
  game: CreativeMasterV2['game'];
}

function failFromIssues(code: string, message: string, issues: ReturnType<typeof validateVariantRecipe>): never {
  const errors = issues.filter((candidate) => candidate.severity === 'error');
  throw new BcsHeadlessError(code, message, {
    ...(errors[0]?.path !== undefined ? { path: errors[0].path } : {}),
    details: errors,
  });
}

function mergedOutput(master: CreativeMasterV2, recipe: VariantRecipe): OutputSpec {
  return {
    width: recipe.outputOverrides?.width ?? master.baseOutput.width,
    height: recipe.outputOverrides?.height ?? master.baseOutput.height,
    fps: recipe.outputOverrides?.fps ?? master.baseOutput.fps,
    quality: recipe.outputOverrides?.quality ?? master.baseOutput.quality,
  };
}

function assertLockMode(master: CreativeMasterV2, recipe: VariantRecipe, output: OutputSpec): void {
  if (recipe.lockMode !== 'frame-exact') return;
  if (recipe.directorOverrides && Object.keys(recipe.directorOverrides).length > 0) {
    throw new BcsHeadlessError(
      'FRAME_EXACT_DIRECTOR_OVERRIDE',
      'frame-exact variants cannot change director timing.',
      { path: '$.directorOverrides' },
    );
  }
  if (output.fps !== master.baseOutput.fps) {
    throw new BcsHeadlessError(
      'FRAME_EXACT_FPS_OVERRIDE',
      'frame-exact variants must keep the master fps.',
      { path: '$.outputOverrides.fps' },
    );
  }
  if (master.replay.frameHash === undefined) {
    throw new BcsHeadlessError(
      'FRAME_EXACT_HASH_REQUIRED',
      'frame-exact variants require replay.frameHash on the creative master.',
      { path: '$.replay.frameHash' },
    );
  }
}

function assertRoleCompatibility(contract: GameRenderContract, renderer: string, slots: Record<string, ResolvedAsset>): void {
  const backend = contract.backends[renderer];
  const tileSlot = backend?.requiredSlots.find((slot) => slot.role === 'tile-material');
  const clearSlot = backend?.requiredSlots.find((slot) => slot.role === 'clear-primary');
  if (!tileSlot || !clearSlot) return;
  const materialAsset = slots[tileSlot.slotId];
  const effectAsset = slots[clearSlot.slotId];
  if (!materialAsset || !effectAsset) return;
  if (materialAsset.manifest.kind !== 'material-pack') {
    throw new BcsHeadlessError('TILE_MATERIAL_KIND_INVALID', `${tileSlot.slotId} must resolve to a material-pack.`, {
      path: `$.slots.${tileSlot.slotId}`,
    });
  }
  if (effectAsset.manifest.kind !== 'effect-pack') {
    throw new BcsHeadlessError('CLEAR_EFFECT_KIND_INVALID', `${clearSlot.slotId} must resolve to an effect-pack.`, {
      path: `$.slots.${clearSlot.slotId}`,
    });
  }
  const material = materialAsset.manifest as MaterialPackManifest;
  const effect = effectAsset.manifest as EffectPackManifest;
  if (
    !effect.compatibleMaterialClasses.includes('*')
    && !effect.compatibleMaterialClasses.includes(material.behavior.materialClass)
  ) {
    throw new BcsHeadlessError(
      'EFFECT_MATERIAL_INCOMPATIBLE',
      `Effect ${effect.id} does not support material class ${material.behavior.materialClass}.`,
      { path: `$.slots.${clearSlot.slotId}` },
    );
  }
  for (const event of effect.supportedEvents) {
    if (!catalogAcceptsEvent(contract, event)) {
      throw new BcsHeadlessError(
        'UNKNOWN_EVENT',
        `Effect ${effect.id} declares unsupported event ${event} for render contract ${contract.id}.`,
        { path: `$.slots.${clearSlot.slotId}.supportedEvents` },
      );
    }
  }
}

export function compileVariantV2(
  master: CreativeMasterV2,
  recipe: VariantRecipe,
  registry: AssetRegistry,
  gameRenderContract: GameRenderContract,
  options: CompileVariantOptions,
): ResolvedRenderPlanV2 {
  if (master.contract !== CREATIVE_MASTER_V2_CONTRACT || master.contractVersion !== CREATIVE_MASTER_V2_CONTRACT_VERSION) {
    throw new BcsHeadlessError('MASTER_INVALID', 'Creative master V2 contract is invalid.', { path: '$.contract' });
  }
  if (master.renderContractId !== gameRenderContract.id || master.renderContractVersion !== gameRenderContract.version) {
    throw new BcsHeadlessError(
      'RENDER_CONTRACT_MISMATCH',
      `Master render contract ${master.renderContractId}@${master.renderContractVersion} does not match ${gameRenderContract.id}@${gameRenderContract.version}.`,
      { path: '$.renderContractId' },
    );
  }
  if (gameRenderContract.gameId !== master.game.id) {
    throw new BcsHeadlessError(
      'RENDER_CONTRACT_GAME_MISMATCH',
      `Render contract game ${gameRenderContract.gameId} does not match master game ${master.game.id}.`,
      { path: '$.game.id' },
    );
  }
  const recipeIssues = validateVariantRecipe(recipe);
  if (recipeIssues.some((candidate) => candidate.severity === 'error')) {
    failFromIssues('VARIANT_INVALID', 'Variant recipe failed validation.', recipeIssues);
  }
  if (recipe.masterId !== master.id) {
    throw new BcsHeadlessError(
      'VARIANT_MASTER_MISMATCH',
      `Variant targets ${recipe.masterId}, but the supplied master is ${master.id}.`,
      { path: '$.masterId' },
    );
  }

  const backend = gameRenderContract.backends[options.renderer];
  if (!backend) {
    throw new BcsHeadlessError(
      'RENDERER_UNSUPPORTED',
      `Render contract ${gameRenderContract.id} does not declare backend ${options.renderer}.`,
      { path: `$.backends.${options.renderer}` },
    );
  }

  const requireHashes = options.requireHashes ?? false;
  const lookPack = resolveAsset(
    registry,
    recipe.lookPackRef,
    options.renderer,
    requireHashes,
    '$.lookPackRef',
  );
  if (lookPack.manifest.kind !== 'look-pack') {
    throw new BcsHeadlessError('LOOK_PACK_KIND_INVALID', 'lookPackRef must resolve to a look-pack.', {
      path: '$.lookPackRef',
    });
  }

  const look = lookPack.manifest as LookPackManifest;
  const slotRefs: Record<string, AssetRef> = {
    ...look.slots,
    ...(recipe.slotOverrides ?? {}),
  };
  for (const slotId of requiredSlotIds(gameRenderContract, options.renderer)) {
    if (!slotRefs[slotId]) {
      throw new BcsHeadlessError('REQUIRED_LOOK_SLOT_MISSING', `Required look slot ${slotId} is missing.`, {
        path: `$.slots.${slotId}`,
      });
    }
  }
  for (const slotId of Object.keys(slotRefs)) {
    const requirement = slotRequirement(gameRenderContract, options.renderer, slotId);
    if (!requirement && !(slotId in look.slots)) {
      throw new BcsHeadlessError(
        'UNKNOWN_SLOT',
        `Slot ${slotId} is not declared by render contract ${gameRenderContract.id} backend ${options.renderer}.`,
        { path: `$.slots.${slotId}` },
      );
    }
  }

  const slots: Record<string, ResolvedAsset> = {};
  for (const [slot, ref] of Object.entries(slotRefs).sort(([left], [right]) => left.localeCompare(right))) {
    const resolved = resolveAsset(registry, ref, options.renderer, requireHashes, `$.slots.${slot}`);
    const requirement = slotRequirement(gameRenderContract, options.renderer, slot);
    if (requirement && !requirement.acceptedKinds.includes(resolved.manifest.kind)) {
      throw new BcsHeadlessError(
        'SLOT_KIND_INVALID',
        `Slot ${slot} resolved to ${resolved.manifest.kind}, expected ${requirement.acceptedKinds.join('|')}.`,
        { path: `$.slots.${slot}` },
      );
    }
    slots[slot] = resolved;
  }

  const layoutProfile = resolveAsset(
    registry,
    master.layoutProfileRef,
    options.renderer,
    requireHashes,
    '$.layoutProfileRef',
  );
  const cameraProfile = resolveAsset(
    registry,
    master.cameraProfileRef,
    options.renderer,
    requireHashes,
    '$.cameraProfileRef',
  );
  assertRoleCompatibility(gameRenderContract, options.renderer, slots);

  const dependencyClosure = resolveDependencyClosure(
    registry,
    [
      { ref: layoutProfile.ref, path: '$.layoutProfileRef' },
      { ref: cameraProfile.ref, path: '$.cameraProfileRef' },
      { ref: lookPack.ref, path: '$.lookPackRef' },
      ...Object.entries(slots).map(([slot, asset]) => ({
        ref: asset.ref,
        path: `$.slots.${slot}`,
      })),
    ],
    options.renderer,
    requireHashes,
  );

  const output = mergedOutput(master, recipe);
  assertLockMode(master, recipe, output);
  if (output.width % 2 !== 0 || output.height % 2 !== 0) {
    throw new BcsHeadlessError('OUTPUT_DIMENSIONS_ODD', 'H.264 output dimensions must be even.', {
      path: '$.output',
    });
  }

  const warnings: string[] = [];
  if (!requireHashes) {
    const unhashed = Object.values(dependencyClosure.assets)
      .filter((asset) => !asset.manifest.contentHash)
      .map((asset) => `${asset.manifest.id}@${asset.manifest.version}`);
    if (unhashed.length) warnings.push(`Assets without content hashes: ${[...new Set(unhashed)].join(', ')}`);
  }

  const directorOverrides = cloneValue(recipe.directorOverrides ?? {});
  const planIdentity = {
    planSchemaVersion: PLAN_SCHEMA_VERSION_V2,
    renderContract: { id: gameRenderContract.id, version: gameRenderContract.version },
    game: master.game,
    compositionProfileId: master.compositionProfileId ?? null,
    masterId: master.id,
    replay: master.replay,
    variantId: recipe.id,
    lockMode: recipe.lockMode,
    renderer: options.renderer,
    layoutProfile: layoutProfile.ref,
    cameraProfile: cameraProfile.ref,
    lookPack: lookPack.ref,
    slots: Object.fromEntries(Object.entries(slots).map(([slot, asset]) => [slot, asset.ref])),
    dependencyOrder: dependencyClosure.dependencyOrder,
    directorOverrides,
    output,
    seed: recipe.seed,
  };

  return {
    contract: 'bcs.resolved-render-plan',
    contractVersion: '1.0.0',
    planSchemaVersion: PLAN_SCHEMA_VERSION_V2,
    renderContract: { id: gameRenderContract.id, version: gameRenderContract.version },
    game: cloneValue(master.game),
    id: `plan:${recipe.id}:${stableHash(planIdentity).slice(-8)}`,
    masterId: master.id,
    variantId: recipe.id,
    lockMode: recipe.lockMode,
    renderer: options.renderer,
    replay: cloneValue(master.replay),
    layoutProfile,
    cameraProfile,
    lookPack,
    slots,
    assets: dependencyClosure.assets,
    dependencyOrder: dependencyClosure.dependencyOrder,
    directorOverrides,
    output,
    seed: recipe.seed,
    planHash: stableHash(planIdentity),
    warnings,
  };
}

export type { CompileVariantOptions };
export type { HeadlessRendererId };
