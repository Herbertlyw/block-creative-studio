import type {
  AssetManifest,
  AssetRef,
  EffectPackManifest,
  HeadlessRendererId,
  LookPackManifest,
  MaterialBehaviorProfile,
  MaterialClass,
  MaterialPackManifest,
  ResolvedRenderPlan,
} from '../headless/contracts';
import { AssetRegistry } from '../headless/assetRegistry';
import { BcsHeadlessError } from '../headless/errors';
import {
  bitmapManifestFromTextureRef,
  materialMapsPublicBase,
  materialRuntimeFromPlan,
  rewriteMaterialMapUriForBrowser,
} from '../headless/materialRuntime';
import { stableHash } from '../headless/stableHash';
import { validateAssetManifest } from '../headless/validation';
import type { ProjectSpec, StyleSpec } from '../domain/types';
import { BLOCK_MATERIAL_OPTICS } from '../renderer/materialProfiles';
import { defaultMaterialBehavior } from '../renderer/materialFracture';
import {
  attachShotExecutionToStyle,
  shotDrivesCameraPixels,
  shotDrivesLayoutPixels,
} from '../renderer/planShotAdapter';
import {
  DEFAULT_REFERENCE_2D_STYLE,
  DEFAULT_STYLE,
  GEOMETRY_PRESETS,
} from '../renderer/stylePresets';

const CONTRACT_VERSION = '1.0.0' as const;
const ASSET_VERSION = '1.0.0';
const ALL_RENDERERS: HeadlessRendererId[] = [
  'reference-2d',
  'three-3d',
  'fixed-camera-cinematic',
];

export const PROJECT_CURRENT_LOOK_KEY = 'project-current';

type StudioStylePatch = Omit<Partial<StyleSpec>, 'reference2d' | 'geometry'> & {
  reference2d?: Partial<StyleSpec['reference2d']>;
  geometry?: Partial<StyleSpec['geometry']>;
};

interface StudioManifestMetadata extends Record<string, unknown> {
  studio?: {
    description?: string;
    previewSupported?: boolean;
    style?: StyleSpec;
    stylePatch?: StudioStylePatch;
  };
}

export interface StudioLookOption {
  key: string;
  ref: AssetRef;
  label: string;
  description: string;
  previewSupported: boolean;
  origin: AssetManifest['origin'];
}

