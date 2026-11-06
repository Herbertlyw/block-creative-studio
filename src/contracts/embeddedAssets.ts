import { blockPlacementAgentAssetDeclaration } from '../nativeReference/games/block-placement/agent/assetBindings';
import {
  readAgentAssetExtension,
  verifyAgentAssetBindings,
  createRuntimeAgentAssetBindings,
} from '../nativeReference/agent-assets/storage';
import { parseAgentAssetRef } from '../nativeReference/agent-assets/refs';
import { encodeBase64Bytes, sha256Hex } from '../nativeReference/agent-assets/image';
import type { StudioProjectDocumentV2 } from '../nativeReference/game-runtime/projectEnvelope';
import type {
  RuntimeAssetBindings,
  RuntimeImageAssetBinding,
} from '../nativeReference/assets/runtimeAssetBindings';
import {
  EmbeddedBackgroundError,
  decodeImage,
  type EmbeddedBackgroundErrorCode,
} from './embeddedBackground';

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
export function hasLocalImageReferences(value: unknown): boolean {
  const ext = record(record(record(record(value)?.direction)?.style)?.agentAssets);
  return Object.values(record(ext?.entries) ?? {}).some(
    (item) => record(item)?.kind === 'image' && record(item)?.encoding === 'ref',
  );
}
function explain(error: unknown): EmbeddedBackgroundError {
  if (error instanceof EmbeddedBackgroundError) return error;
  const message = error instanceof Error ? error.message : String(error);
  let code: EmbeddedBackgroundErrorCode = 'unsupported';
  let label = '工程素材不支持或配置无效';
  if (message.includes('AGENT_ASSET_BINDING_ASSET_UNKNOWN')) {
    code = 'asset-missing';
    label = '绑定素材缺失';
  } else if (message.includes('SHA256_MISMATCH')) {
    code = 'hash-mismatch';
    label = '素材 SHA-256 不一致';
  } else if (message.includes('MIME_UNSUPPORTED')) {
    code = 'format-unsupported';
    label = '素材图片格式不支持，仅接受 PNG 或 JPEG';
  } else if (message.includes('SLOT_UNSUPPORTED')) {
    code = 'slot-unsupported';
    label = '未知或不支持的素材槽位';
  } else if (/BASE64_INVALID|PNG_|JPEG_|IMAGE_FORMAT/.test(message)) {
    code = 'image-corrupt';
    label = '素材图片损坏或内容与声明格式不符';
  } else if (message.includes('DERIVED_METADATA_MISMATCH')) {
    code = 'metadata-mismatch';
    label = '素材字节数、类型或尺寸不一致';
  } else if (message.includes('UNRESOLVED_REF')) label = '外部素材引用尚未解析';
  else if (message.includes('KIND_UNSUPPORTED')) label = '素材槽或素材类型尚未接入';
  return new EmbeddedBackgroundError(code, `${label}：${message}`);
}

