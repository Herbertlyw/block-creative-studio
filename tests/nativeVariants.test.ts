import { ordinaryProject } from './fixtures/ordinaryProject';
import { syntheticLookProject } from './fixtures/syntheticLookProject';
import { expect, it } from 'vitest';
import {
  compileNativePreviewLook,
  compileNativeV2PlanLook,
  listNativePreviewLooks,
} from '../src/contracts/nativeVariants';
import { compileNativeVariantPlanV2 } from '../src/contracts/nativeVariantPlanV2';
const source = () => JSON.parse(JSON.stringify(ordinaryProject()));
it('compiles BB 1.0.0 reference looks and quality gates without modifying the V2 project or Take', () => {
  const doc = source(),
    before = JSON.stringify(doc),
    options = listNativePreviewLooks(doc, 'synthetic-take');
  expect(options.map((x) => x.key)).toContain('builtin.reference-clean.look@1.0.0');
  const clean = compileNativePreviewLook(
    doc,
    'synthetic-take',
    'builtin.reference-clean.look@1.0.0',
  );
  const current = compileNativePreviewLook(doc, 'synthetic-take', 'project-current');
  expect(clean.style.renderer).toBe('reference-2d');
  expect(clean.style.reference2d.tileMaterial).toBe('flat-matte');
  expect(current.style.reference2d.tileMaterial).toBe('soft-bevel');
  expect(clean.planHash).not.toBe(current.planHash);
  expect(JSON.stringify(doc)).toBe(before);
});

it('compiles a native V2 plan with registered BB contracts and explicit matching manifests', async () => {
  const { studioBundleFromBlockPlacementV2 } = await import(
    '../src/nativeReference/games/block-placement/migrations/blockPlacementV1'
  );
  const { compileTakeForMaster, createStudioVariantMatrix } = await import(
    '../src/nativeReference/games/block-placement/studio/studioVariantBridge'
  );
  const doc = source();
  listNativePreviewLooks(doc, 'synthetic-take');
  const bundle = studioBundleFromBlockPlacementV2(doc),
    take = bundle.takes[0]!;
  const matrix = createStudioVariantMatrix({
    project: bundle.project,
    selectedTake: take,
    compiledTake: compileTakeForMaster(take, bundle.project),
    requestedLockMode: 'frame-exact',
    selectedLookKey: 'builtin.reference-clean.look@1.0.0',
    importedAssets: [],
    importedRecipes: [],
  });
  const recipe = { ...matrix.rows[0]!.recipe, masterId: doc.id };
  expect(() =>
    compileNativeVariantPlanV2(doc, 'synthetic-take', recipe, matrix.catalog.assets),
  ).toThrow(/not registered/);
  doc.production.layoutProfileRef = matrix.catalog.layoutProfileRef;
  doc.production.cameraProfileRef = matrix.catalog.cameraProfileRef;
  const before = JSON.stringify(doc),
    result = compileNativeVariantPlanV2(doc, 'synthetic-take', recipe, matrix.catalog.assets);
  expect(result.plan.planSchemaVersion).toBe('2.0.0');
  expect(result.plan.game.id).toBe('block-placement');
  expect(result.plan.renderContract.id).toBe('bcs.render.block-placement');
  expect(result.plan.replay.frameHash).toBeTruthy();
  expect(result.quality.passed).toBe(true);
  const rendered = compileNativeV2PlanLook(
    doc,
    'synthetic-take',
    'builtin.reference-clean.look@1.0.0',
  );
  expect(rendered.planHash).toBe(result.plan.planHash);
  expect(rendered.style.reference2d.tileMaterial).toBe('flat-matte');
  expect(rendered.evidence.cameraDrivesPixels).toBe(false);
  expect(rendered.evidence.layoutDrivesPixels).toBe(false);
  expect(JSON.stringify(doc)).toBe(before);
  const mismatched = { ...recipe, masterId: 'another-master' };
  expect(() =>
    compileNativeVariantPlanV2(doc, 'synthetic-take', mismatched, matrix.catalog.assets),
  ).toThrow(/targets/);
  const wrongGame = structuredClone(doc);
  wrongGame.game.game.moduleVersion = '999.0.0';
  expect(() =>
    compileNativeVariantPlanV2(wrongGame, 'synthetic-take', recipe, matrix.catalog.assets),
  ).toThrow(/not registered/);
});
it('rejects other games, versions and unverified look keys', () => {
  const doc = source();
  expect(() => compileNativePreviewLook(doc, 'synthetic-take', 'unknown')).toThrow(/不是/);
  doc.game.game.id = 'other-game';
  expect(() => listNativePreviewLooks(doc, 'synthetic-take')).toThrow(/仅支持/);
  doc.game.game.id = 'block-placement';
  doc.game.game.moduleVersion = '2.0.0';
  expect(() => listNativePreviewLooks(doc, 'synthetic-take')).toThrow(/1.0.0/);
});

