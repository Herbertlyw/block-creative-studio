import type {
  AssetManifest,
  AssetRef,
  CreativeMaster,
  EffectPackManifest,
  HeadlessRendererId,
  LookPackManifest,
  MaterialPackManifest,
  OutputSpec,
  ResolvedAsset,
  ResolvedRenderPlan,
  VariantRecipe,
} from './contracts.js';
import { BCS_CONTRACT_VERSION } from './contracts.js';
import { AssetRegistry } from './assetRegistry.js';
import { BcsHeadlessError } from './errors.js';
import { stableHash } from './stableHash.js';
import { validateCreativeMaster, validateVariantRecipe } from './validation.js';

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const REQUIRED_LOOK_SLOTS = [
  'background.base',
  'board.skin',
  'tile.material',
  'interaction.preview',
  'placement.confirmation',
  'clear.primary',
  'clear.tile-exit',
  'hud.current-score',
  'endgame.presentation',
] as const;

export interface CompileVariantOptions {
  renderer: HeadlessRendererId;
  requireHashes?: boolean;
}

function failFromIssues(code: string, message: string, issues: ReturnType<typeof validateCreativeMaster>): never {
  const errors = issues.filter((candidate) => candidate.severity === 'error');
  throw new BcsHeadlessError(code, message, {
    ...(errors[0]?.path !== undefined ? { path: errors[0].path } : {}),
    details: errors,
  });
}

function resolveAsset(
  registry: AssetRegistry,
  ref: AssetRef,
  renderer: HeadlessRendererId,
  requireHashes: boolean,
  path: string,
): ResolvedAsset {
  let manifest: AssetManifest;
  try {
    manifest = registry.resolve(ref, { requireHash: requireHashes });
  } catch (error) {
    if (error instanceof BcsHeadlessError) {
      throw new BcsHeadlessError(error.code, error.message, {
        path,
        recoverable: error.recoverable,
        details: error.details,
      });
    }
    throw error;
  }
  if (!manifest.runtime.renderers.includes(renderer)) {
    throw new BcsHeadlessError(
      'ASSET_RENDERER_INCOMPATIBLE',
      `Asset ${manifest.id}@${manifest.version} does not support renderer ${renderer}.`,
      { path },
    );
  }
  return {
    ref: {
      id: manifest.id,
      version: manifest.version,
      kind: manifest.kind,
      ...(manifest.contentHash ? { contentHash: manifest.contentHash } : {}),
    },
    manifest,
  };
}

function assetKey(ref: Pick<AssetRef, 'id' | 'version'>): string {
  return `${ref.id}@${ref.version}`;
}

function manifestDependencies(manifest: AssetManifest): AssetRef[] {
  const refs: AssetRef[] = [...(manifest.dependencies ?? [])];
  if (manifest.kind === 'material-pack') {
    for (const ref of Object.values(manifest.appearance.textureRefs ?? {})) {
      if (ref) refs.push(ref);
    }
  } else if (manifest.kind === 'effect-pack') {
    for (const layer of manifest.layers) {
      if (layer.assetRef) refs.push(layer.assetRef);
    }
  } else if (manifest.kind === 'look-pack') {
    refs.push(...Object.values(manifest.slots));
  }
  const unique = new Map<string, AssetRef>();
  for (const ref of refs) unique.set(assetKey(ref), ref);
  return [...unique.values()].sort((left, right) => assetKey(left).localeCompare(assetKey(right)));
}

interface DependencyClosure {
  assets: Record<string, ResolvedAsset>;
  dependencyOrder: AssetRef[];
}