/** Verify declared BB slots with the supplied reference parser; never modifies the source document. */
export async function resolveEmbeddedAssets(
  value: unknown,
  decoder: (blob: Blob) => Promise<{ width: number; height: number }> = decodeImage,
  localFiles: readonly Blob[] = [],
): Promise<RuntimeAssetBindings> {
  try {
    let doc = value as StudioProjectDocumentV2;
    const raw = record(record(record(value)?.direction)?.style)?.agentAssets;
    if (raw !== undefined) {
      const entries = record(record(raw)?.entries);
      // Reject oversized inline payloads before the reference parser allocates decoded bytes.
      for (const entry of Object.values(entries ?? {})) {
        const candidate = record(entry);
        if (
          typeof candidate?.data === 'string' &&
          candidate.data.length > Math.ceil((8 * 1024 * 1024) / 3) * 4
        )
          throw new Error('AGENT_ASSET_IMAGE_BUDGET_EXCEEDED');
        if (
          Array.isArray(candidate?.frames) &&
          candidate.frames.some(
            (frame) =>
              typeof record(frame)?.data === 'string' &&
              String(record(frame)?.data).length > Math.ceil((8 * 1024 * 1024) / 3) * 4,
          )
        )
          throw new Error('AGENT_SEQUENCE_FRAME_BUDGET_EXCEEDED');
      }
    }
    const initial = readAgentAssetExtension(doc);
    const refs = Object.values(initial.entries).filter(
      (asset) => asset.kind === 'image' && asset.encoding === 'ref',
    );
    const sourceRefs = new Map<string, string>();
    if (refs.length) {
      if (localFiles.length > 64)
        throw new EmbeddedBackgroundError('unsupported', '所选本地素材超过 64 个。');
      const available = new Map<string, Uint8Array>();
      for (const file of localFiles) {
        if (file.size < 1 || file.size > 8 * 1024 * 1024)
          throw new EmbeddedBackgroundError('unsupported', '本地图片必须为 8 MiB 以内的非空文件。');
        const bytes = new Uint8Array(await file.arrayBuffer());
        available.set(await sha256Hex(bytes), bytes);
      }
      doc = structuredClone(doc);
      const style = record(record(doc.direction)?.style)!;
      const entries = record(record(style.agentAssets)?.entries)!;
      for (const asset of refs) {
        if (asset.encoding !== 'ref' || asset.kind !== 'image') continue;
        const ref = parseAgentAssetRef(asset.ref);
        if (ref.sha256 && ref.sha256 !== asset.sha256)
          throw new EmbeddedBackgroundError(
            'hash-mismatch',
            `外部引用 ${asset.id} 的固定哈希与素材声明不一致。`,
          );
        const bytes = available.get(asset.sha256);
        if (!bytes)
          throw new EmbeddedBackgroundError(
            localFiles.length ? 'hash-mismatch' : 'unresolved-ref',
            `外部素材 ${asset.id}（${asset.ref}）${localFiles.length ? '没有匹配声明哈希的所选文件' : '尚未选择本地文件'}。`,
          );
        if (bytes.byteLength !== asset.byteLength)
          throw new EmbeddedBackgroundError(
            'metadata-mismatch',
            `外部素材 ${asset.id} 的字节数不一致。`,
          );
        const original = record(entries[asset.id])!;
        const inline: JsonRecord = {
          ...original,
          encoding: 'base64',
          data: encodeBase64Bytes(bytes),
        };
        delete inline.ref;
        entries[asset.id] = inline;
        sourceRefs.set(asset.id, asset.ref!);
      }
    }
    const extension = readAgentAssetExtension(doc);
    await verifyAgentAssetBindings(doc, blockPlacementAgentAssetDeclaration);
    const result = createRuntimeAgentAssetBindings(doc, blockPlacementAgentAssetDeclaration);
    const verified = new Set<string>();
    for (const item of Object.values(result.bySlot).flat() as RuntimeImageAssetBinding[]) {
      const assetId = item.sourceUri.slice('embedded:'.length),
        asset = extension.entries[assetId];
      if (verified.has(item.sourceUri)) {
        const ref = sourceRefs.get(assetId);
        if (ref) item.sourceUri = `local-ref:${ref}`;
        continue;
      }
      if (!asset || asset.kind !== 'image' || asset.encoding !== 'base64')
        throw new Error(`AGENT_ASSET_UNRESOLVED_REF: ${assetId}`);
      const rawBytes = atob(asset.data),
        bytes = Uint8Array.from(rawBytes, (char) => char.charCodeAt(0));
      let dimensions: { width: number; height: number };
      try {
        dimensions = await decoder(new Blob([bytes], { type: asset.mimeType }));
      } catch {
        throw new EmbeddedBackgroundError('image-corrupt', `素材图片解码失败：${assetId}`);
      }
      if (dimensions.width !== asset.width || dimensions.height !== asset.height)
        throw new EmbeddedBackgroundError(
          'metadata-mismatch',
          `素材图片尺寸与声明不一致：${assetId}`,
        );
      verified.add(item.sourceUri);
      const ref = sourceRefs.get(assetId);
      if (ref) item.sourceUri = `local-ref:${ref}`;
    }
    return result;
  } catch (error) {
    throw explain(error);
  }
}
