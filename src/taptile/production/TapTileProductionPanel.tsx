import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { exportFixedFrameVideo, renderFixedFrameToCanvas, type FixedFrameExportResult, type FrameRenderProgress } from '../../exporter/fixedFrameExporter';
import { downloadBlob } from '../../utils/download';
import {
  assertTapTileBlenderVfxCompatibility,
  createTapTileBlenderSceneExchange,
  createTapTileBlenderVfxAsset,
  exportTapTileBlenderBundle,
  forgetTapTileBlenderVfxAsset,
  persistTapTileBlenderVfxAsset,
  restoreTapTileBlenderVfxAsset,
  type TapTileBlenderVfxAsset,
} from '../blender';
import type { CompiledTapTileLevel, TapTileProjectV2 } from '../project';
import { hashCanvasPixels, resolveTapTileVideoQualityProfile, TAPTILE_VIDEO_QUALITY_PROFILES } from '../render';
import {
  expandTapTileBatchMatrix,
  prepareTapTileVariant,
  runTapTileBatch,
  serializeTapTileRenderManifest,
  validateTapTileVariantDependencies,
  type TapTileBatchTask,
  type PreparedTapTileVariant,
  type TapTileVariantSpec,
} from './index';
import { createTapTileRenderManifest } from './manifest';
import { exportTapTileProjectBundle, importTapTileProjectBundle } from './projectBundle';
import { preflightTapTileProductionRenderJob, selectTapTileProductionVerificationFrames } from './renderJob';

const TapTileBlenderPreview = lazy(async () => {
  const module = await import('../blender/TapTileBlenderPreview');
  return { default: module.TapTileBlenderPreview };
});

interface TapTileProductionPanelProps {
  project: TapTileProjectV2;
  level: CompiledTapTileLevel;
  onChange(mutator: (draft: TapTileProjectV2) => void): void;
  onImport(project: TapTileProjectV2): void;
  onNotice(message: string): void;
}

interface ProductionArtifact {
  videoUrl: string;
  manifestUrl: string;
  video: FixedFrameExportResult;
  manifestText: string;
  manifestFileName: string;
  sha256: string;
  pcmHash: string;
  combinationHash: string;
}

interface BatchArtifact {
  taskId: string;
  videoUrl: string;
  manifestUrl: string;
  videoFileName: string;
  manifestFileName: string;
}

function selectedVariant(project: TapTileProjectV2, level: CompiledTapTileLevel): TapTileVariantSpec | null {
  const take = project.takes.find((candidate) => candidate.id === project.selectedTakeId) ?? project.takes.at(-1);
  const skinPackId = project.visuals.selectedThemeId;
  const directorProfileId = project.director.selectedProfileId;
  const audioPackId = project.production.selectedAudioPackId ?? Object.keys(project.production.audioPacks)[0];
  const cutSpecId = project.production.selectedCutId ?? Object.keys(project.production.cuts)[0];
  const cut = cutSpecId ? project.production.cuts[cutSpecId] : undefined;
  if (!take || !audioPackId || !cutSpecId) return null;
  return {
    levelId: project.level.id,
    takeId: take.id,
    skinPackId,
    directorProfileId,
    audioPackId,
    cutSpecId,
    ...(cut?.outroPackId ? { outroPackId: cut.outroPackId } : {}),
    renderSpec: structuredClone(project.render),
  };
}

function releaseArtifact(artifact: ProductionArtifact | null): void {
  if (!artifact) return;
  URL.revokeObjectURL(artifact.videoUrl);
  URL.revokeObjectURL(artifact.manifestUrl);
}

