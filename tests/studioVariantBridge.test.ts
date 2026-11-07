import { describe, expect, it } from 'vitest';
import { createGreedyAgentTake } from '../src/director/botDirector';
import { compileTake } from '../src/director/presentationCompiler';
import { RHYTHM_PRESETS } from '../src/director/rhythmPresets';
import { createCrossClearBoard } from '../src/domain/boardPresets';
import { createGame, createPieceSet } from '../src/domain/gameEngine';
import type { ProjectSpec } from '../src/domain/types';
import {
  PROJECT_CURRENT_LOOK_KEY,
  createStudioAssetCatalog,
  parseImportedAssetBundle,
  styleForLookOption,
} from '../src/integration/studioAssetCatalog';
import {
  PROJECT_CURRENT_VARIANT_ID,
  createStudioVariantMatrix,
  studioPreviewStyle,
  variantRowPreviewKind,
} from '../src/integration/studioVariantBridge';
import { DEFAULT_STYLE } from '../src/renderer/stylePresets';

function projectFixture(): ProjectSpec {
  const seed = 41782;
  return {
    schemaVersion: '1.0.0',
    id: 'web-variant-fixture',
    name: 'Web Variant Fixture',
    ruleProfile: 'block-placement-classic-v1',
    seed,
    setupBoard: createCrossClearBoard(),
    setupPieces: createPieceSet(seed, 0, ['single', 'tri-h', 'square-2']),
    style: structuredClone(DEFAULT_STYLE),
    rhythm: { ...RHYTHM_PRESETS['human-natural'] },
    render: { width: 1080, height: 1920, fps: 30, quality: 'standard' },
  };
}

describe('studioVariantBridge', () => {
  it('compiles the current Web project through the same headless core used by CLI', () => {
    const project = projectFixture();
    const take = createGreedyAgentTake(createGame(project.setupBoard, project.seed, project.setupPieces), 6);
    const compiled = compileTake(take, project.rhythm, project.render.fps);
    const matrix = createStudioVariantMatrix({
      project,
      selectedTake: take,
      compiledTake: compiled,
      requestedLockMode: 'frame-exact',
      selectedLookKey: PROJECT_CURRENT_LOOK_KEY,
      importedAssets: [],
      importedRecipes: [],
    });

    expect(matrix.rows).toHaveLength(1);
    const row = matrix.rows[0]!;
    expect(row.recipe.id).toBe(PROJECT_CURRENT_VARIANT_ID);
    expect(row.plan?.planHash).toMatch(/^fnv1a32:/);
    expect(row.quality?.passed).toBe(true);
    expect(row.previewSupported).toBe(true);
    expect(row.resolvedStyle.renderer).toBe(project.style.renderer);
    expect(row.resolvedStyle.material).toBe(project.style.material);
    expect(row.resolvedStyle.materialRuntime).toBeDefined();
    expect(row.resolvedStyle.materialRuntime?.id).toContain('material');
  });

  it('switches a complete Look Pack without reimplementing style inheritance in UI', () => {
    const project = projectFixture();
    const catalog = createStudioAssetCatalog(project);
    const cleanLook = catalog.lookOptions.find((option) => option.ref.id === 'builtin.reference-clean.look');
    expect(cleanLook).toBeDefined();
    const resolved = styleForLookOption(catalog, cleanLook!.key, project.style);

    expect(resolved.previewSupported).toBe(true);
    expect(resolved.style.renderer).toBe('reference-2d');
    expect(resolved.style.reference2d.tileMaterial).toBe('flat-matte');
    expect(resolved.style.reference2d.tileFaceSet).toBe('none');
    expect(resolved.style.reference2d.ambientFx).toBe('none');
  });

  it('keeps the fixed-camera profile aligned with the output aspect', () => {
    const project = projectFixture();
    const matrix = createStudioVariantMatrix({
      project,
      selectedTake: null,
      compiledTake: null,
      requestedLockMode: 'frame-exact',
      selectedLookKey: PROJECT_CURRENT_LOOK_KEY,
      importedAssets: [],
      importedRecipes: [],
    });
    const row = matrix.rows[0]!;
    const metadata = row.plan?.cameraProfile.manifest.metadata as {
      designResolution?: { width: number; height: number };
      boardScreenRect?: { x: number; y: number; width: number; height: number };
    };

    expect(metadata.designResolution).toEqual({ width: 1080, height: 1920 });
    expect(metadata.boardScreenRect?.x).toBeGreaterThanOrEqual(0);
    expect((metadata.boardScreenRect?.x ?? 0) + (metadata.boardScreenRect?.width ?? 0)).toBeLessThanOrEqual(1080);
    expect(row.quality?.issues.map((issue) => issue.code)).not.toContain('CAMERA_OUTPUT_ASPECT_MISMATCH');
  });

  it('accepts an external Agent asset bundle but preserves strict manifests', () => {
    const project = projectFixture();
    const catalog = createStudioAssetCatalog(project);
    const exported = { contract: 'bcs.asset-bundle', contractVersion: '1.0.0', assets: catalog.assets };
    const parsed = parseImportedAssetBundle(exported);

    expect(parsed.length).toBe(catalog.assets.length);
    expect(parsed.every((asset) => asset.contract === 'bcs.asset-manifest')).toBe(true);
  });

  it('keeps Plan material on the webpage when Look has no studio.style binding', () => {
    const project = projectFixture();
    const matrix = createStudioVariantMatrix({
      project,
      selectedTake: null,
      compiledTake: null,
      requestedLockMode: 'frame-exact',
      selectedLookKey: PROJECT_CURRENT_LOOK_KEY,
      importedAssets: [],
      importedRecipes: [],
    });
    const row = matrix.rows[0]!;
    expect(row.previewSupported).toBe(true);
    expect(row.resolvedStyle.materialRuntime).toBeDefined();
    expect(studioPreviewStyle(row, project.style)).toBe(row.resolvedStyle);
    expect(variantRowPreviewKind(row)).toBe('full-style');

    const unboundWithRuntime = { ...row, previewSupported: false };
    const preview = studioPreviewStyle(unboundWithRuntime, project.style);
    expect(variantRowPreviewKind(unboundWithRuntime)).toBe('plan-material');
    expect(preview.renderer).toBe('fixed-camera-cinematic');
    expect(preview.material).toBe(project.style.material);
    expect(preview.materialRuntime).toEqual(row.resolvedStyle.materialRuntime);
    expect(preview.materialRuntime).not.toBeUndefined();

    const unboundWithoutRuntime = {
      ...row,
      previewSupported: false,
      resolvedStyle: structuredClone(project.style),
    };
    expect(variantRowPreviewKind(unboundWithoutRuntime)).toBe('artifact-only');
    expect(studioPreviewStyle(unboundWithoutRuntime, project.style)).toBe(project.style);
    expect(studioPreviewStyle(null, project.style)).toBe(project.style);
  });
});
