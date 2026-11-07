import type { FrameRenderJob } from '../../exporter/fixedFrameExporter';
import type { CompiledTapTileTake, TapTilePresentationFrame } from '../director';
import { stableHash, type AudioPack, type CompiledTapTileLevel, type CutSpec, type TapTileProjectV2 } from '../project';
import { createTapTileRenderJob, preflightTapTileRenderJob, type TapTileRenderJob, type TapTileRenderPreflightIssue } from '../render/TapTileRenderJob';
import { renderTapTileOutroOverlay, renderTapTilePraiseOverlay } from '../render/CanvasRenderer';
import { compileTapTileAudioMix, type CompiledTapTileAudioMix } from './audio';
import { compileTapTileCut, type CompiledTapTileCut, type TapTileProductionFrame } from './cut';
import { assertTapTileBlenderVfxCompatibility, type TapTileBlenderVfxAsset } from '../blender/blenderVfxAsset';
import type { TapTileBlenderVfxOverlayRuntime } from '../blender/BlenderVfxOverlayRuntime';

export interface TapTileProductionIdentity {
  combinationHash: string;
  base: TapTileRenderJob['identity'];
  cutHash: string;
  audioHash: string;
  outroHash?: string;
  blenderVfxHash?: string;
}

export interface TapTileProductionRenderOptions {
  blenderVfxAsset?: TapTileBlenderVfxAsset;
}

function presentationForBlenderVfx(frame: TapTilePresentationFrame): TapTilePresentationFrame {
  return {
    ...frame,
    effects: frame.effects.map((effect) => {
      if (effect.kind !== 'match' || effect.particles.length === 0) return effect;
      const { praiseLabel: _praiseLabel, ...withoutPraise } = effect;
      return { ...withoutPraise, particles: [] };
    }),
  };
}

export interface TapTileProductionRenderJob extends FrameRenderJob<TapTileProductionFrame> {
  readonly baseJob: TapTileRenderJob;
  readonly cut: CompiledTapTileCut;
  readonly audioMix: CompiledTapTileAudioMix;
  readonly audioPack: AudioPack;
  readonly identity: TapTileProductionIdentity;
  readonly blenderVfxAsset?: TapTileBlenderVfxAsset;
}

export interface TapTileProductionPreflightResult {
  valid: boolean;
  issues: TapTileRenderPreflightIssue[];
  identity: TapTileProductionIdentity;
  totalFrames: number;
  durationSeconds: number;
  scheduledAudioCues: number;
}

/**
 * Keep the cheap head/middle/tail checks, but always include real match beats.
 * This catches regressions in praise, shatter, and an optional Blender overlay
 * that generic temporal samples can otherwise miss completely.
 */
export function selectTapTileProductionVerificationFrames(job: TapTileProductionRenderJob): number[] {
  const frames = [0, Math.floor((job.totalFrames - 1) / 2), job.totalFrames - 1];
  const matchActions = job.baseJob.compiledTake.actions
    .filter((action) => action.transition.matchedTileIds.length > 0);
  for (const action of [matchActions[0], matchActions.at(-1)]) {
    if (!action) continue;
    const sourceFrame = Math.round(action.timing.matchStartFrame
      + (action.timing.matchVfxEndFrame - action.timing.matchStartFrame) * 0.48);
    const finalFrame = job.cut.sourceFrameToFinalFrame(sourceFrame);
    if (finalFrame !== null) frames.push(finalFrame);
  }
  return [...new Set(frames)]
    .filter((frame) => frame >= 0 && frame < job.totalFrames)
    .sort((left, right) => left - right);
}

