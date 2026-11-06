import type {
  RuntimeImageAssetBinding,
  RuntimeImageBlendMode,
  RuntimeImageFit,
} from '../nativeReference/assets/runtimeAssetBindings';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : null;
export type EmbeddedBackgroundErrorCode =
  | 'asset-missing'
  | 'hash-mismatch'
  | 'image-corrupt'
  | 'metadata-mismatch'
  | 'unresolved-ref'
  | 'format-unsupported'
  | 'slot-unsupported'
  | 'unsupported';
export class EmbeddedBackgroundError extends Error {
  constructor(
    readonly code: EmbeddedBackgroundErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EmbeddedBackgroundError';
  }
}
function fail(code: EmbeddedBackgroundErrorCode, message: string): never {
  throw new EmbeddedBackgroundError(code, message);
}

export async function decodeImage(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }
  if (typeof Image === 'undefined') throw new Error('图片解码器不可用');
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Resolve only the documented inline PNG background slot. It never changes the project. */
export async function resolveEmbeddedBackground(
  document: unknown,
  imageDecoder: (blob: Blob) => Promise<{ width: number; height: number }> = decodeImage,
): Promise<RuntimeImageAssetBinding | null> {
  const style = object(object(object(document)?.direction)?.style),
    extension = object(style?.agentAssets);
  if (style?.agentAssets === undefined) return null;
  if (!extension || (extension.version !== '1.0.0' && extension.version !== 1))
    fail('unsupported', '工程素材扩展格式或版本不支持。');
  if (Object.keys(extension).some((key) => !['version', 'entries', 'bindings'].includes(key)))
    fail('unsupported', '工程素材扩展包含未支持字段，未进行替换。');
  const entries = object(extension.entries),
    bindings = object(extension.bindings);
  if (!entries || !bindings) fail('unsupported', '工程素材条目或绑定表格式无效。');
  const unsupported = Object.keys(bindings).find((slot) => slot !== 'background.base');
  if (unsupported) fail('unsupported', `素材槽 ${unsupported} 尚未接入，未静默替换。`);
  if (!Object.hasOwn(bindings, 'background.base')) return null;
  const binding = object(bindings['background.base']);
  if (
    !binding ||
    binding.slotId !== 'background.base' ||
    binding.role !== 'background-image' ||
    typeof binding.assetId !== 'string' ||
    !binding.assetId
  )
    fail('unsupported', 'background.base 绑定无效或角色不支持。');
  if (
    Object.keys(binding).some(
      (key) => !['slotId', 'assetId', 'role', 'fit', 'opacity', 'blendMode', 'inset'].includes(key),
    )
  )
    fail('unsupported', '背景绑定包含尚未支持的变换或扩展。');
  if (
    !['cover', 'contain', 'stretch'].includes(String(binding.fit)) ||
    !['source-over', 'multiply', 'screen', 'overlay', 'soft-light'].includes(
      String(binding.blendMode),
    ) ||
    typeof binding.opacity !== 'number' ||
    !Number.isFinite(binding.opacity) ||
    binding.opacity < 0 ||
    binding.opacity > 1 ||
    binding.inset !== 0
  )
    fail('unsupported', '背景绑定的适配、混合、透明度或 inset 不受支持。');
  const entry = object(entries[binding.assetId]);
  if (!entry) fail('asset-missing', `背景素材缺失：${binding.assetId}。`);
  if (
    entry.id !== binding.assetId ||
    entry.kind !== 'image' ||
    entry.mimeType !== 'image/png' ||
    entry.encoding !== 'base64'
  )
    fail('unsupported', `背景素材 ${binding.assetId} 不是受支持的内嵌 PNG。`);
  if (
    Object.keys(entry).some(
      (key) =>
        ![
          'id',
          'kind',
          'sourceName',
          'mimeType',
          'encoding',
          'data',
          'sha256',
          'width',
          'height',
          'byteLength',
          'provenance',
        ].includes(key),
    )
  )
    fail('unsupported', `背景素材 ${binding.assetId} 含未支持字段。`);
  if (
    typeof entry.data !== 'string' ||
    entry.data.length > 28_000_000 ||
    entry.data.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.data)
  )
    fail('image-corrupt', `背景素材 ${binding.assetId} 的 Base64 数据损坏。`);
  if (
    typeof entry.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    typeof entry.sourceName !== 'string' ||
    !entry.sourceName ||
    entry.sourceName.length > 240 ||
    !Number.isInteger(entry.byteLength) ||
    !Number.isInteger(entry.width) ||
    !Number.isInteger(entry.height) ||
    Number(entry.byteLength) < 1 ||
    Number(entry.width) < 1 ||
    Number(entry.height) < 1
  )
    fail('metadata-mismatch', `背景素材 ${binding.assetId} 的声明元数据无效。`);
  if (
    Number(entry.byteLength) > 8 * 1024 * 1024 ||
    Number(entry.width) > 8192 ||
    Number(entry.height) > 8192 ||
    Number(entry.width) * Number(entry.height) > 16_777_216
  )
    fail('unsupported', `背景素材 ${binding.assetId} 超出参考工作台的尺寸或字节预算。`);
  let bytes: Uint8Array;
  try {
    const raw = atob(entry.data);
    if (btoa(raw) !== entry.data) throw new Error('noncanonical');
    bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  } catch {
    return fail('image-corrupt', `背景素材 ${binding.assetId} 的 Base64 数据损坏。`);
  }
  if (bytes.length !== entry.byteLength)
    fail('metadata-mismatch', `背景素材 ${binding.assetId} 的字节数不符。`);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 24 ||
    signature.some((value, index) => bytes[index] !== value) ||
    String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR'
  )
    fail('image-corrupt', `背景素材 ${binding.assetId} 的 PNG 格式损坏。`);
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(8) !== 13)
    fail('image-corrupt', `背景素材 ${binding.assetId} 的 PNG 头部损坏。`);
  if (header.getUint32(16) !== entry.width || header.getUint32(20) !== entry.height)
    fail('metadata-mismatch', `背景素材 ${binding.assetId} 的 PNG 尺寸与声明不符。`);
  if (!globalThis.crypto?.subtle) fail('unsupported', '当前环境无法验证素材 SHA-256。');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const actual = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (actual !== entry.sha256)
    fail('hash-mismatch', `背景素材 ${binding.assetId} 的 SHA-256 不一致。`);
  const blob = new Blob([bytes], { type: 'image/png' });
  let dimensions: { width: number; height: number };
  try {
    dimensions = await imageDecoder(blob);
  } catch {
    return fail('image-corrupt', `背景素材 ${binding.assetId} 的 PNG 解码失败。`);
  }
  if (dimensions.width !== entry.width || dimensions.height !== entry.height)
    fail('metadata-mismatch', `背景素材 ${binding.assetId} 的图片尺寸与声明不符。`);
  return {
    slotId: 'background.base',
    role: 'background-image',
    contentHash: `sha256:${actual}`,
    sourceUri: `embedded:${binding.assetId}`,
    objectUrl: `data:image/png;base64,${entry.data}`,
    fileName: entry.sourceName,
    mimeType: 'image/png',
    width: dimensions.width,
    height: dimensions.height,
    fit: binding.fit as RuntimeImageFit,
    opacity: binding.opacity,
    blendMode: binding.blendMode as RuntimeImageBlendMode,
    inset: binding.inset,
  };
}
