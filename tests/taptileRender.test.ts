import { describe, expect, it } from 'vitest';
import { validateFrameRenderJob, type FrameRenderJob } from '../src/exporter/fixedFrameExporter';
import { compileTapTileTake } from '../src/taptile/director';
import {
  applyTapAction,
  compileTapTileLevel,
  createInitialTapTileGameState,
} from '../src/taptile/gameplay';
import { createTapTileTake } from '../src/taptile/gameplay/take';
import {
  createDefaultTapTileProject,
  type TapTileTakeAction,
} from '../src/taptile/project';
import { resolveTapTileBuiltinAssetUrl } from '../src/taptile/assetUrl';
import {
  assertTapTileFrameProofsMatch,
  collectTapTileDrawableAssetIds,
  compareTapTileFrameProofs,
  createTapTileRenderJob,
  hashTapTileRenderIdentity,
  hashPixelBytes,
  renderTapTilePresentationFrame,
  selectTapTileRegressionFrames,
  TapTileAssetCache,
  TAPTILE_VIDEO_QUALITY_PROFILES,
  TAPTILE_Z_BANDS,
  resolveTapTileVideoQualityProfile,
} from '../src/taptile/render';
import { tapTileTraySlotRect } from '../src/taptile/trayLayout';
import { TAPTILE_POINTER_ASSET_ID } from '../src/taptile/presentation/assets';
import { tapTileMaterialAppearance } from '../src/taptile/visual/materialAppearance';

const ACTION_IDS = ['hourglass-43', 'hourglass-44', 'hourglass-45', 'hourglass-46', 'hourglass-47', 'hourglass-48'];

function renderFixture() {
  const project = createDefaultTapTileProject('hourglass');
  const level = compileTapTileLevel(project);
  let state = createInitialTapTileGameState(level);
  const actions: TapTileTakeAction[] = [];
  for (const [index, tileId] of ACTION_IDS.entries()) {
    const action = { id: `render-${index}`, type: 'tap' as const, actor: 'script' as const, tileId };
    const transition = applyTapAction(level, state, action);
    state = transition.after;
    actions.push({ ...action, startedAtFrame: index * 2, durationFrames: 1 });
  }
  const take = createTapTileTake(level, actions, state, { id: 'render-take', name: 'Render fixture', createdAt: '1970-01-01T00:00:00.000Z' });
  const compiled = compileTapTileTake(level, take, project.director.profiles['combo-rush']!, { seed: 44 });
  return { project, level, take, compiled };
}

function fakeCanvas(gradientColors: string[] = [], strokeColors: string[] = []): HTMLCanvasElement {
  const gradient = { addColorStop: (_offset: number, color: string) => { gradientColors.push(color); } };
  const contextState = {
    globalAlpha: 1,
    strokeStyle: '',
    createLinearGradient: () => gradient,
    getImageData: () => ({ data: new Uint8ClampedArray(1080 * 4) }),
    measureText: () => ({ width: 0 }),
    stroke: () => { strokeColors.push(String(contextState.strokeStyle)); },
  } as unknown as CanvasRenderingContext2D;
  const context = new Proxy(contextState, {
    get(target, property) {
      const value = Reflect.get(target as unknown as object, property);
      return value ?? (() => undefined);
    },
    set(target, property, value) {
      Reflect.set(target as unknown as object, property, value);
      return true;
    },
  });
  return { width: 1080, height: 1920, getContext: () => context } as unknown as HTMLCanvasElement;
}

describe('generic fixed-frame render jobs', () => {
  it('validates dimensions, frame count and every evaluator result before encoding', () => {
    let evaluations = 0;
    const job: FrameRenderJob<{ index: number }> = {
      width: 1080,
      height: 1920,
      fps: 30,
      totalFrames: 9,
      evaluate: (index) => { evaluations += 1; return { index }; },
      render: () => undefined,
    };
    expect(validateFrameRenderJob(job)).toEqual({ valid: true, errors: [] });
    expect(evaluations).toBe(9);
    expect(validateFrameRenderJob({ ...job, width: 1079 }).errors).toContain('H.264 输出宽高必须是偶数。');
    expect(validateFrameRenderJob({ ...job, totalFrames: 0 }).valid).toBe(false);
  });

  it('defines explicit 1080p30 quality budgets without changing timeline semantics', () => {
    expect(TAPTILE_VIDEO_QUALITY_PROFILES.map((profile) => profile.id)).toEqual(['preview', 'standard', 'cinematic']);
    expect(resolveTapTileVideoQualityProfile('standard')).toMatchObject({ videoBitrate: 14_000_000, audioBitrate: 192_000, renderScale: 1 });
    expect(resolveTapTileVideoQualityProfile('cinematic').videoBitrate)
      .toBeGreaterThan(resolveTapTileVideoQualityProfile('standard').videoBitrate);
    expect(resolveTapTileVideoQualityProfile('cinematic').renderScale).toBe(1.5);
  });
});

