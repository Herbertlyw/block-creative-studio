import { useEffect, useMemo, useState } from 'react';
import { useRebasedDraft } from '../state/useRebasedDraft';
import {
  inlineBrowserStudioReferences,
  hasStudioAssetReferences,
} from '../contracts/browserAssetReferences';
import { prepareCalibratedRenderer } from '../contracts/calibratedRenderer';
import { createObservedBBStage } from '../contracts/bbRenderStage';
import {
  compileNativeProductionAudio,
  describeProductionMixWarnings,
} from '../contracts/nativeProductionAudio';
import type { NativeRuntimeAudit } from '../contracts/inspectNativeRuntime';
import { downloadBlob } from '../utils/download';
import { describeExportFailure } from '../exporter/exportStatus';
import {
  verifyObservedPointer,
  type PointerOverlay,
  type VerifiedPointerOverlay,
} from '../contracts/observedPointer';
import type { BBWorkPackage } from '../contracts/bbWorkPackage';
import { CalibratedComparison } from './CalibratedComparison';
import { makeBBConfiguredTestAudio, makeBBDefaultTestAudio } from '../exporter/bbSyntheticAudio';
import type { BBPreviewConfiguration } from './useBBTimelinePlayer';
import { useBBPlayerConfiguration } from './BBTimelinePlayerContext';
import { BBPlaybackControls } from './BBPlaybackControls';
import { BB_EXPORT_QUALITY, readBBExportQuality } from '../contracts/bbExportQuality';
import { readBBTestAudio } from '../contracts/bbSyntheticAudio';

