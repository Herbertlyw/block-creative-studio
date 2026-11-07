import { authoringToExportPoint, TAPTILE_EXPORT_SCALE } from '../pixelGeometry';
import {
  FACE_LIBRARY,
  STACK_STAGE,
  type TapTileStackProject,
} from '../stackModel';
import { stableHash } from './stableHash';
import {
  TAPTILE_PROJECT_FORMAT,
  TAPTILE_RULE_PROFILE_ID,
  TAPTILE_SCHEMA_VERSION,
  type BodyStyle,
  type FaceAssembly,
  type TapTileDirectorProfile,
  type TapTileProjectV2,
  type ThemeVariant,
} from './types';
import {
  TAPTILE_REFERENCE_BOARD_TOP_PX,
  TAPTILE_REFERENCE_TRAY_BOUNDS,
} from '../trayLayout';
import { createDefaultTapTileAudioAssets, createDefaultTapTileProductionSpec } from '../production/defaults';
import { createDefaultTapTilePresentationAssets } from '../presentation/assets';
import { ensureChainComboFaceTheme } from './builtInFaceThemes';

const LEGACY_ANIMAL_GLYPHS = ['🐼', '🦊', '🐸', '🐯', '🐰', '🐨', '🐵', '🦁', '🐙', '🐳', '🦜', '🦋'];
const LEGACY_FOOD_GLYPHS = ['🍓', '🍉', '🍋', '🥝', '🍒', '🍇', '🥕', '🍩', '🍪', '🧁', '🍄', '🥑'];

// A visible face is gameplay language: two different match keys must never look
// identical. Earlier builds wrapped 16 keys over 12 glyphs, so (for example)
// shoe and star both appeared as a frog even though they could not match.
const ANIMAL_GLYPHS = [...LEGACY_ANIMAL_GLYPHS, '🐶', '🐱', '🐹', '🐮'];
const FOOD_GLYPHS = [...LEGACY_FOOD_GLYPHS, '🍔', '🍕', '🥨', '🧀'];

interface BuiltInGlyphTheme {
  id: 'animals-v1' | 'food-v1';
  assemblyPrefix: 'face-animals-' | 'face-food-';
  label: '动物' | '食物';
  legacyGlyphs: readonly string[];
  glyphs: readonly string[];
}

const BUILT_IN_GLYPH_THEMES: readonly BuiltInGlyphTheme[] = [
  {
    id: 'animals-v1',
    assemblyPrefix: 'face-animals-',
    label: '动物',
    legacyGlyphs: LEGACY_ANIMAL_GLYPHS,
    glyphs: ANIMAL_GLYPHS,
  },
  {
    id: 'food-v1',
    assemblyPrefix: 'face-food-',
    label: '食物',
    legacyGlyphs: LEGACY_FOOD_GLYPHS,
    glyphs: FOOD_GLYPHS,
  },
];

export const DEFAULT_DIRECTOR_PROFILES: Record<string, TapTileDirectorProfile> = {
  'human-natural': {
    id: 'human-natural',
    name: '真人自然',
    globalSpeed: 1,
    betweenActionFrames: 10,
    pointerStyle: 'natural',
    tileFlightStyle: 'arc',
    trayMotionStyle: 'smooth',
    matchStyle: 'shatter',
    cameraStyle: 'steady',
    timing: {
      pointerTravelFrames: 12,
      pressFrames: 3,
      flightFrames: 13,
      trayReorderFrames: 7,
      matchDelayFrames: 2,
      matchVfxFrames: 29,
      inputOverlapFrames: 14,
    },
  },
  'tight-fast': {
    id: 'tight-fast',
    name: '紧凑快速',
    globalSpeed: 1.2,
    betweenActionFrames: 4,
    pointerStyle: 'direct',
    tileFlightStyle: 'direct',
    trayMotionStyle: 'tight',
    matchStyle: 'burst',
    cameraStyle: 'impact',
    timing: {
      pointerTravelFrames: 7,
      pressFrames: 2,
      flightFrames: 8,
      trayReorderFrames: 4,
      matchDelayFrames: 1,
      matchVfxFrames: 16,
      inputOverlapFrames: 8,
    },
  },
  'danger-rescue': {
    id: 'danger-rescue',
    name: '险境翻盘',
    globalSpeed: 0.96,
    betweenActionFrames: 8,
    pointerStyle: 'urgent',
    tileFlightStyle: 'arc',
    trayMotionStyle: 'elastic',
    matchStyle: 'pulse',
    cameraStyle: 'impact',
    timing: {
      pointerTravelFrames: 10,
      pressFrames: 4,
      flightFrames: 14,
      trayReorderFrames: 8,
      matchDelayFrames: 3,
      matchVfxFrames: 26,
      inputOverlapFrames: 9,
    },
  },
  'combo-rush': {
    id: 'combo-rush',
    name: '连消冲刺',
    globalSpeed: 1.34,
    betweenActionFrames: 3,
    pointerStyle: 'urgent',
    tileFlightStyle: 'snap',
    trayMotionStyle: 'tight',
    matchStyle: 'burst',
    cameraStyle: 'rush',
    timing: {
      pointerTravelFrames: 6,
      pressFrames: 2,
      flightFrames: 7,
      trayReorderFrames: 4,
      matchDelayFrames: 0,
      matchVfxFrames: 17,
      inputOverlapFrames: 10,
    },
  },
};