export function TapTileProductionPanel({ project, level, onChange, onImport, onNotice }: TapTileProductionPanelProps) {
  const qualityProfile = resolveTapTileVideoQualityProfile(project.render.quality);
  const spec = useMemo(() => selectedVariant(project, level), [level, project]);
  const dependency = useMemo(
    () => spec ? validateTapTileVariantDependencies(project, level, spec) : { valid: false, reasons: ['TAKE_MISSING: 请先保存至少一条 Take。'] },
    [level, project, spec],
  );
  const [preview, setPreview] = useState<PreparedTapTileVariant | null>(null);
  const [previewFrame, setPreviewFrame] = useState(0);
  const [previewHash, setPreviewHash] = useState('pending');
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRenderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRenderQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [singleProgress, setSingleProgress] = useState<FrameRenderProgress | null>(null);
  const [singleError, setSingleError] = useState('');
  const [singleArtifact, setSingleArtifact] = useState<ProductionArtifact | null>(null);
  const singleAbortRef = useRef<AbortController | null>(null);
  const [batchTasks, setBatchTasks] = useState<TapTileBatchTask[]>([]);
  const [batchArtifacts, setBatchArtifacts] = useState<BatchArtifact[]>([]);
  const batchAbortRef = useRef<AbortController | null>(null);
  const bundleImportRef = useRef<HTMLInputElement | null>(null);
  const blenderVfxInputRef = useRef<HTMLInputElement | null>(null);
  const [bundleResult, setBundleResult] = useState<{ url: string; fileName: string; bytes: number; projectHash: string } | null>(null);
  const [blenderExchangeSummary, setBlenderExchangeSummary] = useState<{
    fileName: string;
    bytes: number;
    entities: number;
    tracks: number;
    events: number;
    frames: number;
    assets: number;
    checksums: number;
  } | null>(null);
  const [blenderExporting, setBlenderExporting] = useState(false);
  const [blenderError, setBlenderError] = useState('');
  const [blenderVfxAsset, setBlenderVfxAsset] = useState<TapTileBlenderVfxAsset | null>(null);
  const [blenderVfxEnabled, setBlenderVfxEnabled] = useState(false);
  const [blenderVfxError, setBlenderVfxError] = useState('');
  const [blenderVfxPersistence, setBlenderVfxPersistence] = useState<'idle' | 'restoring' | 'stored' | 'session-only'>('idle');

  useEffect(() => {
    let active = true;
    setBlenderVfxAsset(null);
    setBlenderVfxEnabled(false);
    setBlenderVfxPersistence('restoring');
    void restoreTapTileBlenderVfxAsset(project.id).then((asset) => {
      if (!active) return;
      if (asset) {
        setBlenderVfxAsset(asset);
        setBlenderVfxEnabled(true);
        setBlenderVfxPersistence('stored');
      } else {
        setBlenderVfxPersistence('idle');
      }
    }).catch((error: unknown) => {
      if (!active) return;
      try {
        forgetTapTileBlenderVfxAsset(project.id);
      } catch {
        // Storage can be blocked by browser privacy settings. The imported GLB
        // remains usable for this session even when its stale pointer cannot be removed.
      }
      setBlenderVfxPersistence('idle');
      setBlenderVfxError(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, [project.id]);

  useEffect(() => {
    if (!spec || !dependency.valid) {
      setPreview(null);
      return undefined;
    }
    let prepared: PreparedTapTileVariant | null = null;
    try {
      prepared = prepareTapTileVariant(project, level, spec, {
        ...(blenderVfxEnabled && blenderVfxAsset ? { blenderVfxAsset } : {}),
      });
      setPreview(prepared);
      // Keep the actionable incompatibility message visible after the effect
      // reruns with the automatically disabled asset and recovers in 2D.
      if (blenderVfxEnabled || !blenderVfxAsset) setBlenderVfxError('');
    } catch (error) {
      if (blenderVfxEnabled && blenderVfxAsset) {
        const message = error instanceof Error ? error.message : String(error);
        setBlenderVfxEnabled(false);
        setBlenderVfxError(`3D 特效与当前 Take 不兼容，已自动停用；2D 预览仍可继续。${message}`);
        try {
          prepared = prepareTapTileVariant(project, level, spec);
          setPreview(prepared);
        } catch {
          setPreview(null);
        }
      } else {
        setPreview(null);
      }
    }
    return () => { void prepared?.job.dispose?.(); };
  }, [blenderVfxAsset, blenderVfxEnabled, dependency.valid, level, project, spec]);
  useEffect(() => () => releaseArtifact(singleArtifact), [singleArtifact]);
  useEffect(() => () => {
    for (const artifact of batchArtifacts) {
      URL.revokeObjectURL(artifact.videoUrl);
      URL.revokeObjectURL(artifact.manifestUrl);
    }
  }, [batchArtifacts]);
  useEffect(() => () => { if (bundleResult) URL.revokeObjectURL(bundleResult.url); }, [bundleResult]);

  useEffect(() => {
    setPreviewFrame((current) => Math.min(current, Math.max(0, (preview?.job.totalFrames ?? 1) - 1)));
  }, [preview?.job.totalFrames]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!preview || !canvas) { setPreviewHash('unavailable'); return; }
    let active = true;
    setPreviewHash('pending');
    const renderCanvas = previewRenderCanvasRef.current ?? document.createElement('canvas');
    previewRenderCanvasRef.current = renderCanvas;
    const timer = window.setTimeout(() => {
      const queued = previewRenderQueueRef.current.catch(() => undefined).then(async () => {
        if (!active) return;
        await renderFixedFrameToCanvas(preview.job, preview.job.evaluate(previewFrame), canvas, qualityProfile.renderScale, renderCanvas);
        if (active) setPreviewHash(hashCanvasPixels(canvas));
      }).catch((error: unknown) => {
        if (active) setPreviewHash(`error:${error instanceof Error ? error.message : String(error)}`);
      });
      previewRenderQueueRef.current = queued;
    }, 48);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [preview, previewFrame, qualityProfile.renderScale]);
  useEffect(() => () => {
    if (previewRenderCanvasRef.current) {
      previewRenderCanvasRef.current.width = 1;
      previewRenderCanvasRef.current.height = 1;
      previewRenderCanvasRef.current = null;
    }
  }, []);

  const matrix = useMemo(() => expandTapTileBatchMatrix(project, level, {
    takeIds: project.takes.map((take) => take.id),
    skinPackIds: Object.keys(project.visuals.themes),
    directorProfileIds: Object.keys(project.director.profiles).slice(0, 3),
    audioPackIds: Object.keys(project.production.audioPacks),
    cutSpecIds: Object.keys(project.production.cuts),
    outroPackIds: Object.keys(project.production.outros),
    renderSpecs: [project.render],
  }), [level, project]);
  const validMatrix = useMemo(() => matrix.filter((task) => validateTapTileVariantDependencies(project, level, task.spec).valid), [level, matrix, project]);
  const invalidMatrix = matrix.length - validMatrix.length;

  const updateSelection = (kind: 'take' | 'skin' | 'director' | 'audio' | 'cut' | 'outro' | 'quality', value: string): void => {
    onChange((draft) => {
      if (kind === 'take') draft.selectedTakeId = value;
      else if (kind === 'skin') draft.visuals.selectedThemeId = value;
      else if (kind === 'director') draft.director.selectedProfileId = value;
      else if (kind === 'audio') draft.production.selectedAudioPackId = value;
      else if (kind === 'cut') draft.production.selectedCutId = value;
      else if (kind === 'quality') draft.render.quality = value as TapTileProjectV2['render']['quality'];
      else {
        const cutId = draft.production.selectedCutId;
        if (cutId && draft.production.cuts[cutId]) draft.production.cuts[cutId]!.outroPackId = value;
      }
    });
    setPreviewFrame(0);
  };

  const exportProductionVariant = async (): Promise<void> => {
    if (!spec || !dependency.valid || singleAbortRef.current) return;
    releaseArtifact(singleArtifact);
    setSingleArtifact(null);
    setSingleError('');
    const controller = new AbortController();
    singleAbortRef.current = controller;
    let prepared: ReturnType<typeof prepareTapTileVariant> | undefined;
    try {
      prepared = prepareTapTileVariant(project, level, spec, {
        ...(blenderVfxEnabled && blenderVfxAsset ? { blenderVfxAsset } : {}),
      });
      const preflight = await preflightTapTileProductionRenderJob(prepared.job);
      if (!preflight.valid) throw new Error(preflight.issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'));
      const video = await exportFixedFrameVideo(prepared.job, {
        bitrate: qualityProfile.videoBitrate,
        renderScale: qualityProfile.renderScale,
        fileName: prepared.fileName,
        signal: controller.signal,
        onProgress: setSingleProgress,
        keyFrameIntervalSeconds: qualityProfile.keyFrameIntervalSeconds,
        audio: {
          data: prepared.job.audioMix.data,
          sampleRate: prepared.job.audioMix.sampleRate,
          numberOfChannels: prepared.job.audioMix.numberOfChannels,
          bitrate: qualityProfile.audioBitrate,
        },
        metadata: {
          title: `${prepared.project.name} · TapTile production variant`,
          artist: 'Block Creative Studio',
          comment: `${prepared.job.identity.combinationHash} · ${prepared.job.audioMix.pcmHash}`,
        },
        visualVerification: {
          frameIndexes: selectTapTileProductionVerificationFrames(prepared.job),
          renderScale: qualityProfile.renderScale,
        },
      });
      const manifest = await createTapTileRenderManifest(prepared.project, level, prepared.job, video);
      const manifestText = serializeTapTileRenderManifest(manifest);
      const videoUrl = URL.createObjectURL(video.blob);
      const manifestUrl = URL.createObjectURL(new Blob([manifestText], { type: 'application/json' }));
      setSingleArtifact({
        videoUrl,
        manifestUrl,
        video,
        manifestText,
        manifestFileName: `${video.fileName}.manifest.json`,
        sha256: manifest.output.sha256,
        pcmHash: manifest.audio.pcmHash,
        combinationHash: manifest.combinationHash,
      });
      onNotice(`带音频成片已完成：${video.frameCount} 帧 · ${manifest.audio.cueCount} 个语义音效`);
    } catch (error) {
      const canceled = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      setSingleError(canceled ? '成片导出已取消；工程保持不变。' : error instanceof Error ? error.message : String(error));
    } finally {
      await prepared?.job.dispose?.();
      singleAbortRef.current = null;
    }
  };

  const importBlenderVfx = async (file: File): Promise<void> => {
    setBlenderVfxError('');
    try {
      const asset = await createTapTileBlenderVfxAsset(await file.arrayBuffer(), file.name);
      if (preview) {
        assertTapTileBlenderVfxCompatibility(asset, {
          totalFrames: preview.job.baseJob.compiledTake.totalFrames,
          fps: preview.job.baseJob.compiledTake.fps,
          matchEventIds: preview.job.baseJob.compiledTake.actions
            .filter((action) => action.transition.matchedTileIds.length === 3)
            .map((action) => `${action.actionId}:match`),
        });
      }
      setBlenderVfxAsset(asset);
      setBlenderVfxEnabled(true);
      try {
        await persistTapTileBlenderVfxAsset(project.id, asset);
        setBlenderVfxPersistence('stored');
      } catch {
        setBlenderVfxPersistence('session-only');
      }
      const timeline = asset.validation.inspection.timeline!;
      const assetKind = asset.validation.tileEntityCount === 0 ? 'VFX 专用轻量层' : '完整场景特效层';
      const matchEvents = asset.validation.inspection.entityIdsByRole['match-core']?.length ?? 0;
      onNotice(`Blender ${assetKind}已接入成片：${timeline.frameCount} 帧 · ${matchEvents} 个三消事件 · ${asset.validation.effectFragmentCount} 片视觉碎片`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBlenderVfxError(message);
      onNotice(`Blender 3D 特效层导入失败：${message}`);
    }
  };

  const toggleBlenderVfx = (enabled: boolean): void => {
    setBlenderVfxEnabled(enabled);
    if (!blenderVfxAsset) return;
    if (!enabled) {
      try {
        forgetTapTileBlenderVfxAsset(project.id);
        setBlenderVfxPersistence('idle');
        setBlenderVfxError('');
      } catch {
        setBlenderVfxPersistence('session-only');
        setBlenderVfxError('3D 特效已在本次会话停用，但浏览器阻止清除自动恢复记录。');
      }
      return;
    }
    void persistTapTileBlenderVfxAsset(project.id, blenderVfxAsset).then(() => {
      setBlenderVfxPersistence('stored');
    }).catch(() => {
      setBlenderVfxPersistence('session-only');
    });
  };

  const startBatch = async (): Promise<void> => {
    if (batchAbortRef.current || validMatrix.length === 0) return;
    for (const artifact of batchArtifacts) {
      URL.revokeObjectURL(artifact.videoUrl);
      URL.revokeObjectURL(artifact.manifestUrl);
    }
    setBatchArtifacts([]);
    const preferred = validMatrix.filter((task) => task.spec.cutSpecId === project.production.selectedCutId);
    const pool = preferred.length >= 3 ? preferred : validMatrix;
    const indexes = [...new Set([0, Math.floor(pool.length / 2), pool.length - 1])];
    const selected = indexes.map((index) => pool[index]).filter((task): task is TapTileBatchTask => Boolean(task));
    const controller = new AbortController();
    batchAbortRef.current = controller;
    setBatchTasks(selected);
    const finished = await runTapTileBatch(project, level, selected, async (prepared, signal, onProgress) => {
      const preflight = await preflightTapTileProductionRenderJob(prepared.job);
      if (!preflight.valid) throw new Error(preflight.issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'));
      return exportFixedFrameVideo(prepared.job, {
        bitrate: qualityProfile.videoBitrate,
        renderScale: qualityProfile.renderScale,
        fileName: prepared.fileName,
        ...(signal ? { signal } : {}),
        onProgress,
        keyFrameIntervalSeconds: qualityProfile.keyFrameIntervalSeconds,
        audio: {
          data: prepared.job.audioMix.data,
          sampleRate: prepared.job.audioMix.sampleRate,
          numberOfChannels: prepared.job.audioMix.numberOfChannels,
          bitrate: qualityProfile.audioBitrate,
        },
        metadata: { title: prepared.fileName, artist: 'Block Creative Studio', comment: prepared.job.identity.combinationHash },
        visualVerification: {
          frameIndexes: selectTapTileProductionVerificationFrames(prepared.job),
          renderScale: qualityProfile.renderScale,
        },
      });
    }, { signal: controller.signal, onUpdate: setBatchTasks });
    const artifacts: BatchArtifact[] = [];
    for (const task of finished) {
      if (!task.result) continue;
      const manifestText = serializeTapTileRenderManifest(task.result.manifest);
      artifacts.push({
        taskId: task.id,
        videoUrl: URL.createObjectURL(task.result.video.blob),
        manifestUrl: URL.createObjectURL(new Blob([manifestText], { type: 'application/json' })),
        videoFileName: task.result.video.fileName,
        manifestFileName: `${task.result.video.fileName}.manifest.json`,
      });
    }
    setBatchArtifacts(artifacts);
    batchAbortRef.current = null;
    const completed = finished.filter((task) => task.status === 'completed').length;
    const failed = finished.filter((task) => task.status === 'failed').length;
    onNotice(`批量队列完成：${completed} 成功 · ${failed} 失败`);
  };

  const exportBundle = async (): Promise<void> => {
    const result = await exportTapTileProjectBundle(project);
    if (bundleResult) URL.revokeObjectURL(bundleResult.url);
    const url = URL.createObjectURL(result.blob);
    setBundleResult({ url, fileName: result.fileName, bytes: result.blob.size, projectHash: result.manifest.projectHash });
    onNotice(`项目包已生成：${result.manifest.takeIds.length} 条 Take · ${Object.keys(result.checksums).length} 个校验项`);
  };

  const exportBlenderExchange = async (): Promise<void> => {
    if (!preview || blenderExporting) return;
    setBlenderExporting(true);
    setBlenderError('');
    try {
      const exchange = createTapTileBlenderSceneExchange(
        preview.project,
        level,
        preview.job.baseJob.compiledTake,
        { packageId: `${preview.project.id}-${preview.job.identity.combinationHash}` },
      );
      const result = await exportTapTileBlenderBundle(exchange, {
        fileNameBase: `${preview.project.name}__${exchange.id}`,
      });
      downloadBlob(result.blob, result.fileName);
      setBlenderExchangeSummary({
        fileName: result.fileName,
        bytes: result.blob.size,
        entities: exchange.entities.length,
        tracks: exchange.tracks.length,
        events: exchange.events.length,
        frames: exchange.output.frameEnd - exchange.output.frameStart + 1,
        assets: result.manifest.assetCount,
        checksums: Object.keys(result.checksums).length,
      });
      onNotice(`Blender 自包含包已生成：${result.manifest.assetCount} 个贴图 · ${exchange.events.length} 次三消 · ${Object.keys(result.checksums).length} 个校验项`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBlenderError(message);
      onNotice(`Blender 包生成失败：${message}`);
    } finally {
      setBlenderExporting(false);
    }
  };

  const selectedCut = spec ? project.production.cuts[spec.cutSpecId] : undefined;
  const batchCompleted = batchTasks.filter((task) => task.status === 'completed').length;
  const batchFailed = batchTasks.filter((task) => task.status === 'failed').length;
  const batchCanceled = batchTasks.filter((task) => task.status === 'canceled').length;
  const currentProductionFrame = preview?.job.evaluate(previewFrame);

  return (
    <section
      className="tpt-production-panel"
      data-production-valid={dependency.valid ? 'true' : 'false'}
      data-production-takes={project.takes.length}
      data-production-skins={Object.keys(project.visuals.themes).length}
      data-production-directors={Object.keys(project.director.profiles).length}
      data-production-audio-packs={Object.keys(project.production.audioPacks).length}
      data-production-cuts={Object.keys(project.production.cuts).length}
      data-production-outros={Object.keys(project.production.outros).length}
      data-matrix-total={matrix.length}
      data-matrix-valid={validMatrix.length}
      data-matrix-invalid={invalidMatrix}
      data-single-phase={singleProgress?.phase ?? 'idle'}
      data-single-error={singleError}
      data-single-bytes={singleArtifact?.video.blob.size ?? 0}
      data-single-frames={singleArtifact?.video.frameCount ?? 0}
      data-single-video-sha={singleArtifact?.sha256 ?? ''}
      data-single-pcm-hash={singleArtifact?.pcmHash ?? ''}
      data-single-combination-hash={singleArtifact?.combinationHash ?? ''}
      data-single-container-verified={singleArtifact?.video.verification.containerReadable ? 'true' : 'false'}
      data-single-actual-fps={singleArtifact?.video.verification.averageFrameRate ?? 0}
      data-single-actual-video-bitrate={singleArtifact?.video.verification.averageVideoBitrate ?? 0}
      data-single-minimum-psnr={singleArtifact?.video.verification.visual ? Math.min(...singleArtifact.video.verification.visual.samples.map((sample) => sample.psnrDb)) : 0}
      data-single-visual-sample-count={singleArtifact?.video.verification.visual?.samples.length ?? 0}
      data-single-visual-sample-frames={singleArtifact?.video.verification.visual?.samples.map((sample) => sample.frameIndex).join(',') ?? ''}
      data-single-render-scale={singleArtifact?.video.renderScale ?? 0}
      data-batch-total={batchTasks.length}
      data-batch-completed={batchCompleted}
      data-batch-failed={batchFailed}
      data-batch-canceled={batchCanceled}
      data-blender-exchange-bytes={blenderExchangeSummary?.bytes ?? 0}
      data-blender-exchange-entities={blenderExchangeSummary?.entities ?? 0}
      data-blender-exchange-tracks={blenderExchangeSummary?.tracks ?? 0}
      data-blender-exchange-events={blenderExchangeSummary?.events ?? 0}
      data-blender-exchange-frames={blenderExchangeSummary?.frames ?? 0}
      data-blender-exchange-assets={blenderExchangeSummary?.assets ?? 0}
      data-blender-exchange-checksums={blenderExchangeSummary?.checksums ?? 0}
      data-blender-exporting={blenderExporting ? 'true' : 'false'}
      data-blender-vfx-loaded={blenderVfxAsset ? 'true' : 'false'}
      data-blender-vfx-enabled={blenderVfxEnabled && blenderVfxAsset ? 'true' : 'false'}
      data-blender-vfx-sha={blenderVfxAsset?.sha256 ?? ''}
      data-blender-vfx-events={blenderVfxAsset?.validation.inspection.entityIdsByRole['match-core']?.length ?? 0}
      data-blender-vfx-isolated={blenderVfxAsset && blenderVfxAsset.validation.tileEntityCount === 0 ? 'true' : 'false'}
      data-blender-vfx-persistence={blenderVfxPersistence}
    >
      <div className="tpt-production-heading">
        <div><strong>投放成片与批量矩阵</strong><small>语义音频 · Cut/TimeWarp · Outro · manifest · 项目包</small></div>
        <span className={dependency.valid ? 'is-valid' : 'is-invalid'}>{dependency.valid ? '依赖完整' : `${dependency.reasons.length} 个依赖问题`}</span>
      </div>
      <div className="tpt-production-grid">
        <div className="tpt-production-controls">
          <label><span>Take</span><select data-production-take value={spec?.takeId ?? ''} onChange={(event) => updateSelection('take', event.target.value)}>{project.takes.map((take) => <option key={take.id} value={take.id}>{take.name} · {take.actions.length} 步</option>)}</select></label>
          <label><span>SkinPack</span><select data-production-skin value={spec?.skinPackId ?? ''} onChange={(event) => updateSelection('skin', event.target.value)}>{Object.values(project.visuals.themes).map((skin) => <option key={skin.id} value={skin.id}>{skin.name}</option>)}</select></label>
          <label><span>Director</span><select data-production-director value={spec?.directorProfileId ?? ''} onChange={(event) => updateSelection('director', event.target.value)}>{Object.values(project.director.profiles).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
          <label><span>AudioPack</span><select data-production-audio value={spec?.audioPackId ?? ''} onChange={(event) => updateSelection('audio', event.target.value)}>{Object.values(project.production.audioPacks).map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}</select></label>
          <label><span>CutSpec</span><select data-production-cut value={spec?.cutSpecId ?? ''} onChange={(event) => updateSelection('cut', event.target.value)}>{Object.values(project.production.cuts).map((cut) => <option key={cut.id} value={cut.id}>{cut.name}</option>)}</select></label>
          <label><span>OutroPack</span><select data-production-outro value={selectedCut?.outroPackId ?? ''} onChange={(event) => updateSelection('outro', event.target.value)}>{Object.values(project.production.outros).map((outro) => <option key={outro.id} value={outro.id}>{outro.name} · {outro.durationFrames}f</option>)}</select></label>
          <label><span>1080p30 画质</span><select data-production-quality value={project.render.quality} onChange={(event) => updateSelection('quality', event.target.value)}>{TAPTILE_VIDEO_QUALITY_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label} · {profile.videoBitrate / 1_000_000} Mbps</option>)}</select><small>{qualityProfile.description}</small></label>
        </div>
        <div className="tpt-production-preview-card">
          <canvas ref={previewCanvasRef} className="tpt-production-preview" width={1080} height={1920} data-preview-hash={previewHash} data-preview-frame={previewFrame} data-preview-source-frame={currentProductionFrame?.sourceFrame ?? -1} data-preview-phase={currentProductionFrame?.phase ?? 'unavailable'} />
          {preview && (
            <>
              <input data-production-preview-seek type="range" min={0} max={preview.job.totalFrames - 1} value={previewFrame} onChange={(event) => setPreviewFrame(Number(event.target.value))} />
              <div><b>{preview.job.totalFrames} 帧 / {(preview.job.totalFrames / preview.job.fps).toFixed(2)} 秒</b><span>{currentProductionFrame?.phase} · 源帧 {currentProductionFrame?.sourceFrame} · {preview.job.audioMix.scheduledCues.length} cues</span></div>
              <small>{preview.job.identity.combinationHash} · {preview.job.audioMix.pcmHash} · peak {preview.job.audioMix.peakAfterLimit.toFixed(3)}</small>
            </>
          )}
        </div>
      </div>
      {!dependency.valid && <p className="tpt-production-error" data-production-error>{dependency.reasons.join(' · ')}</p>}
      {singleProgress && <div className="tpt-export-progress"><i style={{ width: `${singleProgress.ratio * 100}%` }} /><span>{singleProgress.message}</span></div>}
      {singleError && <p className="tpt-production-error">{singleError}</p>}
      {singleArtifact && <div className="tpt-encode-verification" data-encode-verification="passed"><b>✓ MP4 回读验收通过</b><span>{singleArtifact.video.verification.width}×{singleArtifact.video.verification.height} · {singleArtifact.video.verification.averageFrameRate.toFixed(3)}fps · {singleArtifact.video.verification.frameCount} 帧 · {singleArtifact.video.renderScale.toFixed(2)}× 渲染 · {(singleArtifact.video.verification.averageVideoBitrate / 1_000_000).toFixed(2)} Mbps · {singleArtifact.video.verification.audioCodec ?? '无音轨'}{singleArtifact.video.verification.visual ? ` · ${singleArtifact.video.verification.visual.samples.length} 个源帧回读 · 最低 PSNR ${Math.min(...singleArtifact.video.verification.visual.samples.map((sample) => sample.psnrDb)).toFixed(2)} dB` : ''}</span></div>}
      <div className="tpt-production-actions">
        {singleAbortRef.current
          ? <button data-action="cancel-production-export" onClick={() => singleAbortRef.current?.abort()}>取消带音频导出</button>
          : <button data-action="start-production-export" className="tpt-action-primary" disabled={!dependency.valid} onClick={() => void exportProductionVariant()}>导出带音频成片</button>}
        {singleArtifact && <><a data-production-video-download href={singleArtifact.videoUrl} download={singleArtifact.video.fileName}>下载 MP4</a><a data-production-manifest-download href={singleArtifact.manifestUrl} download={singleArtifact.manifestFileName}>下载 manifest</a></>}
      </div>

      <div className="tpt-batch-summary">
        <div><strong>批量矩阵</strong><span>1 Level × {project.takes.length} Take × {Object.keys(project.visuals.themes).length} Skin × {Math.min(3, Object.keys(project.director.profiles).length)} Director × {Object.keys(project.production.audioPacks).length} Audio × {Object.keys(project.production.cuts).length} Cut × {Object.keys(project.production.outros).length} Outro</span><small>{matrix.length} 个去重组合 · {validMatrix.length} 可执行 · {invalidMatrix} 个有明确依赖原因</small></div>
        {batchAbortRef.current
          ? <button data-action="cancel-production-batch" onClick={() => batchAbortRef.current?.abort()}>取消队列</button>
          : <button data-action="start-production-batch" disabled={validMatrix.length === 0} onClick={() => void startBatch()}>生成 3 个代表组合</button>}
      </div>
      {batchTasks.length > 0 && <div className="tpt-batch-list">{batchTasks.map((task) => {
        const artifact = batchArtifacts.find((candidate) => candidate.taskId === task.id);
        return <div key={task.id} data-batch-task={task.id} data-batch-status={task.status}><b>{task.status}</b><span>{task.spec.skinPackId} · {task.spec.directorProfileId} · {task.spec.audioPackId} · {task.spec.cutSpecId}</span><i style={{ width: `${task.progress * 100}%` }} />{task.failureReason && <small>{task.failureReason}</small>}{artifact && <span><a data-batch-video-download href={artifact.videoUrl} download={artifact.videoFileName}>MP4</a> · <a data-batch-manifest-download href={artifact.manifestUrl} download={artifact.manifestFileName}>manifest</a></span>}</div>;
      })}</div>}

      <div className="tpt-bundle-row" data-bundle-bytes={bundleResult?.bytes ?? 0} data-bundle-project-hash={bundleResult?.projectHash ?? ''}>
        <div><strong>.taptile-project.zip</strong><small>project.json / assets / takes / manifests / checksums.json</small></div>
        <button data-action="export-project-bundle" onClick={() => void exportBundle()}>生成项目包</button>
        <button onClick={() => bundleImportRef.current?.click()}>回导项目包</button>
        {bundleResult && <a data-project-bundle-download href={bundleResult.url} download={bundleResult.fileName}>下载 {bundleResult.fileName}</a>}
        <input ref={bundleImportRef} data-project-bundle-import className="tpt-hidden-input" type="file" accept=".zip,.taptile-project.zip" onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          void importTapTileProjectBundle(file).then((result) => {
            onImport(result.project);
            onNotice(`项目包 hash 校验通过并已回导：${result.manifest.projectHash}`);
          }).catch((error: unknown) => onNotice(error instanceof Error ? error.message : String(error)));
          event.currentTarget.value = '';
        }} />
      </div>
      <div className="tpt-blender-row">
        <div>
          <strong>Blender 3D 交换包</strong>
          <small>自包含 ZIP · 无需手动解压即可交给本地 BCS/Blender 编译 · 固定相机 · 贴图与 SHA-256</small>
          {blenderExchangeSummary && <small data-blender-exchange-file>{blenderExchangeSummary.fileName} · {(blenderExchangeSummary.bytes / 1024).toFixed(1)} KiB</small>}
          {blenderError && <small className="is-error" data-blender-exchange-error>{blenderError}</small>}
        </div>
        <button data-action="export-blender-exchange" disabled={!preview || blenderExporting} onClick={() => void exportBlenderExchange()}>{blenderExporting ? '正在打包贴图…' : '导出 Blender 自包含包'}</button>
      </div>
      <div className="tpt-blender-vfx-row">
        <div>
          <strong>Blender 3D 特效叠加</strong>
          <small>推荐导入 Blender 生成的 scene.vfx.glb；仅含碎裂与核心闪光，2D 导演画面和最终 MP4 共用同一路径</small>
          {blenderVfxAsset && <small data-blender-vfx-file>{blenderVfxAsset.fileName} · {(blenderVfxAsset.byteLength / 1024 / 1024).toFixed(2)} MiB · {blenderVfxAsset.sha256.slice(0, 12)}</small>}
          {blenderVfxAsset && <small>{blenderVfxAsset.validation.tileEntityCount === 0 ? '✓ VFX 专用轻量层 · 不含牌面贴图' : '兼容完整场景 GLB；换用 scene.vfx.glb 可减少下载和解析开销'}</small>}
          {blenderVfxAsset && <small>✓ {blenderVfxAsset.validation.inspection.entityIdsByRole['match-core']?.length ?? 0} 个三消事件已按稳定 ID 绑定当前 Take</small>}
          {blenderVfxPersistence === 'stored' && <small>已按 SHA-256 保存在当前浏览器，刷新后自动恢复</small>}
          {blenderVfxPersistence === 'restoring' && <small>正在恢复该工程的本地 3D 特效…</small>}
          {blenderVfxPersistence === 'session-only' && <small className="is-error">3D 特效本次会话可用，但浏览器未能持久保存</small>}
          {blenderVfxError && <small className="is-error" data-blender-vfx-error>{blenderVfxError}</small>}
        </div>
        <button type="button" data-action="import-blender-vfx" onClick={() => blenderVfxInputRef.current?.click()}>选择已编译 GLB</button>
        <label><input data-blender-vfx-enabled type="checkbox" disabled={!blenderVfxAsset} checked={blenderVfxEnabled && Boolean(blenderVfxAsset)} onChange={(event) => toggleBlenderVfx(event.target.checked)} />叠加到预览与成片</label>
        <input ref={blenderVfxInputRef} className="tpt-hidden-input" data-blender-vfx-input type="file" accept=".glb,model/gltf-binary" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importBlenderVfx(file);
          event.currentTarget.value = '';
        }} />
      </div>
      <Suspense fallback={<div className="tpt-blender-preview-card" data-blender-preview-loading="true"><small>正在载入 3D 审看器…</small></div>}>
        <TapTileBlenderPreview onNotice={onNotice} />
      </Suspense>
      {singleArtifact && <button className="tpt-hidden-repeat" data-action="download-production-direct" onClick={() => downloadBlob(singleArtifact.video.blob, singleArtifact.video.fileName)}>下载当前成片</button>}
    </section>
  );
}
