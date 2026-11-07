import type { CompiledTapTileLevel } from '../../project';
import { applyTapAction, createInitialTapTileGameState, playableTapTileIds } from '../engine';
import { tapTileStateHash } from '../stateHash';
import type { TapTileAction, TapTileGameState } from '../types';
import { scoreSolverCandidate } from './scoring';
import { createSeededPathState, extendSeededPathState, rankSeededPathState } from './seededOrder';
import type {
  SolveResult,
  SolveTapTileAnytimeOptions,
  SolveTapTileOptions,
  TapTileScenarioProfileId,
  TapTileSolveMetrics,
  TapTileSolveProgress,
  TapTileSolveTerminationReason,
} from './types';

interface Candidate {
  state: TapTileGameState;
  actions: TapTileAction[];
  matchCount: number;
  unlockedCount: number;
  consecutiveMatches: number;
  maxConsecutiveMatches: number;
  sawWarning: boolean;
  recoveredAfterWarning: boolean;
  peakTrayOccupancy: number;
  score: number;
  tieBreak: number;
  pathKey: string;
  pathRankState: number;
}

type TapTileSearchProgressSnapshot = Omit<TapTileSolveProgress, 'elapsedMs'>;

interface TapTileSearchControl {
  stopReason: Extract<TapTileSolveTerminationReason, 'canceled' | 'time-budget'>;
}

function clearableCountForTileIds(level: CompiledTapTileLevel, tileIds: readonly string[]): number {
  const counts = new Map<string, number>();
  for (const tileId of tileIds) {
    const matchKey = level.tiles[tileId]?.matchKey;
    if (!matchKey) continue;
    counts.set(matchKey, (counts.get(matchKey) ?? 0) + 1);
  }
  return [...counts.values()].reduce((total, count) => total + Math.floor(count / 3) * 3, 0);
}

export function theoreticalTapTileClearableCount(level: CompiledTapTileLevel): number {
  return clearableCountForTileIds(level, level.initialBoardIds);
}

function candidateClearUpperBound(level: CompiledTapTileLevel, candidate: Candidate): number {
  return candidate.state.clearedIds.length
    + clearableCountForTileIds(level, [...candidate.state.boardIds, ...candidate.state.trayIds]);
}

function isGoal(candidate: Candidate, profile: TapTileScenarioProfileId): boolean {
  if (profile === 'intentional-fail') return candidate.state.status === 'lost';
  if (candidate.state.status !== 'won') return false;
  if (profile === 'danger-rescue') return candidate.sawWarning && candidate.recoveredAfterWarning;
  return true;
}

function createBehavioralStateKey(level: CompiledTapTileLevel): (state: TapTileGameState) => string {
  const tokenByTileId = new Map(level.initialBoardIds.map((tileId, index) => [tileId, index.toString(36)]));
  return (state) => {
    // turn, clearedIds and activeBlockerCount are deterministic consequences of
    // the remaining board/tray. Keeping exact tray ids/order preserves match
    // event identity while avoiding generic object canonicalization per node.
    const board = state.boardIds.map((tileId) => tokenByTileId.get(tileId) ?? tileId).join('.');
    const tray = state.trayIds.map((tileId) => tokenByTileId.get(tileId) ?? tileId).join('.');
    return `${state.status[0]}|${board}|${tray}`;
  };
}

function scenarioStateKey(candidate: Candidate, profile: TapTileScenarioProfileId, stateKey: (state: TapTileGameState) => string): string {
  const key = stateKey(candidate.state);
  if (profile === 'danger-rescue') {
    return `${key}:${candidate.sawWarning ? 1 : 0}:${candidate.recoveredAfterWarning ? 1 : 0}`;
  }
  if (profile === 'combo-heavy') return `${key}:${candidate.consecutiveMatches}`;
  return key;
}

function maxClearBestOrder(left: Candidate, right: Candidate): number {
  const statusRank = (candidate: Candidate): number => candidate.state.status === 'won' ? 2 : candidate.state.status === 'playing' ? 1 : 0;
  return right.state.clearedIds.length - left.state.clearedIds.length
    || statusRank(right) - statusRank(left)
    || left.state.trayIds.length - right.state.trayIds.length
    || left.peakTrayOccupancy - right.peakTrayOccupancy
    || left.actions.length - right.actions.length
    || right.unlockedCount - left.unlockedCount
    || right.maxConsecutiveMatches - left.maxConsecutiveMatches
    || left.tieBreak - right.tieBreak
    || left.pathKey.localeCompare(right.pathKey);
}

