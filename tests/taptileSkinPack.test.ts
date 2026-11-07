import { describe, expect, it } from 'vitest';
import {
  applyTapAction,
  compileTapTileLevel,
  createInitialTapTileGameState,
  replayTapTileTake,
} from '../src/taptile/gameplay';
import {
  CHAIN_COMBO_FACE_ASSETS,
  CHAIN_COMBO_UI_THEME_ID,
  createDefaultTapTileProject,
  randomizeChainComboFaceTheme,
  type FaceAssembly,
  type TapTilePresentationRole,
  type TapTileTakeAction,
  upgradeLegacyBuiltInThemeGlyphs,
} from '../src/taptile/project';
import { createTapTileTake } from '../src/taptile/gameplay/take';
import {
  renderFaceAssembly,
  resolveStageAssembly,
  resolveTileVisual,
  TapTileAssetRegistry,
  validateSkinPack,
} from '../src/taptile/visual';

const GATE_ACTIONS = [
  'hourglass-43',
  'hourglass-44',
  'hourglass-45',
  'hourglass-46',
  'hourglass-47',
  'hourglass-48',
];

describe('TapTile SkinPack and presentation roles', () => {
  it('requires complete built-in theme coverage without fallback', () => {
    const project = createDefaultTapTileProject('hourglass');
    const archetypeCount = Object.keys(project.visuals.archetypes).length;
    for (const themeId of ['animals-v1', 'food-v1', CHAIN_COMBO_UI_THEME_ID]) {
      const report = validateSkinPack(project, themeId);
      expect(report.valid, report.issues.map((issue) => issue.code).join(',')).toBe(true);
      expect(report.coveredArchetypeIds).toHaveLength(archetypeCount);
    }

    const incomplete = structuredClone(project);
    const firstArchetypeId = Object.keys(incomplete.visuals.archetypes)[0]!;
    delete incomplete.visuals.themes['food-v1']!.bindings[firstArchetypeId];
    const report = validateSkinPack(incomplete, 'food-v1');
    expect(report.valid).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'THEME_BINDING_MISSING', archetypeId: firstArchetypeId }));
    expect(() => resolveTileVisual(incomplete, firstArchetypeId, 'food-v1', 'board')).toThrow('THEME_BINDING_NOT_FOUND');
  });

  it('installs all 14 chain-combo PNGs and safely randomizes 16 visually unique match faces', () => {
    const baseline = createDefaultTapTileProject('hourglass');
    expect(CHAIN_COMBO_FACE_ASSETS).toHaveLength(14);
    for (const spec of CHAIN_COMBO_FACE_ASSETS) {
      expect(baseline.assets.entries[spec.id]).toMatchObject({
        kind: 'image',
        width: 256,
        height: 256,
        hasAlpha: true,
        contentHash: spec.contentHash,
      });
    }

    const first = structuredClone(baseline);
    const repeated = structuredClone(baseline);
    const changed = structuredClone(baseline);
    randomizeChainComboFaceTheme(first, 'fixture-seed-a');
    randomizeChainComboFaceTheme(repeated, 'fixture-seed-a');
    randomizeChainComboFaceTheme(changed, 'fixture-seed-b');
    const signatures = (project: typeof baseline) => Object.values(project.visuals.archetypes)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((archetype) => {
        const binding = project.visuals.themes[CHAIN_COMBO_UI_THEME_ID]!.bindings[archetype.id]!;
        return JSON.stringify(project.visuals.faceAssemblies[binding.faceAssemblyId]!.parts);
      });
    expect(signatures(repeated)).toEqual(signatures(first));
    expect(signatures(changed)).not.toEqual(signatures(first));
    expect(new Set(signatures(first))).toHaveLength(Object.keys(first.visuals.archetypes).length);
    const assemblies = Object.values(first.visuals.themes[CHAIN_COMBO_UI_THEME_ID]!.bindings)
      .map((binding) => first.visuals.faceAssemblies[binding.faceAssemblyId]!);
    expect(assemblies.every((assembly) => assembly.mode === 'overlay-on-body')).toBe(true);
    expect(assemblies.every((assembly) => assembly.parts.length === 1)).toBe(true);
    expect(validateSkinPack(first, CHAIN_COMBO_UI_THEME_ID).valid).toBe(true);
    expect(compileTapTileLevel(first).levelHash).toBe(compileTapTileLevel(baseline).levelHash);
  });

  it('keeps every built-in match key visually unique and upgrades the legacy duplicate frog', () => {
    const project = createDefaultTapTileProject('hourglass');
    const archetypeIds = Object.keys(project.visuals.archetypes);
    for (const themeId of ['animals-v1', 'food-v1']) {
      const glyphs = archetypeIds.map((archetypeId) => {
        const binding = project.visuals.themes[themeId]!.bindings[archetypeId]!;
        const part = project.visuals.faceAssemblies[binding.faceAssemblyId]!.parts[0]!;
        return part.source.kind === 'glyph' ? part.source.value : part.source.assetId;
      });
      expect(new Set(glyphs).size, `${themeId} contains duplicate visible faces`).toBe(glyphs.length);
    }

    const legacy = structuredClone(project);
    const oldStarPart = legacy.visuals.faceAssemblies['face-animals-star']!.parts[0]!;
    if (oldStarPart.source.kind !== 'glyph') throw new Error('Built-in star must be a glyph.');
    oldStarPart.source.value = '🐸';
    expect(validateSkinPack(legacy, 'animals-v1').issues)
      .toContainEqual(expect.objectContaining({ code: 'MATCH_VISUAL_DUPLICATE', severity: 'error' }));
    const upgraded = upgradeLegacyBuiltInThemeGlyphs(legacy);
    const upgradedStarPart = upgraded.visuals.faceAssemblies['face-animals-star']!.parts[0]!;
    expect(upgradedStarPart.source.kind === 'glyph' ? upgradedStarPart.source.value : '').toBe('🐹');
    expect(validateSkinPack(upgraded, 'animals-v1').valid).toBe(true);
  });

  it('resolves one visual identity consistently for every presentation role', () => {
    const project = createDefaultTapTileProject('hourglass');
    const archetypeId = project.level.tileInstances[0]!.archetypeId;
    const roles: TapTilePresentationRole[] = ['board', 'flight', 'tray', 'match-ghost', 'hud-preview'];
    const animals = roles.map((role) => resolveTileVisual(project, archetypeId, 'animals-v1', role));
    expect(new Set(animals.map((visual) => visual.identityHash))).toHaveLength(1);
    expect(new Set(animals.map((visual) => visual.faceAssembly.id))).toHaveLength(1);
    expect(new Set(animals.map((visual) => visual.bodyStyle.id))).toHaveLength(1);
    const food = resolveTileVisual(project, archetypeId, 'food-v1', 'board');
    expect(food.identityHash).not.toBe(animals[0]!.identityHash);
    const iceProject = structuredClone(project);
    iceProject.authoring.material = 'ice';
    const ice = resolveTileVisual(iceProject, archetypeId, 'animals-v1', 'board');
    expect(ice.material).toBe('ice');
    expect(ice.identityHash).not.toBe(animals[0]!.identityHash);
  });

  it('renders overlay, full-front and composed assemblies including repeats', () => {
    const project = createDefaultTapTileProject('hourglass');
    project.assets.entries['alpha-face'] = {
      id: 'alpha-face',
      kind: 'image',
      source: { type: 'builtin', uri: '/assets/taptile/alpha-face.png' },
      width: 256,
      height: 256,
      hasAlpha: true,
      version: '1',
    };
    const registry = new TapTileAssetRegistry(project.assets);
    const baseTransform = { x: 0.5, y: 0.5, scaleX: 0.7, scaleY: 0.7, rotationDeg: 0, opacity: 1 };
    const assemblies: FaceAssembly[] = [
      {
        id: 'overlay', name: 'overlay', mode: 'overlay-on-body', bodyInteraction: 'show-body',
        parts: [{ id: 'overlay-image', source: { kind: 'image', assetId: 'alpha-face' }, transform: baseTransform }],
      },
      {
        id: 'front', name: 'front', mode: 'full-front', bodyInteraction: 'replace-front-surface',
        parts: [{ id: 'front-image', source: { kind: 'image', assetId: 'alpha-face' }, transform: { ...baseTransform, scaleX: 1, scaleY: 1 } }],
      },
      {
        id: 'composed', name: 'composed', mode: 'composed', bodyInteraction: 'partially-cover-body',
        parts: [
          { id: 'eyes', source: { kind: 'glyph', value: '●' }, transform: { ...baseTransform, scaleX: 0.2, scaleY: 0.2 }, repeat: { count: 2, layout: 'row' } },
          { id: 'mouth', source: { kind: 'glyph', value: '⌣' }, transform: { ...baseTransform, y: 0.7, scaleX: 0.3, scaleY: 0.2 } },
        ],
      },
    ];
    const rendered = assemblies.map((assembly) => renderFaceAssembly(assembly, registry));
    expect(rendered.map((item) => item.fit)).toEqual(['contain-safe-area', 'cover-front', 'composed']);
    expect(rendered[0]!.showBody).toBe(true);
    expect(rendered[1]!.showBody).toBe(false);
    expect(rendered[2]!.parts).toHaveLength(3);
  });

  it('reports alpha, clipping and custom repeat compatibility failures', () => {
    const project = createDefaultTapTileProject('hourglass');
    const archetypeId = project.level.tileInstances[0]!.archetypeId;
    const binding = project.visuals.themes['animals-v1']!.bindings[archetypeId]!;
    project.assets.entries['opaque'] = {
      id: 'opaque', kind: 'image', source: { type: 'builtin', uri: '/opaque.png' }, hasAlpha: false, version: '1',
    };
    project.visuals.faceAssemblies[binding.faceAssemblyId] = {
      id: binding.faceAssemblyId,
      name: 'invalid overlay',
      mode: 'overlay-on-body',
      bodyInteraction: 'show-body',
      parts: [{
        id: 'bad',
        source: { kind: 'image', assetId: 'opaque' },
        transform: { x: 0.02, y: 0.5, scaleX: 0.8, scaleY: 0.8, rotationDeg: 0, opacity: 1 },
        repeat: { count: 2, layout: 'custom', offsets: [{ x: 0, y: 0 }] },
      }],
    };
    const report = validateSkinPack(project, 'animals-v1');
    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'OVERLAY_ALPHA_REQUIRED',
      'OVERLAY_OUTSIDE_SAFE_AREA',
      'FACE_REPEAT_OFFSETS_MISSING',
    ]));
  });

  it('resolves static, ambient, foreground, HUD and tray stage layers through the asset registry', () => {
    const project = createDefaultTapTileProject('hourglass');
    project.visuals.stageAssemblies.qa = [
      { id: 'base', role: 'base', color: '#123456', opacity: 1 },
      { id: 'ambient', role: 'ambient', assetId: 'classic-tile-surface-v1', opacity: 0.2 },
      { id: 'foreground', role: 'foreground', assetId: 'classic-tile-surface-v1', opacity: 0.4 },
      { id: 'hud', role: 'hud', opacity: 1 },
      { id: 'tray', role: 'tray', opacity: 1 },
    ];
    const resolved = resolveStageAssembly(project, 'qa');
    expect(resolved.layers.map((layer) => layer.role)).toEqual(['base', 'ambient', 'foreground', 'hud', 'tray']);
    expect(resolved.layers[1]?.asset?.uri).toBe('/assets/taptile/classic-tile-surface-v1.png');
    expect(JSON.stringify(project)).not.toContain('blob:');
  });

  it('keeps every gameplay transition and hash invariant across the two skins', () => {
    const animalProject = createDefaultTapTileProject('hourglass');
    animalProject.visuals.selectedThemeId = 'animals-v1';
    const foodProject = structuredClone(animalProject);
    foodProject.visuals.selectedThemeId = 'food-v1';
    const animalLevel = compileTapTileLevel(animalProject);
    const foodLevel = compileTapTileLevel(foodProject);
    expect(foodLevel.levelHash).toBe(animalLevel.levelHash);

    let state = createInitialTapTileGameState(animalLevel);
    const actions: TapTileTakeAction[] = [];
    for (const [index, tileId] of GATE_ACTIONS.entries()) {
      const action = { id: `skin-${index}`, type: 'tap' as const, actor: 'script' as const, tileId };
      const transition = applyTapAction(animalLevel, state, action);
      expect(transition.accepted).toBe(true);
      state = transition.after;
      actions.push({ ...action, startedAtFrame: index * 2, durationFrames: 1 });
    }
    const take = createTapTileTake(animalLevel, actions, state, { id: 'skin-gate-take', name: 'Skin invariant', createdAt: '1970-01-01T00:00:00.000Z' });
    const animalReplay = replayTapTileTake(animalLevel, take);
    const foodReplay = replayTapTileTake(foodLevel, take);
    expect(foodReplay.valid).toBe(true);
    expect(foodReplay.transitions).toEqual(animalReplay.transitions);
    expect(foodReplay.states).toEqual(animalReplay.states);
    expect(foodReplay.states.at(-1)).toEqual(animalReplay.states.at(-1));
    expect(take.actions.map((action) => action.tileId)).toEqual(GATE_ACTIONS);
  });

  it('does not let visual bounds, body thickness or shadows enter the blocker graph', () => {
    const baseline = createDefaultTapTileProject('hourglass');
    const reskinned = structuredClone(baseline);
    reskinned.visuals.selectedThemeId = 'food-v1';
    for (const body of Object.values(reskinned.visuals.bodyStyles)) {
      body.cornerRadiusPx = 200;
      body.borderWidthPx = 44;
      body.shadowPresetId = 'huge-visual-only-shadow';
    }
    for (const assembly of Object.values(reskinned.visuals.faceAssemblies)) {
      for (const part of assembly.parts) {
        part.transform.scaleX *= 1.3;
        part.transform.scaleY *= 1.3;
      }
    }
    const left = compileTapTileLevel(baseline);
    const right = compileTapTileLevel(reskinned);
    expect(right.levelHash).toBe(left.levelHash);
    expect(right.blockerEdges).toEqual(left.blockerEdges);
    expect(right.initialBlockerCount).toEqual(left.initialBlockerCount);
  });
});
