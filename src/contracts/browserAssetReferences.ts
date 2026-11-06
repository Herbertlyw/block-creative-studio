import {
  parseAgentAssetRef,
  type AgentAssetRefReader,
  type ParsedAgentAssetRef,
} from '../nativeReference/agent-assets/refs';
import { decodeBase64Image, sha256Hex } from '../nativeReference/agent-assets/image';
import { canonicalBlockPlacementDocumentForHash } from '../nativeReference/games/block-placement/canonical';
import { stableHash, stableStringify } from '../nativeReference/headless/stableHash';
import { GameRegistry } from '../nativeReference/game-runtime/gameRegistry';
import { validateStudioProjectDocumentV2 } from '../nativeReference/game-runtime/projectDocument';
import { blockPlacementDefinition } from '../nativeReference/games/block-placement/definition';
import { readAgentAssetExtension } from '../nativeReference/agent-assets/storage';
import { inlineStudioDocumentAssets } from '../nativeReference/agent-assets/payloadRefs';
import { parseProductionDirection } from '../nativeReference/agent-director/contracts';
import { hydrateLegacyReferenceSprites } from '../nativeReference/games/block-placement/legacyReferenceSprites';
import type { StudioProjectDocumentV2 } from '../nativeReference/game-runtime/projectEnvelope';

type DirectoryFile = Pick<File, 'name' | 'size' | 'webkitRelativePath' | 'arrayBuffer'>;
export interface BrowserAssetSources {
  project?: readonly DirectoryFile[];
  cas?: readonly DirectoryFile[];
  library?: readonly DirectoryFile[];
}
export class BrowserAssetReferenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BrowserAssetReferenceError';
  }
}
const fail = (code: string, message: string): never => {
  throw new BrowserAssetReferenceError(code, message);
};
function readDocument(source: unknown): StudioProjectDocumentV2 {
  const games = new GameRegistry();
  games.register(blockPlacementDefinition);
  const { parsed: _parsed, ...document } = validateStudioProjectDocumentV2(source, games);
  readAgentAssetExtension(document);
  if (document.direction?.production) parseProductionDirection(document.direction.production);
  return document;
}
/** Resolve the existing attachment protocol without loading unrelated authoring operations. */
async function inlineBBAssets(source: unknown, read: AgentAssetRefReader) {
  const document = readDocument(source);
  const before = stableHash(canonicalBlockPlacementDocumentForHash(document));
  const result = await inlineStudioDocumentAssets(document, read);
  const legacySpritesHydrated = await hydrateLegacyReferenceSprites(result.document);
  const resolved = readDocument(result.document);
  const after = stableHash(canonicalBlockPlacementDocumentForHash(resolved));
  if (after !== before) throw new Error('ASSET_REF_IDENTITY_CHANGED');
  return {
    document: resolved,
    report: {
      operation: 'project inline',
      ...result.report,
      ...(legacySpritesHydrated ? { legacySpritesHydrated } : {}),
      contentIdentityVersion: 1,
      projectHash: after,
      identityUnchanged: true,
      gameUnchanged: true,
      takesUnchanged: true,
    },
  };
}
function indexDirectory(
  files: readonly DirectoryFile[] | undefined,
  title: string,
): Map<string, DirectoryFile> | null {
  if (!files?.length) return null;
  if (files.length > 10000) fail('ASSET_DIRECTORY_TOO_LARGE', `${title}超过 10000 个文件。`);
  const index = new Map<string, DirectoryFile>();
  let root: string | undefined;
  for (const file of files) {
    const path = file.webkitRelativePath,
      parts = path.split('/');
    if (
      !path ||
      parts.length < 2 ||
      parts.some(
        (part) =>
          !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'),
      )
    )
      fail('ASSET_REF_OUTSIDE_ROOT', `${title}含不可安全解析的路径。`);
    if (root !== undefined && root !== parts[0])
      fail('ASSET_DIRECTORY_AMBIGUOUS', `${title}包含多个目录根。`);
    root = parts[0];
    const relative = parts.slice(1).join('/');
    if (index.has(relative)) fail('ASSET_DIRECTORY_AMBIGUOUS', `${title}含重复路径：${relative}`);
    index.set(relative, file);
  }
  return index;
}
function safeAttachment(locator: string): string {
  const parts = locator.split('/');
  if (
    !locator ||
    parts.some(
      (part) =>
        !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'),
    )
  )
    fail('ASSET_REF_OUTSIDE_ROOT', `工程相对路径越界或无效：${locator}`);
  return locator;
}
/** Mirrors the received filesystem reader's project-relative and sha256/xx/digest.bin layouts.
 * Files are restricted to explicitly selected directory snapshots; no filesystem or network lookup occurs. */
