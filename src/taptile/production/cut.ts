import { evaluateTapTileFrame, type CompiledTapTileTake, type TapTilePresentationFrame } from '../director';
import { stableHash, type CutSpec, type OutroPack } from '../project';

export interface TapTileProductionFrame {
  finalFrame: number;
  sourceFrame: number;
  phase: 'intro' | 'gameplay' | 'outro';
  presentation: TapTilePresentationFrame;
  outro?: OutroPack;
  outroProgress: number;
}

export interface CompiledTapTileCut {
  id: string;
  cutSpec: CutSpec;
  sourceStartFrame: number;
  sourceEndFrame: number;
  introFrames: number;
  gameplaySourceFrames: readonly number[];
  outroFrames: number;
  outro?: OutroPack;
  totalFrames: number;
  frameMapHash: string;
  evaluate(finalFrame: number): TapTileProductionFrame;
  sourceFrameToFinalFrame(sourceFrame: number): number | null;
}

export interface TapTileCutValidationIssue {
  code: string;
  message: string;
}

export function validateTapTileCutDependencies(
  compiled: CompiledTapTileTake,
  cut: CutSpec,
  outros: Record<string, OutroPack>,
): TapTileCutValidationIssue[] {
  const issues: TapTileCutValidationIssue[] = [];
  const { startActionIndex, endActionIndex } = cut.takeRange;
  if (!Number.isInteger(startActionIndex) || !Number.isInteger(endActionIndex) || startActionIndex < 0 || endActionIndex < startActionIndex) {
    issues.push({ code: 'CUT_ACTION_RANGE_INVALID', message: `${cut.id} 的动作范围必须是递增的非负整数。` });
  } else if (endActionIndex >= compiled.actions.length) {
    issues.push({ code: 'CUT_ACTION_MISSING', message: `${cut.id} 需要动作 ${endActionIndex}，但 Take 只有 ${compiled.actions.length} 个动作。` });
  }
  if (cut.introFrames !== undefined && (!Number.isInteger(cut.introFrames) || cut.introFrames < 0)) {
    issues.push({ code: 'CUT_INTRO_INVALID', message: `${cut.id} 的 introFrames 必须是非负整数。` });
  }
  if (cut.targetDurationFrames !== undefined && (!Number.isInteger(cut.targetDurationFrames) || cut.targetDurationFrames <= 0)) {
    issues.push({ code: 'CUT_TARGET_DURATION_INVALID', message: `${cut.id} 的目标帧数必须是正整数。` });
  }
  if (cut.outroPackId && !outros[cut.outroPackId]) {
    issues.push({ code: 'CUT_OUTRO_MISSING', message: `${cut.id} 引用的 OutroPack ${cut.outroPackId} 不存在。` });
  }
  const sortedSegments = [...(cut.timeWarpSegments ?? [])].sort((left, right) => left.sourceStartFrame - right.sourceStartFrame);
  let previousEnd = -1;
  for (const segment of sortedSegments) {
    if (!Number.isInteger(segment.sourceStartFrame) || !Number.isInteger(segment.sourceEndFrame) || segment.sourceStartFrame < 0 || segment.sourceEndFrame < segment.sourceStartFrame) {
      issues.push({ code: 'CUT_TIMEWARP_RANGE_INVALID', message: `${cut.id} 含无效 TimeWarp 源帧范围。` });
      continue;
    }
    if (!Number.isFinite(segment.speed) || segment.speed <= 0) {
      issues.push({ code: 'CUT_TIMEWARP_SPEED_INVALID', message: `${cut.id} 的 TimeWarp 速度必须大于 0。` });
    }
    if (segment.sourceStartFrame <= previousEnd) {
      issues.push({ code: 'CUT_TIMEWARP_OVERLAP', message: `${cut.id} 的 TimeWarp 片段互相重叠。` });
    }
    previousEnd = Math.max(previousEnd, segment.sourceEndFrame);
  }
  return issues;
}

function resampleRange(startFrame: number, endFrame: number, outputCount: number): number[] {
  const sourceCount = endFrame - startFrame + 1;
  if (outputCount <= 1) return [startFrame];
  return Array.from({ length: outputCount }, (_, index) => {
    const normalized = index / (outputCount - 1);
    return Math.min(endFrame, startFrame + Math.round(normalized * (sourceCount - 1)));
  });
}

