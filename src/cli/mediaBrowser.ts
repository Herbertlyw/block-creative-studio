import { hasReferenceCalibration } from '../contracts/hasReferenceCalibration';
import {
  inlineBrowserStudioReferences,
  assertBrowserReferenceCompatibility,
} from '../contracts/browserAssetReferences';
import { resolveEmbeddedAssets } from '../contracts/embeddedAssets';
import { verifyObservedPointer } from '../contracts/observedPointer';
import { prepareCalibratedRenderer } from '../contracts/calibratedRenderer';
import { compileNativeTake } from '../contracts/compileNativeTake';
import { compileNativePreviewLook, compileNativeV2PlanLook } from '../contracts/nativeVariants';
import { resolveSavedWorkbenchVariant } from '../contracts/workbenchVariant';
import { readPreviewStyle, resolvePreviewVariant } from '../contracts/previewVariant';
import { parseWorkbenchView } from '../contracts/reference2dView';
import { readWorkbenchBackground } from '../contracts/workbenchBackground';
import { BB_EXPORT_QUALITY, readBBExportQuality } from '../contracts/bbExportQuality';
import { createAuthoredBBStage, createObservedBBStage } from '../contracts/bbRenderStage';
import { compileBCPlayback, prepareBCScene, mixBCAudio } from '../games/block-crush/timeline';
import { bcProduction } from '../games/block-crush/document';
import { productionFromDocument } from '../nativeReference/agent-director/contracts';
import {
  compileProductionAudio,
  verifyProductionAudioAssets,
} from '../nativeReference/agent-director/audioMix';
import { describeProductionMixWarnings } from '../contracts/nativeProductionAudio';
import { exportFrameVideo } from '../exporter/exportFrameVideo';
import { mediaWindow } from './mediaContract';