describe('TapTile Canvas render pipeline', () => {
  it('resolves built-in assets beneath a GitHub Pages project base without changing external URLs', () => {
    expect(resolveTapTileBuiltinAssetUrl('/assets/taptile/tile.png', '/block-creative-studio/'))
      .toBe('/block-creative-studio/assets/taptile/tile.png');
    expect(resolveTapTileBuiltinAssetUrl('/assets/taptile/tile.png', '/'))
      .toBe('/assets/taptile/tile.png');
    expect(resolveTapTileBuiltinAssetUrl('https://cdn.example.com/tile.png', '/block-creative-studio/'))
      .toBe('https://cdn.example.com/tile.png');
  });

  it('deduplicates asset decoding and freezes asset versions', async () => {
    const project = createDefaultTapTileProject('hourglass');
    let decodes = 0;
    const cache = new TapTileAssetCache(project, {
      image: async () => { decodes += 1; return {} as CanvasImageSource; },
    });
    await Promise.all([
      cache.load('classic-tile-surface-v1'),
      cache.load('classic-tile-surface-v1'),
      cache.preload(['classic-tile-surface-v1', 'classic-tile-surface-v1']),
    ]);
    expect(decodes).toBe(1);
    expect(cache.has('classic-tile-surface-v1')).toBe(true);
    const same = new TapTileAssetCache(structuredClone(project), { image: async () => ({} as CanvasImageSource) });
    expect(same.versionHash).toBe(cache.versionHash);
    project.assets.entries['classic-tile-surface-v1']!.version = '2';
    expect(new TapTileAssetCache(project).versionHash).not.toBe(cache.versionHash);
    cache.dispose();
    expect(cache.has('classic-tile-surface-v1')).toBe(false);
  });

  it('preloads the reference hand used by both preview and exported frames', () => {
    const project = createDefaultTapTileProject('hourglass');
    expect(project.assets.entries[TAPTILE_POINTER_ASSET_ID]).toMatchObject({
      kind: 'image',
      width: 280,
      height: 360,
      hasAlpha: true,
    });
    expect(collectTapTileDrawableAssetIds(project)).toContain(TAPTILE_POINTER_ASSET_ID);
  });

  it('freezes project/level/take/skin/director identity for one job', () => {
    const { project, level, compiled } = renderFixture();
    const first = createTapTileRenderJob(project, level, compiled, { image: async () => ({} as CanvasImageSource) });
    const second = createTapTileRenderJob(project, level, compiled, { image: async () => ({} as CanvasImageSource) });
    expect(second.identity).toEqual(first.identity);
    expect(Object.isFrozen(first.project)).toBe(true);
    expect(Object.isFrozen(first.project.visuals)).toBe(true);
    expect(Object.isFrozen(first.level)).toBe(true);
    expect(Object.isFrozen(first.level.tiles)).toBe(true);
    expect(Object.isFrozen(first.compiledTake)).toBe(true);
    expect(Object.isFrozen(first.compiledTake.actions)).toBe(true);
    expect(hashTapTileRenderIdentity(second.identity)).toBe(hashTapTileRenderIdentity(first.identity));
    project.visuals.selectedThemeId = 'food-v1';
    expect(first.project.visuals.selectedThemeId).toBe('animals-v1');
    const foodJob = createTapTileRenderJob(project, level, compiled, { image: async () => ({} as CanvasImageSource) });
    expect(foodJob.identity.levelHash).toBe(first.identity.levelHash);
    expect(foodJob.identity.finalStateHash).toBe(first.identity.finalStateHash);
    expect(foodJob.identity.skinHash).not.toBe(first.identity.skinHash);
  });

  it('uses exact 1080×1920 geometry and monotonically ordered zBands', () => {
    const { project, level, compiled } = renderFixture();
    const cache = new TapTileAssetCache(project, { image: async () => ({} as CanvasImageSource) });
    const frame = compiled.actions[0]!.timing.flightStartFrame;
    const presentation = createTapTileRenderJob(project, level, compiled, { image: async () => ({} as CanvasImageSource) }).evaluate(frame);
    const trace = renderTapTilePresentationFrame(fakeCanvas(), presentation, { project, level, assets: cache });
    expect(trace.width).toBe(1080);
    expect(trace.height).toBe(1920);
    expect(trace.items.map((item) => item.band)).toEqual([...trace.items.map((item) => item.band)].sort((left, right) => left - right));
    expect(trace.items.some((item) => item.band === TAPTILE_Z_BANDS.board)).toBe(true);
    expect(trace.items.some((item) => item.band === TAPTILE_Z_BANDS.moving)).toBe(true);
    const tray = project.stage.safeAreas.tray!;
    expect(trace.items.find((item) => item.id === 'tray')?.bounds).toEqual({ x: tray.left, y: tray.top, width: tray.width, height: tray.height });
    for (const index of [0, 6]) {
      const slot = tapTileTraySlotRect(index, tray);
      expect(trace.items.find((item) => item.id === `tray-slot:${index}`)?.bounds)
        .toEqual({ x: slot.left, y: slot.top, width: slot.width, height: slot.height });
    }
  });

  it('renders deterministic praise above match VFX in the same preview/export trace', () => {
    const { project, level, compiled } = renderFixture();
    const cache = new TapTileAssetCache(project, { image: async () => ({} as CanvasImageSource) });
    const match = compiled.actions.find((action) => action.transition.matchedTileIds.length === 3)!;
    const presentation = createTapTileRenderJob(project, level, compiled, { image: async () => ({} as CanvasImageSource) })
      .evaluate(match.timing.matchStartFrame + Math.ceil((match.timing.matchVfxEndFrame - match.timing.matchStartFrame) * 0.5));
    const trace = renderTapTilePresentationFrame(fakeCanvas(), presentation, { project, level, assets: cache });
    const matchIndex = trace.items.findIndex((item) => item.id === `${match.actionId}:match`);
    const praiseIndex = trace.items.findIndex((item) => item.id === `praise:${match.actionId}:match`);
    expect(presentation.effects.find((effect) => effect.kind === 'match')?.praiseLabel).toBe('Great');
    expect(matchIndex).toBeGreaterThanOrEqual(0);
    expect(praiseIndex).toBeGreaterThan(matchIndex);
    expect(trace.items[praiseIndex]!.band).toBe(TAPTILE_Z_BANDS.praiseWarning);
  });

  it('renders cinematic frames at 1.5x physical resolution while preserving logical geometry', () => {
    const { project, level, compiled } = renderFixture();
    const cache = new TapTileAssetCache(project, { image: async () => ({} as CanvasImageSource) });
    const presentation = createTapTileRenderJob(project, level, compiled, { image: async () => ({} as CanvasImageSource) }).evaluate(0);
    const canvas = fakeCanvas();
    const trace = renderTapTilePresentationFrame(canvas, presentation, { project, level, assets: cache }, { pixelScale: 1.5 });
    expect(canvas.width).toBe(1620);
    expect(canvas.height).toBe(2880);
    expect(trace.width).toBe(1080);
    expect(trace.height).toBe(1920);
    const tray = project.stage.safeAreas.tray!;
    expect(trace.items.find((item) => item.id === 'tray')?.bounds).toEqual({ x: tray.left, y: tray.top, width: tray.width, height: tray.height });
  });

  it('composites each board layer as one shared shadow pass followed by one surface pass', () => {
    const { project, level, compiled } = renderFixture();
    const cache = new TapTileAssetCache(project, { image: async () => ({} as CanvasImageSource) });
    const presentation = createTapTileRenderJob(project, level, compiled, { image: async () => ({} as CanvasImageSource) }).evaluate(0);
    const trace = renderTapTilePresentationFrame(fakeCanvas(), presentation, { project, level, assets: cache });
    const layers = [...new Set(presentation.gameState.boardIds
      .map((tileId) => level.tiles[tileId]!.geometry.layer))]
      .sort((left, right) => left - right);
    let previousSurfaceIndex = -1;
    for (const layer of layers) {
      const tileIds = presentation.gameState.boardIds.filter((tileId) => level.tiles[tileId]!.geometry.layer === layer);
      const shadowIndexes = tileIds.map((tileId) => trace.items.findIndex((item) => item.id === `board-shadow:${tileId}`));
      const surfaceIndexes = tileIds.map((tileId) => trace.items.findIndex((item) => item.id === `board:${tileId}`));
      expect(shadowIndexes.every((index) => index >= 0)).toBe(true);
      expect(surfaceIndexes.every((index) => index >= 0)).toBe(true);
      expect(Math.max(...shadowIndexes)).toBeLessThan(Math.min(...surfaceIndexes));
      expect(Math.min(...shadowIndexes)).toBeGreaterThan(previousSurfaceIndex);
      previousSurfaceIndex = Math.max(...surfaceIndexes);
    }
  });

  it('keeps every material edge inside the snapped tile geometry', () => {
    for (const material of ['porcelain', 'ice', 'jelly', 'paper'] as const) {
      const appearance = tapTileMaterialAppearance(material);
      expect(appearance.surfaceOffsetYRatio).toBe(0);
      expect(appearance.edgeDepthRatio).toBeGreaterThan(0);
      expect(appearance.edgeDepthRatio).toBeLessThanOrEqual(0.032);
    }
  });

  it('renders the selected ice material into the same Canvas path used by MP4 export', () => {
    const { project, level, compiled } = renderFixture();
    project.authoring.material = 'ice';
    const cache = new TapTileAssetCache(project, { image: async () => ({} as CanvasImageSource) });
    const gradientColors: string[] = [];
    const presentation = createTapTileRenderJob(project, level, compiled, { image: async () => ({} as CanvasImageSource) }).evaluate(0);
    renderTapTilePresentationFrame(fakeCanvas(gradientColors), presentation, { project, level, assets: cache });
    expect(gradientColors).toEqual(expect.arrayContaining(['#ffffff', '#eef5ff', '#d3e4ff']));
  });

  it('renders one compact tray tile without a second inset material ring', () => {
    const { project, level, compiled } = renderFixture();
    project.authoring.material = 'ice';
    const cache = new TapTileAssetCache(project, { image: async () => ({} as CanvasImageSource) });
    const original = createTapTileRenderJob(project, level, compiled, { image: async () => ({} as CanvasImageSource) }).evaluate(0);
    const tileId = original.gameState.boardIds[0]!;
    const presentation = {
      ...original,
      gameState: {
        ...original.gameState,
        boardIds: original.gameState.boardIds.filter((id) => id !== tileId),
        trayIds: [tileId],
      },
      movingTiles: [],
      effects: [],
      pointer: { ...original.pointer, visible: false },
    };
    const strokeColors: string[] = [];
    renderTapTilePresentationFrame(fakeCanvas([], strokeColors), presentation, { project, level, assets: cache });
    const innerRingColor = tapTileMaterialAppearance('ice').highlightColor;
    expect(strokeColors.filter((color) => color === innerRingColor)).toHaveLength(presentation.gameState.boardIds.length);
  });

  it('selects deterministic visual regression checkpoints from the compiled timeline', () => {
    const { compiled } = renderFixture();
    const checkpoints = selectTapTileRegressionFrames(compiled);
    expect(checkpoints.map((checkpoint) => checkpoint.label)).toEqual([
      'initial',
      'first-click',
      'first-flight-midpoint',
      'first-tray-reorder',
      'first-match',
      'ending',
    ]);
    expect(checkpoints.every((checkpoint) => checkpoint.frameNumber >= 0 && checkpoint.frameNumber < compiled.totalFrames)).toBe(true);
  });

  it('hashes identical pixels identically and catches one-byte drift', () => {
    const first = new Uint8ClampedArray([0, 1, 2, 3, 4, 5]);
    const second = new Uint8ClampedArray(first);
    expect(hashPixelBytes(second)).toBe(hashPixelBytes(first));
    second[5] = 6;
    expect(hashPixelBytes(second)).not.toBe(hashPixelBytes(first));
  });

  it('blocks export when the checked preview frame differs by identity, frame, dimensions, or pixels', () => {
    const base = {
      renderIdentityHash: 'render-a',
      frameNumber: 12,
      pixelHash: 'pixels-a',
      width: 1080,
      height: 1920,
    };
    expect(compareTapTileFrameProofs(base, { ...base })).toEqual({ valid: true, reasons: [] });
    expect(() => assertTapTileFrameProofsMatch(base, { ...base })).not.toThrow();
    expect(compareTapTileFrameProofs(base, {
      ...base,
      renderIdentityHash: 'render-b',
      frameNumber: 13,
      pixelHash: 'pixels-b',
      width: 720,
    })).toEqual({
      valid: false,
      reasons: [
        'RENDER_IDENTITY_MISMATCH',
        'RENDER_FRAME_MISMATCH',
        'RENDER_DIMENSIONS_MISMATCH',
        'RENDER_PIXELS_MISMATCH',
      ],
    });
    expect(() => assertTapTileFrameProofsMatch(base, { ...base, pixelHash: 'pixels-b' }))
      .toThrow('PREVIEW_EXPORT_PARITY_FAILED: RENDER_PIXELS_MISMATCH');
  });
});