function resolveDependencyClosure(
  registry: AssetRegistry,
  roots: Array<{ ref: AssetRef; path: string }>,
  renderer: HeadlessRendererId,
  requireHashes: boolean,
): DependencyClosure {
  const assets: Record<string, ResolvedAsset> = {};
  const order: AssetRef[] = [];
  const visited = new Set<string>();
  const visiting: string[] = [];

  const visit = (ref: AssetRef, path: string): void => {
    // Always resolve first so duplicate references with conflicting kind/hash
    // cannot bypass registry validation merely because their id@version was seen.
    const resolved = resolveAsset(registry, ref, renderer, requireHashes, path);
    const key = assetKey(resolved.ref);
    const cycleIndex = visiting.indexOf(key);
    if (cycleIndex >= 0) {
      const cycle = [...visiting.slice(cycleIndex), key];
      throw new BcsHeadlessError(
        'ASSET_DEPENDENCY_CYCLE',
        `Asset dependency cycle detected: ${cycle.join(' -> ')}`,
        { path, details: { cycle } },
      );
    }
    if (visited.has(key)) return;

    visiting.push(key);
    for (const dependency of manifestDependencies(resolved.manifest)) {
      visit(dependency, `${path}.dependencies[${assetKey(dependency)}]`);
    }
    visiting.pop();
    visited.add(key);
    assets[key] = resolved;
    order.push(cloneValue(resolved.ref));
  };

  for (const root of roots) visit(root.ref, root.path);
  return { assets, dependencyOrder: order };
}

function mergedOutput(master: CreativeMaster, recipe: VariantRecipe): OutputSpec {
  return {
    width: recipe.outputOverrides?.width ?? master.baseOutput.width,
    height: recipe.outputOverrides?.height ?? master.baseOutput.height,
    fps: recipe.outputOverrides?.fps ?? master.baseOutput.fps,
    quality: recipe.outputOverrides?.quality ?? master.baseOutput.quality,
  };
}

function assertLockMode(master: CreativeMaster, recipe: VariantRecipe, output: OutputSpec): void {
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

function assertMaterialEffectCompatibility(slots: Record<string, ResolvedAsset>): void {
  const materialAsset = slots['tile.material'];
  const effectAsset = slots['clear.primary'];
  if (!materialAsset || !effectAsset) return;
  if (materialAsset.manifest.kind !== 'material-pack') {
    throw new BcsHeadlessError('TILE_MATERIAL_KIND_INVALID', 'tile.material must resolve to a material-pack.', {
      path: '$.slots.tile.material',
    });
  }
  if (effectAsset.manifest.kind !== 'effect-pack') {
    throw new BcsHeadlessError('CLEAR_EFFECT_KIND_INVALID', 'clear.primary must resolve to an effect-pack.', {
      path: '$.slots.clear.primary',
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
      { path: '$.slots.clear.primary' },
    );
  }
}

export function compileVariant(
  master: CreativeMaster,
  recipe: VariantRecipe,
  registry: AssetRegistry,
  options: CompileVariantOptions,
): ResolvedRenderPlan {
  const masterIssues = validateCreativeMaster(master);
  if (masterIssues.some((candidate) => candidate.severity === 'error')) {
    failFromIssues('MASTER_INVALID', 'Creative master failed validation.', masterIssues);
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
  for (const slot of REQUIRED_LOOK_SLOTS) {
    if (!slotRefs[slot]) {
      throw new BcsHeadlessError('REQUIRED_LOOK_SLOT_MISSING', `Required look slot ${slot} is missing.`, {
        path: `$.slots.${slot}`,
      });
    }
  }

  const slots: Record<string, ResolvedAsset> = {};
  for (const [slot, ref] of Object.entries(slotRefs).sort(([left], [right]) => left.localeCompare(right))) {
    slots[slot] = resolveAsset(registry, ref, options.renderer, requireHashes, `$.slots.${slot}`);
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
  assertMaterialEffectCompatibility(slots);

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
    contractVersion: BCS_CONTRACT_VERSION,
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

export interface VariantMatrixResult {
  plans: ResolvedRenderPlan[];
  failures: Array<{ variantId: string; code: string; message: string; path?: string }>;
}

export function compileVariantMatrix(
  master: CreativeMaster,
  recipes: VariantRecipe[],
  registry: AssetRegistry,
  options: CompileVariantOptions,
): VariantMatrixResult {
  const plans: ResolvedRenderPlan[] = [];
  const failures: VariantMatrixResult['failures'] = [];
  for (const recipe of recipes) {
    try {
      plans.push(compileVariant(master, recipe, registry, options));
    } catch (error) {
      if (error instanceof BcsHeadlessError) {
        failures.push({
          variantId: recipe.id,
          code: error.code,
          message: error.message,
          ...(error.path !== undefined ? { path: error.path } : {}),
        });
      } else {
        throw error;
      }
    }
  }
  return { plans, failures };
}
