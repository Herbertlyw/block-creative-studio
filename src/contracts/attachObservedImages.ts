import {
  encodeBase64Bytes,
  inspectImageBytes,
  sha256Hex,
} from '../nativeReference/agent-assets/image';
import { inlineBrowserStudioReferences } from './browserAssetReferences';
import { prepareCalibratedRenderer } from './calibratedRenderer';

type InputFile = Pick<File, 'name' | 'size' | 'arrayBuffer'>;
type ImageDecoder = (bytes: Uint8Array) => Promise<{ width: number; height: number }>;
async function decodeInBrowser(bytes: Uint8Array) {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }));
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** Bind the supplied renderer's static PNG slots, without replacing existing assets. */
export async function attachObservedImages(
  document: unknown,
  files: { background?: InputFile; tile?: InputFile },
  decode: ImageDecoder = decodeInBrowser,
) {
  const copy = structuredClone(document) as any,
    style = copy?.direction?.style,
    cal = style?.referenceCalibration;
  if (
    !cal ||
    style.agentAssets ||
    cal.sprites ||
    cal.appearance ||
    cal.tileMaterial ||
    cal.tileColors ||
    cal.backdrop
  )
    throw new Error('已有素材或自定义校准外观不能通过此入口覆盖；原工程保留。');
  if (!files.background && !files.tile) throw new Error('请至少选择一张 PNG 图片。');
  const entries: Record<string, unknown> = {},
    sprites: Record<string, string> = {};
  for (const [role, file] of [
    ['background', files.background],
    ['tile', files.tile],
  ] as const) {
    if (!file) continue;
    if (file.size < 1 || file.size > 2 * 1024 * 1024)
      throw new Error(`${role} 图片为空或超过 2 MiB。`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== file.size) throw new Error(`${role} 图片字节数不一致。`);
    let image;
    try {
      image = inspectImageBytes(bytes);
    } catch (e) {
      throw new Error(
        `${role} 图片损坏或格式不支持：${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (image.mimeType !== 'image/png') throw new Error(`${role} 仅支持 PNG。`);
    if (image.width > 4096 || image.height > 4096 || image.width * image.height > 16777216)
      throw new Error(`${role} 图片尺寸超过限制。`);
    let decoded;
    try {
      decoded = await decode(bytes);
    } catch {
      throw new Error(`${role} PNG 无法解码。`);
    }
    if (decoded.width !== image.width || decoded.height !== image.height)
      throw new Error(`${role} PNG 解码尺寸不一致。`);
    const id = `observed-${role}`;
    entries[id] = {
      id,
      kind: 'image',
      sourceName: file.name,
      mimeType: 'image/png',
      encoding: 'base64',
      data: encodeBase64Bytes(bytes),
      sha256: await sha256Hex(bytes),
      width: image.width,
      height: image.height,
      byteLength: bytes.length,
    };
    if (role === 'background') sprites.background = `asset:${id}`;
    else
      for (const key of [
        'tilePink',
        'tilePurple',
        'tileBlue',
        'tileWhite',
        'tileCoral',
        'tileCyan',
      ])
        sprites[key] = `asset:${id}`;
  }
  style.agentAssets = { version: '1.0.0', entries, bindings: {} };
  cal.sprites = sprites;
  const resolved = await inlineBrowserStudioReferences(copy, {});
  prepareCalibratedRenderer(resolved.document, copy.takes?.[0]?.takeId);
  return { document: copy, entries };
}

/** Only the exact two-slot observed image layout can be replaced without disturbing other assets. */
export async function copyObservedImageVariant(
  document: unknown,
  files: { background: InputFile; tile: InputFile },
  decode: ImageDecoder = decodeInBrowser,
) {
  const original = document as any,
    style = original?.direction?.style,
    cal = style?.referenceCalibration,
    assets = style?.agentAssets;
  const expected: Record<string, string> = { background: 'asset:observed-background' };
  for (const key of ['tilePink', 'tilePurple', 'tileBlue', 'tileWhite', 'tileCoral', 'tileCyan'])
    expected[key] = 'asset:observed-tile';
  if (
    !cal ||
    !assets ||
    Object.keys(assets.entries ?? {})
      .sort()
      .join(',') !== 'observed-background,observed-tile' ||
    Object.keys(assets.bindings ?? {}).length ||
    Object.keys(cal.sprites ?? {})
      .sort()
      .join(',') !== Object.keys(expected).sort().join(',') ||
    Object.entries(expected).some(([k, v]) => cal.sprites[k] !== v)
  )
    throw new Error('仅支持本入口的背景与统一方块图片变体；原工程保留。');
  await inlineBrowserStudioReferences(original, {});
  const clone = structuredClone(original);
  delete clone.direction.style.agentAssets;
  delete clone.direction.style.referenceCalibration.sprites;
  return attachObservedImages(clone, files, decode);
}

/** The frozen grey renderer distinguishes coral and cyan; its other game colors share tileWhite. */
export async function attachObservedGroupedImages(
  document: unknown,
  files: { background?: InputFile; white: InputFile; coral: InputFile; cyan: InputFile },
  decode: ImageDecoder = decodeInBrowser,
) {
  const source = document as any;
  if (source?.direction?.style?.referenceCalibration?.theme !== 'grey')
    throw new Error('分槽图片仅支持灰色校准主题：coral、cyan 和其他颜色共用的 white。');
  if (!files.white || !files.coral || !files.cyan)
    throw new Error('必须提供 white、coral、cyan 三张图片；其他颜色共享 white，不能静默替代。');
  const base = await attachObservedImages(
    document,
    { ...(files.background ? { background: files.background } : {}), tile: files.white },
    decode,
  );
  const style = base.document.direction.style,
    entries = style.agentAssets.entries,
    white = entries['observed-tile'];
  delete entries['observed-tile'];
  white.id = 'observed-white';
  entries['observed-white'] = white;
  const sprites: Record<string, string> = {
    ...(files.background ? { background: 'asset:observed-background' } : {}),
    tileWhite: 'asset:observed-white',
  };
  for (const role of ['coral', 'cyan'] as const) {
    const next = await attachObservedImages(document, { tile: files[role] }, decode);
    const entry = next.document.direction.style.agentAssets.entries['observed-tile'];
    entry.id = `observed-${role}`;
    entries[entry.id] = entry;
    sprites[role === 'coral' ? 'tileCoral' : 'tileCyan'] = `asset:${entry.id}`;
  }
  style.referenceCalibration.sprites = sprites;
  const resolved = await inlineBrowserStudioReferences(base.document, {});
  prepareCalibratedRenderer(resolved.document, base.document.takes[0].takeId);
  return { document: base.document, entries };
}
/** Replace one explicitly grouped slot, leaving all unrelated resources byte-for-byte intact. */
export async function copyObservedGroupedVariant(
  document: unknown,
  role: 'background' | 'white' | 'coral' | 'cyan',
  file: InputFile,
  decode: ImageDecoder = decodeInBrowser,
) {
  const source = document as any,
    style = source?.direction?.style,
    cal = style?.referenceCalibration,
    entries = style?.agentAssets?.entries;
  const expected: Record<string, string> = {
    tileWhite: 'asset:observed-white',
    tileCoral: 'asset:observed-coral',
    tileCyan: 'asset:observed-cyan',
  };
  if (
    cal?.theme !== 'grey' ||
    !entries ||
    !['white', 'coral', 'cyan', 'background'].includes(role) ||
    !entries[`observed-${role}`] ||
    Object.entries(expected).some(([k, v]) => cal.sprites?.[k] !== v) ||
    Object.keys(style.agentAssets.bindings ?? {}).length ||
    Object.keys(entries).some(
      (k) =>
        !['observed-background', 'observed-white', 'observed-coral', 'observed-cyan'].includes(k),
    ) ||
    Object.keys(cal.sprites ?? {}).some(
      (k) => !['background', ...Object.keys(expected)].includes(k),
    ) ||
    (cal.sprites?.background !== undefined &&
      cal.sprites.background !== 'asset:observed-background')
  )
    throw new Error('仅支持灰色校准的已核验分槽图片；原工程保留。');
  await inlineBrowserStudioReferences(source, {});
  const blank = structuredClone(source);
  delete blank.direction.style.agentAssets;
  delete blank.direction.style.referenceCalibration.sprites;
  const checked = await attachObservedImages(blank, { tile: file }, decode);
  const replacement = checked.document.direction.style.agentAssets.entries['observed-tile'];
  replacement.id = `observed-${role}`;
  const copy = structuredClone(source);
  copy.direction.style.agentAssets.entries[replacement.id] = replacement;
  const resolved = await inlineBrowserStudioReferences(copy, {});
  prepareCalibratedRenderer(resolved.document, copy.takes[0].takeId);
  return { document: copy };
}