it('binds a verified clear effect independently of the look and rejects incompatible effects', () => {
  const doc = syntheticLookProject();
  const before = JSON.stringify(doc),
    key = 'builtin.reference-clean.look@1.0.0';
  const simple = compileNativeV2PlanLook(
    doc,
    'synthetic-take',
    key,
    'builtin.reference-clean.look@1.0.0',
  );
  const spark = compileNativeV2PlanLook(
    doc,
    'synthetic-take',
    key,
    'builtin.reference-garden.look@1.0.0',
  );
  expect(simple.referenceEffect).toMatchObject({ preset: 'sweep-only', consumed: true });
  expect(spark.referenceEffect).toMatchObject({ preset: 'sweep-score-spark', consumed: true });
  expect(simple.planHash).not.toBe(spark.planHash);
  const a = structuredClone(simple.style),
    b = structuredClone(spark.style);
  a.reference2d.clearFx = b.reference2d.clearFx;
  expect(a).toEqual(b);
  expect(() => compileNativeV2PlanLook(doc, 'synthetic-take', key, 'unverified')).toThrow(
    /没有接入/,
  );
  expect(() =>
    compileNativeV2PlanLook(
      doc,
      'synthetic-take',
      'builtin.classic-blast.look@1.0.0',
      'builtin.reference-clean.look@1.0.0',
    ),
  ).toThrow(/未被/);
  expect(JSON.stringify(doc)).toBe(before);
});

it('uses the received quality gate to reject a plan with a missing required material slot', async () => {
  const { studioBundleFromBlockPlacementV2 } = await import(
    '../src/nativeReference/games/block-placement/migrations/blockPlacementV1'
  );
  const { compileTakeForMaster, createStudioVariantMatrix } = await import(
    '../src/nativeReference/games/block-placement/studio/studioVariantBridge'
  );
  const { runQualityGate } = await import('../src/nativeReference/headless/qualityGate');
  const doc = source();
  listNativePreviewLooks(doc, 'synthetic-take');
  const bundle = studioBundleFromBlockPlacementV2(doc),
    take = bundle.takes[0]!;
  const matrix = createStudioVariantMatrix({
    project: bundle.project,
    selectedTake: take,
    compiledTake: compileTakeForMaster(take, bundle.project),
    requestedLockMode: 'frame-exact',
    selectedLookKey: 'project-current',
    importedAssets: [],
    importedRecipes: [],
  });
  const row = matrix.rows[0]!;
  expect(row.quality?.passed).toBe(true);
  const plan = structuredClone(row.plan!);
  delete plan.slots['tile.material'];
  const report = runQualityGate(plan, { strict: true, requireHashes: true });
  expect(report.passed).toBe(false);
  expect(report.issues.some((issue) => issue.code === 'REQUIRED_LOOK_SLOT_MISSING')).toBe(true);
});