/** Explicit current-source renderer mode. It never claims to match a historical extension lock. */
export function ObservedPreviewSettings({
  document,
  audit,
  work,
  selected,
  onSelect,
  onDraftChange,
}: {
  document: unknown;
  audit: NativeRuntimeAudit;
  work?: BBWorkPackage | null;
  selected: string;
  onSelect: (takeId: string) => void;
  onDraftChange?: (editor: string, dirty: boolean) => void;
}) {
  const firstTake = (document as { takes?: Array<{ takeId?: string }> }).takes?.[0]?.takeId;
  const multi =
    (document as { direction?: { style?: { workbenchCalibrationV2?: unknown } } }).direction?.style
      ?.workbenchCalibrationV2 !== undefined;
  const valid = audit.takes.filter((t) => t.legal && t.actions > 0);
  const takeId =
    valid.some((t) => t.takeId === selected) && (multi || selected === firstTake) ? selected : '';
  const [active, setActive] = useState(false),
    [variantBusy, setVariantBusy] = useState(false);
  const [variantPointer, setVariantPointer] = useState<PointerOverlay | null>(null);
  const [pointer, setPointer] = useState<VerifiedPointerOverlay | null>(null),
    [pointerState, setPointerState] = useState<'none' | 'loading' | 'ready' | 'error'>(
      work?.pointer ? 'loading' : 'none',
    );
  const hasProductionAudio = Boolean(
    (document as { direction?: { production?: { audio?: unknown } } })?.direction?.production
      ?.audio,
  );
  const [modeOverride, setModeOverride] = useState<'silent' | 'production' | 'test' | null>(null);
  const mode = modeOverride ?? (hasProductionAudio ? 'production' : 'silent');
  const [project, setProject] = useState<File[]>([]),
    [cas, setCas] = useState<File[]>([]),
    [library, setLibrary] = useState<File[]>([]);
  const variantData = document as {
    direction?: {
      style?: {
        referenceCalibration?: {
          backdrop?: { boardFrame: string; boardGrid: string; boardCell: string };
        };
      };
      production?: { audio?: { bgm?: { gain?: number } } };
    };
  };
  const [groupRole, setGroupRole] = useState<'background' | 'white' | 'coral' | 'cyan'>('coral'),
    [groupFile, setGroupFile] = useState<File | null>(null);
  const [savedGroup, setSavedGroup] = useState<{ role: typeof groupRole; file: File } | null>(null);
  const [variantBackground, setVariantBackground] = useState<File | null>(null),
    [variantTile, setVariantTile] = useState<File | null>(null);
  const [savedImages, setSavedImages] = useState<{ background: File; tile: File } | null>(null);
  const [variantTheme, setVariantTheme] = useState('pink'),
    [variantGain, setVariantGain] = useRebasedDraft(
      variantData.direction?.production?.audio?.bgm?.gain ?? 1,
    );
  const [savedTheme, setSavedTheme] = useState('pink');
  const [savedGain, setSavedGain] = useRebasedDraft(
    variantData.direction?.production?.audio?.bgm?.gain ?? 1,
  );
  const variantDraft =
    (!!groupFile && (savedGroup?.file !== groupFile || savedGroup.role !== groupRole)) ||
    ((!!variantBackground || !!variantTile) &&
      (savedImages?.background !== variantBackground || savedImages.tile !== variantTile)) ||
    variantTheme !== savedTheme ||
    variantGain !== savedGain;
  useEffect(() => {
    onDraftChange?.('observed-variant', variantDraft);
  }, [onDraftChange, variantDraft]);
  useEffect(() => () => onDraftChange?.('observed-variant', false), [onDraftChange]);
  const [resolved, setResolved] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; document: unknown; hash: string }
  >({ status: 'loading' });
  useEffect(() => {
    let live = true;
    setPointer(null);
    if (!work?.pointer) {
      setPointerState('none');
      return () => {
        live = false;
      };
    }
    setPointerState('loading');
    void verifyObservedPointer(document, work.pointer)
      .then((value) => {
        if (live) {
          setPointer(value);
          setPointerState('ready');
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setPointerState('error');
          setStatus(`作品指针核验失败：${error instanceof Error ? error.message : String(error)}`);
        }
      });
    return () => {
      live = false;
    };
  }, [document, work?.pointer]);
  useEffect(() => {
    let live = true;
    setResolved({ status: 'loading' });
    void inlineBrowserStudioReferences(document, { project, cas, library })
      .then((value) => {
        if (live)
          setResolved({
            status: 'ready',
            document: value.document,
            hash: value.report.canonicalSha256,
          });
      })
      .catch((error: unknown) => {
        if (live)
          setResolved({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      live = false;
    };
  }, [document, project, cas, library]);
  const prepared = useMemo(() => {
    if (
      !active ||
      resolved.status !== 'ready' ||
      !takeId ||
      pointerState === 'loading' ||
      pointerState === 'error'
    )
      return null;
    try {
      return {
        ok: true as const,
        quality: BB_EXPORT_QUALITY[readBBExportQuality(resolved.document)],
        testAudio: readBBTestAudio(resolved.document),
        ...prepareCalibratedRenderer(resolved.document, takeId, pointer),
      };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }, [active, resolved, takeId, pointer, pointerState]);
  const configuration = useMemo<BBPreviewConfiguration | null>(() => {
    if (!prepared?.ok || resolved.status !== 'ready') return null;
    const output = (document as { production?: { output?: { width: number; height: number } } })
      .production?.output;
    if (!output || output.width <= 0 || output.height <= 0) return null;
    const source = prepared.frameSource,
      scale = Math.min(512 / output.width, 864 / output.height);
    return {
      source,
      output,
      quality: prepared.quality,
      preview: {
        width: Math.max(1, Math.round(output.width * scale)),
        height: Math.max(1, Math.round(output.height * scale)),
      },
      audioEnabled: mode !== 'silent',
      async audio(signal) {
        if (mode === 'silent') return null;
        if (mode === 'test') {
          const mix = prepared.testAudio
            ? makeBBConfiguredTestAudio(source, prepared.testAudio)
            : null;
          return {
            pcm: mix?.pcm ?? makeBBDefaultTestAudio(source, 'observed'),
            channels: 1 as const,
            ...(mix ? { warning: mix.warning } : {}),
          };
        }
        if (source.takeId !== prepared.timelinePlan.takeId)
          throw new Error('工程音频与当前 Take 时间线不匹配。');
        const mix = await compileNativeProductionAudio(resolved.document, source, signal);
        return {
          pcm: mix.track.data,
          channels: 2 as const,
          warning: describeProductionMixWarnings(resolved.document, mix),
        };
      },
      async createStage(canvas, width, height, _purpose, _initialFrame, scale) {
        return createObservedBBStage(canvas, width, height, scale, prepared);
      },
    };
  }, [prepared, resolved, document, mode]);
  const player = useBBPlayerConfiguration(configuration);
  const {
    canvas,
    frame,
    setFrame,
    frameRef,
    playing,
    setPlaying,
    status,
    setStatus,
    ready: stageReady,
  } = player;
  useEffect(() => {
    setPlaying(false);
    setFrame(0);
    frameRef.current = 0;
  }, [takeId, setPlaying, setFrame, frameRef]);
  const busy = player.preparing || player.exporting || variantBusy;
  async function exportVideo() {
    if (pointerState === 'error' || pointerState === 'loading') return;
    const result = await player.exportVideo();
    if (!result || !result.isCurrent()) return;
    try {
      downloadBlob(result.blob, `v2-${takeId}-calibrated-${mode}.mp4`);
      setStatus(`视频下载已发起；请检查浏览器下载是否完成。${result.warning}`);
    } catch (error) {
      setStatus(describeExportFailure(error, 'download'));
    }
  }
  async function loadPointer(file: File | undefined) {
    if (!file) return;
    setPointerState('loading');
    try {
      const parsed = JSON.parse(await file.text());
      const valid = await verifyObservedPointer(document, parsed);
      setPointer(valid);
      setPointerState('ready');
      setStatus('工作台圆环指针已核验；预览和导出使用同一轨道。');
    } catch (error) {
      setPointer(null);
      setPointerState('error');
      setStatus(
        `指针旁车无效，已阻止播放及导出：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  async function saveGroupedVariant() {
    setVariantBusy(true);
    setVariantPointer(null);
    try {
      if (!groupFile) throw new Error('请选择替换的 PNG。');
      const { copyObservedGroupedVariant } = await import('../contracts/attachObservedImages');
      const result = await copyObservedGroupedVariant(document, groupRole, groupFile);
      let nextPointer: PointerOverlay | null = null;
      if (pointer) {
        const { rebindPointerForImageVariant } = await import('../contracts/observedPointer');
        nextPointer = await rebindPointerForImageVariant(
          document,
          result.document,
          pointer,
          groupRole,
        );
        setVariantPointer(nextPointer);
      }
      if (work) {
        const { updateBBWorkPackageProject } = await import('../contracts/bbWorkPackage');
        const variant = await updateBBWorkPackageProject({ ...work, pointer }, result.document);
        downloadBlob(
          new Blob([JSON.stringify(variant, null, 2)], { type: 'application/json' }),
          'bb-work-variant.json',
        );
        setStatus(`已另存 ${groupRole} 单槽作品包；原作品保留，重新打开即可加载指针与来源记录。`);
      } else {
        downloadBlob(
          new Blob([JSON.stringify(result.document, null, 2)], { type: 'application/json' }),
          'calibrated-single-slot-variant.json',
        );
        setStatus(
          `已另存 ${groupRole} 单槽变体；原工程保留，请重新打开。${pointer ? '请同时保存新工程的指针旁车。' : ''}`,
        );
      }
      setSavedGroup({ role: groupRole, file: groupFile });
    } catch (error) {
      setStatus(`单槽变体未保存：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setVariantBusy(false);
    }
  }
  async function saveImageVariant() {
    setVariantBusy(true);
    try {
      if (!variantBackground || !variantTile) throw new Error('请同时选择背景和方块 PNG。');
      const { copyObservedImageVariant } = await import('../contracts/attachObservedImages');
      const result = await copyObservedImageVariant(document, {
        background: variantBackground,
        tile: variantTile,
      });
      if (work) {
        const { updateBBWorkPackageProject } = await import('../contracts/bbWorkPackage');
        const updated = await updateBBWorkPackageProject(work, result.document);
        downloadBlob(
          new Blob([JSON.stringify(updated, null, 2)], { type: 'application/json' }),
          'bb-work-image-variant.json',
        );
      } else
        downloadBlob(
          new Blob([JSON.stringify(result.document, null, 2)], { type: 'application/json' }),
          'calibrated-image-variant.json',
        );
      setStatus('已另存背景和统一方块图片变体；原工程保留，请重新打开并预览。');
      setSavedImages({ background: variantBackground, tile: variantTile });
    } catch (error) {
      setStatus(`图片变体未保存：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setVariantBusy(false);
    }
  }
  async function saveVariant() {
    setVariantBusy(true);
    try {
      const { createCalibratedVariant } = await import('../contracts/calibratedVariant');
      const result = await createCalibratedVariant(document, variantTheme, variantGain, {
        project,
        cas,
        library,
      });
      if (work) {
        const { updateBBWorkPackageProject } = await import('../contracts/bbWorkPackage');
        const updated = await updateBBWorkPackageProject(work, result.document);
        downloadBlob(
          new Blob([JSON.stringify(updated, null, 2)], { type: 'application/json' }),
          'bb-work-theme-bgm-variant.json',
        );
      } else
        downloadBlob(
          new Blob([JSON.stringify(result.document, null, 2)], { type: 'application/json' }),
          'calibrated-theme-bgm-variant.json',
        );
      setStatus(`已另存程序主题与 BGM 增益变体；请重新打开。${result.warning}`);
      setSavedTheme(variantTheme);
      setSavedGain(variantGain);
    } catch (error) {
      setStatus(`变体未保存：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setVariantBusy(false);
    }
  }
  return (
    <section className="native-preview">
      <h2>BB 校准渲染器测试预览</h2>
      <p>
        {multi
          ? '使用工作台 2.0.0 多轨道合同；逐 Take 核验动作、状态哈希和帧率后，调用状态帧渲染实现。'
          : '使用基于参考源码改造的工作台状态帧渲染实现；单轨合同仅支持第一个 Take。'}
        不会验证历史工程锁定的扩展哈希。背景、候选牌面及棋盘图集支持图片绑定；清除碎片当前使用牌面而非按原格切片，外部布局／镜头
        profile 尚未接入。
      </p>
      {multi && valid.length > 0 && (
        <label>
          校准 Take{' '}
          <select
            aria-label="V2 校准 Take"
            value={selected}
            disabled={playing || busy}
            onChange={(event) => {
              setPlaying(false);
              setFrame(0);
              frameRef.current = 0;
              onSelect(event.target.value);
              setStatus('');
            }}
          >
            {!takeId && <option value={selected}>{selected || '未选择'}（没有合法动作）</option>}
            {valid.map((item) => (
              <option value={item.takeId} key={item.takeId}>
                {item.takeId}
              </option>
            ))}
          </select>
        </label>
      )}
      {hasStudioAssetReferences(document) && (
        <div>
          {(
            [
              ['工程所在目录', setProject, project],
              ['CAS 素材库目录', setCas, cas],
              ['元素库缓存目录', setLibrary, library],
            ] as const
          ).map(([label, set, files]) => (
            <p key={label}>
              <label>
                选择{label}{' '}
                <input
                  type="file"
                  aria-label={`校准${label}`}
                  multiple
                  {...({ webkitdirectory: '' } as Record<string, string>)}
                  disabled={busy || playing}
                  onChange={(e) => {
                    set(Array.from(e.target.files ?? []));
                    e.target.value = '';
                  }}
                />
              </label>{' '}
              已选择 {files.length} 个文件
            </p>
          ))}
        </div>
      )}
      {resolved.status === 'loading' && <p>正在核验素材…</p>}
      {resolved.status === 'error' && <p role="alert">{resolved.message}；原工程保留。</p>}
      {resolved.status === 'ready' && <p>素材字节和规范化工程身份已核验：{resolved.hash}。</p>}
      {!multi && (
        <details>
          <summary>复制分槽图片的单槽变体</summary>
          <p>仅支持灰色主题的观察分槽工程；white 对应除 coral 和 cyan 外的颜色。</p>
          <label>
            槽位{' '}
            <select
              aria-label="变体单槽"
              value={groupRole}
              onChange={(e) => setGroupRole(e.target.value as typeof groupRole)}
            >
              {['background', 'white', 'coral', 'cyan'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            替换 PNG{' '}
            <input
              type="file"
              aria-label="变体单槽 PNG"
              accept="image/png,.png"
              onChange={(e) => setGroupFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button disabled={busy || playing} onClick={() => void saveGroupedVariant()}>
            另存单槽图片变体
          </button>
          {variantPointer && (
            <button
              onClick={() =>
                downloadBlob(
                  new Blob([JSON.stringify(variantPointer, null, 2)], { type: 'application/json' }),
                  'calibrated-variant-pointer.json',
                )
              }
            >
              保存单槽变体的指针旁车
            </button>
          )}
        </details>
      )}
      {!multi && (
        <details>
          <summary>复制背景与方块图片变体</summary>
          <p>
            仅支持观察入口同时内嵌背景和统一方块 PNG
            的工程；更换两张图，保留玩法、时钟和音频。其他素材布局会明确拒绝。
          </p>
          <label>
            新背景 PNG{' '}
            <input
              aria-label="变体背景 PNG"
              type="file"
              accept="image/png,.png"
              onChange={(e) => setVariantBackground(e.target.files?.[0] ?? null)}
            />
          </label>{' '}
          <label>
            新方块 PNG{' '}
            <input
              aria-label="变体方块 PNG"
              type="file"
              accept="image/png,.png"
              onChange={(e) => setVariantTile(e.target.files?.[0] ?? null)}
            />
          </label>{' '}
          <button disabled={busy || playing} onClick={() => void saveImageVariant()}>
            另存图片变体
          </button>
        </details>
      )}
      {!multi && variantData.direction?.production?.audio?.bgm && (
        <details>
          <summary>复制程序主题与音乐变体</summary>
          <p>
            适用于无图片素材的校准工程；主题会改变程序背景、棋盘、方块和部分反馈样式，音乐仅改变 BGM
            增益。玩法和事件时钟保留。另存后重新打开。
          </p>
          <label>
            程序主题{' '}
            <select
              aria-label="变体程序主题"
              value={variantTheme}
              onChange={(e) => setVariantTheme(e.target.value)}
            >
              <option value="pink">粉色</option>
              <option value="grey">灰色</option>
              <option value="purple">紫色</option>
            </select>
          </label>{' '}
          <label>
            音乐增益{' '}
            <input
              aria-label="变体音乐增益"
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={variantGain}
              onChange={(e) => setVariantGain(e.target.valueAsNumber)}
            />
          </label>{' '}
          <button disabled={busy || playing} onClick={() => void saveVariant()}>
            检查并另存主题和音乐变体
          </button>
        </details>
      )}
      <p>
        工作台新增圆环指针：可载入与本工程 SHA-256 及 Take
        严格绑定的旁车；不是原生手指效果。错误旁车会阻止播放与导出，清除后明确使用无指针模式。
        {work ? '作品包内的指针已自动载入；手动移除仅作用于本次预览。' : ''}当前：
        {pointerState === 'none'
          ? '无指针，需另选旁车'
          : pointerState === 'loading'
            ? '核验中'
            : pointerState === 'ready'
              ? '指针已启用'
              : '旁车错误'}
        。
      </p>
      <label>
        指针旁车{' '}
        <input
          aria-label="校准指针旁车"
          type="file"
          accept="application/json,.json"
          disabled={busy || playing}
          onChange={(e) => {
            void loadPointer(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>{' '}
      <button
        disabled={busy || playing}
        onClick={() => {
          setPointer(null);
          setPointerState('none');
          setStatus('已明确移除指针旁车；当前预览和导出无指针。');
        }}
      >
        清除指针旁车
      </button>
      {!takeId && (
        <p role="alert">
          {!multi && selected && selected !== firstTake
            ? '当前观察轨道只绑定首个 Take，请选择首个 Take 或配置多轨道。'
            : '当前 Take 没有合法的非空动作。'}
        </p>
      )}
      {resolved.status === 'ready' &&
        takeId &&
        (!active ? (
          <button onClick={() => setActive(true)}>使用当前校准渲染器测试</button>
        ) : (
          <>
            {prepared && !prepared.ok && <p role="alert">{prepared.message}</p>}
            {prepared?.ok && (
              <BBPlaybackControls
                player={player}
                totalFrames={prepared.frameSource.totalFrames}
                fps={prepared.frameSource.fps}
                canvasLabel="V2 校准渲染画面"
                seekLabel="校准预览帧"
                playLabel="播放校准预览"
                pauseLabel="暂停校准预览"
                exportLabel="导出校准测试视频"
                onExport={() => void exportVideo()}
                seekWhilePlaying={false}
                disableExportWhilePlaying
                disablePlay={variantBusy || pointerState === 'error' || pointerState === 'loading'}
                disableExport={
                  variantBusy || pointerState === 'error' || pointerState === 'loading'
                }
                audioControls={
                  <>
                    <label>
                      音轨{' '}
                      <select
                        aria-label="校准预览音轨"
                        value={mode}
                        disabled={playing || busy}
                        onChange={(e) => setModeOverride(e.target.value as typeof mode)}
                      >
                        <option value="silent">无声</option>
                        <option value="production">工程音频</option>
                        <option value="test">合成测试音</option>
                      </select>
                    </label>
                    {modeOverride !== null && (
                      <button
                        type="button"
                        disabled={playing || busy}
                        onClick={() => setModeOverride(null)}
                      >
                        跟随工程声音
                      </button>
                    )}
                  </>
                }
                afterCanvas={
                  <CalibratedComparison
                    document={document}
                    pointer={pointer}
                    workSource={work?.source ?? null}
                    frame={frame}
                    fps={prepared.frameSource.fps}
                    sourceCanvas={canvas}
                    stageReady={stageReady}
                    actions={
                      (document as any)?.direction?.style?.referenceCalibration?.actions ?? []
                    }
                  />
                }
              />
            )}
          </>
        ))}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
