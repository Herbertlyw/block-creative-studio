import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { createAgentAssetOperations } from '../nativeReference/agent-assets/operations';
import {
  readAgentAssetExtension,
  withAgentAssetExtension,
} from '../nativeReference/agent-assets/storage';
import { inspectImageBytes, sha256Hex } from '../nativeReference/agent-assets/image';
import { blockPlacementAgentAssetDeclaration } from '../nativeReference/games/block-placement/agent/assetBindings';
import { blockCrushDropAgentAssetDeclaration } from '../nativeReference/games/block-crush-drop/agent/assetBindings';
import { updateBBWorkPackageProject, type BBWorkPackage } from '../contracts/bbWorkPackage';
import { resolveEmbeddedAssets } from '../contracts/embeddedAssets';
import { hasReferenceCalibration } from '../contracts/hasReferenceCalibration';
import { prepareCalibratedRenderer } from '../contracts/calibratedRenderer';
import {
  bcCalibration,
  bcColours,
  bcProduction,
  readBCProject,
  type BCProject,
} from '../games/block-crush/document';
import { changeBCImage } from '../games/block-crush/editing';

type Game = 'block-placement' | 'block-crush-drop';
type Work = BBWorkPackage | BCProject;
type Options = Record<string, unknown>;
const text = { type: 'string', minLength: 1, maxLength: 240 };
const schema = (required: string[], properties: Record<string, unknown>) => ({
  type: 'object',
  required,
  properties,
  additionalProperties: false,
});
export function assetOperations() {
  const make = (id: string, kind: 'query' | 'edit', s: object, description: string) => ({
    id,
    kind,
    schema: s,
    requiresInput: true,
    output: kind === 'edit',
    description,
  });
  return [
    make('asset catalog', 'query', schema([], {}), '查询素材和实际支持的图片槽。'),
    make(
      'asset inspect',
      'query',
      schema(['assetId'], { assetId: text }),
      '查询素材元数据和引用。',
    ),
    make(
      'asset import',
      'edit',
      schema(['id', 'file'], {
        id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$' },
        file: text,
      }),
      '导入 PNG/JPEG 图片。',
    ),
    make(
      'asset bind',
      'edit',
      schema(['assetId', 'slotId'], {
        assetId: text,
        slotId: text,
        fit: { enum: ['cover', 'contain', 'stretch'] },
        opacity: { type: 'number', minimum: 0, maximum: 1 },
        blendMode: { enum: ['source-over', 'multiply', 'screen', 'overlay', 'soft-light'] },
        inset: { type: 'number', minimum: 0, maximum: 0.45 },
      }),
      '绑定现有图片素材。',
    ),
    make('asset unbind', 'edit', schema(['slotId'], { slotId: text }), '解除槽位绑定并保留素材。'),
    make('asset prune', 'edit', schema([], {}), '保守清理未引用的图片素材。'),
  ];
}
function refs(project: any, id: string, sha?: string, extra?: unknown) {
  const copy = structuredClone(project);
  const entries = copy.direction?.style?.agentAssets?.entries ?? {};
  delete copy.direction?.style?.agentAssets?.entries;
  const hits: string[] = [];
  function scan(value: any, path: string) {
    if (typeof value === 'string' && (value.includes(id) || (sha && value.includes(sha))))
      hits.push(path);
    else if (Array.isArray(value)) value.forEach((v, i) => scan(v, `${path}[${i}]`));
    else if (value && typeof value === 'object')
      for (const [k, v] of Object.entries(value)) {
        if (k.includes(id)) hits.push(`${path}.${k}`);
        scan(v, `${path}.${k}`);
      }
  }
  scan(copy, 'project');
  if (extra) scan(extra, 'package');
  for (const [other, entry] of Object.entries(entries))
    if (other !== id) scan(entry, `asset:${other}`);
  return hits;
}
function unknownReferences(project: any, entries: Record<string, any>, extra?: unknown) {
  const identifiers = [
    ...Object.keys(entries),
    ...Object.values(entries).map((entry: any) => entry.sha256),
    ...Object.keys(project.direction?.production?.audio?.assets ?? {}),
  ].filter(Boolean);
  const unknown: string[] = [];
  const copy = structuredClone(project);
  delete copy.direction?.style?.agentAssets?.entries;
  const scan = (value: any, path: string, key = '') => {
    if (
      typeof value === 'string' &&
      (/(?:asset|image|texture|sprite|sequence|media).*id$/i.test(key) || /ref$/i.test(key))
    ) {
      if (!value.startsWith('builtin:') && !identifiers.some((id) => value.includes(id)))
        unknown.push(path);
    } else if (Array.isArray(value))
      value.forEach((item, index) => scan(item, `${path}[${index}]`));
    else if (value && typeof value === 'object')
      for (const [name, item] of Object.entries(value)) scan(item, `${path}.${name}`, name);
  };
  scan(copy, 'project');
  for (const [id, entry] of Object.entries(entries)) scan(entry, `asset:${id}`);
  if (extra) scan(extra, 'package');
  return unknown;
}
async function decode(bytes: Uint8Array, mime: string) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    return await page.evaluate(
      async ({ data, mime }) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const image = await createImageBitmap(new Blob([bytes], { type: mime }));
        try {
          return { width: image.width, height: image.height };
        } finally {
          image.close();
        }
      },
      { data: Buffer.from(bytes).toString('base64'), mime },
    );
  } finally {
    await browser.close();
  }
}
async function palette(asset: any, colors: string[]) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    cache = await mkdtemp(join(tmpdir(), 'bcs-image-'));
  const server = await createServer({
    root,
    configFile: join(root, 'vite.config.ts'),
    cacheDir: cache,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as any).port}`);
    return await page.evaluate(
      async ({ asset, colors }) => {
        const modulePath = '/src/games/block-crush/assets.ts';
        const { makePaletteAsset, imageAsset } = await import(/* @vite-ignore */ modulePath);
        const bytes = Uint8Array.from(atob(asset.data), (c) => c.charCodeAt(0));
        const result = await makePaletteAsset(
          new File([bytes], asset.sourceName, { type: asset.mimeType }),
          colors,
        );
        if (result.mimeType === 'image/png') return result;
        const image = await createImageBitmap(new Blob([bytes], { type: asset.mimeType }));
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法创建调色板画布。');
        context.drawImage(image, 0, 0);
        image.close();
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) => (value ? resolve(value) : reject(new Error('PNG 编码失败。'))),
            'image/png',
          ),
        );
        return imageAsset(
          new Uint8Array(await blob.arrayBuffer()),
          result.id,
          result.sourceName + '.png',
        );
      },
      { asset, colors },
    );
  } finally {
    await browser?.close();
    await server.close();
    await rm(cache, { recursive: true, force: true });
  }
}
export async function runAsset(game: Game, operation: string, work: Work, options: Options) {
  const project: any = game === 'block-placement' ? (work as BBWorkPackage).project : work;
  const declaration =
    game === 'block-placement'
      ? blockPlacementAgentAssetDeclaration
      : blockCrushDropAgentAssetDeclaration;
  const ext = readAgentAssetExtension(project);
  const extra =
    game === 'block-placement'
      ? { source: (work as BBWorkPackage).source, pointer: (work as BBWorkPackage).pointer }
      : undefined;
  const meta = (asset: any) => ({
    id: asset.id,
    kind: asset.kind,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    byteLength: asset.byteLength,
    sha256: asset.sha256,
    encoding: asset.encoding,
    ...(asset.kind === 'sequence' ? { fps: asset.fps, frameCount: asset.frames.length } : {}),
    slots: Object.values(ext.bindings)
      .filter((b: any) => b.assetId === asset.id)
      .map((b: any) => b.slotId),
  });
  if (operation === 'asset catalog')
    return {
      report: {
        slots: declaration.slots
          .filter((s) =>
            (game === 'block-placement'
              ? ['background.base', 'tile.face', 'board.atlas']
              : ['world.background', 'tile.palette']
            ).includes(s.slotId),
          )
          .map((s) => ({
            slotId: s.slotId,
            acceptedMimeTypes: s.acceptedMimeTypes,
            role: s.role,
            consumer: s.consumer,
          })),
        assets: Object.values(ext.entries).map(meta),
      },
    };
  if (operation === 'asset inspect') {
    const asset = ext.entries[options.assetId as string];
    if (!asset) throw new Error(`AGENT_ASSET_UNKNOWN: ${options.assetId}`);
    const references = refs(project, asset.id, asset.sha256, extra);
    return { report: { asset: meta(asset), references, canDelete: references.length === 0 } };
  }
  const factory = createAgentAssetOperations(declaration);
  let result: any,
    details: Record<string, unknown> = {};
  if (operation === 'asset import') {
    const bytes = await readFile(options.file as string);
    if (!bytes.length || bytes.length > 12 * 1024 * 1024)
      throw new Error('IMAGE_SIZE_INVALID: 图片为空或超过 12 MiB。');
    const header = inspectImageBytes(bytes),
      actual = await decode(bytes, header.mimeType);
    if (actual.width !== header.width || actual.height !== header.height)
      throw new Error('IMAGE_DIMENSIONS_MISMATCH');
    const sha256 = await sha256Hex(bytes),
      id = options.id as string,
      old = ext.entries[id];
    if (old) {
      if (
        old.kind !== 'image' ||
        old.encoding !== 'base64' ||
        old.sha256 !== sha256 ||
        old.data !== bytes.toString('base64')
      )
        throw new Error(`AGENT_ASSET_ID_CONFLICT: ${id}`);
      result = structuredClone(project);
      details = { addedAssetIds: [], reused: id };
    } else {
      const op = factory.find((x) => x.id === 'asset import')!;
      const output = await op.execute({
        project,
        options: {
          id,
          sourceName: basename(options.file as string),
          mimeType: header.mimeType,
          encoding: 'base64',
          data: bytes.toString('base64'),
          sha256,
        },
      });
      result = output.document;
      details = output.report;
    }
  } else if (operation === 'asset bind') {
    let asset: any = ext.entries[options.assetId as string];
    const slot = options.slotId as string;
    if (!asset || asset.kind !== 'image')
      throw new Error(`AGENT_ASSET_UNKNOWN_OR_NOT_IMAGE: ${options.assetId}`);
    if (asset.encoding !== 'base64') throw new Error(`AGENT_ASSET_UNRESOLVED_REF: ${asset.id}`);
    await decode(Buffer.from(asset.data, 'base64'), asset.mimeType);
    const supported =
      game === 'block-placement'
        ? ['background.base', 'tile.face', 'board.atlas']
        : ['world.background', 'tile.palette'];
    if (!supported.includes(slot)) throw new Error(`AGENT_ASSET_SLOT_UNSUPPORTED: ${slot}`);
    let base = project;
    if (game === 'block-crush-drop') {
      if (bcProduction(project).clips?.length)
        throw new Error('工程含片段，图片修改不能安全更新其来源；请先处理片段。');
      if (slot === 'tile.palette') {
        const colors = bcColours(project);
        if (asset.width === asset.height && (colors.length > 1 || asset.mimeType !== 'image/png')) {
          const produced: any = await palette(asset, colors);
          produced.id = `${asset.id.slice(0, 90)}-palette-${produced.sha256.slice(0, 12)}`;
          produced.provenance = {
            sourceRef: asset.id,
            originalSha256: asset.sha256,
            conversion: 'workbench-palette',
          };
          const old = ext.entries[produced.id];
          if (old && old.sha256 !== produced.sha256)
            throw new Error(`AGENT_ASSET_ID_CONFLICT: ${produced.id}`);
          asset = produced;
        } else if (asset.width !== asset.height * colors.length || asset.mimeType !== 'image/png')
          throw new Error(
            `BC_PALETTE_INVALID: 需要正方形原图或 ${colors.length} 格 PNG 横向图集。`,
          );
      }
      base = changeBCImage(project, slot as 'world.background' | 'tile.palette', asset);
    }
    const old: any = ext.bindings[slot];
    const merged: any = { assetId: asset.id, slotId: slot };
    for (const key of ['fit', 'opacity', 'blendMode', 'inset', 'transform'])
      if ((options as any)[key] !== undefined || old?.[key] !== undefined)
        merged[key] = (options as any)[key] ?? old[key];
    const output = await factory
      .find((x) => x.id === 'asset bind')!
      .execute({ project: base, options: merged });
    result = output.document;
    details = output.report;
  } else if (operation === 'asset unbind') {
    const slot = options.slotId as string;
    if (game === 'block-crush-drop' && bcProduction(project).clips?.length)
      throw new Error('工程含片段，图片解绑不能安全更新其来源；请先处理片段。');
    if (
      game === 'block-crush-drop' &&
      slot === 'tile.palette' &&
      bcCalibration(project).clear?.fragmentMaterialTexture
    )
      throw new Error('碎片仍引用牌面纹理；请先切换为不依赖牌面的材质。');
    if (!ext.bindings[slot]) throw new Error(`AGENT_ASSET_BINDING_UNKNOWN: ${slot}`);
    const output = await factory
      .find((x) => x.id === 'asset unbind')!
      .execute({ project, options: { slotId: slot } });
    result = output.document;
    details = output.report;
  } else if (operation === 'asset prune') {
    const ids = Object.keys(ext.entries),
      // Keep references from any other entry, including an otherwise-unused
      // reference cycle; this operation never assumes unknown dependencies are safe.
      used = new Set(
        ids.filter((id) => refs(project, id, (ext.entries[id] as any).sha256, extra).length > 0),
      );
    const unknown = unknownReferences(project, ext.entries, extra);
    if (unknown.length) for (const id of ids) used.add(id);
    const removedAssetIds = ids.filter((id) => !used.has(id));
    for (const id of removedAssetIds) delete ext.entries[id];
    result = withAgentAssetExtension(project, ext);
    details = {
      removedAssetIds,
      retainedAssetIds: [...used],
      reason: unknown.length
        ? '发现无法识别的引用，保留全部素材'
        : '保留被工程或其他素材引用的条目',
      unknownReferences: unknown,
    };
  } else throw new Error(`AGENT_ASSET_OPERATION_UNSUPPORTED: ${operation}`);
  if (!result) throw new Error('AGENT_ASSET_OPERATION_NO_DOCUMENT');
  if (game === 'block-placement' && (operation === 'asset bind' || operation === 'asset unbind')) {
    await resolveEmbeddedAssets(result, async (blob) =>
      decode(new Uint8Array(await blob.arrayBuffer()), blob.type),
    );
    if (hasReferenceCalibration(result))
      for (const take of result.takes)
        if (take.actions.length) prepareCalibratedRenderer(result, take.takeId);
  }
  const document =
    game === 'block-placement'
      ? await updateBBWorkPackageProject(work as BBWorkPackage, result)
      : readBCProject(result);
  return {
    document,
    report: {
      ...details,
      invalidated:
        operation === 'asset bind' || operation === 'asset unbind'
          ? ['render-artifacts', 'visual-previews']
          : [],
    },
  };
}
