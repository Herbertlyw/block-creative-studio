import type {
  AssetManifest,
  AssetRef,
  HeadlessRendererId,
  LookPackManifest,
  ResolvedRenderPlan,
  VariantLockMode,
  VariantRecipe,
} from '../headless/contracts';
import { stableHash } from '../headless/stableHash';
import type { BrowserAssetMetadata } from './browserAssetStore';
import { DEFAULT_GLB_INSPECTION_LIMITS, inspectGlbArrayBuffer } from './glbInspector';
import type {
  BrowserAssetBindingRole,
  BrowserAssetManifestMetadata,
  RuntimeImageBlendMode,
  RuntimeImageFit,
} from './runtimeAssetBindings';

const CONTRACT_VERSION = '1.0.0' as const;
const ASSET_VERSION = '1.0.0';
const MAX_RUNTIME_IMAGE_EDGE = 8192;
const MAX_RUNTIME_IMAGE_PIXELS = 32 * 1024 * 1024;

export type BrowserAssetImportRole = BrowserAssetBindingRole;

export interface BrowserAssetImportOption {
  id: BrowserAssetImportRole;
  label: string;
  description: string;
  slotId: string;
  accept: string;
  previewRenderers: HeadlessRendererId[];
}

export const BROWSER_ASSET_IMPORT_OPTIONS: BrowserAssetImportOption[] = [
  {
    id: 'background-image',
    label: '背景图片',
    description: 'PNG / JPEG / WebP / AVIF。立即绑定到 background.base。',
    slotId: 'background.base',
    accept: 'image/png,image/jpeg,image/webp,image/avif,.png,.jpg,.jpeg,.webp,.avif',
    previewRenderers: ['reference-2d', 'three-3d'],
  },
  {
    id: 'tile-face-image',
    label: '牌面贴图',
    description: '透明 PNG / WebP / AVIF。与方块材质保持独立；SVG 待安全净化器接入后开放。',
    slotId: 'tile.face',
    accept: 'image/png,image/webp,image/avif,.png,.webp,.avif',
    previewRenderers: ['reference-2d'],
  },
  {
    id: 'particle-sprite',
    label: '粒子 Sprite',
    description: '保存并进入 clear.secondary；网页预览适配将在后续 Pass 中扩展。',
    slotId: 'clear.secondary',
    accept: 'image/png,image/webp,image/avif,.png,.webp,.avif',
    previewRenderers: [],
  },
  {
    id: 'flipbook',
    label: 'Flipbook / 透明片段',
    description: '保存为动画资产，供固定机位影视渲染器或外部 Renderer 使用。',
    slotId: 'clear.secondary',
    accept: 'image/png,image/webp,video/webm,video/mp4,.png,.webp,.webm,.mp4',
    previewRenderers: [],
  },
  {
    id: 'audio',
    label: '音效',
    description: 'WAV / MP3 / OGG / FLAC。保存到 audio.pack，不自动混入当前无声导出。',
    slotId: 'audio.pack',
    accept: 'audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac',
    previewRenderers: [],
  },
  {
    id: 'geometry-3d',
    label: 'GLB / glTF',
    description: '单文件 GLB 几何资产。保存到 tile.geometry，等待对应 Renderer Adapter。',
    slotId: 'tile.geometry',
    accept: 'model/gltf-binary,.glb',
    previewRenderers: [],
  },
  {
    id: 'texture-map',
    label: '材质纹理图',
    description: '保存为独立纹理资产；通常由外部 Agent 再写 Material Pack 引用。',
    slotId: 'tile.material.texture',
    accept: 'image/png,image/jpeg,image/webp,image/avif,.png,.jpg,.jpeg,.webp,.avif',
    previewRenderers: ['fixed-camera-cinematic', 'three-3d'],
  },
];

export interface CreateBrowserAssetManifestOptions {
  role: BrowserAssetImportRole;
  label?: string;
  fit?: RuntimeImageFit;
  opacity?: number;
  blendMode?: RuntimeImageBlendMode;
  inset?: number;
}

