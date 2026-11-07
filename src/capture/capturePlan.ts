import { cloneBoard } from '../domain/boardPresets';
import { cloneSnapshot } from '../domain/gameEngine';
import {
  consecutiveTake,
  crossClearTake,
  endgameSnapshot,
  illegalPreviewFrame,
  illegalPreviewSnapshot,
  singleClearTake,
} from '../domain/publicFixtures';
import type { LookDevPresetId, PresentationFrame, RhythmProfile, Take } from '../domain/types';
import { compileTake, evaluateCompiledTake } from '../director/presentationCompiler';
import { RHYTHM_PRESETS } from '../director/rhythmPresets';
import type { DiagnosticViewId, ReferencePassId } from '../headless/contracts';

export const CAPTURE_FPS = 30;
export const CAPTURE_RHYTHM_ID = 'human-natural' as const;
export const VIDEO_SIZE = { width: 1080, height: 1920 } as const;

export type CaptureTakeId = 'consecutive' | 'single-clear' | 'cross-clear';

export interface ResolvedAnchor {
  take: Take;
  compiledTotalFrames: number;
  durationSeconds: number;
  frames: {
    idle: number;
    pickup: number;
    preview: number;
    peak: number;
    end: number;
  };
}

export interface CaptureStillSpec {
  id: string;
  role: 'after' | 'diagnostic' | 'pass-isolation';
  renderer: 'reference-2d' | 'fixed-camera-cinematic';
  takeId?: CaptureTakeId;
  snapshotId?: 'illegal-preview' | 'endgame';
  anchor: keyof ResolvedAnchor['frames'] | 'snapshot';
  diagnosticView?: DiagnosticViewId;
  enabledPasses?: ReferencePassId[];
  lookDevId?: LookDevPresetId;
  materialId?: 'material.stainless-steel' | 'material.oak-wood' | 'material.aurora-shell';
}

export const STILL_SPECS: CaptureStillSpec[] = [
  { id: '2d-idle', role: 'after', renderer: 'reference-2d', takeId: 'consecutive', anchor: 'idle' },
  { id: '2d-pickup', role: 'after', renderer: 'reference-2d', takeId: 'consecutive', anchor: 'pickup' },
  { id: '2d-legal-preview', role: 'after', renderer: 'reference-2d', takeId: 'consecutive', anchor: 'preview' },
  { id: '2d-illegal-preview', role: 'after', renderer: 'reference-2d', snapshotId: 'illegal-preview', anchor: 'snapshot' },
  { id: '2d-single-clear-start', role: 'after', renderer: 'reference-2d', takeId: 'single-clear', anchor: 'idle' },
  { id: '2d-single-clear-peak', role: 'after', renderer: 'reference-2d', takeId: 'single-clear', anchor: 'peak' },
  { id: '2d-single-clear-end', role: 'after', renderer: 'reference-2d', takeId: 'single-clear', anchor: 'end' },
  { id: '2d-cross-clear-peak', role: 'after', renderer: 'reference-2d', takeId: 'cross-clear', anchor: 'peak' },
  { id: '2d-consecutive-peak', role: 'after', renderer: 'reference-2d', takeId: 'consecutive', anchor: 'peak' },
  { id: '2d-endgame', role: 'after', renderer: 'reference-2d', snapshotId: 'endgame', anchor: 'snapshot' },
  {
    id: '2d-background-only',
    role: 'pass-isolation',
    renderer: 'reference-2d',
    takeId: 'consecutive',
    anchor: 'idle',
    enabledPasses: ['background'],
  },
  {
    id: '3d-steel-idle',
    role: 'after',
    renderer: 'fixed-camera-cinematic',
    takeId: 'consecutive',
    anchor: 'idle',
    materialId: 'material.stainless-steel',
    lookDevId: 'neutral-lookdev',
  },
  {
    id: '3d-wood-idle',
    role: 'after',
    renderer: 'fixed-camera-cinematic',
    takeId: 'consecutive',
    anchor: 'idle',
    materialId: 'material.oak-wood',
    lookDevId: 'neutral-lookdev',
  },
  {
    id: '3d-aurora-idle',
    role: 'after',
    renderer: 'fixed-camera-cinematic',
    takeId: 'consecutive',
    anchor: 'idle',
    materialId: 'material.aurora-shell',
    lookDevId: 'neutral-lookdev',
  },
  {
    id: '3d-steel-peak',
    role: 'after',
    renderer: 'fixed-camera-cinematic',
    takeId: 'consecutive',
    anchor: 'peak',
    materialId: 'material.stainless-steel',
  },
  {
    id: '3d-wood-peak',
    role: 'after',
    renderer: 'fixed-camera-cinematic',
    takeId: 'consecutive',
    anchor: 'peak',
    materialId: 'material.oak-wood',
  },
  {
    id: '3d-aurora-peak',
    role: 'after',
    renderer: 'fixed-camera-cinematic',
    takeId: 'consecutive',
    anchor: 'peak',
    materialId: 'material.aurora-shell',
  },
  {
    id: '3d-steel-albedo',
    role: 'diagnostic',
    renderer: 'fixed-camera-cinematic',
    takeId: 'consecutive',
    anchor: 'idle',
    materialId: 'material.stainless-steel',
    diagnosticView: 'albedo',
    lookDevId: 'neutral-lookdev',
  },
  {
    id: '3d-steel-roughness',
    role: 'diagnostic',
    renderer: 'fixed-camera-cinematic',
    takeId: 'consecutive',
    anchor: 'idle',
    materialId: 'material.stainless-steel',
    diagnosticView: 'roughness',
    lookDevId: 'neutral-lookdev',
  },
  {
    id: '3d-steel-metalness',
    role: 'diagnostic',
    renderer: 'fixed-camera-cinematic',
    takeId: 'consecutive',
    anchor: 'idle',
    materialId: 'material.stainless-steel',
    diagnosticView: 'metalness',
    lookDevId: 'neutral-lookdev',
  },
];

