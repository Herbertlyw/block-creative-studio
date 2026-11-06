import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { makeBBConfiguredTestAudio, makeBBDefaultTestAudio } from '../exporter/bbSyntheticAudio';
import { compileNativeTake } from '../contracts/compileNativeTake';
import {
  compileNativeProductionAudio,
  describeProductionMixWarnings,
} from '../contracts/nativeProductionAudio';
import { resolveEmbeddedAssets } from '../contracts/embeddedAssets';
import {
  assertBrowserReferenceCompatibility,
  hasStudioAssetReferences,
  inlineBrowserStudioReferences,
} from '../contracts/browserAssetReferences';
import {
  auditNativeV2LookPlan,
  compileNativePreviewLook,
  compileNativeV2PlanLook,
  listNativePreviewLooks,
} from '../contracts/nativeVariants';
import type { NativeRuntimeAudit } from '../contracts/inspectNativeRuntime';
import { BBScene2D } from '../games/block-placement/rendering/BBScene2D';
import { sha256Blob, contentHashToAssetUri } from '../nativeReference/assets/browserAssetStore';
import {
  createRuntimeAssetBindings,
  type RuntimeAssetBindings,
  type RuntimeImageAssetBinding,
} from '../nativeReference/assets/runtimeAssetBindings';
import type { StyleSpec } from '../nativeReference/domain/types';
import { downloadBlob } from '../utils/download';
import type { BBWorkPackage } from '../contracts/bbWorkPackage';
import { hasReferenceCalibration } from '../contracts/hasReferenceCalibration';
import { resolveSavedWorkbenchVariant } from '../contracts/workbenchVariant';
import {
  readPreviewStyle,
  resolvePreviewVariant,
  type PreviewVariantSelection,
} from '../contracts/previewVariant';
import {
  parseWorkbenchView,
  paintWorkbenchView,
  hitWorkbenchView,
} from '../contracts/reference2dView';
import { readBBFrame } from '../games/block-placement/planning/timelineFrameSource';
import type { CompiledFrameSource } from '../nativeReference/game-runtime/frameSource';
import type { BBThreeScene } from '../renderer/BBThreeScene';
import type { BBPreviewConfiguration } from './useBBTimelinePlayer';
import { BBTimelinePlayerProvider, useBBPlayerConfiguration } from './BBTimelinePlayerContext';
import { BBPlaybackControls } from './BBPlaybackControls';
import { readWorkbenchBackground } from '../contracts/workbenchBackground';
import { BB_EXPORT_QUALITY, readBBExportQuality } from '../contracts/bbExportQuality';
import { readBBTestAudio } from '../contracts/bbSyntheticAudio';

function authoredFrame(source: CompiledFrameSource, index: number) {
  return readBBFrame(source.evaluate(index));
}
type PreviewScene = BBScene2D | BBThreeScene;
async function createPreviewScene(
  canvas: HTMLCanvasElement,
  mode: '2d' | '3d',
  solidBackground: string | null,
): Promise<PreviewScene> {
  if (mode === '2d') return new BBScene2D(canvas, { quality: 'cinematic', solidBackground });
  const { BBThreeScene } = await import('../renderer/BBThreeScene');
  return new BBThreeScene(canvas);
}

const ObservedPreviewSettings = lazy(() =>
  import('./ObservedPreviewSettings').then((module) => ({
    default: module.ObservedPreviewSettings,
  })),
);

interface PreviewInput {
  direction?: { style?: StyleSpec; production?: { audio?: unknown } };
  production?: { output?: { width: number; height: number } };
}

export function NativeTimedPreview(props: {
  document: unknown;
  audit: NativeRuntimeAudit;
  work?: BBWorkPackage | null;
  selected: string;
  onSelect: (takeId: string) => void;
}) {
  return (
    <BBTimelinePlayerProvider>
      {hasReferenceCalibration(props.document) ? (
        <Suspense fallback={<p>正在加载观察素材…</p>}>
          <ObservedPreviewSettings {...props} />
        </Suspense>
      ) : (
        <AuthoredPreviewSettings {...props} />
      )}
    </BBTimelinePlayerProvider>
  );
}

