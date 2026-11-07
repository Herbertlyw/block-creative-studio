import type {
  AssetManifest,
  AssetRef,
  CreativeMaster,
  EffectPackManifest,
  LookPackManifest,
  MaterialPackManifest,
  VariantRecipe,
} from '../src/headless/contracts';

const renderer = 'fixed-camera-cinematic' as const;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

export function ref(id: string, kind: AssetRef['kind'], character = 'a'): AssetRef {
  return { id, version: '1.0.0', kind, contentHash: hash(character) };
}

function generic(
  id: string,
  kind: AssetManifest['kind'],
  character: string,
  budget?: { textureMemoryMiB?: number; triangleCount?: number; pluginMemoryMiB?: number },
  metadata?: Record<string, unknown>,
): AssetManifest {
  return {
    contract: 'bcs.asset-manifest',
    contractVersion: '1.0.0',
    id,
    version: '1.0.0',
    kind,
    origin: 'builtin',
    contentHash: hash(character),
    runtime: {
      renderers: [renderer],
      deterministic: true,
      ...(budget !== undefined ? { budget } : {}),
    },
    ...(metadata !== undefined ? { metadata } : {}),
  } as AssetManifest;
}

export function makeFixture(options: { effectMaterialClass?: 'metal' | 'wood' | '*'; plugin?: boolean } = {}) {
  const material: MaterialPackManifest = {
    contract: 'bcs.asset-manifest',
    contractVersion: '1.0.0',
    id: 'material.copper',
    version: '1.0.0',
    kind: 'material-pack',
    origin: 'generated',
    contentHash: hash('b'),
    runtime: {
      renderers: [renderer],
      deterministic: true,
      budget: { textureMemoryMiB: 24, triangleCount: 0 },
    },
    appearance: {
      baseColor: '#b76e45',
      roughness: 0.31,
      metalness: 0.88,
      clearcoat: 0.12,
      normalStrength: 0.24,
    },
    behavior: {
      materialClass: 'metal',
      density: 0.82,
      brittleness: 0.34,
      ductility: 0.58,
      elasticity: 0.08,
      hardness: 0.73,
      fractureMode: 'chips',
      largeFragmentRatio: 0.65,
      dustAmount: 0.05,
      sparkAmount: 0.36,
      dropletAmount: 0,
      gravityScale: 1.1,
      drag: 0.12,
    },
  };

  const effect: EffectPackManifest = {
    contract: 'bcs.asset-manifest',
    contractVersion: '1.0.0',
    id: 'effect.copper-clear',
    version: '1.0.0',
    kind: 'effect-pack',
    origin: 'generated',
    contentHash: hash('c'),
    runtime: {
      renderers: [renderer],
      deterministic: true,
      budget: { textureMemoryMiB: 18, triangleCount: 12000 },
    },
    supportedEvents: ['line-clear', 'cross-clear', 'combo', 'all-clear'],
    compatibleMaterialClasses: [options.effectMaterialClass ?? 'metal'],
    layers: [
      { id: 'sweep', role: 'energy', implementation: 'shader', required: true },
      { id: 'response', role: 'material-response', implementation: 'shader', required: true },
      { id: 'fragments', role: 'large-fragments', implementation: 'geometry', required: true },
    ],
  };

  const assets: AssetManifest[] = [
    generic('layout.vertical', 'ui-theme', 'd', undefined, {
      designResolution: { width: 1080, height: 1920 },
    }),
    generic('camera.fixed', 'camera-profile', 'e', undefined, { designResolution: { width: 1080, height: 1920 }, boardScreenRect: { x: 78, y: 332, width: 924, height: 924 }, allowOrbit: false, allowTransformAnimation: false, maximumScreenZoom: 1.025, maximumScreenTranslationPx: 8, maximumScreenRotationDegrees: 0.2 }),
    generic('background.dark', 'background', 'f', { textureMemoryMiB: 8 }),
    generic('board.dark', 'board-skin', '1', { textureMemoryMiB: 12, triangleCount: 16000 }),
    material,
    generic('preview.default', 'animation-asset', '2'),
    generic('placement.default', 'animation-asset', '3'),
    effect,
    generic('clear.exit', 'animation-asset', '4'),
    generic('hud.score', 'ui-theme', '5'),
    generic('endgame.default', 'ui-theme', '6'),
  ];

  if (options.plugin) {
    assets.push({
      contract: 'bcs.asset-manifest',
      contractVersion: '1.0.0',
      id: 'plugin.unsafe',
      version: '1.0.0',
      kind: 'plugin-package',
      origin: 'generated',
      contentHash: hash('7'),
      runtime: {
        renderers: [renderer],
        deterministic: true,
        budget: { pluginMemoryMiB: 32 },
      },
      apiVersion: '1',
      executionRuntime: 'node-worker',
      entry: 'index.js',
      inputSchemaRef: 'input.schema.json',
      outputSchemaRef: 'output.schema.json',
      timeoutMs: 1000,
      permissions: ['network'],
    });
  }

  const slots: LookPackManifest['slots'] = {
    'background.base': ref('background.dark', 'background', 'f'),
    'board.skin': ref('board.dark', 'board-skin', '1'),
    'tile.material': ref('material.copper', 'material-pack', 'b'),
    'interaction.preview': ref('preview.default', 'animation-asset', '2'),
    'placement.confirmation': ref('placement.default', 'animation-asset', '3'),
    'clear.primary': ref('effect.copper-clear', 'effect-pack', 'c'),
    'clear.tile-exit': ref('clear.exit', 'animation-asset', '4'),
    'hud.current-score': ref('hud.score', 'ui-theme', '5'),
    'endgame.presentation': ref('endgame.default', 'ui-theme', '6'),
  };
  if (options.plugin) slots['clear.secondary'] = ref('plugin.unsafe', 'plugin-package', '7');

  const look: LookPackManifest = {
    contract: 'bcs.asset-manifest',
    contractVersion: '1.0.0',
    id: 'look.copper',
    version: '1.0.0',
    kind: 'look-pack',
    origin: 'generated',
    contentHash: hash('8'),
    runtime: { renderers: [renderer], deterministic: true },
    slots,
  };
  assets.push(look);

  const master: CreativeMaster = {
    contract: 'bcs.creative-master',
    contractVersion: '1.0.0',
    id: 'master.demo',
    ruleProfile: 'block-placement-classic-v1',
    board: { rows: 8, cols: 8 },
    replay: {
      takeId: 'take.demo',
      semanticHash: 'sha256:semantic',
      frameHash: 'sha256:frame',
      fps: 30,
      totalFrames: 450,
    },
    layoutProfileRef: ref('layout.vertical', 'ui-theme', 'd'),
    cameraProfileRef: ref('camera.fixed', 'camera-profile', 'e'),
    baseOutput: { width: 1080, height: 1920, fps: 30, quality: 'cinematic' },
  };

  const recipe: VariantRecipe = {
    contract: 'bcs.variant-recipe',
    contractVersion: '1.0.0',
    id: 'variant.copper',
    masterId: master.id,
    lockMode: 'frame-exact',
    lookPackRef: ref('look.copper', 'look-pack', '8'),
    seed: 20260902,
  };

  return { assets, material, effect, look, master, recipe };
}
