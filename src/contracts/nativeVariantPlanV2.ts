import { GameRegistry } from '../nativeReference/game-runtime/gameRegistry';
import { RenderContractRegistry } from '../nativeReference/game-runtime/renderContractRegistry';
import { validateStudioProjectDocumentV2 } from '../nativeReference/game-runtime/projectDocument';
import { blockPlacementDefinition } from '../nativeReference/games/block-placement/definition';
import { blockPlacementRenderContract } from '../nativeReference/games/block-placement/render/renderContract';
import { AssetRegistry } from '../nativeReference/headless/assetRegistry';
import type { AssetManifest, VariantRecipe } from '../nativeReference/headless/contracts';
import { buildCreativeMasterV2FromValidated } from '../nativeReference/headless/creativeMasterV2';
import { compileVariantV2 } from '../nativeReference/headless/variantCompilerV2';
import { runQualityGateV2 } from '../nativeReference/headless/qualityGateV2';
import { stableHash } from '../nativeReference/headless/stableHash';
import { compileNativeTake } from './compileNativeTake';

/** Compile a V2 plan against explicitly supplied manifests and the project's own
 * layout/camera references. The caller must separately bind and render assets. */
export function compileNativeVariantPlanV2(
  document: unknown,
  takeId: string,
  recipe: VariantRecipe,
  manifests: AssetManifest[],
) {
  const games = new GameRegistry();
  games.register(blockPlacementDefinition);
  const contracts = new RenderContractRegistry();
  contracts.register(blockPlacementRenderContract);
  const contract = contracts.require(
    blockPlacementRenderContract.id,
    blockPlacementRenderContract.version,
  );
  const checked = validateStudioProjectDocumentV2(document, games);
  const take = checked.parsed.takes.find((item) => item.replay.takeId === takeId);
  if (!take) throw new Error(`找不到 Take ${takeId}。`);
  const { frameSource, timelinePlan } = compileNativeTake(document, takeId);
  const master = buildCreativeMasterV2FromValidated(checked, {
    id: checked.id,
    takeId,
    renderContract: contract,
    fps: frameSource.fps,
    totalFrames: frameSource.totalFrames,
    semanticHash: stableHash({ initial: checked.game.initialState, actions: take.replay.actions }),
    // Preserve the identity locked into already-saved variant plans. It is a
    // timing/action identity, not the full current render-source or asset hash.
    frameHash: timelinePlan.identity,
  });
  const registry = new AssetRegistry(manifests);
  const plan = compileVariantV2(master, recipe, registry, contract, {
    renderer: 'reference-2d',
    requireHashes: true,
  });
  const quality = runQualityGateV2(plan, contract, { strict: true, requireHashes: true });
  if (!quality.passed)
    throw new Error(`V2 变体质量检查未通过：${quality.issues.map((item) => item.code).join(', ')}`);
  return { master, plan, quality };
}