function AuthoredPreviewSettings({
  document,
  audit,
  selected,
  onSelect,
}: {
  document: unknown;
  audit: NativeRuntimeAudit;
  selected: string;
  onSelect: (takeId: string) => void;
}) {
  const savedVariant = readPreviewStyle(document)?.workbenchVariantV1;
  const [enabled, setEnabled] = useState(false);
  const [visualMode, setVisualMode] = useState<'2d' | '3d'>('2d');
  const [variantOverride, setVariantOverride] = useState<PreviewVariantSelection | null>(null);
  const {
    lookKey: variantKey,
    route: variantRoute,
    clearFromLook,
  } = resolvePreviewVariant(document, variantOverride);
  const setVariantKey = (lookKey: string) =>
    setVariantOverride({ ...resolvePreviewVariant(document, variantOverride), lookKey });
  const setVariantRoute = (route: 'bridge' | 'v2') =>
    setVariantOverride({ ...resolvePreviewVariant(document, variantOverride), route });
  const setClearFromLook = (value: string) =>
    setVariantOverride({
      ...resolvePreviewVariant(document, variantOverride),
      clearFromLook: value,
    });
  const [withTestAudio, setWithTestAudio] = useState(false);
  const hasProductionAudio = (document as PreviewInput)?.direction?.production?.audio !== undefined;
  const sourceAssetIsReference = (sourceUri: string) => {
    if (!sourceUri.startsWith('embedded:')) return sourceUri.startsWith('local-ref:');
    const source = document as {
      direction?: { style?: { agentAssets?: { entries?: Record<string, { encoding?: string }> } } };
    };
    return (
      source.direction?.style?.agentAssets?.entries?.[sourceUri.slice('embedded:'.length)]
        ?.encoding === 'ref'
    );
  };
  const [productionAudioOverride, setProductionAudioOverride] = useState<boolean | null>(null);
  const withProductionAudio = (productionAudioOverride ?? hasProductionAudio) && !withTestAudio;
  const [background, setBackground] = useState<RuntimeImageAssetBinding | null>(null);
  const [projectFiles, setProjectFiles] = useState<File[]>([]),
    [casFiles, setCasFiles] = useState<File[]>([]),
    [libraryFiles, setLibraryFiles] = useState<File[]>([]);
  const [embedded, setEmbedded] = useState<
    | { status: 'checking' }
    | { status: 'ready'; bindings: RuntimeAssetBindings; document: unknown }
    | { status: 'error'; message: string }
  >({ status: 'checking' });
  const [identity, setIdentity] = useState<{
    hash: string;
    payloads: number;
    legacy: number;
  } | null>(null);
  const valid = audit.takes.filter((take) => take.legal && take.actions > 0);
  const takeId = valid.some((item) => item.takeId === selected) ? selected : '';
  useEffect(() => {
    let active = true;
    setEmbedded({ status: 'checking' });
    setIdentity(null);
    const resolve = async () => {
      const result = await inlineBrowserStudioReferences(document, {
        project: projectFiles,
        cas: casFiles,
        library: libraryFiles,
      });
      if (active)
        setIdentity({
          hash: result.report.canonicalSha256,
          payloads: result.report.verifiedPayloads,
          legacy: Number(result.report.legacySpritesHydrated ?? 0),
        });
      const resolved = result.document;
      assertBrowserReferenceCompatibility(resolved);
      const bindings = await resolveEmbeddedAssets(resolved);
      return { bindings, document: resolved };
    };
    void resolve()
      .then((result) => {
        if (active) setEmbedded({ status: 'ready', ...result });
      })
      .catch((error: unknown) => {
        if (active)
          setEmbedded({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      active = false;
    };
  }, [document, projectFiles, casFiles, libraryFiles]);
  const effectiveAssets = useMemo(() => {
    if (embedded.status !== 'ready') return null;
    if (!background || embedded.bindings.background) return embedded.bindings;
    return createRuntimeAssetBindings({
      revision: `${embedded.bindings.revision}:${background.contentHash}`,
      bySlot: embedded.bindings.bySlot,
      background,
    });
  }, [embedded, background]);
  const lookCatalog = useMemo(() => {
    if (embedded.status !== 'ready' || !takeId) return null;
    try {
      return { ok: true as const, options: listNativePreviewLooks(embedded.document, takeId) };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  }, [embedded, takeId]);
  const v2PlanAudit = useMemo(() => {
    if (embedded.status !== 'ready' || !takeId || !variantKey) return null;
    try {
      return { ok: true as const, ...auditNativeV2LookPlan(embedded.document, takeId, variantKey) };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }, [embedded, takeId, variantKey]);
  const preview = useMemo(() => {
    if (!enabled || !takeId) return null;
    try {
      const source = document as PreviewInput;
      if (!source.direction?.style || source.direction.style.renderer !== 'reference-2d')
        throw new Error('仅支持显式 reference-2d 样式；没有自动替换样式。');
      const output = source.production?.output;
      if (!output) throw new Error('缺少视频输出设置。');
      const input = embedded.status === 'ready' ? embedded.document : document;
      const solidBackground = readWorkbenchBackground(input)?.color ?? null;
      const quality = BB_EXPORT_QUALITY[readBBExportQuality(input)];
      const testAudio = readBBTestAudio(input);
      if (solidBackground && effectiveAssets?.background)
        throw new Error('2D 纯色背景与临时或工程背景图片不能同时使用。');
      if (solidBackground && variantKey)
        throw new Error('2D 纯色背景不能与临时外观变体同时使用；请先恢复默认背景。');
      if (savedVariant !== undefined) resolveSavedWorkbenchVariant(input, takeId);
      const variant = variantKey
        ? variantRoute === 'v2'
          ? compileNativeV2PlanLook(input, takeId, variantKey, clearFromLook || undefined)
          : compileNativePreviewLook(input, takeId, variantKey)
        : null;
      const compiled = compileNativeTake(
        document,
        takeId,
        variant?.style ?? source.direction.style,
      );
      const view = parseWorkbenchView(
        readPreviewStyle(input)?.workbenchView2D,
        compiled.compiled.fps,
        compiled.compiled.totalFrames,
      );
      if (visualMode === '3d') {
        if (solidBackground) throw new Error('3D 不消费 2D 纯色背景；请先恢复 2D 默认背景。');
        if (view) throw new Error('3D 暂不消费工作台 2D 镜头；请先选择没有该镜头的作品。');
        if (variantKey)
          throw new Error('3D 暂不消费工作台 2D 外观和清除效果变体；请先取消该变体。');
        if (
          effectiveAssets &&
          (effectiveAssets.background || effectiveAssets.tileFace || effectiveAssets.boardAtlas)
        )
          throw new Error('3D 尚不消费工程图片绑定；为避免忽略素材，已阻止 3D 预览与导出。');
        if ((variant?.style ?? source.direction.style).lighting === 'neutral-lookdev')
          throw new Error('3D 暂不支持 neutral-lookdev 灯光。');
      }
      return {
        ...compiled,
        style: variant?.style ?? source.direction.style,
        variantHash: variant?.planHash,
        output,
        view,
        solidBackground,
        quality,
        testAudio,
        ok: true as const,
      };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  }, [
    document,
    enabled,
    takeId,
    variantKey,
    variantRoute,
    clearFromLook,
    embedded,
    savedVariant,
    visualMode,
    effectiveAssets,
  ]);
  const configuration = useMemo<BBPreviewConfiguration | null>(() => {
    if (!preview?.ok || embedded.status !== 'ready') return null;
    const { style, frameSource, output, view, solidBackground, quality, testAudio } = preview;
    const ratio = view ? Math.min(512 / output.width, 864 / output.height) : 1;
    const previewSize = view
      ? {
          width: Math.max(1, Math.round(output.width * ratio)),
          height: Math.max(1, Math.round(output.height * ratio)),
        }
      : { width: 512, height: 864 };
    return {
      source: frameSource,
      output,
      preview: previewSize,
      quality,
      audioEnabled: withProductionAudio || withTestAudio,
      async audio() {
        if (withProductionAudio) {
          const mix = await compileNativeProductionAudio(embedded.document, frameSource);
          return {
            pcm: mix.track.data,
            channels: 2 as const,
            warning: describeProductionMixWarnings(embedded.document, mix),
          };
        }
        if (withTestAudio) {
          const mix = testAudio ? makeBBConfiguredTestAudio(frameSource, testAudio) : null;
          return {
            pcm: mix?.pcm ?? makeBBDefaultTestAudio(frameSource, 'authored'),
            channels: 1 as const,
            ...(mix ? { warning: mix.warning } : {}),
          };
        }
        return null;
      },
      async createStage(target, width, height, purpose, initialFrame, scale) {
        target.width = width;
        target.height = height;
        const staging =
          purpose === 'preview' || view || scale !== 1
            ? window.document.createElement('canvas')
            : target;
        const scene = await createPreviewScene(staging, visualMode, solidBackground);
        try {
          scene.resize(width, height, scale);
          if (effectiveAssets && scene instanceof BBScene2D)
            scene.setRuntimeAssets(effectiveAssets);
          await scene.warmup(authoredFrame(frameSource, initialFrame), style);
          return {
            draw(index: number) {
              scene.renderAt(authoredFrame(frameSource, index), style);
              if (view) paintWorkbenchView(staging, target, view, index);
              else if (staging !== target) {
                const context = target.getContext('2d');
                if (!context) throw new Error('无法创建预览画布。');
                context.drawImage(staging, 0, 0, width, height);
              }
            },
            dispose() {
              scene.dispose();
            },
          };
        } catch (error) {
          scene.dispose();
          throw error;
        }
      },
    };
  }, [preview, embedded, effectiveAssets, visualMode, withProductionAudio, withTestAudio]);
  const player = useBBPlayerConfiguration(configuration);
  const {
    frame,
    setFrame,
    playing,
    setPlaying,
    preparing: preparingPlayback,
    exporting,
    status,
    setStatus,
  } = player;
  useEffect(
    () => () => {
      if (background) URL.revokeObjectURL(background.objectUrl);
    },
    [background],
  );
  useEffect(() => {
    setPlaying(false);
    setFrame(0);
  }, [takeId, setPlaying, setFrame]);
  const exportVideo = async () => {
    const result = await player.exportVideo();
    if (!result) return;
    const suffix = withProductionAudio
      ? 'production-audio'
      : withTestAudio
        ? 'test-audio'
        : 'silent';
    downloadBlob(
      result.blob,
      `v2-${takeId}-${visualMode === '3d' ? 'three-3d' : 'procedural'}-${suffix}.mp4`,
    );
    setStatus(`视频已导出。${result.warning}`);
  };
  return (
    <section className="native-preview">
      <h2>参考编译器与 2D 测试预览</h2>
      <p>
        原生布局和镜头 profile 尚未驱动画面；可选的工作台 2D
        视图合同对整个参考画布应用缩放和平移。支持 PNG/JPEG 的 background.base、tile.face 和
        board.atlas。
      </p>
      {savedVariant !== undefined && (
        <p>
          工程保存了工作台 2D
          效果合同；打开预览时核验外观和效果的版本与哈希。下方选择可临时覆盖，不修改保存值。
        </p>
      )}
      {v2PlanAudit && (
        <p>
          {v2PlanAudit.ok
            ? `基础 V2 变体计划通过质量检查：${v2PlanAudit.planHash}；这不代表布局或镜头已驱动画面。另选清除效果时，请查看下方实际预览计划。`
            : `V2 变体计划未通过：${v2PlanAudit.message}。V1 桥接预览是独立路径。`}
        </p>
      )}
      {hasStudioAssetReferences(document) && (
        <div>
          <p>
            工程含本地素材引用。请选择工程所在目录、CAS
            素材库或元素库缓存；相对路径严格从所选工程目录查找，CAS／元素库使用 sha256
            分层路径并验证哈希。只读取本次选择的文件，不访问网络或历史路径；关闭后需重新选择。浏览器只能检查所选文件的逻辑路径，不能核实符号链接的实际目标。
          </p>
          <p>
            <label>
              选择工程所在目录{' '}
              <input
                aria-label="V2 工程素材目录"
                type="file"
                multiple
                {...({ webkitdirectory: '' } as Record<string, string>)}
                disabled={exporting || preparingPlayback || playing}
                onChange={(event) => {
                  setProjectFiles(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
            </label>{' '}
            已选择 {projectFiles.length} 个文件
          </p>
          <p>
            <label>
              选择 CAS 素材库目录{' '}
              <input
                aria-label="V2 CAS 素材库目录"
                type="file"
                multiple
                {...({ webkitdirectory: '' } as Record<string, string>)}
                disabled={exporting || preparingPlayback || playing}
                onChange={(event) => {
                  setCasFiles(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
            </label>{' '}
            已选择 {casFiles.length} 个文件
          </p>
          <p>
            <label>
              选择元素库缓存目录{' '}
              <input
                aria-label="V2 元素库目录"
                type="file"
                multiple
                {...({ webkitdirectory: '' } as Record<string, string>)}
                disabled={exporting || preparingPlayback || playing}
                onChange={(event) => {
                  setLibraryFiles(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
            </label>{' '}
            已选择 {libraryFiles.length} 个文件
          </p>
        </div>
      )}
      {identity && (
        <p>
          BB 1.0.0 素材字节及规范化工程身份已核对：{identity.payloads} 项素材字节，旧精灵还原{' '}
          {identity.legacy} 项；规范化 SHA-256：{identity.hash}。此检查不代表旧精灵已渲染。
        </p>
      )}
      {embedded.status === 'checking' && <p>正在核验游戏身份与素材依赖…</p>}
      {embedded.status === 'error' && (
        <p role="alert">{embedded.message} 已停止预览及导出，原工程保留。</p>
      )}
      {embedded.status === 'ready' &&
        Object.values(embedded.bindings.bySlot)
          .flat()
          .map((item) => (
            <p key={`${item.slotId}:${item.contentHash}`}>
              {sourceAssetIsReference(item.sourceUri)
                ? '本地引用素材（仅在内存解析）'
                : '工程内嵌素材'}
              已通过 SHA-256、字节数、尺寸和图片解码校验：{item.slotId} · {item.fileName}（
              {'width' in item ? item.width : '?'}×{'height' in item ? item.height : '?'}）。
            </p>
          ))}
      {embedded.status === 'ready' && !embedded.bindings.background && (
        <p>工程没有背景绑定；预览将使用程序素材或由你选择的临时测试背景。</p>
      )}
      {!valid.length && <p>没有通过参考玩法检查的非空 Take，不能进行定帧预览或导出。</p>}
      {embedded.status === 'ready' &&
        valid.length > 0 &&
        (!enabled ? (
          <button className="button-secondary" onClick={() => setEnabled(true)}>
            打开 2D 测试预览
          </button>
        ) : (
          <>
            {lookCatalog && !lookCatalog.ok && (
              <p role="alert">BB 变体目录不可用：{lookCatalog.error}；仍可使用原工程样式。</p>
            )}
            {variantOverride && (
              <p>
                <button
                  type="button"
                  disabled={playing || preparingPlayback || exporting}
                  onClick={() => setVariantOverride(null)}
                >
                  恢复工程设置
                </button>{' '}
                当前使用临时覆盖。
              </p>
            )}
            {variantKey && (
              <p>
                <label>
                  变体编译路径{' '}
                  <select
                    aria-label="V2 变体编译路径"
                    value={variantRoute}
                    disabled={playing || preparingPlayback || exporting}
                    onChange={(event) => setVariantRoute(event.target.value as typeof variantRoute)}
                  >
                    <option value="bridge">参考桥接外观</option>
                    <option value="v2">原生 V2 计划外观</option>
                  </select>
                </label>{' '}
                V2 模式要求工程布局与镜头引用能从本地目录解析；目前消费已支持的外观和两种参考 2D
                清除样式，布局和镜头 profile 尚未驱动画面。
              </p>
            )}
            {variantKey && variantRoute === 'v2' && (
              <p>
                <label>
                  清除效果{' '}
                  <select
                    aria-label="V2 清除效果计划"
                    value={clearFromLook}
                    disabled={playing || preparingPlayback || exporting}
                    onChange={(event) => setClearFromLook(event.target.value)}
                  >
                    <option value="">使用选定外观的效果</option>
                    <option value="builtin.reference-clean.look@1.0.0">参考 2D · 简洁扫光</option>
                    <option value="builtin.reference-garden.look@1.0.0">
                      参考 2D · 扫光及计分粒子
                    </option>
                  </select>
                </label>{' '}
                仅用于本次预览和导出；不改写工程。
              </p>
            )}
            {lookCatalog?.ok && lookCatalog.options.length > 0 && (
              <p>
                <label>
                  临时 BB 参考 2D 变体{' '}
                  <select
                    aria-label="V2 临时参考变体"
                    value={variantKey}
                    disabled={playing || preparingPlayback || exporting}
                    onChange={(event) => {
                      setVariantKey(event.target.value);
                      setFrame(0);
                    }}
                  >
                    <option value="">工程原有样式</option>
                    {lookCatalog.options
                      .filter((option) => option.key !== 'project-current')
                      .map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                  </select>
                </label>{' '}
                使用已接入的 BB 1.0.0
                本地目录与质量检查，仅临时预览／导出，不写入工程；不代表已解析工程外部 profile。
              </p>
            )}
            <label>
              画面表现{' '}
              <select
                aria-label="BB 画面表现"
                value={visualMode}
                disabled={playing || preparingPlayback || exporting}
                onChange={(event) => {
                  setVisualMode(event.target.value as '2d' | '3d');
                  setStatus('');
                }}
              >
                <option value="2d">2D</option>
                <option value="3d">3D</option>
              </select>
            </label>
            {visualMode === '3d' && (
              <p>
                3D 使用当前 Take 和共同帧时间以及工程的 3D 材质、灯光和相机预设；目前不消费 lookDev
                参数、工程图片绑定、观察几何或 2D 专用效果。遇到图片、2D 镜头或 2D
                外观变体会明确阻止预览和导出。
              </p>
            )}
            <label>
              Take{' '}
              <select
                aria-label="V2 定帧预览 Take"
                disabled={preparingPlayback}
                value={selected}
                onChange={(event) => {
                  setPlaying(false);
                  onSelect(event.target.value);
                  setFrame(0);
                }}
              >
                {!takeId && (
                  <option value={selected}>{selected || '未选择'}（没有合法动作）</option>
                )}
                {valid.map((item) => (
                  <option key={item.takeId} value={item.takeId}>
                    {item.takeId}
                  </option>
                ))}
              </select>
            </label>
            {!takeId && <p>当前 Take 没有可预览的合法动作；可选择其他 Take。</p>}
            {preview && !preview.ok ? (
              <p role="alert">{preview.error}</p>
            ) : (
              preview?.ok && (
                <>
                  {!embedded.bindings.background && (
                    <>
                      <p>
                        <label>
                          临时测试背景图片{' '}
                          <input
                            aria-label="临时测试背景图片"
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={exporting}
                            onChange={async (event) => {
                              const file = event.target.files?.[0];
                              event.target.value = '';
                              if (!file) return;
                              try {
                                if (
                                  !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
                                  file.size === 0 ||
                                  file.size > 20 * 1024 * 1024
                                )
                                  throw new Error(
                                    '测试背景须为 20 MB 以内的 PNG、JPEG 或 WebP 图片。',
                                  );
                                const contentHash = await sha256Blob(file),
                                  objectUrl = URL.createObjectURL(file);
                                setBackground({
                                  slotId: 'background.base',
                                  role: 'background-image',
                                  contentHash,
                                  sourceUri: contentHashToAssetUri(contentHash),
                                  objectUrl,
                                  fileName: file.name,
                                  mimeType: file.type,
                                  fit: 'cover',
                                  opacity: 1,
                                  blendMode: 'source-over',
                                  inset: 0,
                                });
                                setStatus(`临时背景 SHA-256：${contentHash}；未更改工程资源引用。`);
                              } catch (error) {
                                setStatus(error instanceof Error ? error.message : String(error));
                              }
                            }}
                          />
                        </label>
                      </p>
                      <p>测试背景只用于本次预览和测试导出，不会解析或改写工程资源引用。</p>
                      {background && (
                        <button
                          className="button-secondary"
                          disabled={exporting}
                          onClick={() => {
                            setBackground(null);
                            setStatus('已移除临时背景。');
                          }}
                        >
                          移除临时背景
                        </button>
                      )}
                    </>
                  )}
                  {preview.view && (
                    <p>工作台 2D 视图已启用；点击画面可检查变换后的棋盘格或候选命中（只读）。</p>
                  )}
                  <BBPlaybackControls
                    player={player}
                    totalFrames={preview.compiled.totalFrames}
                    fps={preview.compiled.fps}
                    canvasLabel="V2 参考 2D 测试画面"
                    seekLabel="V2 预览帧"
                    playLabel="播放 V2 预览"
                    pauseLabel="暂停 V2 预览"
                    exportLabel={
                      withProductionAudio
                        ? '导出工程音频测试视频'
                        : withTestAudio
                          ? '导出合成音效测试视频'
                          : '导出无声测试视频'
                    }
                    onExport={() => void exportVideo()}
                    canvasStyle={{ display: 'block', width: 'min(360px, 100%)', height: 'auto' }}
                    onCanvasClick={(event) => {
                      if (!preview.view) return;
                      const rect = event.currentTarget.getBoundingClientRect(),
                        point = {
                          x: ((event.clientX - rect.left) * event.currentTarget.width) / rect.width,
                          y:
                            ((event.clientY - rect.top) * event.currentTarget.height) / rect.height,
                        };
                      const hit = hitWorkbenchView(
                        preview.view,
                        frame,
                        event.currentTarget.width,
                        event.currentTarget.height,
                        point,
                        authoredFrame(preview.frameSource, frame),
                      );
                      setStatus(
                        hit
                          ? hit.kind === 'cell'
                            ? `视图命中：第 ${hit.row + 1} 行第 ${hit.col + 1} 列。`
                            : `视图命中候选：${hit.pieceId}。`
                          : '视图内没有命中棋盘格或候选。',
                      );
                    }}
                    details={
                      preview.variantHash && (
                        <span> 临时变体计划 {preview.variantHash}（工程原文不变）。</span>
                      )
                    }
                    audioControls={
                      <>
                        {hasProductionAudio && (
                          <label>
                            <input
                              type="checkbox"
                              disabled={playing || preparingPlayback || exporting}
                              checked={withProductionAudio}
                              onChange={(event) => {
                                setProductionAudioOverride(event.target.checked);
                                if (event.target.checked) setWithTestAudio(false);
                              }}
                            />{' '}
                            使用工程 production.audio（WAV）
                          </label>
                        )}{' '}
                        <label>
                          <input
                            type="checkbox"
                            checked={withTestAudio}
                            disabled={
                              withProductionAudio || playing || preparingPlayback || exporting
                            }
                            onChange={(event) => setWithTestAudio(event.target.checked)}
                          />{' '}
                          合成测试提示音（不是工程音频）
                        </label>
                      </>
                    }
                  />
                  <p>
                    选择工程音频或测试提示音后，连续预览使用同一帧时间轴播放；未勾选时为无声预览。音频设备、浏览器输出延迟和最终导出仍需另行验证。
                  </p>
                </>
              )
            )}
            {status && <p role="status">{status}</p>}
          </>
        ))}
    </section>
  );
}
