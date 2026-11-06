import { takeFromBBReplay } from '../games/block-placement/authoring/replayTake';
import { parseBlockPlacementState } from '../nativeReference/games/block-placement/schemas';
import { productionFromDocument } from '../nativeReference/agent-director/contracts';
import { blockPlacementCompositionProfile } from '../nativeReference/games/block-placement/profiles/composition';
import {
  getDefaultCompositionProfile,
  registerCompositionProfile,
} from '../nativeReference/rendering/compositionRegistry';
import { createStudioVariantMatrix } from '../nativeReference/games/block-placement/studio/studioVariantBridge';
import type { StudioProjectDocumentV2 } from '../nativeReference/game-runtime/projectEnvelope';
import type { StyleSpec, ProjectSpec, RhythmProfile } from '../nativeReference/domain/types';
import { compileNativeTake } from './compileNativeTake';
import { compileNativeVariantPlanV2 } from './nativeVariantPlanV2';
import {
  planRenderEvidence,
  resolveStyleFromRenderPlan,
} from '../nativeReference/games/block-placement/studio/studioAssetCatalog';
import type { LookPackManifest } from '../nativeReference/headless/contracts';
const supported = new Set([
  'project-current',
  'builtin.reference-clean.look@1.0.0',
  'builtin.reference-garden.look@1.0.0',
  'builtin.classic-blast.look@1.0.0',
]);
const clearOptions = new Set([
  'builtin.reference-clean.look@1.0.0',
  'builtin.reference-garden.look@1.0.0',
]);
function withoutWorkbenchVariant(document: unknown): unknown {
  const doc = document as {
    direction?: { style?: { workbenchVariantV1?: unknown; workbenchView2D?: unknown } };
  };
  if (
    doc?.direction?.style?.workbenchVariantV1 === undefined &&
    doc?.direction?.style?.workbenchView2D === undefined
  )
    return document;
  const copy = structuredClone(doc);
  delete copy.direction!.style!.workbenchVariantV1;
  delete copy.direction!.style!.workbenchView2D;
  return copy;
}
function createMatrix(document: unknown, takeId: string, key: string) {
  const doc = withoutWorkbenchVariant(document) as StudioProjectDocumentV2;
  if (doc.game?.game?.id !== 'block-placement' || doc.game.game.moduleVersion !== '1.0.0')
    throw new Error('变体目录仅支持 block-placement 1.0.0。');
  registerCompositionProfile(blockPlacementCompositionProfile);
  const profile = getDefaultCompositionProfile();
  if (
    profile.id !== blockPlacementCompositionProfile.id ||
    profile.gameId !== 'block-placement' ||
    profile.version !== '1.0.0'
  )
    throw new Error('变体合成 profile 与 BB 游戏或版本不一致。');
  const replay = doc.takes.find((item) => item.takeId === takeId);
  if (!replay) throw new Error(`找不到 Take ${takeId}。`);
  const initial = parseBlockPlacementState(doc.game.initialState.data),
    style = doc.direction?.style,
    rhythm = doc.direction?.rhythm;
  if (!style || !rhythm) throw new Error('作品缺少外观或节奏。');
  // The catalog consumes a read-only render description, not a V1 document or game runtime.
  const project = {
    schemaVersion: '1.0.0',
    ...(productionFromDocument(doc)?.audio
      ? { audio: structuredClone(productionFromDocument(doc)!.audio!) }
      : {}),
    id: doc.id,
    name: doc.name,
    ruleProfile: 'block-placement-classic-v1',
    seed: initial.seed,
    setupBoard: structuredClone(initial.board),
    ...(initial.clearAxes ? { clearAxes: initial.clearAxes } : {}),
    ...(initial.clearTrigger ? { clearTrigger: initial.clearTrigger } : {}),
    ...(initial.referenceClearRules ? { referenceClearRules: initial.referenceClearRules } : {}),
    setupPieces: structuredClone(initial.pieces),
    ...(initial.fixedPieceSupply
      ? { fixedPieceSupply: structuredClone(initial.fixedPieceSupply) }
      : {}),
    style: structuredClone(style) as StyleSpec,
    rhythm: structuredClone(rhythm) as RhythmProfile,
    render: { ...doc.production.output },
  } as unknown as ProjectSpec;
  const take = takeFromBBReplay(doc.game, replay),
    compiled = compileNativeTake(doc, takeId).compiled;
  const matrix = createStudioVariantMatrix({
    project,
    selectedTake: take,
    compiledTake: compiled,
    requestedLockMode: 'frame-exact',
    selectedLookKey: key,
    importedAssets: [],
    importedRecipes: [],
  });
  return matrix;
}
/** Read-only local V1-bridge plan; V2 source and production profile references remain unchanged. */
export function listNativePreviewLooks(document: unknown, takeId: string) {
  return createMatrix(document, takeId, 'project-current')
    .catalog.lookOptions.filter((option) => supported.has(option.key))
    .map(({ key, label }) => ({ key, label }));
}
export function compileNativePreviewLook(
  document: unknown,
  takeId: string,
  key: string,
): { style: StyleSpec; planHash: string } {
  if (!supported.has(key)) throw new Error('该变体不是当前已接入的 BB 参考 2D 预览选项。');
  const matrix = createMatrix(document, takeId, key);
  if (!matrix.catalog.lookOptions.some((option) => option.key === key))
    throw new Error('BB 素材目录没有该变体。');
  const row = matrix.rows[0];
  if (
    !row ||
    row.error ||
    !row.plan ||
    !row.quality?.passed ||
    !row.previewSupported ||
    row.resolvedStyle.renderer !== 'reference-2d' ||
    row.plan.renderer !== 'reference-2d'
  )
    throw new Error(
      `变体尚不能按参考 2D 计划预览：${row?.error?.message ?? '质量或渲染器检查未通过'}`,
    );
  return { style: row.resolvedStyle, planHash: row.plan.planHash };
}

