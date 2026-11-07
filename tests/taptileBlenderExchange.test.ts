import { describe, expect, it } from 'vitest';
import { validateBlenderSceneExchange } from '../src/headless/blenderContracts';
import { createTapTileBlenderSceneExchange } from '../src/taptile/blender';
import { compileTapTileTake } from '../src/taptile/director';
import { applyTapAction, compileTapTileLevel, createInitialTapTileGameState } from '../src/taptile/gameplay';
import { createTapTileTake } from '../src/taptile/gameplay/take';
import { CHAIN_COMBO_UI_THEME_ID, createDefaultTapTileProject, type TapTileTakeAction } from '../src/taptile/project';

const ACTION_IDS = ['hourglass-43', 'hourglass-44', 'hourglass-45', 'hourglass-46', 'hourglass-47', 'hourglass-48'];

function fixture() {
  const project = createDefaultTapTileProject('hourglass');
  const level = compileTapTileLevel(project);
  let state = createInitialTapTileGameState(level);
  const actions: TapTileTakeAction[] = [];
  for (const [index, tileId] of ACTION_IDS.entries()) {
    const action = { id: `blender-action-${index}`, type: 'tap' as const, actor: 'script' as const, tileId };
    const transition = applyTapAction(level, state, action);
    expect(transition.accepted).toBe(true);
    state = transition.after;
    actions.push({ ...action, startedAtFrame: index * 2, durationFrames: 1 });
  }
  const take = createTapTileTake(level, actions, state, {
    id: 'blender-take',
    name: 'Blender Take',
    createdAt: '1970-01-01T00:00:00.000Z',
  });
  const compiled = compileTapTileTake(level, take, project.director.profiles['combo-rush']!, {
    seed: 20260904,
  });
  return { project, level, compiled };
}

describe('TapTile to Blender scene exchange', () => {
  it('converts the real director frame evaluation into validated 3D transform tracks', () => {
    const { project, level, compiled } = fixture();
    const exchange = createTapTileBlenderSceneExchange(project, level, compiled);
    expect(validateBlenderSceneExchange(exchange).filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(exchange.output).toEqual({
      width: 1080,
      height: 1920,
      fps: 30,
      frameStart: 1,
      frameEnd: compiled.totalFrames,
      alphaMode: 'opaque',
    });
    expect(exchange.camera.target).toEqual([0, 0, 0]);
    expect(exchange.camera.location).toEqual([0, -18, 0]);
    expect(exchange.camera.orthographicScale).toBeCloseTo(project.stage.exportHeight / 180, 6);
    expect(exchange.entities).toHaveLength(Object.keys(level.tiles).length + 2);
    expect(exchange.tracks).toHaveLength(Object.keys(level.tiles).length);
    expect(exchange.events.length).toBeGreaterThan(0);
    expect(exchange.events.every((event) => event.entityIds.length === 3)).toBe(true);
    expect(exchange.events.every((event) => event.vfx?.style === 'burst' && event.vfx.fragmentCount === 15)).toBe(true);
    expect(exchange.assets).toEqual([]);
    expect(exchange.entities.find((entity) => entity.role === 'tile')?.face?.layers?.[0]?.source.kind).toBe('glyph');

    const firstClickedTrack = exchange.tracks.find((track) => track.entityId === ACTION_IDS[0]);
    expect(firstClickedTrack?.keyframes.length).toBeGreaterThan(4);
    expect(firstClickedTrack?.keyframes.some((keyframe) => keyframe.position[2] > 3)).toBe(true);
    expect(firstClickedTrack?.keyframes.some((keyframe) => !keyframe.visible)).toBe(true);
  });

  it('translates all director match styles into bounded deterministic 3D VFX recipes', () => {
    const { project, level, compiled } = fixture();
    const expected = {
      'human-natural': { style: 'shatter', fragmentCount: 96 },
      'tight-fast': { style: 'burst', fragmentCount: 15 },
      'danger-rescue': { style: 'pulse', fragmentCount: 0 },
    } as const;
    for (const [profileId, recipe] of Object.entries(expected)) {
      const variant = compileTapTileTake(level, compiled.sourceTake, project.director.profiles[profileId]!, { seed: compiled.seed });
      const exchange = createTapTileBlenderSceneExchange(project, level, variant);
      expect(exchange.events.every((event) => event.vfx?.style === recipe.style)).toBe(true);
      expect(exchange.events.every((event) => event.vfx?.fragmentCount === recipe.fragmentCount)).toBe(true);
      if (recipe.style === 'shatter') expect(exchange.events.every((event) => event.vfx?.shockwave === false)).toBe(true);
      expect(validateBlenderSceneExchange(exchange).filter((issue) => issue.severity === 'error')).toEqual([]);
    }
  });

  it('is deterministic and can emit a static look-dev package without tracks', () => {
    const { project, level, compiled } = fixture();
    const first = createTapTileBlenderSceneExchange(project, level, compiled, { packageId: 'lookdev-test' });
    const second = createTapTileBlenderSceneExchange(project, level, compiled, { packageId: 'lookdev-test' });
    expect(second).toEqual(first);

    const staticExchange = createTapTileBlenderSceneExchange(project, level, compiled, {
      packageId: 'lookdev-static',
      includeTransformTracks: false,
      alphaMode: 'straight',
    });
    expect(staticExchange.tracks).toEqual([]);
    expect(staticExchange.output.alphaMode).toBe('straight');
    expect(validateBlenderSceneExchange(staticExchange).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('exports the selected image theme as hashed Blender asset references', () => {
    const { project, level, compiled } = fixture();
    project.visuals.selectedThemeId = CHAIN_COMBO_UI_THEME_ID;
    const exchange = createTapTileBlenderSceneExchange(project, level, compiled);
    expect(exchange.assets.length).toBeGreaterThan(0);
    expect(exchange.assets.every((asset) => asset.source.type === 'builtin-uri')).toBe(true);
    expect(exchange.assets.every((asset) => /^[a-f0-9]{64}$/u.test(asset.contentHash ?? ''))).toBe(true);
    expect(exchange.entities
      .filter((entity) => entity.role === 'tile')
      .every((entity) => entity.face?.layers?.some((layer) => layer.source.kind === 'image'))).toBe(true);
    expect(validateBlenderSceneExchange(exchange).filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});