let current: AbortController | null = null;
let pendingCancel = false;
export function cancel() {
  pendingCancel = true;
  current?.abort();
}
export async function run(
  game: string,
  operation: string,
  work: any,
  options: Record<string, any>,
  progress: (message: string) => void,
) {
  const controller = new AbortController();
  current = controller;
  if (pendingCancel) controller.abort();
  const signal = controller.signal;
  let stage: { draw(index: number): void; dispose(): void } | undefined;
  try {
    progress('准备工程和素材');
    const project = game === 'block-placement' ? work.project : work;
    const take = project.takes.find((item: any) => item.takeId === options.takeId);
    if (!take) throw new Error('TAKE_NOT_FOUND: 指定 Take 不存在。');
    const output = project.production.output;
    const canvas = document.createElement('canvas');
    let source: any,
      playback: any,
      prepared: any,
      quality = { bitrate: 8_000_000, scale: 1 },
      resolved: any;
    if (game === 'block-placement') {
      resolved = (
        await inlineBrowserStudioReferences(project, { project: [], cas: [], library: [] })
      ).document;
      quality = BB_EXPORT_QUALITY[readBBExportQuality(resolved)];
      if (hasReferenceCalibration(resolved)) {
        const pointer = work.pointer ? await verifyObservedPointer(resolved, work.pointer) : null;
        prepared = prepareCalibratedRenderer(resolved, options.takeId, pointer);
        source = prepared.frameSource;
        stage = await createObservedBBStage(
          canvas,
          output.width,
          output.height,
          quality.scale,
          prepared,
        );
      } else {
        assertBrowserReferenceCompatibility(resolved);
        const assets = await resolveEmbeddedAssets(resolved);
        const baseStyle = resolved.direction?.style;
        if (baseStyle?.renderer !== 'reference-2d')
          throw new Error('RENDERER_UNSUPPORTED: 仅支持 reference-2d。');
        const solidBackground = readWorkbenchBackground(resolved)?.color ?? null;
        const selection = resolvePreviewVariant(resolved, null);
        if (solidBackground && (assets.background || selection.lookKey))
          throw new Error('纯色背景与工程背景图片或外观变体不能同时使用。');
        if (readPreviewStyle(resolved)?.workbenchVariantV1 !== undefined)
          resolveSavedWorkbenchVariant(resolved, options.takeId);
        const variant = selection.lookKey
          ? selection.route === 'v2'
            ? compileNativeV2PlanLook(
                resolved,
                options.takeId,
                selection.lookKey,
                selection.clearFromLook || undefined,
              )
            : compileNativePreviewLook(resolved, options.takeId, selection.lookKey)
          : null;
        const compiled = compileNativeTake(resolved, options.takeId, variant?.style ?? baseStyle);
        source = compiled.frameSource;
        const view = parseWorkbenchView(
          readPreviewStyle(resolved)?.workbenchView2D,
          compiled.compiled.fps,
          compiled.compiled.totalFrames,
        );
        const initialFrame =
          operation === 'preview render' ? options.frame : (options.startFrame ?? 0);
        if (
          !Number.isInteger(initialFrame) ||
          initialFrame < 0 ||
          initialFrame >= source.totalFrames
        )
          throw new Error('FRAME_RANGE_INVALID: 指定帧超出 Take。');
        stage = await createAuthoredBBStage({
          target: canvas,
          width: output.width,
          height: output.height,
          purpose: 'export',
          initialFrame,
          scale: quality.scale,
          visualMode: '2d',
          solidBackground,
          assets,
          source,
          style: variant?.style ?? baseStyle,
          view,
        });
      }
    } else {
      playback = compileBCPlayback(project, options.takeId, true);
      source = playback.source;
    }
    signal.throwIfAborted();
    const production = productionFromDocument(project);
    if (
      operation === 'video render' &&
      (production?.presentation || production?.camera || production?.effects)
    )
      throw new Error('PRODUCTION_UNSUPPORTED: 工程包含尚未接入的额外时序、镜头或特效。');
    const window =
      operation === 'preview render'
        ? mediaWindow(
            { scope: 'range', startFrame: options.frame, endFrame: options.frame },
            source.totalFrames,
            take,
            source.frameSourceHash,
          )
        : mediaWindow(options, source.totalFrames, take, source.frameSourceHash, production?.clips);
    if (game === 'block-crush-drop') {
      playback = {
        ...playback,
        start: window.startFrame,
        end: window.endFrame,
        totalFrames: window.totalFrames,
      };
      const bcStage = await prepareBCScene(canvas, playback);
      stage = {
        draw: (absolute: number) => bcStage.render(absolute - window.startFrame),
        dispose: bcStage.dispose,
      };
    }
    if (!stage) throw new Error('未能准备画布。');
    signal.throwIfAborted();
    let blob: Blob,
      hasAudioTrack = false,
      warning = '';
    if (operation === 'preview render') {
      stage.draw(window.startFrame);
      blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('PNG 编码失败。'))),
          'image/png',
        ),
      );
    } else {
      progress('准备音频');
      let audio: { pcm: Float32Array; channels: 2 } | null = null;
      if ((options.audio ?? 'project') === 'project' && production?.audio) {
        if (game === 'block-crush-drop') {
          const mix = await mixBCAudio(playback);
          if (mix) {
            audio = { pcm: mix.track.data, channels: 2 };
            warning = describeProductionMixWarnings(project, mix);
          }
        } else {
          await verifyProductionAudioAssets(production.audio);
          const mix = compileProductionAudio(source, production.audio, 48_000, {
            startFrame: window.startFrame,
            endFrame: window.endFrame,
          });
          audio = { pcm: mix.track.data, channels: 2 };
          warning = describeProductionMixWarnings(project, mix);
        }
      }
      hasAudioTrack = !!audio;
      signal.throwIfAborted();
      progress('渲染和编码');
      blob = await exportFrameVideo({
        canvas,
        width: output.width,
        height: output.height,
        fps: source.fps,
        totalFrames: window.totalFrames,
        bitrate: quality.bitrate,
        audio,
        signal,
        render: (index) => stage!.draw(window.startFrame + index),
        onProgress: (done, total) => progress(`渲染和编码 ${done}/${total}`),
      });
    }
    signal.throwIfAborted();
    progress('完成封装');
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = operation === 'preview render' ? 'frame.png' : 'video.mp4';
      link.click();
      return {
        takeId: options.takeId,
        ...(operation === 'preview render'
          ? { frame: options.frame, takeTimeSeconds: options.frame / source.fps }
          : {
              ...window,
              fps: source.fps,
              durationSeconds: window.totalFrames / source.fps,
              audio: options.audio ?? 'project',
              hasAudioTrack,
              warning,
            }),
        width: output.width,
        height: output.height,
      };
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } finally {
    stage?.dispose();
    if (current === controller) current = null;
  }
}