export interface StudioAssetCatalog {
  assets: AssetManifest[];
  registry: AssetRegistry;
  lookOptions: StudioLookOption[];
  currentLookRef: AssetRef;
  layoutProfileRef: AssetRef;
  cameraProfileRef: AssetRef;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function keyOf(ref: Pick<AssetRef, 'id' | 'version'>): string {
  return `${ref.id}@${ref.version}`;
}

function refOf(manifest: AssetManifest): AssetRef {
  return {
    id: manifest.id,
    version: manifest.version,
    kind: manifest.kind,
    ...(manifest.contentHash ? { contentHash: manifest.contentHash } : {}),
  };
}

function withHash<T extends AssetManifest>(manifest: Omit<T, 'contentHash'>): T {
  const contentHash = stableHash(manifest);
  return { ...manifest, contentHash } as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function styleMetadata(
  style?: StyleSpec,
  stylePatch?: StudioStylePatch,
  description?: string,
): StudioManifestMetadata {
  return {
    studio: {
      previewSupported: true,
      ...(description ? { description } : {}),
      ...(style ? { style: clone(style) } : {}),
      ...(stylePatch ? { stylePatch: clone(stylePatch) } : {}),
    },
  };
}

function genericManifest(
  id: string,
  kind: Exclude<AssetManifest['kind'], 'material-pack' | 'effect-pack' | 'look-pack' | 'plugin-package'>,
  label: string,
  metadata: StudioManifestMetadata,
  budget?: { textureMemoryMiB?: number; triangleCount?: number; pluginMemoryMiB?: number },
): AssetManifest {
  return withHash({
    contract: 'bcs.asset-manifest',
    contractVersion: CONTRACT_VERSION,
    id,
    version: ASSET_VERSION,
    kind,
    origin: id.startsWith('project.') ? 'project' : 'builtin',
    label,
    runtime: {
      renderers: [...ALL_RENDERERS],
      deterministic: true,
      ...(budget ? { budget } : {}),
    },
    metadata,
  } as AssetManifest);
}

function materialBehavior(materialClass: MaterialClass): MaterialBehaviorProfile {
  return defaultMaterialBehavior(materialClass);
}

function materialManifest(prefix: string, style: StyleSpec): MaterialPackManifest {
  const isReference = style.renderer === 'reference-2d';
  const id = isReference
    ? `${prefix}.material.${style.reference2d.tileMaterial}`
    : `${prefix}.material.${style.material}`;
  const materialClass: MaterialClass = isReference
    ? 'plastic'
    : style.material === 'crystal-glass'
      ? 'glass'
      : style.material === 'candy-resin'
        ? 'jelly'
        : 'plastic';

  const optics = isReference ? null : BLOCK_MATERIAL_OPTICS[style.material];
  const appearance = isReference
    ? style.reference2d.tileMaterial === 'flat-matte'
      ? { baseColor: '#d7e4ff', roughness: 0.84, metalness: 0.02, specular: 0.28 }
      : { baseColor: '#d7e4ff', roughness: 0.42, metalness: 0.03, specular: 0.48, clearcoat: 0.18 }
    : {
        baseColor: style.material === 'crystal-glass'
          ? '#d9efff'
          : style.material === 'candy-resin'
            ? '#e4dcff'
            : '#e8edff',
        roughness: optics!.roughness,
        metalness: optics!.metalness,
        specular: style.material === 'crystal-glass' ? 0.78 : style.material === 'candy-resin' ? 0.62 : 0.5,
        clearcoat: optics!.clearcoat,
        transmission: optics!.transmission,
        ior: optics!.ior,
        thickness: optics!.thickness,
        normalStrength: style.material === 'crystal-glass' ? 0.18 : style.material === 'candy-resin' ? 0.12 : 0.08,
        emission: optics!.emissiveScale,
      };


  return withHash({
    contract: 'bcs.asset-manifest',
    contractVersion: CONTRACT_VERSION,
    id,
    version: ASSET_VERSION,
    kind: 'material-pack',
    origin: prefix.startsWith('project.') ? 'project' : 'builtin',
    label: isReference ? `2D ${style.reference2d.tileMaterial}` : style.material,
    runtime: {
      renderers: [...ALL_RENDERERS],
      deterministic: true,
      budget: {
        textureMemoryMiB: isReference ? 4 : style.material === 'crystal-glass' ? 28 : 16,
        triangleCount: 0,
      },
    },
    metadata: styleMetadata(
      undefined,
      isReference
        ? { reference2d: { tileMaterial: style.reference2d.tileMaterial } }
        : { material: style.material },
    ),
    appearance,
    behavior: materialBehavior(materialClass),
  });
}

function clearEffectManifest(prefix: string, style: StyleSpec): EffectPackManifest {
  const isReference = style.renderer === 'reference-2d';
  const id = isReference
    ? `${prefix}.effect.${style.reference2d.clearFx}`
    : `${prefix}.effect.${style.fx}`;
  const layers: EffectPackManifest['layers'] = isReference
    ? [
        { id: 'line-sweep', role: 'energy', implementation: 'recipe', required: true },
        { id: 'tile-fade', role: 'tile-exit', implementation: 'recipe', required: true },
        ...(style.reference2d.clearFx === 'sweep-score-spark'
          ? [{ id: 'score-spark', role: 'particles' as const, implementation: 'sprite' as const, required: false }]
          : []),
      ]
    : [
        { id: 'energy-sweep', role: 'energy', implementation: 'shader', required: true },
        { id: 'material-flash', role: 'material-response', implementation: 'shader', required: true },
        { id: 'tile-fragments', role: 'large-fragments', implementation: 'geometry', required: true },
        { id: 'tile-exit', role: 'tile-exit', implementation: 'recipe', required: true },
        { id: 'secondary-particles', role: 'particles', implementation: 'sprite', required: false },
      ];

  return withHash({
    contract: 'bcs.asset-manifest',
    contractVersion: CONTRACT_VERSION,
    id,
    version: ASSET_VERSION,
    kind: 'effect-pack',
    origin: prefix.startsWith('project.') ? 'project' : 'builtin',
    label: isReference ? style.reference2d.clearFx : style.fx,
    runtime: {
      renderers: [...ALL_RENDERERS],
      deterministic: true,
      budget: {
        textureMemoryMiB: isReference ? 6 : 18,
        triangleCount: isReference ? 0 : style.fx === 'clean-pop' ? 8_000 : 24_000,
      },
    },
    metadata: styleMetadata(
      undefined,
      isReference
        ? { reference2d: { clearFx: style.reference2d.clearFx } }
        : { fx: style.fx },
    ),
    supportedEvents: ['line-clear', 'cross-clear', 'combo', 'all-clear'],
    compatibleMaterialClasses: ['*'],
    layers,
  });
}

function scaleReferenceBoardRect(output: ProjectSpec['render']): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const source = { width: 1064, height: 1788 };
  const sourceRect = { x: 80, y: 309, width: 912, height: 912 };
  const scale = Math.min(output.width / source.width, output.height / source.height);
  const offsetX = (output.width - source.width * scale) / 2;
  const offsetY = (output.height - source.height * scale) / 2;
  return {
    x: Math.round(offsetX + sourceRect.x * scale),
    y: Math.round(offsetY + sourceRect.y * scale),
    width: Math.round(sourceRect.width * scale),
    height: Math.round(sourceRect.height * scale),
  };
}

function styleAssets(
  style: StyleSpec,
  prefix: string,
  label: string,
  description: string,
  output: ProjectSpec['render'],
): { assets: AssetManifest[]; look: LookPackManifest; layoutRef: AssetRef; cameraRef: AssetRef } {
  const renderer = style.renderer;
  const layout = genericManifest(
    `${prefix}.layout`,
    'ui-theme',
    `${label} layout`,
    styleMetadata(undefined, undefined, 'Fixed vertical layout contract.'),
  );
  const boardRect = renderer === 'reference-2d'
    ? scaleReferenceBoardRect(output)
    : {
        x: Math.round(output.width * 0.05),
        y: Math.round(output.height * 0.16),
        width: Math.round(output.width * 0.9),
        height: Math.round(output.width * 0.9),
      };
  const camera = genericManifest(
    `${prefix}.camera`,
    'camera-profile',
    `${label} camera`,
    {
      designResolution: { width: output.width, height: output.height },
      boardScreenRect: boardRect,
      allowOrbit: false,
      allowTransformAnimation: false,
      maximumScreenZoom: 1.025,
      maximumScreenTranslationPx: 8,
      maximumScreenRotationDegrees: 0.25,
      ...styleMetadata(
        undefined,
        { renderer, camera: style.camera },
        'Fixed camera profile; Web UI scales the preview without changing composition.',
      ),
    },
  );
  const background = genericManifest(
    `${prefix}.background`,
    'background',
    `${label} background`,
    styleMetadata(undefined, { background: style.background }),
    { textureMemoryMiB: 8 },
  );
  const board = genericManifest(
    `${prefix}.board`,
    'board-skin',
    `${label} board`,
    styleMetadata(undefined, undefined),
    { textureMemoryMiB: renderer === 'reference-2d' ? 4 : 12, triangleCount: renderer === 'reference-2d' ? 0 : 16_000 },
  );
  const material = materialManifest(prefix, style);
  const tileFace = genericManifest(
    `${prefix}.tile-face.${style.reference2d.tileFaceSet}`,
    'tile-face',
    `${label} tile face`,
    styleMetadata(undefined, { reference2d: { tileFaceSet: style.reference2d.tileFaceSet } }),
    { textureMemoryMiB: style.reference2d.tileFaceSet === 'none' ? 0 : 4 },
  );
  const geometry = genericManifest(
    `${prefix}.geometry.${style.geometry.id}`,
    'geometry-3d',
    `${label} geometry`,
    styleMetadata(undefined, { geometry: clone(style.geometry) }),
    { triangleCount: renderer === 'reference-2d' ? 0 : 12_000 },
  );
  const preview = genericManifest(
    `${prefix}.preview.${style.reference2d.previewFx}`,
    'animation-asset',
    `${label} placement preview`,
    styleMetadata(undefined, { reference2d: { previewFx: style.reference2d.previewFx } }),
  );
  const placement = genericManifest(
    `${prefix}.placement`,
    'animation-asset',
    `${label} placement confirmation`,
    styleMetadata(undefined, undefined),
  );
  const clear = clearEffectManifest(prefix, style);
  const tileExit = genericManifest(
    `${prefix}.tile-exit`,
    'animation-asset',
    `${label} tile exit`,
    styleMetadata(undefined, undefined),
  );
  const hud = genericManifest(
    `${prefix}.hud`,
    'ui-theme',
    `${label} HUD`,
    styleMetadata(undefined, { reference2d: { bestScore: style.reference2d.bestScore } }),
  );
  const feedback = genericManifest(
    `${prefix}.feedback.${style.reference2d.feedbackFx}`,
    'ui-theme',
    `${label} feedback`,
    styleMetadata(undefined, { reference2d: { feedbackFx: style.reference2d.feedbackFx } }),
  );
  const ambient = genericManifest(
    `${prefix}.ambient.${style.reference2d.ambientFx}`,
    'animation-asset',
    `${label} ambient`,
    styleMetadata(undefined, { reference2d: { ambientFx: style.reference2d.ambientFx } }),
    { textureMemoryMiB: style.reference2d.ambientFx === 'none' ? 0 : 4 },
  );
  const lighting = genericManifest(
    `${prefix}.lighting.${style.lighting}`,
    'animation-asset',
    `${label} lighting`,
    styleMetadata(undefined, { lighting: style.lighting }),
  );
  const pointer = genericManifest(
    `${prefix}.pointer`,
    'ui-theme',
    `${label} pointer`,
    styleMetadata(undefined, { showPointer: style.showPointer }),
  );
  const endgame = genericManifest(
    `${prefix}.endgame`,
    'ui-theme',
    `${label} endgame`,
    styleMetadata(undefined, undefined),
  );

  const slots: LookPackManifest['slots'] = {
    'background.base': refOf(background),
    'board.skin': refOf(board),
    'tile.material': refOf(material),
    'tile.face': refOf(tileFace),
    'tile.geometry': refOf(geometry),
    'interaction.preview': refOf(preview),
    'interaction.pointer': refOf(pointer),
    'placement.confirmation': refOf(placement),
    'clear.primary': refOf(clear),
    'clear.tile-exit': refOf(tileExit),
    'hud.current-score': refOf(hud),
    'feedback.praise': refOf(feedback),
    'feedback.combo': refOf(feedback),
    'background.reaction': refOf(ambient),
    'lighting.rig': refOf(lighting),
    'endgame.presentation': refOf(endgame),
  };

  const look = withHash<LookPackManifest>({
    contract: 'bcs.asset-manifest',
    contractVersion: CONTRACT_VERSION,
    id: `${prefix}.look`,
    version: ASSET_VERSION,
    kind: 'look-pack',
    origin: prefix.startsWith('project.') ? 'project' : 'builtin',
    label,
    runtime: {
      renderers: [...ALL_RENDERERS],
      deterministic: true,
    },
    metadata: styleMetadata(style, undefined, description),
    slots,
  } as Omit<LookPackManifest, 'contentHash'>);

  return {
    assets: [
      layout,
      camera,
      background,
      board,
      material,
      tileFace,
      geometry,
      preview,
      placement,
      clear,
      tileExit,
      hud,
      feedback,
      ambient,
      lighting,
      pointer,
      endgame,
      look,
    ],
    look,
    layoutRef: refOf(layout),
    cameraRef: refOf(camera),
  };
}

function referenceStyle(patch: Partial<StyleSpec['reference2d']>): StyleSpec {
  return {
    ...clone(DEFAULT_STYLE),
    renderer: 'reference-2d',
    reference2d: {
      ...clone(DEFAULT_REFERENCE_2D_STYLE),
      ...patch,
    },
  };
}

function threeStyle(patch: Partial<StyleSpec>): StyleSpec {
  return {
    ...clone(DEFAULT_STYLE),
    renderer: 'three-3d',
    ...patch,
    reference2d: clone(DEFAULT_REFERENCE_2D_STYLE),
    geometry: patch.geometry ? clone(patch.geometry) : clone(GEOMETRY_PRESETS['premium-beveled']),
  };
}

function readStudioMetadata(manifest: AssetManifest): StudioManifestMetadata['studio'] | null {
  const metadata = manifest.metadata;
  if (!isRecord(metadata) || !isRecord(metadata.studio)) return null;
  return metadata.studio as StudioManifestMetadata['studio'];
}

export function isLookPreviewSupported(manifest: AssetManifest): boolean {
  if (manifest.kind !== 'look-pack') return false;
  return readStudioMetadata(manifest)?.previewSupported === true;
}

function browserMaterialMapsBase(): string {
  return materialMapsPublicBase(import.meta.env.BASE_URL);
}

export function rendererConsumesMaterialRuntime(renderer: StyleSpec['renderer']): boolean {
  return renderer === 'three-3d' || renderer === 'fixed-camera-cinematic';
}

export function overlayPlanMaterialOnStyle(
  fallback: StyleSpec,
  runtime: StyleSpec['materialRuntime'],
): StyleSpec {
  if (!runtime) return fallback;
  const materialBehavior = defaultMaterialBehavior(runtime.materialClass);
  if (rendererConsumesMaterialRuntime(fallback.renderer)) {
    return { ...fallback, materialRuntime: runtime, materialBehavior };
  }
  return { ...fallback, renderer: 'fixed-camera-cinematic', materialRuntime: runtime, materialBehavior };
}

function attachMaterialRuntimeFromPlan(style: StyleSpec, plan: ResolvedRenderPlan): void {
  const slot = plan.slots['tile.material'];
  if (!slot || slot.manifest.kind !== 'material-pack') return;
  const pack = slot.manifest as MaterialPackManifest;
  style.materialRuntime = materialRuntimeFromPlan(plan, {
    rewriteUri: (uri) => rewriteMaterialMapUriForBrowser(uri, browserMaterialMapsBase()),
  });
  style.materialBehavior = clone(pack.behavior);
}

function attachPlanExecution(style: StyleSpec, plan: ResolvedRenderPlan): void {
  attachMaterialRuntimeFromPlan(style, plan);
  attachShotExecutionToStyle(style, plan);
}

function applySlotStylePatches(style: StyleSpec, plan: ResolvedRenderPlan): void {
  for (const asset of Object.values(plan.slots)) {
    const patch = readStudioMetadata(asset.manifest)?.stylePatch;
    if (!patch) continue;
    const reference2d = patch.reference2d
      ? { ...style.reference2d, ...patch.reference2d }
      : style.reference2d;
    const geometry = patch.geometry
      ? { ...style.geometry, ...patch.geometry }
      : style.geometry;
    Object.assign(style, patch);
    style.reference2d = reference2d;
    style.geometry = geometry;
  }
}

export interface PlanRenderEvidence {
  planHash: string;
  renderer: ResolvedRenderPlan['renderer'];
  materialId: string;
  validatedEffectId: string;
  renderedFxPreset: StyleSpec['fx'];
  effectDrivesPixels: boolean;
  validatedCameraId: string;
  renderedCameraProfile: string;
  cameraDrivesPixels: boolean;
  validatedLayoutId: string;
  renderedLayoutProfile: string;
  layoutDrivesPixels: boolean;
}

export function planRenderEvidence(plan: ResolvedRenderPlan, style: StyleSpec): PlanRenderEvidence {
  const effectManifest = plan.slots['clear.primary']?.manifest;
  const effectId = effectManifest?.id ?? '';
  const fxPatch = effectManifest ? readStudioMetadata(effectManifest)?.stylePatch?.fx : undefined;
  const cameraId = plan.cameraProfile.manifest.id;
  const layoutId = plan.layoutProfile.manifest.id;
  const effectDrivesPixels = Boolean(fxPatch) && style.fx === fxPatch && rendererConsumesMaterialRuntime(style.renderer);
  const cameraDrivesPixels = shotDrivesCameraPixels(plan, style);
  const layoutDrivesPixels = shotDrivesLayoutPixels(plan, style);
  const shot = style.shotExecution;
  return {
    planHash: plan.planHash,
    renderer: plan.renderer,
    materialId: plan.slots['tile.material']?.manifest.id ?? '',
    validatedEffectId: effectId,
    renderedFxPreset: style.fx,
    effectDrivesPixels,
    validatedCameraId: cameraId,
    renderedCameraProfile: cameraDrivesPixels
      ? cameraId
      : style.renderer === 'fixed-camera-cinematic'
        ? 'block-garden-fixed-shot-v1'
        : style.camera,
    cameraDrivesPixels,
    validatedLayoutId: layoutId,
    renderedLayoutProfile: layoutDrivesPixels && shot?.layoutDesignResolution
      ? `${shot.layoutDesignResolution.width}x${shot.layoutDesignResolution.height}`
      : style.renderer === 'fixed-camera-cinematic' ? 'design-1080x1920' : 'unbound',
    layoutDrivesPixels,
  };
}

export function resolveStyleFromRenderPlan(
  plan: ResolvedRenderPlan,
  fallback: StyleSpec,
): { style: StyleSpec; previewSupported: boolean } {
  const studio = readStudioMetadata(plan.lookPack.manifest);
  if (!studio?.previewSupported || !studio.style) {
    let style = clone(fallback);
    attachPlanExecution(style, plan);
    if (style.materialRuntime && !rendererConsumesMaterialRuntime(style.renderer)) {
      style = { ...style, renderer: 'fixed-camera-cinematic' };
    }
    applySlotStylePatches(style, plan);
    attachShotExecutionToStyle(style, plan);
    return { style, previewSupported: false };
  }

  const style = clone(studio.style);
  applySlotStylePatches(style, plan);
  attachPlanExecution(style, plan);
  return { style, previewSupported: true };
}

export function createStudioAssetCatalog(
  project: ProjectSpec,
  importedAssets: AssetManifest[] = [],
): StudioAssetCatalog {
  const definitions = [
    styleAssets(
      project.style,
      `project.current.${stableHash({ style: project.style, render: project.render }).slice(-8)}`,
      '当前工程 Look',
      '由当前网页工作台参数即时编译，任何原子调整都会生成新的不可变 Plan Hash。',
      project.render,
    ),
    styleAssets(
      referenceStyle({}),
      'builtin.reference-garden',
      '参考花园 · 完整',
      '用于逐帧参考校准的完整 2D 风格。',
      project.render,
    ),
    styleAssets(
      referenceStyle({
        tileMaterial: 'flat-matte',
        tileFaceSet: 'none',
        previewFx: 'cells-only',
        clearFx: 'sweep-only',
        feedbackFx: 'score-only',
        ambientFx: 'none',
      }),
      'builtin.reference-clean',
      '参考 2D · 清洁',
      '减少牌面和装饰层，方便检查玩法、布局与时序。',
      project.render,
    ),
    styleAssets(
      threeStyle({
        material: 'candy-resin',
        lighting: 'soft-candy',
        camera: 'premium-perspective',
        fx: 'crystal-shatter',
        geometry: clone(GEOMETRY_PRESETS['premium-beveled']),
        background: '#07142d',
      }),
      'builtin.three-candy',
      '固定机位 3D · 糖果',
      '现有 Three.js 体积化实验的可复现 Look Pack。',
      project.render,
    ),
    styleAssets(
      threeStyle({
        material: 'crystal-glass',
        lighting: 'neon-contrast',
        camera: 'dynamic-clear',
        fx: 'energy-burst',
        geometry: clone(GEOMETRY_PRESETS['candy-rounded']),
        background: '#061124',
      }),
      'builtin.three-crystal',
      '固定机位 3D · 水晶',
      '用于验证材质、镜头和清除原子独立替换的内置样例。',
      project.render,
    ),
  ];

  const assetMap = new Map<string, AssetManifest>();
  for (const definition of definitions) {
    for (const asset of definition.assets) {
      const key = keyOf(asset);
      const existing = assetMap.get(key);
      if (existing && existing.contentHash !== asset.contentHash) {
        throw new Error(`Built-in asset collision: ${key}`);
      }
      assetMap.set(key, asset);
    }
  }
  for (const asset of importedAssets) {
    const issues = validateAssetManifest(asset).filter((candidate) => candidate.severity === 'error');
    if (issues.length) {
      const first = issues[0]!;
      throw new BcsHeadlessError('IMPORTED_ASSET_INVALID', first.message, {
        ...(first.path ? { path: first.path } : {}),
        details: issues,
      });
    }
    const key = keyOf(asset);
    const existing = assetMap.get(key);
    if (existing && existing.contentHash !== asset.contentHash) {
      throw new BcsHeadlessError(
        'IMPORTED_ASSET_CONFLICT',
        `Imported asset ${key} conflicts with an existing immutable version.`,
        { path: '$.id' },
      );
    }
    assetMap.set(key, clone(asset));
  }

  for (const asset of [...assetMap.values()]) {
    if (asset.kind !== 'material-pack') continue;
    for (const ref of Object.values(asset.appearance.textureRefs ?? {})) {
      if (!ref?.uri || !ref.contentHash) continue;
      const bitmap = bitmapManifestFromTextureRef(ref);
      const bitmapKey = keyOf(bitmap);
      if (!assetMap.has(bitmapKey)) assetMap.set(bitmapKey, bitmap);
    }
  }

  const current = definitions[0]!;
  const assets = [...assetMap.values()];
  const registry = new AssetRegistry(assets);
  const lookOptions = assets
    .filter((asset): asset is LookPackManifest => asset.kind === 'look-pack')
    .map((asset) => {
      const studio = readStudioMetadata(asset);
      return {
        key: asset.id === current.look.id ? PROJECT_CURRENT_LOOK_KEY : keyOf(asset),
        ref: refOf(asset),
        label: asset.label ?? asset.id,
        description: studio?.description ?? '外部 Look Pack；可编译，但当前 Web 预览可能没有绑定。',
        previewSupported: studio?.previewSupported === true,
        origin: asset.origin,
      };
    })
    .sort((left, right) => {
      if (left.key === PROJECT_CURRENT_LOOK_KEY) return -1;
      if (right.key === PROJECT_CURRENT_LOOK_KEY) return 1;
      return left.label.localeCompare(right.label, 'zh-Hans-CN');
    });

  return {
    assets,
    registry,
    lookOptions,
    currentLookRef: refOf(current.look),
    layoutProfileRef: current.layoutRef,
    cameraProfileRef: current.cameraRef,
  };
}

export function parseImportedAssetBundle(value: unknown): AssetManifest[] {
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.assets)
      ? value.assets
      : [value];
  return candidates.map((candidate, index) => {
    const issues = validateAssetManifest(candidate).filter((issue) => issue.severity === 'error');
    if (issues.length) {
      const first = issues[0]!;
      throw new BcsHeadlessError('IMPORTED_ASSET_INVALID', first.message, {
        path: first.path ?? `assets[${index}]`,
        details: issues,
      });
    }
    return clone(candidate as AssetManifest);
  });
}

export function styleForLookOption(
  catalog: StudioAssetCatalog,
  key: string,
  fallback: StyleSpec,
): { style: StyleSpec; previewSupported: boolean } {
  const option = catalog.lookOptions.find((candidate) => candidate.key === key);
  if (!option) return { style: clone(fallback), previewSupported: false };
  const manifest = catalog.registry.resolve(option.ref);
  const studio = readStudioMetadata(manifest);
  if (!studio?.previewSupported || !studio.style) {
    return { style: clone(fallback), previewSupported: false };
  }
  return { style: clone(studio.style), previewSupported: true };
}