export function createTapTileProductionRenderJob(
  project: TapTileProjectV2,
  level: CompiledTapTileLevel,
  compiledTake: CompiledTapTileTake,
  cutSpec: CutSpec,
  audioPack: AudioPack,
  options: TapTileProductionRenderOptions = {},
): TapTileProductionRenderJob {
  const baseJob = createTapTileRenderJob(project, level, compiledTake);
  if (options.blenderVfxAsset) {
    assertTapTileBlenderVfxCompatibility(options.blenderVfxAsset, {
      totalFrames: compiledTake.totalFrames,
      fps: compiledTake.fps,
      matchEventIds: compiledTake.actions
        .filter((action) => action.transition.matchedTileIds.length === 3)
        .map((action) => `${action.actionId}:match`),
    });
  }
  const cut = compileTapTileCut(compiledTake, cutSpec, baseJob.project.production.outros);
  const audioMix = compileTapTileAudioMix(baseJob.project, compiledTake, cut, audioPack);
  const identity: TapTileProductionIdentity = Object.freeze({
    combinationHash: stableHash({
      base: baseJob.identity,
      cut: cut.frameMapHash,
      audioPack,
      audioPcm: audioMix.pcmHash,
      outro: cut.outro,
      render: baseJob.project.render,
      blenderVfx: options.blenderVfxAsset?.sha256,
    }, 'variant'),
    base: baseJob.identity,
    cutHash: cut.frameMapHash,
    audioHash: audioMix.pcmHash,
    ...(cut.outro ? { outroHash: stableHash(cut.outro, 'outro') } : {}),
    ...(options.blenderVfxAsset ? { blenderVfxHash: options.blenderVfxAsset.sha256 } : {}),
  });
  let blenderVfxRuntime: TapTileBlenderVfxOverlayRuntime | undefined;
  return {
    width: baseJob.width,
    height: baseJob.height,
    fps: baseJob.fps,
    totalFrames: cut.totalFrames,
    baseJob,
    cut,
    audioMix,
    audioPack: structuredClone(audioPack),
    identity,
    ...(options.blenderVfxAsset ? { blenderVfxAsset: options.blenderVfxAsset } : {}),
    evaluate: cut.evaluate,
    prepare: async (canvas, renderOptions) => {
      await baseJob.prepare?.(canvas, renderOptions);
      if (options.blenderVfxAsset && !blenderVfxRuntime) {
        const { createTapTileBlenderVfxOverlayRuntime } = await import('../blender/BlenderVfxOverlayRuntime');
        blenderVfxRuntime = await createTapTileBlenderVfxOverlayRuntime(options.blenderVfxAsset);
      }
    },
    render: async (frame, canvas, frameRenderOptions) => {
      await baseJob.render(options.blenderVfxAsset ? presentationForBlenderVfx(frame.presentation) : frame.presentation, canvas, frameRenderOptions);
      if (frame.phase === 'gameplay' && blenderVfxRuntime) {
        blenderVfxRuntime.renderInto(canvas, frame.sourceFrame);
        renderTapTilePraiseOverlay(canvas, frame.presentation, {
          project: baseJob.project,
          level: baseJob.level,
          assets: baseJob.assets,
        }, frameRenderOptions);
      }
      if (frame.phase === 'outro' && frame.outro) {
        renderTapTileOutroOverlay(canvas, frame.outro, frame.outroProgress, {
          project: baseJob.project,
          level: baseJob.level,
          assets: baseJob.assets,
        }, frameRenderOptions);
      }
    },
    dispose: async () => {
      try {
        await baseJob.dispose?.();
      } finally {
        blenderVfxRuntime?.dispose();
        blenderVfxRuntime = undefined;
      }
    },
  };
}

export async function preflightTapTileProductionRenderJob(job: TapTileProductionRenderJob): Promise<TapTileProductionPreflightResult> {
  const base = await preflightTapTileRenderJob(job.baseJob);
  const issues = [...base.issues];
  if (job.totalFrames <= 0) issues.push({ code: 'PRODUCTION_DURATION_INVALID', message: '最终成片必须至少包含 1 帧。' });
  if (job.audioMix.data.length / job.audioMix.numberOfChannels < Math.ceil(job.totalFrames / job.fps * job.audioMix.sampleRate)) {
    issues.push({ code: 'AUDIO_DURATION_SHORT', message: '混音轨长度短于最终成片。' });
  }
  if (job.audioMix.scheduledCues.length === 0) issues.push({ code: 'AUDIO_CUES_EMPTY', message: '所选 Cut 内没有可绑定的语义音频事件。' });
  if (job.audioMix.peakAfterLimit > job.audioMix.peakLimit + 0.0001) {
    issues.push({ code: 'AUDIO_PEAK_EXCEEDED', message: `音频峰值 ${job.audioMix.peakAfterLimit.toFixed(4)} 超过 ${job.audioMix.peakLimit.toFixed(4)}。` });
  }
  return {
    valid: issues.length === 0,
    issues,
    identity: job.identity,
    totalFrames: job.totalFrames,
    durationSeconds: job.totalFrames / job.fps,
    scheduledAudioCues: job.audioMix.scheduledCues.length,
  };
}
