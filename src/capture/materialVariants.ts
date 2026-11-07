import type {
  AssetManifest,
  CreativeMaster,
  EffectPackManifest,
  MaterialPackManifest,
  MaterialRuntimeDescriptor,
  ResolvedRenderPlan,
  VariantRecipe,
} from '../headless/contracts';
import { AssetRegistry } from '../headless/assetRegistry';
import { compileVariant } from '../headless/variantCompiler';
import {
  bitmapManifestFromTextureRef,
  materialMapsPublicBase,
  materialRuntimeFromPlan,
  rewriteMaterialMapUriForBrowser,
} from '../headless/materialRuntime';
import {
  createUniversalClearEffect,
  UNIVERSAL_CLEAR_EFFECT_ID,
} from '../headless/universalClearEffect';

export const VARIANT_PACK_PATHS = {
  'material.stainless-steel': 'examples/headless/materials/material.stainless-steel.json',
  'material.oak-wood': 'examples/headless/materials/material.oak-wood.json',
  'material.aurora-shell': 'examples/headless/materials/material.aurora-shell.json',
} as const;

export type VariantMaterialId = keyof typeof VARIANT_PACK_PATHS;

export const CAPTURE_ASSET_PATHS = [
  'examples/headless/assets/layout.vertical.json',
  'examples/headless/assets/camera.fixed.json',
  'examples/headless/assets/background.dark.json',
  'examples/headless/assets/board.dark.json',
  'examples/headless/assets/material.copper.json',
  'examples/headless/assets/preview.default.json',
  'examples/headless/assets/placement.default.json',
  'examples/headless/assets/effect.copper-clear.json',
  'examples/headless/assets/effect.universal-clear.json',
  'examples/headless/assets/clear.exit.json',
  'examples/headless/assets/hud.score.json',
  'examples/headless/assets/endgame.default.json',
  'examples/headless/assets/look.copper.json',
] as const;

export { rewriteMaterialMapUriForBrowser };

export function registerPackTextures(registry: AssetRegistry, pack: MaterialPackManifest): void {
  for (const ref of Object.values(pack.appearance.textureRefs ?? {})) {
    if (!ref) continue;
    registry.register(bitmapManifestFromTextureRef(ref), { replace: true });
  }
}

function universalClearFromAssets(assets: AssetManifest[]): EffectPackManifest {
  const existing = assets.find((asset) => asset.id === UNIVERSAL_CLEAR_EFFECT_ID && asset.kind === 'effect-pack');
  return existing ? existing as EffectPackManifest : createUniversalClearEffect();
}

export interface CompiledRegisteredMaterialPlan {
  runtime: MaterialRuntimeDescriptor;
  plan: ResolvedRenderPlan;
}

/**
 * Compile a MaterialPack through the same Registry → Recipe → Plan path as Studio.
 * Does not rewrite EffectPack compatibility or the recipe lockMode. Wood/aurora
 * compile against `effect.universal-clear` (`compatibleMaterialClasses: ['*']`)
 * via slotOverrides, while `effect.copper-clear` stays metal-only for the look
 * pack dependency closure.
 */
export function compileRegisteredMaterialPlan(
  pack: MaterialPackManifest,
  context: {
    master: CreativeMaster;
    recipe: VariantRecipe;
    assets: AssetManifest[];
    rewriteUri?: (uri: string) => string;
    renderer?: ResolvedRenderPlan['renderer'];
  },
): CompiledRegisteredMaterialPlan {
  const registry = new AssetRegistry();
  for (const asset of context.assets) {
    registry.register(asset, { replace: true });
  }
  const universalClear = universalClearFromAssets(context.assets);
  registry.register(universalClear, { replace: true });
  registry.register(pack, { replace: true });
  registerPackTextures(registry, pack);

  const recipe: VariantRecipe = {
    ...context.recipe,
    slotOverrides: {
      ...(context.recipe.slotOverrides ?? {}),
      'tile.material': {
        id: pack.id,
        version: pack.version,
        kind: 'material-pack',
        ...(pack.contentHash ? { contentHash: pack.contentHash } : {}),
      },
      'clear.primary': {
        id: universalClear.id,
        version: universalClear.version,
        kind: 'effect-pack',
        ...(universalClear.contentHash ? { contentHash: universalClear.contentHash } : {}),
      },
    },
  };

  const plan = compileVariant(context.master, recipe, registry, {
    renderer: context.renderer ?? 'fixed-camera-cinematic',
    requireHashes: true,
  });
  return {
    plan,
    runtime: materialRuntimeFromPlan(plan, {
      ...(context.rewriteUri ? { rewriteUri: context.rewriteUri } : {}),
    }),
  };
}

export function compileRuntimeFromRegisteredPlan(
  pack: MaterialPackManifest,
  context: {
    master: CreativeMaster;
    recipe: VariantRecipe;
    assets: AssetManifest[];
    rewriteUri?: (uri: string) => string;
    renderer?: ResolvedRenderPlan['renderer'];
  },
): MaterialRuntimeDescriptor {
  return compileRegisteredMaterialPlan(pack, context).runtime;
}

interface CapturePlanContext {
  master: CreativeMaster;
  recipe: VariantRecipe;
  assets: AssetManifest[];
}

const runtimeCache = new Map<string, CompiledRegisteredMaterialPlan>();
let captureContext: Promise<CapturePlanContext> | null = null;

async function loadCaptureJson<T>(path: string): Promise<T> {
  const response = await fetch(`/__capture/workspace/${path}`);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return await response.json() as T;
}

async function loadCaptureContext(): Promise<CapturePlanContext> {
  captureContext ??= Promise.all([
    loadCaptureJson<CreativeMaster>('examples/headless/master.demo.json'),
    loadCaptureJson<VariantRecipe>('examples/headless/variant.copper.demo.json'),
    Promise.all(CAPTURE_ASSET_PATHS.map((path) => loadCaptureJson<AssetManifest>(path))),
  ]).then(([master, recipe, assets]) => ({ master, recipe, assets }));
  return captureContext;
}

export async function compileVariantRuntime(
  pack: MaterialPackManifest,
  mapBaseUrl?: string,
): Promise<CompiledRegisteredMaterialPlan> {
  const mapsBase = mapBaseUrl ?? materialMapsPublicBase(import.meta.env.BASE_URL);
  const cacheKey = `${pack.id}@${pack.version}:${pack.contentHash ?? ''}:${mapsBase}`;
  const cached = runtimeCache.get(cacheKey);
  if (cached) return cached;
  const context = await loadCaptureContext();
  const compiled = compileRegisteredMaterialPlan(pack, {
    ...context,
    rewriteUri: (uri) => rewriteMaterialMapUriForBrowser(uri, mapsBase),
  });
  runtimeCache.set(cacheKey, compiled);
  return compiled;
}