export interface AuthoredBrowserVariant {
  asset: AssetManifest;
  look: LookPackManifest;
  recipe: VariantRecipe;
  slotId: string;
  previewSupported: boolean;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function slug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .toLowerCase();
  return normalized || 'asset';
}

function fileStem(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index > 0 ? fileName.slice(0, index) : fileName;
}

function roleOption(role: BrowserAssetImportRole): BrowserAssetImportOption {
  const option = BROWSER_ASSET_IMPORT_OPTIONS.find((candidate) => candidate.id === role);
  if (!option) throw new Error(`Unsupported browser asset role: ${role}`);
  return option;
}

function rendererSupport(role: BrowserAssetImportRole): HeadlessRendererId[] {
  switch (role) {
    case 'background-image':
      return ['reference-2d', 'three-3d', 'fixed-camera-cinematic'];
    case 'tile-face-image':
      return ['reference-2d', 'fixed-camera-cinematic'];
    case 'geometry-3d':
      return ['three-3d', 'fixed-camera-cinematic'];
    case 'particle-sprite':
    case 'flipbook':
    case 'texture-map':
      return ['fixed-camera-cinematic', 'three-3d'];
    case 'audio':
      return ['reference-2d', 'three-3d', 'fixed-camera-cinematic'];
  }
}

function assetKind(role: BrowserAssetImportRole): AssetManifest['kind'] {
  switch (role) {
    case 'background-image': return 'background';
    case 'tile-face-image': return 'tile-face';
    case 'particle-sprite': return 'bitmap';
    case 'flipbook': return 'animation-asset';
    case 'audio': return 'audio';
    case 'geometry-3d': return 'geometry-3d';
    case 'texture-map': return 'bitmap';
  }
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

function isImageRole(role: BrowserAssetImportRole): boolean {
  return role === 'background-image'
    || role === 'tile-face-image'
    || role === 'particle-sprite'
    || role === 'texture-map';
}

function isSvgFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type.toLowerCase() === 'image/svg+xml' || extensionOf(file.name) === 'svg';
}

async function inspectRuntimeImageFile(file: File): Promise<void> {
  if (typeof createImageBitmap !== 'function') return;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('图片无法解码，或格式不受当前 Chrome 支持。');
  }
  try {
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      throw new Error('图片尺寸无效。');
    }
    if (bitmap.width > MAX_RUNTIME_IMAGE_EDGE || bitmap.height > MAX_RUNTIME_IMAGE_EDGE) {
      throw new Error(`图片边长不能超过 ${MAX_RUNTIME_IMAGE_EDGE}px。`);
    }
    if (bitmap.width * bitmap.height > MAX_RUNTIME_IMAGE_PIXELS) {
      throw new Error(`图片总像素不能超过 ${MAX_RUNTIME_IMAGE_PIXELS.toLocaleString()}。`);
    }
  } finally {
    bitmap.close();
  }
}

async function validateGlbFile(file: File): Promise<void> {
  if (file.size > DEFAULT_GLB_INSPECTION_LIMITS.maximumBytes) {
    throw new Error(`GLB 文件不能超过 ${Math.round(DEFAULT_GLB_INSPECTION_LIMITS.maximumBytes / 1024 / 1024)} MiB。`);
  }
  inspectGlbArrayBuffer(await file.arrayBuffer());
}

/**
 * Browser-side preflight before a Blob enters the content-addressed store.
 * The store itself remains format-neutral; this check enforces the selected
 * semantic role and rejects active/vector formats until a sanitizer exists.
 */