function buildWarpedFrames(startFrame: number, endFrame: number, cut: CutSpec): number[] {
  const applicable = [...(cut.timeWarpSegments ?? [])]
    .map((segment) => ({
      start: Math.max(startFrame, segment.sourceStartFrame),
      end: Math.min(endFrame, segment.sourceEndFrame),
      speed: segment.speed,
    }))
    .filter((segment) => segment.end >= segment.start)
    .sort((left, right) => left.start - right.start);
  const frames: number[] = [];
  let cursor = startFrame;
  for (const segment of applicable) {
    if (cursor < segment.start) frames.push(...resampleRange(cursor, segment.start - 1, segment.start - cursor));
    const sourceCount = segment.end - segment.start + 1;
    frames.push(...resampleRange(segment.start, segment.end, Math.max(1, Math.round(sourceCount / segment.speed))));
    cursor = segment.end + 1;
  }
  if (cursor <= endFrame) frames.push(...resampleRange(cursor, endFrame, endFrame - cursor + 1));
  return frames;
}

export function compileTapTileCut(
  compiled: CompiledTapTileTake,
  cut: CutSpec,
  outros: Record<string, OutroPack>,
): CompiledTapTileCut {
  const issues = validateTapTileCutDependencies(compiled, cut, outros);
  if (issues.length > 0) throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'));
  const firstAction = compiled.actions[cut.takeRange.startActionIndex]!;
  const lastAction = compiled.actions[cut.takeRange.endActionIndex]!;
  const sourceStartFrame = firstAction.timing.actionStartFrame;
  const sourceEndFrame = Math.min(compiled.totalFrames - 1, lastAction.timing.actionVisualEndFrame);
  const introFrames = cut.introFrames ?? 0;
  const outro = cut.outroPackId ? outros[cut.outroPackId] : undefined;
  const outroFrames = outro?.durationFrames ?? 0;
  let gameplaySourceFrames = buildWarpedFrames(sourceStartFrame, sourceEndFrame, cut);
  if (cut.targetDurationFrames !== undefined) {
    const targetGameplayFrames = cut.targetDurationFrames - introFrames - outroFrames;
    if (targetGameplayFrames <= 0) throw new Error(`CUT_TARGET_TOO_SHORT: ${cut.id} 无法容纳 ${introFrames} 帧开场与 ${outroFrames} 帧 Outro。`);
    gameplaySourceFrames = resampleRange(0, gameplaySourceFrames.length - 1, targetGameplayFrames)
      .map((index) => gameplaySourceFrames[index] ?? sourceStartFrame);
  }
  if (gameplaySourceFrames.length === 0) gameplaySourceFrames = [sourceStartFrame];
  const totalFrames = introFrames + gameplaySourceFrames.length + outroFrames;
  const frameMapHash = stableHash({ cut, sourceStartFrame, sourceEndFrame, gameplaySourceFrames, outro }, 'cut');
  const sourceFrameToFinalFrame = (sourceFrame: number): number | null => {
    if (sourceFrame < sourceStartFrame || sourceFrame > sourceEndFrame) return null;
    const exact = gameplaySourceFrames.indexOf(sourceFrame);
    if (exact >= 0) return introFrames + exact;
    const nearest = gameplaySourceFrames.findIndex((candidate) => candidate >= sourceFrame);
    return introFrames + (nearest >= 0 ? nearest : gameplaySourceFrames.length - 1);
  };
  const evaluate = (rawFinalFrame: number): TapTileProductionFrame => {
    const finalFrame = Math.max(0, Math.min(totalFrames - 1, Math.round(rawFinalFrame)));
    let phase: TapTileProductionFrame['phase'];
    let sourceFrame: number;
    let outroProgress = 0;
    if (finalFrame < introFrames) {
      phase = 'intro';
      sourceFrame = sourceStartFrame;
    } else if (finalFrame < introFrames + gameplaySourceFrames.length) {
      phase = 'gameplay';
      sourceFrame = gameplaySourceFrames[finalFrame - introFrames] ?? sourceEndFrame;
    } else {
      phase = 'outro';
      sourceFrame = sourceEndFrame;
      const outroIndex = finalFrame - introFrames - gameplaySourceFrames.length;
      outroProgress = outroFrames <= 1 ? 1 : outroIndex / (outroFrames - 1);
    }
    return {
      finalFrame,
      sourceFrame,
      phase,
      presentation: evaluateTapTileFrame(compiled, sourceFrame),
      ...(phase === 'outro' && outro ? { outro } : {}),
      outroProgress,
    };
  };
  return Object.freeze({
    id: stableHash({ compiledId: compiled.id, frameMapHash }, 'production-cut'),
    cutSpec: structuredClone(cut),
    sourceStartFrame,
    sourceEndFrame,
    introFrames,
    gameplaySourceFrames: Object.freeze([...gameplaySourceFrames]),
    outroFrames,
    ...(outro ? { outro: structuredClone(outro) } : {}),
    totalFrames,
    frameMapHash,
    evaluate,
    sourceFrameToFinalFrame,
  });
}