function metricsForCandidate(
  candidate: Candidate,
  theoreticalClearableTileCount: number,
): TapTileSolveMetrics {
  const clearedTileCount = candidate.state.clearedIds.length;
  return {
    clearedTileCount,
    theoreticalClearableTileCount,
    remainingBoardCount: candidate.state.boardIds.length,
    trayOccupancy: candidate.state.trayIds.length,
    peakTrayOccupancy: candidate.peakTrayOccupancy,
    matchCount: candidate.matchCount,
    unlockedCount: candidate.unlockedCount,
    provedMaximum: clearedTileCount >= theoreticalClearableTileCount,
  };
}

function resultForCandidate(
  candidate: Candidate,
  status: 'solved' | 'partial',
  expandedStates: number,
  theoreticalClearableTileCount: number,
  diagnostic: string,
  terminationReason: TapTileSolveTerminationReason,
): SolveResult {
  return {
    status,
    actions: candidate.actions,
    expandedStates,
    terminationReason,
    finalStateHash: tapTileStateHash(candidate.state),
    metrics: metricsForCandidate(candidate, theoreticalClearableTileCount),
    diagnostic,
  };
}

function* iterateTapTileLevel(
  level: CompiledTapTileLevel,
  options: SolveTapTileOptions & { yieldEvery?: number } = {},
): Generator<TapTileSearchProgressSnapshot, SolveResult, TapTileSearchControl | undefined> {
  const profile = options.profile ?? 'safe-win';
  const seed = options.seed ?? 1;
  const beamWidth = Math.max(1, Math.floor(options.beamWidth ?? 600));
  const maxDepth = Math.max(0, Math.floor(options.maxDepth ?? level.initialBoardIds.length));
  const requestedStateBudget = options.maxExpandedStates ?? 250_000;
  const maxExpandedStates = Number.isFinite(requestedStateBudget)
    ? Math.max(1, Math.floor(requestedStateBudget))
    : Number.MAX_SAFE_INTEGER;
  const yieldEvery = Math.max(1, Math.floor(options.yieldEvery ?? 512));
  if (!level.validation.valid) {
    const first = level.validation.issues.find((issue) => issue.severity === 'error');
    return {
      status: 'invalid-level',
      expandedStates: 0,
      terminationReason: 'invalid-level',
      diagnostic: first ? `${first.code}: ${first.message}` : '关卡未通过编译校验。',
    };
  }

  const theoreticalClearableTileCount = theoreticalTapTileClearableCount(level);
  if (profile === 'max-clear' && theoreticalClearableTileCount === 0) {
    return {
      status: 'not-found',
      expandedStates: 0,
      terminationReason: 'no-triples',
      diagnostic: '当前匹配数量无法组成任何三消。',
    };
  }
  const initialState = createInitialTapTileGameState(level);
  const behavioralStateKey = createBehavioralStateKey(level);
  const initialPathRankState = createSeededPathState(seed);
  const initialCandidate: Candidate = {
    state: initialState,
    actions: [],
    matchCount: 0,
    unlockedCount: 0,
    consecutiveMatches: 0,
    maxConsecutiveMatches: 0,
    sawWarning: false,
    recoveredAfterWarning: false,
    peakTrayOccupancy: 0,
    score: 0,
    tieBreak: rankSeededPathState(initialPathRankState),
    pathKey: '',
    pathRankState: initialPathRankState,
  };
  let frontier: Candidate[] = [initialCandidate];
  const seen = new Map<string, number>([[scenarioStateKey(initialCandidate, profile, behavioralStateKey), 0]]);
  let bestMaxClearCandidate = initialCandidate;
  let expandedStates = 0;
  let deepest = 0;
  let budgetExhausted = false;
  let stopReason: TapTileSearchControl['stopReason'] | null = null;
  let nextYieldAt = yieldEvery;
  const progressSnapshot = (depth: number, frontierSize: number): TapTileSearchProgressSnapshot => ({
    profile,
    depth,
    maxDepth,
    frontierSize,
    expandedStates,
    stateBudget: maxExpandedStates,
    bestClearedTileCount: bestMaxClearCandidate.state.clearedIds.length,
    theoreticalClearableTileCount,
    bestActionCount: bestMaxClearCandidate.actions.length,
    peakTrayOccupancy: bestMaxClearCandidate.peakTrayOccupancy,
  });

  const initialControl = yield progressSnapshot(0, frontier.length);
  if (initialControl?.stopReason) stopReason = initialControl.stopReason;

  search:
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (stopReason) break;
    const expanded: Candidate[] = [];
    for (const candidate of frontier) {
      if (profile === 'max-clear'
        && candidateClearUpperBound(level, candidate) < bestMaxClearCandidate.state.clearedIds.length) continue;
      const playableIds = [...playableTapTileIds(level, candidate.state)].sort((left, right) => left.localeCompare(right));
      for (const tileId of playableIds) {
        if (expandedStates >= maxExpandedStates) {
          budgetExhausted = true;
          break search;
        }
        const action: TapTileAction = {
          id: `agent-${candidate.actions.length + 1}-${tileId}`,
          type: 'tap',
          actor: 'agent',
          tileId,
        };
        const transition = applyTapAction(level, candidate.state, action);
        expandedStates += 1;
        if (!transition.accepted) continue;
        const matched = transition.matchedTileIds.length > 0;
        const warnedNow = transition.events.some((event) => event.type === 'tray.warning');
        const sawWarning = candidate.sawWarning || warnedNow;
        const recoveredAfterWarning = candidate.recoveredAfterWarning
          || (candidate.sawWarning && matched && transition.after.trayIds.length < 6);
        const consecutiveMatches = matched ? candidate.consecutiveMatches + 1 : 0;
        const actions = [...candidate.actions, action];
        const pathKey = candidate.pathKey ? `${candidate.pathKey}|${tileId}` : tileId;
        const pathRankState = extendSeededPathState(candidate.pathRankState, tileId, candidate.actions.length > 0);
        const next: Candidate = {
          state: transition.after,
          actions,
          matchCount: candidate.matchCount + (matched ? 1 : 0),
          unlockedCount: candidate.unlockedCount + transition.newlyUnlockedTileIds.length,
          consecutiveMatches,
          maxConsecutiveMatches: Math.max(candidate.maxConsecutiveMatches, consecutiveMatches),
          sawWarning,
          recoveredAfterWarning,
          peakTrayOccupancy: Math.max(candidate.peakTrayOccupancy, transition.trayAfterInsert.length),
          score: 0,
          tieBreak: rankSeededPathState(pathRankState),
          pathKey,
          pathRankState,
        };
        next.score = scoreSolverCandidate(level, profile, { ...next, depth: depth + 1 });
        deepest = Math.max(deepest, depth + 1);

        if (profile === 'max-clear'
          && next.state.status !== 'lost'
          && maxClearBestOrder(next, bestMaxClearCandidate) < 0) {
          bestMaxClearCandidate = next;
        }

        if (isGoal(next, profile)) {
          const diagnostic = profile === 'danger-rescue'
            ? '已触发 6/7 警告、完成恢复并通关。'
            : profile === 'intentional-fail'
              ? '已生成第 7 格失败路径。'
              : profile === 'max-clear'
                ? `已消除全部 ${next.state.clearedIds.length} 张牌并通关。`
                : `已用 ${next.actions.length} 个语义动作达到目标。`;
          return resultForCandidate(next, 'solved', expandedStates, theoreticalClearableTileCount, diagnostic, 'goal');
        }

        if (expandedStates >= nextYieldAt) {
          nextYieldAt = expandedStates + yieldEvery;
          const control = yield progressSnapshot(depth + 1, frontier.length + expanded.length);
          if (control?.stopReason) {
            stopReason = control.stopReason;
            break search;
          }
        }
        if (next.state.status !== 'playing') continue;
        const key = scenarioStateKey(next, profile, behavioralStateKey);
        const previousPeak = seen.get(key);
        if (previousPeak !== undefined && (profile !== 'max-clear' || previousPeak <= next.peakTrayOccupancy)) continue;
        seen.set(key, next.peakTrayOccupancy);
        expanded.push(next);
      }
    }

    if (profile === 'max-clear'
      && theoreticalClearableTileCount > 0
      && bestMaxClearCandidate.state.clearedIds.length >= theoreticalClearableTileCount) {
      return resultForCandidate(
        bestMaxClearCandidate,
        'partial',
        expandedStates,
        theoreticalClearableTileCount,
        `已达到按匹配数量计算的理论上限：消除 ${theoreticalClearableTileCount}/${level.initialBoardIds.length} 张。`,
        'theoretical-maximum',
      );
    }

    if (profile === 'max-clear') {
      expanded.sort((left, right) => candidateClearUpperBound(level, right) - candidateClearUpperBound(level, left)
        || right.state.clearedIds.length - left.state.clearedIds.length
        || right.score - left.score
        || left.tieBreak - right.tieBreak
        || left.pathKey.localeCompare(right.pathKey));
    } else {
      expanded.sort((left, right) => right.score - left.score
        || left.tieBreak - right.tieBreak
        || left.pathKey.localeCompare(right.pathKey));
    }
    frontier = expanded.slice(0, beamWidth);
    if (frontier.length === 0) break;
  }

  if (profile === 'max-clear' && bestMaxClearCandidate.state.clearedIds.length > 0) {
    const metrics = metricsForCandidate(bestMaxClearCandidate, theoreticalClearableTileCount);
    const qualifier = metrics.provedMaximum
      ? '已达到理论上限'
      : stopReason === 'canceled'
        ? '搜索已由用户停止'
        : stopReason === 'time-budget'
          ? '时间预算已用完'
          : budgetExhausted
            ? '状态预算已用完'
            : '搜索已结束';
    const terminationReason: TapTileSolveTerminationReason = metrics.provedMaximum
      ? 'theoretical-maximum'
      : stopReason ?? (budgetExhausted ? 'state-budget' : frontier.length === 0 ? 'frontier-exhausted' : 'depth-limit');
    return resultForCandidate(
      bestMaxClearCandidate,
      'partial',
      expandedStates,
      theoreticalClearableTileCount,
      `${qualifier}；返回当前最佳安全轨迹，消除 ${metrics.clearedTileCount}/${level.initialBoardIds.length} 张（理论上限 ${theoreticalClearableTileCount}）。`,
      terminationReason,
    );
  }

  const budgetText = stopReason === 'canceled'
    ? '，搜索已由用户停止'
    : stopReason === 'time-budget'
      ? '，时间预算已用完'
      : budgetExhausted
        ? `，已用完 ${maxExpandedStates} 个展开状态预算`
        : '';
  return {
    status: 'not-found',
    expandedStates,
    terminationReason: stopReason ?? (budgetExhausted ? 'state-budget' : frontier.length === 0 ? 'frontier-exhausted' : 'depth-limit'),
    diagnostic: `Beam Search 在深度 ${deepest}/${maxDepth}、宽度 ${beamWidth} 内未找到目标${budgetText}；这不等于数学上无解。`,
  };
}