/** Independent V2 plan audit. It does not claim the current preview consumes that plan. */
export function auditNativeV2LookPlan(
  document: unknown,
  takeId: string,
  key: string,
): { planHash: string } {
  if (!supported.has(key)) throw new Error('该变体不在已接入的参考目录中。');
  const matrix = createMatrix(document, takeId, key),
    row = matrix.rows[0];
  if (!row || !matrix.catalog.lookOptions.some((option) => option.key === key))
    throw new Error('未找到变体配方。');
  const doc = withoutWorkbenchVariant(document) as StudioProjectDocumentV2;
  const result = compileNativeVariantPlanV2(
    doc,
    takeId,
    { ...row.recipe, masterId: doc.id },
    matrix.catalog.assets,
  );
  return { planHash: result.plan.planHash };
}

/** Apply only the actual V2 plan's supported reference-2d look. The scene does
 * not currently consume layout/camera profile data; report that separately. */
export function compileNativeV2PlanLook(
  document: unknown,
  takeId: string,
  key: string,
  clearFromLook?: string,
) {
  if (!supported.has(key)) throw new Error('该变体不在已接入的参考目录中。');
  const matrix = createMatrix(document, takeId, key),
    row = matrix.rows[0];
  if (!row || !matrix.catalog.lookOptions.some((option) => option.key === key))
    throw new Error('未找到变体配方。');
  const doc = withoutWorkbenchVariant(document) as StudioProjectDocumentV2;
  let clearOverride;
  if (clearFromLook) {
    if (!clearOptions.has(clearFromLook)) throw new Error('该清除效果没有接入参考 2D 消费者。');
    const option = matrix.catalog.lookOptions.find((item) => item.key === clearFromLook);
    const look = matrix.catalog.assets.find(
      (item) =>
        item.kind === 'look-pack' &&
        item.id === option?.ref.id &&
        item.version === option.ref.version,
    ) as LookPackManifest | undefined;
    clearOverride = look?.slots['clear.primary'];
    if (!clearOverride || clearOverride.kind !== 'effect-pack' || !clearOverride.contentHash)
      throw new Error('清除效果引用缺失版本或哈希。');
  }
  const recipe = {
    ...row.recipe,
    masterId: doc.id,
    ...(clearOverride
      ? { slotOverrides: { ...row.recipe.slotOverrides, 'clear.primary': clearOverride } }
      : {}),
  };
  const result = compileNativeVariantPlanV2(doc, takeId, recipe, matrix.catalog.assets);
  const style = resolveStyleFromRenderPlan(result.plan, doc.direction!.style as StyleSpec);
  if (!style.previewSupported || style.style.renderer !== 'reference-2d')
    throw new Error('此 V2 计划的外观没有可用的参考 2D 消费者。');
  const effect = result.plan.slots['clear.primary']?.manifest;
  const metadata = effect?.metadata as
    | { studio?: { stylePatch?: { reference2d?: { clearFx?: unknown } } } }
    | undefined;
  const patch = metadata?.studio?.stylePatch?.reference2d?.clearFx;
  const referenceEffectConsumed =
    style.style.reference2d.tileMaterial !== 'candy-blast' &&
    (patch === 'sweep-only' || patch === 'sweep-score-spark') &&
    style.style.reference2d.clearFx === patch;
  if (clearOverride && !referenceEffectConsumed)
    throw new Error('清除效果未被当前外观的 2D 渲染器消费。');
  const evidence = planRenderEvidence(result.plan, style.style);
  return {
    style: style.style,
    planHash: result.plan.planHash,
    evidence,
    referenceEffect: {
      id: effect?.id ?? '',
      preset: referenceEffectConsumed ? patch : null,
      consumed: referenceEffectConsumed,
    },
    lookRef: result.plan.lookPack.ref,
    clearRef: result.plan.slots['clear.primary']?.ref,
  };
}