function safeTimestamp(value: string): string {
  return Number.isNaN(Date.parse(value)) ? new Date(0).toISOString() : new Date(value).toISOString();
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '');
  return normalized || stableHash(value, 'archetype');
}

function makeFaceAssembly(id: string, name: string, glyph: string): FaceAssembly {
  return {
    id,
    name,
    mode: 'overlay-on-body',
    bodyInteraction: 'show-body',
    parts: [{
      id: `${id}-glyph`,
      source: { kind: 'glyph', value: glyph },
      transform: { x: 0.5, y: 0.5, scaleX: 0.72, scaleY: 0.72, rotationDeg: 0, opacity: 1 },
    }],
  };
}

function makeBodyStyles(material: TapTileStackProject['material']): Record<string, BodyStyle> {
  const materialPresetId = `legacy-${material}`;
  return {
    'body-warm': {
      id: 'body-warm',
      name: '暖白牌体',
      materialPresetId,
      cornerRadiusPx: 28,
      borderWidthPx: 4,
      shadowPresetId: 'soft-drop',
      bodyAssetId: 'classic-tile-surface-v1',
      fill: '#fff7e7',
    },
    'body-cool': {
      id: 'body-cool',
      name: '冷白牌体',
      materialPresetId,
      cornerRadiusPx: 28,
      borderWidthPx: 4,
      shadowPresetId: 'soft-drop',
      bodyAssetId: 'classic-tile-surface-v1',
      fill: '#eef8ff',
    },
    'body-color': {
      id: 'body-color',
      name: '彩色牌体',
      materialPresetId,
      cornerRadiusPx: 30,
      borderWidthPx: 5,
      shadowPresetId: 'strong-drop',
      bodyAssetId: 'classic-tile-surface-v1',
      fill: '#fff2bd',
    },
  };
}

export function upgradeLegacyBuiltInThemeGlyphs(project: TapTileProjectV2): TapTileProjectV2 {
  let upgraded: TapTileProjectV2 | null = null;
  const archetypesByMatchKey = new Map(
    Object.values(project.visuals.archetypes).map((archetype) => [archetype.matchKey, archetype]),
  );

  for (const [faceIndex, face] of FACE_LIBRARY.entries()) {
    const archetype = archetypesByMatchKey.get(face.id);
    if (!archetype) continue;
    for (const themeSpec of BUILT_IN_GLYPH_THEMES) {
      const theme = project.visuals.themes[themeSpec.id];
      const expectedAssemblyId = `${themeSpec.assemblyPrefix}${slug(archetype.matchKey)}`;
      if (theme?.bindings[archetype.id]?.faceAssemblyId !== expectedAssemblyId) continue;
      const assembly = project.visuals.faceAssemblies[expectedAssemblyId];
      const part = assembly?.parts.length === 1 ? assembly.parts[0] : undefined;
      const expectedPartId = `${expectedAssemblyId}-glyph`;
      const legacyGlyph = themeSpec.legacyGlyphs[faceIndex % themeSpec.legacyGlyphs.length];
      const nextGlyph = themeSpec.glyphs[faceIndex];
      if (!assembly
        || assembly.name !== `${archetype.displayName} · ${themeSpec.label}`
        || part?.id !== expectedPartId
        || part.source.kind !== 'glyph'
        || part.source.value !== legacyGlyph
        || !nextGlyph
        || nextGlyph === legacyGlyph) continue;

      upgraded ??= structuredClone(project);
      const upgradedPart = upgraded.visuals.faceAssemblies[expectedAssemblyId]?.parts[0];
      if (upgradedPart?.source.kind === 'glyph') upgradedPart.source.value = nextGlyph;
    }
  }

  return upgraded ?? project;
}