export const VIDEO_SPECS = [
  { id: 'reference-2d', renderer: 'reference-2d' as const, materialId: undefined },
  { id: 'fixed-steel', renderer: 'fixed-camera-cinematic' as const, materialId: 'material.stainless-steel' as const },
  { id: 'fixed-wood', renderer: 'fixed-camera-cinematic' as const, materialId: 'material.oak-wood' as const },
  { id: 'fixed-aurora', renderer: 'fixed-camera-cinematic' as const, materialId: 'material.aurora-shell' as const },
];

export function captureRhythm(): RhythmProfile {
  return RHYTHM_PRESETS[CAPTURE_RHYTHM_ID];
}

export function takeById(id: CaptureTakeId): Take {
  if (id === 'single-clear') return singleClearTake();
  if (id === 'cross-clear') return crossClearTake();
  return consecutiveTake();
}

export function resolveTakeAnchor(take: Take, rhythm: RhythmProfile = captureRhythm(), fps = CAPTURE_FPS): ResolvedAnchor {
  const compiled = compileTake(take, rhythm, fps);
  const first = compiled.actions[0];
  if (!first) {
    return {
      take,
      compiledTotalFrames: compiled.totalFrames,
      durationSeconds: compiled.totalFrames / fps,
      frames: { idle: 0, pickup: 0, preview: 0, peak: 0, end: compiled.totalFrames - 1 },
    };
  }
  const clearing = compiled.actions.find((action) => action.transition.clear.cells.length > 0) ?? first;
  const preview = Math.round((first.startFrame + first.releaseFrame) / 2);
  const peak = Math.round((clearing.clearStartFrame + clearing.clearEndFrame) / 2);
  return {
    take,
    compiledTotalFrames: compiled.totalFrames,
    durationSeconds: compiled.totalFrames / fps,
    frames: {
      idle: 0,
      pickup: first.startFrame,
      preview,
      peak,
      end: compiled.totalFrames - 1,
    },
  };
}

export function frameFromTake(take: Take, frameIndex: number, rhythm: RhythmProfile = captureRhythm()): PresentationFrame {
  const compiled = compileTake(take, rhythm, CAPTURE_FPS);
  return evaluateCompiledTake(compiled, frameIndex, rhythm);
}

export function frameFromSnapshot(
  snapshot: ReturnType<typeof endgameSnapshot>,
): PresentationFrame {
  const cloned = cloneSnapshot(snapshot);
  return {
    frame: 0,
    fps: CAPTURE_FPS,
    snapshot: cloned,
    board: cloneBoard(cloned.board),
    cameraPunch: 0,
  };
}

export function snapshotForSpec(spec: CaptureStillSpec): ReturnType<typeof endgameSnapshot> {
  return spec.snapshotId === 'illegal-preview' ? illegalPreviewSnapshot() : endgameSnapshot();
}

export function presentationForSpec(spec: CaptureStillSpec): PresentationFrame {
  if (spec.snapshotId === 'illegal-preview') return illegalPreviewFrame();
  if (spec.snapshotId) return frameFromSnapshot(snapshotForSpec(spec));
  const take = takeById(spec.takeId ?? 'consecutive');
  const resolved = resolveTakeAnchor(take);
  const frameIndex = spec.anchor === 'snapshot' ? 0 : resolved.frames[spec.anchor];
  return frameFromTake(take, frameIndex);
}
