import {
  createBrowserAssetRefReader,
  type BrowserAssetSources,
} from '../../contracts/browserAssetReferences';
import { inlineStudioDocumentAssets } from '../../nativeReference/agent-assets/payloadRefs';
import {
  decodeBase64Image,
  encodeBase64Bytes,
  sha256Hex,
} from '../../nativeReference/agent-assets/image';
import { readAgentAssetExtension } from '../../nativeReference/agent-assets/storage';
import type { AgentImageAsset } from '../../nativeReference/agent-assets/contracts';
import { readBCProject, bcStyle, setBCStyle, type BCProject } from './document';

export async function importBCProject(
  value: unknown,
  sources: BrowserAssetSources = {},
): Promise<BCProject> {
  const project = readBCProject(value);
  const result = await inlineStudioDocumentAssets(
    project,
    createBrowserAssetRefReader(sources, { maxFilesPerDirectory: 50_000 }),
  );
  readAgentAssetExtension(result.document);
  return readBCProject(result.document);
}

export async function imageAsset(
  bytes: Uint8Array,
  id: string,
  name: string,
): Promise<AgentImageAsset> {
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpeg = bytes[0] === 255 && bytes[1] === 216;
  if (!png && !jpeg) throw new Error('请选择可解码的 PNG 或 JPEG 图片。');
  const mimeType = png ? 'image/png' : 'image/jpeg';
  const blob = new Blob([new Uint8Array(bytes).buffer], { type: mimeType });
  const image = await createImageBitmap(blob);
  try {
    if (image.width > 8192 || image.height > 8192 || bytes.length > 12 * 1024 * 1024)
      throw new Error('图片超过 8192 像素或 12 MiB，请先缩小素材。');
    return {
      id,
      kind: 'image',
      sourceName: name,
      mimeType,
      encoding: 'base64',
      data: encodeBase64Bytes(bytes),
      sha256: await sha256Hex(bytes),
      width: image.width,
      height: image.height,
      byteLength: bytes.length,
    };
  } finally {
    image.close();
  }
}

export function bindBCImage(
  project: BCProject,
  slot: 'world.background' | 'tile.palette',
  asset: AgentImageAsset,
) {
  const style = bcStyle(project);
  const extension = style.agentAssets ?? { version: '1.0.0', entries: {}, bindings: {} };
  setBCStyle(project, {
    ...style,
    agentAssets: {
      ...extension,
      entries: { ...extension.entries, [asset.id]: asset },
      bindings: {
        ...extension.bindings,
        [slot]: {
          slotId: slot,
          assetId: asset.id,
          role: slot === 'world.background' ? 'background-image' : 'tile-face-image',
          fit: slot === 'world.background' ? 'cover' : 'stretch',
          opacity: 1,
          blendMode: 'source-over',
          inset: 0,
        },
      },
    },
  });
}

export async function encodeCanvas(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('图片编码失败。'))),
      'image/png',
    ),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

function rgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [value >> 16, (value >> 8) & 255, value & 255] as const;
}
const luminance = (red: number, green: number, blue: number) =>
  red * 0.2126 + green * 0.7152 + blue * 0.0722;

/** Recolour the image consumer as well as the saved semantic palette. Alpha is retained. */
export async function recolourPaletteAsset(
  asset: AgentImageAsset,
  before: readonly string[],
  after: readonly string[],
): Promise<AgentImageAsset> {
  const image = await createImageBitmap(
    new Blob([new Uint8Array(decodeBase64Image(asset.data)).buffer], { type: asset.mimeType }),
  );
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    image.close();
    throw new Error('无法创建材质绘制画布。');
  }
  context.drawImage(image, 0, 0);
  image.close();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const column = Math.min(
      before.length - 1,
      Math.floor((((i / 4) % canvas.width) / canvas.width) * before.length),
    );
    if (before[column]?.toLowerCase() === after[column]?.toLowerCase()) continue;
    const old = rgb(before[column]!);
    const colour = rgb(after[column]!);
    const shade =
      luminance(pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!) /
      Math.max(1, luminance(...old));
    for (let channel = 0; channel < 3; channel++)
      pixels.data[i + channel] = Math.min(255, Math.round(colour[channel]! * shade));
  }
  context.putImageData(pixels, 0, 0);
  return imageAsset(
    await encodeCanvas(canvas),
    asset.id,
    asset.sourceName.replace(/\.[^.]+$/, '') + '-recoloured.png',
  );
}

/** A single square texture becomes one material tile per existing colour identity. */
export async function makePaletteAsset(
  file: File,
  colours: readonly string[],
): Promise<AgentImageAsset> {
  const original = await imageAsset(
    new Uint8Array(await file.arrayBuffer()),
    'bc-edited-palette',
    file.name,
  );
  if (original.width === original.height * colours.length) return original;
  if (original.width !== original.height)
    throw new Error('牌面请选择正方形单图，或每个颜色一格的横向图集。');
  const bitmap = await createImageBitmap(
    new Blob([new Uint8Array(decodeBase64Image(original.data)).buffer], {
      type: original.mimeType,
    }),
  );
  const size = Math.min(256, bitmap.width),
    canvas = document.createElement('canvas');
  canvas.width = size * colours.length;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error('无法创建牌面图集。');
  }
  for (let i = 0; i < colours.length; i++) context.drawImage(bitmap, i * size, 0, size, size);
  bitmap.close();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  let total = 0,
    count = 0;
  for (let i = 0; i < pixels.data.length; i += 4)
    if (pixels.data[i + 3]! > 128) {
      total += luminance(pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!);
      count++;
    }
  const mean = Math.max(1, total / Math.max(1, count));
  for (let i = 0; i < pixels.data.length; i += 4) {
    const column = Math.floor(((i / 4) % canvas.width) / size),
      colour = rgb(colours[column]!);
    const shade = luminance(pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!) / mean;
    for (let channel = 0; channel < 3; channel++)
      pixels.data[i + channel] = Math.min(255, Math.round(colour[channel]! * shade));
  }
  context.putImageData(pixels, 0, 0);
  return imageAsset(
    await encodeCanvas(canvas),
    original.id,
    file.name.replace(/\.[^.]+$/, '') + '-palette.png',
  );
}