export function migrateTapTileStackProjectV1(source: TapTileStackProject): TapTileProjectV2 {
  const updatedAt = safeTimestamp(source.updatedAt);
  const createdAt = updatedAt;
  const uniqueFaceIds = [...new Set([
    ...FACE_LIBRARY.map((face) => face.id),
    ...source.tiles.map((tile) => tile.faceId),
  ])];
  const archetypes = Object.fromEntries(uniqueFaceIds.map((faceId) => {
    const option = FACE_LIBRARY.find((face) => face.id === faceId);
    const id = `archetype-${slug(faceId)}`;
    return [id, { id, displayName: option?.label ?? faceId, matchKey: faceId }];
  }));

  const faceAssemblies: Record<string, FaceAssembly> = {};
  const animalBindings: ThemeVariant['bindings'] = {};
  const foodBindings: ThemeVariant['bindings'] = {};
  for (const [index, archetype] of Object.values(archetypes).entries()) {
    const legacy = FACE_LIBRARY.find((face) => face.id === archetype.matchKey);
    const animalId = `face-animals-${slug(archetype.matchKey)}`;
    const foodId = `face-food-${slug(archetype.matchKey)}`;
    faceAssemblies[animalId] = makeFaceAssembly(animalId, `${archetype.displayName} · 动物`, ANIMAL_GLYPHS[index] ?? legacy?.glyph ?? '⭐');
    faceAssemblies[foodId] = makeFaceAssembly(foodId, `${archetype.displayName} · 食物`, FOOD_GLYPHS[index] ?? legacy?.glyph ?? '⭐');
    animalBindings[archetype.id] = {
      faceAssemblyId: animalId,
      bodyStyleId: index % 2 === 0 ? 'body-warm' : 'body-cool',
    };
    foodBindings[archetype.id] = {
      faceAssemblyId: foodId,
      bodyStyleId: index % 3 === 0 ? 'body-color' : 'body-warm',
    };
  }

  const projectIdentity = {
    name: source.name,
    templateId: source.templateId,
    updatedAt,
    tileIds: source.tiles.map((tile) => tile.id),
  };

  const migrated: TapTileProjectV2 = {
    format: TAPTILE_PROJECT_FORMAT,
    schemaVersion: TAPTILE_SCHEMA_VERSION,
    id: stableHash(projectIdentity, 'taptile-project'),
    name: source.name,
    revision: 1,
    createdAt,
    updatedAt,
    ruleProfileId: TAPTILE_RULE_PROFILE_ID,
    stage: {
      authoringWidth: 432,
      authoringHeight: 768,
      exportWidth: 1080,
      exportHeight: 1920,
      scale: 2.5,
      fps: 30,
      safeAreas: {
        board: {
          left: 50,
          top: TAPTILE_REFERENCE_BOARD_TOP_PX,
          right: 1030,
          bottom: 1830,
          width: 980,
          height: 1830 - TAPTILE_REFERENCE_BOARD_TOP_PX,
        },
        tray: { ...TAPTILE_REFERENCE_TRAY_BOUNDS },
      },
    },
    assets: {
      entries: {
        ...createDefaultTapTileAudioAssets(),
        ...createDefaultTapTilePresentationAssets(),
        'classic-tile-surface-v1': {
          id: 'classic-tile-surface-v1',
          kind: 'image',
          source: { type: 'builtin', uri: '/assets/taptile/classic-tile-surface-v1.png' },
          width: 512,
          height: 512,
          hasAlpha: false,
          contentHash: 'f09b96ebfd4206b359d59be9364802b55b2d58cc3f559694a54d6731a6a34509',
          version: '1',
        },
      },
    },
    visuals: {
      archetypes,
      faceAssemblies,
      bodyStyles: makeBodyStyles(source.material),
      themes: {
        'animals-v1': { id: 'animals-v1', name: '动物乐园', bindings: animalBindings },
        'food-v1': { id: 'food-v1', name: '缤纷食物', bindings: foodBindings },
      },
      selectedThemeId: 'animals-v1',
      stageAssemblies: {
        [source.theme]: [
          { id: `${source.theme}-base`, role: 'base', color: source.theme === 'sunset' ? '#7c3655' : source.theme === 'candy' ? '#7855a7' : source.theme === 'forest' ? '#245c50' : '#16557a', opacity: 1 },
          { id: `${source.theme}-hud`, role: 'hud', opacity: 1 },
          { id: `${source.theme}-tray`, role: 'tray', opacity: 1 },
        ],
      },
      selectedStageAssemblyId: source.theme,
    },
    level: {
      id: stableHash(projectIdentity, 'level'),
      name: `${source.name} · 关卡`,
      tileInstances: source.tiles.map((tile, order) => {
        const point = authoringToExportPoint({ x: tile.x, y: tile.y });
        const sizePx = Math.round(STACK_STAGE.tileSize * tile.scale * TAPTILE_EXPORT_SCALE);
        return {
          id: tile.id,
          archetypeId: `archetype-${slug(tile.faceId)}`,
          geometry: {
            centerXPx: point.x,
            centerYPx: point.y,
            widthPx: sizePx,
            heightPx: sizePx,
            rotationDeg: tile.rotation,
            layer: tile.layer,
            order,
          },
          authoring: { editorLocked: tile.locked },
        };
      }),
      blockerPolicy: {
        minimumOverlapAreaPx: 900,
        minimumOverlapRatio: 0.04,
        epsilonPx: 0.001,
      },
      blockerOverrides: { forced: [], ignored: [] },
    },
    takes: [],
    director: {
      selectedProfileId: 'human-natural',
      profiles: structuredClone(DEFAULT_DIRECTOR_PROFILES),
      actionOverrides: {},
      seed: 240811,
    },
    render: { width: 1080, height: 1920, fps: 30, quality: 'standard' },
    authoring: {
      templateId: source.templateId,
      material: source.material,
      sceneTheme: source.theme,
      snap: source.snap,
      snapGapPx: source.snapGapPx ?? 0,
      showLayerBadges: source.showLayerBadges,
      debugView: 'normal',
    },
    production: createDefaultTapTileProductionSpec(),
  };
  return ensureChainComboFaceTheme(migrated);
}
