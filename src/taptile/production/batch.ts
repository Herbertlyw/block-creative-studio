import type { FixedFrameExportResult, FrameRenderProgress } from '../../exporter/fixedFrameExporter';
import { compileTapTileTake } from '../director';
import { stableHash, type CompiledTapTileLevel, type TapTileProjectV2, type TapTileRenderSpec } from '../project';
import { safeFileName } from '../../utils/download';
import { validateTapTileCutDependencies } from './cut';
import { createTapTileRenderManifest, type TapTileRenderManifest } from './manifest';
import { createTapTileProductionRenderJob, type TapTileProductionRenderJob, type TapTileProductionRenderOptions } from './renderJob';

export interface TapTileVariantSpec {
  levelId: string;
  takeId: string;
  skinPackId: string;
  directorProfileId: string;
  audioPackId: string;
  cutSpecId: string;
  outroPackId?: string;
  renderSpec: TapTileRenderSpec;
}

export interface TapTileBatchMatrixSelection {
  takeIds: string[];
  skinPackIds: string[];
  directorProfileIds: string[];
  audioPackIds: string[];
  cutSpecIds: string[];
  outroPackIds: string[];
  renderSpecs: TapTileRenderSpec[];
}

export type TapTileBatchTaskStatus = 'queued' | 'preparing' | 'rendering' | 'completed' | 'failed' | 'canceled';

export interface TapTileBatchTask {
  id: string;
  combinationHash: string;
  spec: TapTileVariantSpec;
  status: TapTileBatchTaskStatus;
  progress: number;
  failureReason?: string;
  result?: {
    video: FixedFrameExportResult;
    manifest: TapTileRenderManifest;
  };
}

export interface PreparedTapTileVariant {
  project: TapTileProjectV2;
  job: TapTileProductionRenderJob;
  fileName: string;
}

export interface TapTileVariantDependencyReport {
  valid: boolean;
  reasons: string[];
}