export async function validateBrowserAssetFile(
  file: File,
  role: BrowserAssetImportRole,
): Promise<void> {
  if (file.size <= 0) throw new Error('不能导入空文件。');
  if (isImageRole(role)) {
    if (isSvgFile(file)) {
      throw new Error('Browser Asset Store v1 暂不接受 SVG；请先栅格化为 PNG、WebP 或 AVIF。');
    }
    await inspectRuntimeImageFile(file);
    return;
  }
  if (role === 'geometry-3d') {
    if (extensionOf(file.name) !== 'glb') throw new Error('3D 几何槽 v1 只接受自包含的 .glb 文件。');
    await validateGlbFile(file);
    return;
  }
  if (role === 'flipbook' && isSvgFile(file)) {
    throw new Error('Flipbook v1 不接受 SVG。');
  }
}

function validateRoleMedia(role: BrowserAssetImportRole, metadata: BrowserAssetMetadata): void {
  const media = metadata.mediaClass;
  const extension = extensionOf(metadata.fileName);
  if (isImageRole(role) && (metadata.mimeType === 'image/svg+xml' || extension === 'svg')) {
    throw new Error('Browser Asset Store v1 暂不接受 SVG；请先栅格化为 PNG、WebP 或 AVIF。');
  }
  if (isImageRole(role) && metadata.width !== undefined && metadata.height !== undefined) {
    if (metadata.width > MAX_RUNTIME_IMAGE_EDGE || metadata.height > MAX_RUNTIME_IMAGE_EDGE) {
      throw new Error(`图片边长不能超过 ${MAX_RUNTIME_IMAGE_EDGE}px。`);
    }
    if (metadata.width * metadata.height > MAX_RUNTIME_IMAGE_PIXELS) {
      throw new Error(`图片总像素不能超过 ${MAX_RUNTIME_IMAGE_PIXELS.toLocaleString()}。`);
    }
  }
  if (
    (role === 'background-image'
      || role === 'tile-face-image'
      || role === 'particle-sprite'
      || role === 'texture-map')
    && media !== 'image'
  ) {
    throw new Error(`${roleOption(role).label} 只接受图片文件。`);
  }
  if (role === 'audio' && media !== 'audio') throw new Error('音效槽只接受音频文件。');
  if (role === 'geometry-3d' && (media !== 'model' || !metadata.fileName.toLowerCase().endsWith('.glb'))) {
    throw new Error('3D 几何槽 v1 只接受自包含的 .glb 文件。');
  }
  if (role === 'flipbook' && media !== 'image' && media !== 'video') {
    throw new Error('Flipbook 槽只接受图片或视频。');
  }
}

function textureBudgetMiB(metadata: BrowserAssetMetadata): number {
  if (metadata.width && metadata.height) {
    return Math.max(1, Math.ceil((metadata.width * metadata.height * 4 * 4 / 3) / 1024 / 1024));
  }
  if (metadata.mediaClass === 'image' || metadata.mediaClass === 'video') {
    return Math.max(1, Math.ceil(metadata.byteLength / 1024 / 1024));
  }
  return 0;
}

export function createBrowserAssetManifest(
  metadata: BrowserAssetMetadata,
  options: CreateBrowserAssetManifestOptions,
): AssetManifest {
  validateRoleMedia(options.role, metadata);
  const role = roleOption(options.role);
  const digest = metadata.contentHash.slice(-12);
  const id = `uploaded.${slug(options.role)}.${slug(fileStem(metadata.fileName))}.${digest}`;
  const browserAsset: BrowserAssetManifestMetadata['browserAsset'] = {
    role: options.role,
    uri: metadata.uri,
    fileName: metadata.fileName,
    mimeType: metadata.mimeType,
    byteLength: metadata.byteLength,
    ...(metadata.width !== undefined ? { width: metadata.width } : {}),
    ...(metadata.height !== undefined ? { height: metadata.height } : {}),
    ...(options.fit ? { fit: options.fit } : {}),
    ...(options.opacity !== undefined ? { opacity: options.opacity } : {}),
    ...(options.blendMode ? { blendMode: options.blendMode } : {}),
    ...(options.inset !== undefined ? { inset: options.inset } : {}),
  };
  return {
    contract: 'bcs.asset-manifest',
    contractVersion: CONTRACT_VERSION,
    id,
    version: ASSET_VERSION,
    kind: assetKind(options.role),
    origin: 'uploaded',
    label: options.label?.trim() || metadata.fileName,
    contentHash: metadata.contentHash,
    uri: metadata.uri,
    runtime: {
      renderers: rendererSupport(options.role),
      deterministic: true,
      budget: {
        ...(textureBudgetMiB(metadata) > 0 ? { textureMemoryMiB: textureBudgetMiB(metadata) } : {}),
        ...(options.role === 'geometry-3d' ? { triangleCount: 0 } : {}),
      },
    },
    provenance: {
      createdBy: 'human',
      sourceUris: [metadata.uri],
    },
    metadata: {
      browserAsset,
      studio: {
        previewBinding: options.role,
        previewSupportedRenderers: role.previewRenderers,
        description: role.description,
      },
    },
  } as AssetManifest;
}