export function solveTapTileLevel(
  level: CompiledTapTileLevel,
  options: SolveTapTileOptions = {},
): SolveResult {
  const iterator = iterateTapTileLevel(level, options);
  let step = iterator.next();
  while (!step.done) step = iterator.next();
  return step.value;
}

function monotonicNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function yieldToHost(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

/**
 * Runs the exact same deterministic search as `solveTapTileLevel`, but yields
 * between bounded expansion slices. This keeps the browser interactive and
 * makes AbortSignal/time budgets return a formally replayable best-so-far path.
 */
export async function solveTapTileLevelAnytime(
  level: CompiledTapTileLevel,
  options: SolveTapTileAnytimeOptions = {},
): Promise<SolveResult> {
  const {
    signal,
    timeBudgetMs: requestedTimeBudgetMs,
    yieldEvery: requestedYieldEvery,
    onProgress,
    ...searchOptions
  } = options;
  const yieldEvery = Math.max(1, Math.floor(requestedYieldEvery ?? 256));
  const timeBudgetMs = requestedTimeBudgetMs === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(0, requestedTimeBudgetMs);
  const startedAt = monotonicNow();
  const iterator = iterateTapTileLevel(level, { ...searchOptions, yieldEvery });
  let step = iterator.next();

  while (!step.done) {
    const elapsedMs = monotonicNow() - startedAt;
    await onProgress?.({ ...step.value, elapsedMs });
    const stopReason: TapTileSearchControl['stopReason'] | null = signal?.aborted
      ? 'canceled'
      : elapsedMs >= timeBudgetMs
        ? 'time-budget'
        : null;
    if (stopReason) {
      step = iterator.next({ stopReason });
      continue;
    }
    await yieldToHost();
    step = iterator.next();
  }

  return step.value;
}