export function validateTapTileVariantDependencies(
  project: TapTileProjectV2,
  level: CompiledTapTileLevel,
  spec: TapTileVariantSpec,
): TapTileVariantDependencyReport {
  const reasons: string[] = [];
  if (spec.levelId !== project.level.id) reasons.push(`LEVEL_MISSING: ${spec.levelId}`);
  const take = project.takes.find((candidate) => candidate.id === spec.takeId);
  const skin = project.visuals.themes[spec.skinPackId];
  const profile = project.director.profiles[spec.directorProfileId];
  const audio = project.production.audioPacks[spec.audioPackId];
  const cut = project.production.cuts[spec.cutSpecId];
  if (!take) reasons.push(`TAKE_MISSING: ${spec.takeId}`);
  if (!skin) reasons.push(`SKIN_MISSING: ${spec.skinPackId}`);
  if (!profile) reasons.push(`DIRECTOR_PROFILE_MISSING: ${spec.directorProfileId}`);
  if (!audio) reasons.push(`AUDIO_PACK_MISSING: ${spec.audioPackId}`);
  if (!cut) reasons.push(`CUT_SPEC_MISSING: ${spec.cutSpecId}`);
  if (spec.outroPackId && !project.production.outros[spec.outroPackId]) reasons.push(`OUTRO_PACK_MISSING: ${spec.outroPackId}`);
  if (take && profile && cut) {
    try {
      const compiled = compileTapTileTake(level, take, profile, {
        fps: spec.renderSpec.fps,
        seed: project.director.seed,
        actionOverrides: project.director.actionOverrides,
      });
      const selectedCut = { ...cut, ...(spec.outroPackId ? { outroPackId: spec.outroPackId } : {}) };
      reasons.push(...validateTapTileCutDependencies(compiled, selectedCut, project.production.outros).map((issue) => `${issue.code}: ${issue.message}`));
    } catch (error) {
      reasons.push(`DIRECTOR_COMPILE_FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { valid: reasons.length === 0, reasons };
}

export function tapTileVariantHash(project: TapTileProjectV2, level: CompiledTapTileLevel, spec: TapTileVariantSpec): string {
  return stableHash({
    levelHash: level.levelHash,
    take: project.takes.find((candidate) => candidate.id === spec.takeId),
    skin: project.visuals.themes[spec.skinPackId],
    director: project.director.profiles[spec.directorProfileId],
    audio: project.production.audioPacks[spec.audioPackId],
    cut: project.production.cuts[spec.cutSpecId],
    outro: spec.outroPackId ? project.production.outros[spec.outroPackId] : undefined,
    render: spec.renderSpec,
    seed: project.director.seed,
  }, 'matrix');
}

export function expandTapTileBatchMatrix(
  project: TapTileProjectV2,
  level: CompiledTapTileLevel,
  selection: TapTileBatchMatrixSelection,
): TapTileBatchTask[] {
  const unique = new Map<string, TapTileBatchTask>();
  for (const takeId of selection.takeIds) for (const skinPackId of selection.skinPackIds) {
    for (const directorProfileId of selection.directorProfileIds) for (const audioPackId of selection.audioPackIds) {
      for (const cutSpecId of selection.cutSpecIds) for (const outroPackId of selection.outroPackIds) {
        for (const renderSpec of selection.renderSpecs) {
          const spec: TapTileVariantSpec = { levelId: project.level.id, takeId, skinPackId, directorProfileId, audioPackId, cutSpecId, ...(outroPackId ? { outroPackId } : {}), renderSpec: structuredClone(renderSpec) };
          const combinationHash = tapTileVariantHash(project, level, spec);
          if (!unique.has(combinationHash)) unique.set(combinationHash, { id: `task-${combinationHash}`, combinationHash, spec, status: 'queued', progress: 0 });
        }
      }
    }
  }
  return [...unique.values()];
}

export function prepareTapTileVariant(
  project: TapTileProjectV2,
  level: CompiledTapTileLevel,
  spec: TapTileVariantSpec,
  renderOptions: TapTileProductionRenderOptions = {},
): PreparedTapTileVariant {
  const dependency = validateTapTileVariantDependencies(project, level, spec);
  if (!dependency.valid) throw new Error(dependency.reasons.join('\n'));
  const snapshot = structuredClone(project);
  snapshot.visuals.selectedThemeId = spec.skinPackId;
  snapshot.director.selectedProfileId = spec.directorProfileId;
  snapshot.production.selectedAudioPackId = spec.audioPackId;
  snapshot.production.selectedCutId = spec.cutSpecId;
  snapshot.render = structuredClone(spec.renderSpec);
  const take = snapshot.takes.find((candidate) => candidate.id === spec.takeId)!;
  const profile = snapshot.director.profiles[spec.directorProfileId]!;
  const sourceCut = snapshot.production.cuts[spec.cutSpecId]!;
  const cut = { ...sourceCut, ...(spec.outroPackId ? { outroPackId: spec.outroPackId } : {}) };
  const audio = snapshot.production.audioPacks[spec.audioPackId]!;
  const compiled = compileTapTileTake(level, take, profile, {
    fps: snapshot.render.fps,
    seed: snapshot.director.seed,
    actionOverrides: snapshot.director.actionOverrides,
  });
  const job = createTapTileProductionRenderJob(snapshot, level, compiled, cut, audio, renderOptions);
  const fileName = `${safeFileName(snapshot.name)}__${safeFileName(take.name)}__${spec.skinPackId}__${spec.directorProfileId}__${spec.audioPackId}__${spec.cutSpecId}__${job.identity.combinationHash}.mp4`;
  return { project: snapshot, job, fileName };
}

export async function runTapTileBatch(
  project: TapTileProjectV2,
  level: CompiledTapTileLevel,
  tasks: TapTileBatchTask[],
  render: (prepared: PreparedTapTileVariant, signal: AbortSignal | undefined, onProgress: (progress: FrameRenderProgress) => void) => Promise<FixedFrameExportResult>,
  options: { signal?: AbortSignal; onUpdate?: (tasks: TapTileBatchTask[]) => void } = {},
): Promise<TapTileBatchTask[]> {
  const queue = tasks.map((task) => ({ ...task, spec: structuredClone(task.spec) }));
  const publish = (): void => options.onUpdate?.(queue.map((task) => ({ ...task })));
  for (const task of queue) {
    if (options.signal?.aborted) {
      if (task.status === 'queued') task.status = 'canceled';
      continue;
    }
    let prepared: PreparedTapTileVariant | undefined;
    try {
      task.status = 'preparing';
      publish();
      prepared = prepareTapTileVariant(project, level, task.spec);
      task.status = 'rendering';
      publish();
      const video = await render(prepared, options.signal, (progress) => {
        task.progress = progress.ratio;
        task.status = progress.phase === 'preparing' ? 'preparing' : 'rendering';
        publish();
      });
      const manifest = await createTapTileRenderManifest(prepared.project, level, prepared.job, video);
      task.result = { video, manifest };
      task.status = 'completed';
      task.progress = 1;
    } catch (error) {
      const canceled = options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError');
      task.status = canceled ? 'canceled' : 'failed';
      task.failureReason = error instanceof Error ? error.message : String(error);
    } finally {
      await prepared?.job.dispose?.();
    }
    publish();
  }
  publish();
  return queue;
}