function refOf(manifest: AssetManifest): AssetRef {
  return {
    id: manifest.id,
    version: manifest.version,
    kind: manifest.kind,
    ...(manifest.contentHash ? { contentHash: manifest.contentHash } : {}),
  };
}

function resolvedSlotRefs(plan: ResolvedRenderPlan): Record<string, AssetRef> {
  return Object.fromEntries(
    Object.entries(plan.slots).map(([slotId, resolved]) => [slotId, clone(resolved.ref)]),
  );
}

export function createBrowserAssetVariant(input: {
  plan: ResolvedRenderPlan;
  masterId: string;
  lockMode: VariantLockMode;
  seed: number;
  asset: AssetManifest;
  role: BrowserAssetImportRole;
}): AuthoredBrowserVariant {
  const option = roleOption(input.role);
  const slotId = option.slotId;
  const slots = resolvedSlotRefs(input.plan);
  slots[slotId] = refOf(input.asset);

  const baseLook = input.plan.lookPack.manifest.kind === 'look-pack'
    ? input.plan.lookPack.manifest as LookPackManifest
    : null;
  const baseMetadata = baseLook?.metadata ? clone(baseLook.metadata) : {};
  const baseStudio = isRecord(baseMetadata.studio) ? baseMetadata.studio : {};
  const previewSupported = option.previewRenderers.includes(input.plan.renderer)
    && isRecord(baseStudio.style);
  const identity = {
    basePlan: input.plan.planHash,
    slotId,
    asset: refOf(input.asset),
  };
  const suffix = stableHash(identity).slice(-8);
  const lookWithoutHash: Omit<LookPackManifest, 'contentHash'> = {
    contract: 'bcs.asset-manifest',
    contractVersion: CONTRACT_VERSION,
    id: `uploaded.look.${slug(input.role)}.${suffix}`,
    version: ASSET_VERSION,
    kind: 'look-pack',
    origin: 'uploaded',
    label: `${input.asset.label ?? input.asset.id} · ${option.label}`,
    runtime: {
      renderers: [input.plan.renderer],
      deterministic: true,
    },
    metadata: {
      ...baseMetadata,
      studio: {
        ...baseStudio,
        previewSupported,
        description: `${option.label} · ${input.asset.label ?? input.asset.id}`,
      },
      browserDerivedLook: {
        basePlanHash: input.plan.planHash,
        replacementSlot: slotId,
        replacementAsset: refOf(input.asset),
      },
    },
    slots,
  };
  const look: LookPackManifest = {
    ...lookWithoutHash,
    contentHash: stableHash(lookWithoutHash),
  };
  const recipe: VariantRecipe = {
    contract: 'bcs.variant-recipe',
    contractVersion: CONTRACT_VERSION,
    id: `uploaded.variant.${slug(input.role)}.${suffix}`,
    masterId: input.masterId,
    lockMode: input.lockMode,
    lookPackRef: refOf(look),
    seed: input.seed,
  };
  return {
    asset: input.asset,
    look,
    recipe,
    slotId,
    previewSupported,
  };
}

export function browserAssetImportOption(role: BrowserAssetImportRole): BrowserAssetImportOption {
  return roleOption(role);
}