export function createBrowserAssetRefReader(sources: BrowserAssetSources): AgentAssetRefReader {
  const project = indexDirectory(sources.project, '工程目录'),
    cas = indexDirectory(sources.cas, 'CAS 素材库'),
    library = indexDirectory(sources.library, '元素库缓存');
  const cache = new Map<string, Promise<Uint8Array>>();
  return async (ref: ParsedAgentAssetRef) => {
    const index = ref.kind === 'attachment' ? project : ref.kind === 'cas' ? cas : library;
    const label =
      ref.kind === 'attachment' ? '工程目录' : ref.kind === 'cas' ? 'CAS 素材库' : '元素库缓存';
    if (!index)
      return fail(
        'ASSET_SOURCE_NOT_SELECTED',
        `尚未选择${label}，无法解析 ${ref.kind}:${ref.locator}。`,
      );
    const path =
      ref.kind === 'attachment'
        ? safeAttachment(ref.locator)
        : `sha256/${ref.sha256!.slice(0, 2)}/${ref.sha256}.bin`;
    const file = index.get(path);
    if (!file) return fail('ASSET_REF_MISSING', `${label}缺少素材：${path}`);
    if (file.size < 1 || file.size > 64 * 1024 * 1024)
      return fail('ASSET_FILE_SIZE_INVALID', `${label}素材为空或超过 64 MiB：${path}`);
    const key = `${ref.kind}:${path}`;
    let read = cache.get(key);
    if (!read) {
      read = (async () => new Uint8Array(await file.arrayBuffer()))();
      cache.set(key, read);
    }
    const bytes = await read;
    if (ref.sha256 && (await sha256Hex(bytes)) !== ref.sha256)
      return fail('ASSET_STORE_HASH_MISMATCH', `${label}素材哈希不一致：${path}`);
    return bytes;
  };
}
function record(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;
}
/** The game-owned reference authoring resolves assets without modifying stored JSON. */
export async function inlineBrowserStudioReferences(
  document: unknown,
  sources: BrowserAssetSources,
) {
  const root = record(document),
    direction = record(root?.direction),
    ext = record(record(direction?.style)?.agentAssets),
    audio = record(record(direction?.production)?.audio);
  const entries = [
    ...Object.values(record(ext?.entries) ?? {}),
    ...Object.values(record(audio?.assets) ?? {}),
  ];
  for (const raw of entries) {
    const entry = record(raw);
    if (!entry || entry.encoding !== 'ref') continue;
    const values = Array.isArray(entry.frames) ? entry.frames : [entry];
    for (const rawItem of values) {
      const item = record(rawItem);
      if (
        !item ||
        typeof item.ref !== 'string' ||
        typeof item.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(item.sha256)
      )
        throw new BrowserAssetReferenceError(
          'ASSET_REF_METADATA_INVALID',
          '外部素材缺少引用或 SHA-256，无法安全解析。',
        );
      if (
        (item.ref.startsWith('./') || item.ref.startsWith('../') || item.ref.startsWith('/')) &&
        (item.ref.includes('..') || item.ref.startsWith('/'))
      )
        fail('ASSET_REF_OUTSIDE_ROOT', `素材路径越界或无效：${item.ref}`);
      let ref: ParsedAgentAssetRef;
      try {
        ref = parseAgentAssetRef(item.ref);
      } catch (error) {
        throw new BrowserAssetReferenceError(
          'ASSET_REF_UNSUPPORTED',
          `素材引用方案或路径不支持：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (ref.kind === 'attachment') safeAttachment(ref.locator);
      if (ref.sha256 && ref.sha256 !== item.sha256)
        fail('ASSET_REF_HASH_MISMATCH', `引用中的固定哈希与声明不一致：${item.ref}`);
    }
  }
  const game = record(record(root?.game)?.game);
  if (game?.id !== 'block-placement' || game.moduleVersion !== '1.0.0')
    throw new BrowserAssetReferenceError(
      'ASSET_GAME_UNSUPPORTED',
      '仅支持 block-placement 1.0.0 的素材 authoring，不会跨游戏套用。',
    );
  try {
    const result = await inlineBBAssets(document, createBrowserAssetRefReader(sources));
    const resolved = result.document;
    const resolvedDirection = record(resolved.direction),
      resolvedExtension = record(record(resolvedDirection?.style)?.agentAssets),
      resolvedAudio = record(record(resolvedDirection?.production)?.audio);
    const stored = [
      ...Object.values(record(resolvedExtension?.entries) ?? {}),
      ...Object.values(record(resolvedAudio?.assets) ?? {}),
    ];
    let verifiedPayloads = 0;
    for (const raw of stored) {
      const entry = record(raw);
      if (!entry) continue;
      const payloads = Array.isArray(entry.frames) ? entry.frames : [entry];
      for (const rawItem of payloads) {
        const item = record(rawItem);
        if (
          !item ||
          typeof item.data !== 'string' ||
          typeof item.sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(item.sha256)
        )
          fail('ASSET_IDENTITY_UNVERIFIABLE', '素材缺少内嵌字节或 SHA-256，无法核验内容身份。');
        const safe = item!;
        const maxChars =
          entry.kind === 'audio'
            ? Math.ceil((64 * 1024 * 1024) / 3) * 4
            : Math.ceil((8 * 1024 * 1024) / 3) * 4;
        if (safe.data.length > maxChars)
          fail('ASSET_FILE_SIZE_INVALID', '素材超过内容身份校验的大小限制。');
        const bytes = decodeBase64Image(safe.data);
        if (
          (await sha256Hex(bytes)) !== safe.sha256 ||
          (typeof safe.byteLength === 'number' && safe.byteLength !== bytes.length)
        )
          fail(
            'ASSET_REF_HASH_MISMATCH',
            `素材内容与声明哈希或长度不一致：${entry.id ?? 'unknown'}`,
          );
        verifiedPayloads++;
      }
    }
    // The reference projection omits storage bytes; validate them above before comparing
    // its full canonical representation, not merely the old declared hashes.
    const before = stableStringify(
      canonicalBlockPlacementDocumentForHash(document as StudioProjectDocumentV2),
    );
    const after = stableStringify(canonicalBlockPlacementDocumentForHash(resolved));
    if (before !== after)
      fail('ASSET_CONTENT_IDENTITY_CHANGED', '素材还原前后的规范化工程内容不一致。');
    const canonicalSha256 = await sha256Hex(new TextEncoder().encode(after));
    return {
      document: resolved,
      report: {
        ...result.report,
        resolvedAssets: Number(result.report.resolvedAssets),
        legacySpritesHydrated: Number(result.report.legacySpritesHydrated ?? 0),
        verifiedPayloads,
        canonicalSha256,
      },
    };
  } catch (error) {
    if (error instanceof BrowserAssetReferenceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('ASSET_INLINE_SHA256_MISMATCH') ||
      message.includes('LEGACY_REFERENCE_SPRITE_SHA256_MISMATCH')
    )
      throw new BrowserAssetReferenceError(
        'ASSET_REF_HASH_MISMATCH',
        `素材内容 SHA-256 不一致：${message}`,
      );
    if (message.includes('LEGACY_REFERENCE_SPRITE_'))
      throw new BrowserAssetReferenceError(
        'LEGACY_SPRITE_INVALID',
        `旧素材别名还原失败：${message}`,
      );
    throw new BrowserAssetReferenceError('ASSET_REF_UNRESOLVABLE', `素材无法解析：${message}`);
  }
}
export function hasStudioAssetReferences(value: unknown): boolean {
  const root = record(value),
    direction = record(root?.direction),
    ext = record(record(direction?.style)?.agentAssets),
    audio = record(record(direction?.production)?.audio);
  return [
    ...Object.values(record(ext?.entries) ?? {}),
    ...Object.values(record(audio?.assets) ?? {}),
  ].some((entry) => record(entry)?.encoding === 'ref');
}

/** Hydration can succeed while the current scene has no legacy-sprite consumer. */
export function assertBrowserReferenceCompatibility(document: unknown): void {
  const style = record(record(record(document)?.direction)?.style),
    calibration = record(style?.referenceCalibration);
  if (calibration && Object.keys(calibration).length > 0) {
    fail(
      'LEGACY_CALIBRATION_UNSUPPORTED',
      '工程包含旧版 referenceCalibration；常规参考 2D 场景不能消费该时序，请使用明确标识的校准渲染路径。',
    );
  }
}
