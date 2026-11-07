import { compileTake, evaluateCompiledTake } from '../director/presentationCompiler';
import type { PresentationFrame, RenderSpec, RhythmProfile, StyleSpec, Take } from '../domain/types';
import type { RuntimeAssetBindings } from '../assets/runtimeAssetBindings';
import { StudioScene } from '../renderer/StudioScene';
import { Reference2DScene } from '../reference2d/Reference2DScene';
import { containMapping, DESIGN_RESOLUTION } from '../headless/coordinateMapping';
import { safeFileName } from '../utils/download';
import {
  exportFixedFrameVideo,
  type FrameRenderJob,
  type FrameRenderProgress,
} from './fixedFrameExporter';

export type RenderProgress = FrameRenderProgress;

export interface ExportVideoOptions {
  take: Take;
  rhythm: RhythmProfile;
  style: StyleSpec;
  render: RenderSpec;
  projectName: string;
  runtimeAssets?: RuntimeAssetBindings;
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
}

export interface ExportVideoResult {
  blob: Blob;
  fileName: string;
  frameCount: number;
  durationSeconds: number;
  renderScale: number;
}

interface QualitySettings {
  bitrate: number;
  renderScale: number;
}

interface OfflineRenderStage {
  readonly canvas: HTMLCanvasElement;
  resize(width: number, height: number, pixelRatio?: number): void;
  setRuntimeAssets(bindings: RuntimeAssetBindings): void;
  warmup(frame: PresentationFrame, style: StyleSpec): Promise<void>;
  renderAt(frame: PresentationFrame, style: StyleSpec): void;
  dispose(): void;
}

function createOfflineStage(canvas: HTMLCanvasElement, style: StyleSpec): OfflineRenderStage {
  return style.renderer === 'reference-2d'
    ? new Reference2DScene(canvas, { quality: 'cinematic' })
    : new StudioScene(canvas, { quality: 'cinematic' });
}

const QUALITY_SETTINGS: Record<RenderSpec['quality'], QualitySettings> = {
  preview: { bitrate: 8_000_000, renderScale: 1 },
  standard: { bitrate: 14_000_000, renderScale: 1.35 },
  cinematic: { bitrate: 24_000_000, renderScale: 2 },
};

function blitFrame(
  outputContext: CanvasRenderingContext2D,
  renderCanvas: HTMLCanvasElement,
  renderer: StyleSpec['renderer'],
  width: number,
  height: number,
): void {
  outputContext.fillStyle = '#05070d';
  outputContext.fillRect(0, 0, width, height);
  if (renderer === 'reference-2d') {
    const mapping = containMapping(DESIGN_RESOLUTION, { width, height });
    outputContext.drawImage(renderCanvas, mapping.offsetX, mapping.offsetY, mapping.drawWidth, mapping.drawHeight);
    return;
  }
  outputContext.drawImage(renderCanvas, 0, 0, width, height);
}

export async function exportTakeVideo(options: ExportVideoOptions): Promise<ExportVideoResult> {
  const compiled = compileTake(options.take, options.rhythm, options.render.fps);
  const quality = QUALITY_SETTINGS[options.render.quality];
  const renderCanvas = document.createElement('canvas');
  const stage = createOfflineStage(renderCanvas, options.style);
  if (options.runtimeAssets) stage.setRuntimeAssets(options.runtimeAssets);
  let outputContext: CanvasRenderingContext2D | null = null;
  const job: FrameRenderJob<PresentationFrame> = {
    width: options.render.width,
    height: options.render.height,
    fps: options.render.fps,
    totalFrames: compiled.totalFrames,
    evaluate: (frameIndex) => evaluateCompiledTake(compiled, frameIndex, options.rhythm),
    prepare: async (canvas) => {
      outputContext = canvas.getContext('2d', { alpha: false });
      if (!outputContext) throw new Error('无法创建视频输出 Canvas。');
      outputContext.imageSmoothingEnabled = true;
      outputContext.imageSmoothingQuality = 'high';
      if (options.style.renderer === 'reference-2d') {
        stage.resize(DESIGN_RESOLUTION.width, DESIGN_RESOLUTION.height, 1);
      } else {
        stage.resize(options.render.width, options.render.height, quality.renderScale);
      }
      await stage.warmup(evaluateCompiledTake(compiled, 0, options.rhythm), options.style);
    },
    render: (frame, canvas) => {
      if (!outputContext) throw new Error('视频输出 Canvas 尚未准备。');
      stage.renderAt(frame, options.style);
      blitFrame(outputContext, renderCanvas, options.style.renderer, canvas.width, canvas.height);
    },
    dispose: () => stage.dispose(),
  };
  const fileName = `${safeFileName(options.projectName)}-${safeFileName(options.take.name)}-${options.render.width}x${options.render.height}.mp4`;
  const result = await exportFixedFrameVideo(job, {
    bitrate: quality.bitrate,
    fileName,
    metadata: {
      title: `${options.projectName} · ${options.take.name}`,
      artist: 'Block Creative Studio',
      comment: `Deterministic browser render · ${options.style.renderer} · ${quality.renderScale}x supersampling`,
    },
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
  return {
    blob: result.blob,
    fileName: result.fileName,
    frameCount: result.frameCount,
    durationSeconds: result.durationSeconds,
    renderScale: quality.renderScale,
  };
}
