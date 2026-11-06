import {
  encodeBase64Bytes,
  inspectImageBytes,
  sha256Hex,
} from '../nativeReference/agent-assets/image';
import { resolveEmbeddedAssets } from './embeddedAssets';
import { updateBBWorkPackageProject, type BBWorkPackage } from './bbWorkPackage';
import { hasReferenceCalibration } from './hasReferenceCalibration';
import { pruneSupersededAssets } from './pruneSupersededAssets';

type Slot = 'background.base' | 'tile.face' | 'board.atlas';
/** Update one image role; unsupported renderer/role combinations fail explicitly. */
export async function setNativeWorkImage(
  work: BBWorkPackage,
  slot: Slot,
  file: Pick<File, 'name' | 'size' | 'arrayBuffer'>,
  decoder?: (blob: Blob) => Promise<{ width: number; height: number }>,
): Promise<BBWorkPackage> {
  if (!['background.base', 'tile.face', 'board.atlas'].includes(slot))
    throw new Error(`不支持的图片槽：${slot}`);
  if (file.size < 1 || file.size > 8 * 1024 * 1024) throw new Error('图片为空或超过 8 MiB。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size) throw new Error('图片字节数不一致。');
  let image;
  try {
    image = inspectImageBytes(bytes);
  } catch (error) {
    throw new Error(
      `图片损坏或格式不支持：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!['image/png', 'image/jpeg'].includes(image.mimeType))
    throw new Error('图片只支持 PNG 或 JPEG。');
  if (image.width > 4096 || image.height > 4096 || image.width * image.height > 16777216)
    throw new Error('图片尺寸超过限制。');
  const doc = structuredClone(work.project) as any,
    style = doc?.direction?.style;
  if (!style) throw new Error('作品缺少样式。');
  const ext = style.agentAssets ?? { version: '1.0.0', entries: {}, bindings: {} };
  if (
    ext.version !== '1.0.0' ||
    !ext.entries ||
    !ext.bindings ||
    Object.keys(ext).some((k) => !['version', 'entries', 'bindings'].includes(k))
  )
    throw new Error('素材扩展无法安全编辑。');
  const previousId = ext.bindings[slot]?.assetId;
  const sha256 = await sha256Hex(bytes),
    id = `work-${slot.replace('.', '-')}-${sha256.slice(0, 16)}`;
  if (ext.entries[id] && ext.entries[id].sha256 !== sha256)
    throw new Error('素材标识冲突，不能覆盖现有条目。');
  if (!ext.entries[id])
    ext.entries[id] = {
      id,
      kind: 'image',
      sourceName: file.name,
      mimeType: image.mimeType,
      encoding: 'base64',
      data: encodeBase64Bytes(bytes),
      sha256,
      width: image.width,
      height: image.height,
      byteLength: bytes.length,
    };
  ext.bindings[slot] = {
    fit: 'cover',
    opacity: 1,
    blendMode: 'source-over',
    inset: slot === 'background.base' ? 0 : 0.06,
    ...(ext.bindings[slot] ?? {}),
    slotId: slot,
    assetId: id,
    role:
      slot === 'background.base'
        ? 'background-image'
        : slot === 'tile.face'
          ? 'tile-face-image'
          : 'board-atlas-image',
  };
  style.agentAssets = ext;
  if (typeof previousId === 'string' && previousId !== id) pruneSupersededAssets(doc, [previousId]);
  await resolveEmbeddedAssets(doc, decoder);
  if (hasReferenceCalibration(doc)) {
    const { inlineBrowserStudioReferences } = await import('./browserAssetReferences');
    const { prepareCalibratedRenderer } = await import('./calibratedRenderer');
    const resolved = (await inlineBrowserStudioReferences(doc, {})).document as any;
    for (const take of resolved.takes)
      if (take.actions.length) prepareCalibratedRenderer(resolved, take.takeId);
  }
  return updateBBWorkPackageProject(work, doc);
}
