import type { BoardState, GameSnapshot, PlacementAction, ClearResult, GameTransition, GridCell, LegalMove } from '../../../domain/types';
import { applyPlacement, cloneSnapshot, createGame, createPieceSet, listLegalMoves, replayActions } from '../runtime/gameEngine';
import { clusterColorizeBoard } from '../runtime/boardPresets';
import { SHAPES } from '../runtime/shapes';

export interface QualityRouteGoals {
  minActions: number;
  minClearEvents: number;
  minClearRatio: number;
  minTripleLineEvents: number;
  minTripleLineSegments: number;
  minConsecutiveClearStreak: number;
  maxNoClearSteps: number;
  minIntermediateBoardCells: number;
  initializerCandidates: number;
  beamWidth: number;
  branchWidth: number;
}

export interface QualityRouteStats {
  actionCount: number;
  clearEvents: number;
  totalClearedLines: number;
  tripleLineEvents: number;
  tripleLineEventSteps: number[];
  tripleLineSegments: number[];
  maxConsecutiveClearStreak: number;
  maxNoClearSteps: number;
  firstClearStep: number | null;
  minIntermediateOccupiedCells: number;
  clearRatio: number;
  finalStatus: GameSnapshot['status'];
  score: number;
}

export interface QualityRoutePlan {
  actions: PlacementAction[];
  stats: QualityRouteStats;
  expandedStates: number;
  goalReached: boolean;
  reason: string;
  initial?: GameSnapshot;
  initializerCandidate?: number;
}

interface BeamNode {
  snapshot: GameSnapshot;
  actions: PlacementAction[];
  transitions: GameTransition[];
  score: number;
  clearEvents: number;
  tripleLineEvents: number;
  clearStreak: number;
  maxClearStreak: number;
  noClearSteps: number;
  maxNoClearSteps: number;
}

function clearLines(clear: ClearResult): number {
  return clear.rows.length + clear.cols.length;
}

function statsFor(initial: GameSnapshot, actions: PlacementAction[]): QualityRouteStats {
  const transitions = replayActions(initial, actions);
  let clearEvents = 0;
  let totalClearedLines = 0;
  let tripleLineEvents = 0;
  let clearStreak = 0;
  let maxConsecutiveClearStreak = 0;
  let noClearSteps = 0;
  let maxNoClearSteps = 0;
  let firstClearStep: number | null = null;
  let minIntermediateOccupiedCells = Number.POSITIVE_INFINITY;
  const tripleLineEventSteps: number[] = [];
  for (const [index, transition] of transitions.entries()) {
    const lines = clearLines(transition.clear);
    if (lines > 0) {
      clearEvents += 1;
      totalClearedLines += lines;
      if (lines >= 3) {
        tripleLineEvents += 1;
        tripleLineEventSteps.push(index + 1);
      }
      clearStreak += 1;
      maxConsecutiveClearStreak = Math.max(maxConsecutiveClearStreak, clearStreak);
      if (firstClearStep === null) firstClearStep = index + 1;
      noClearSteps = 0;
    } else {
      clearStreak = 0;
      noClearSteps += 1;
      maxNoClearSteps = Math.max(maxNoClearSteps, noClearSteps);
    }
    if (index < transitions.length - 1) {
      const occupied = transition.after.board.cells.flat().filter(Boolean).length;
      minIntermediateOccupiedCells = Math.min(minIntermediateOccupiedCells, occupied);
    }
  }
  const final = transitions.at(-1)?.after ?? initial;
  const segmentDivisor = Math.max(1, actions.length);
  const tripleLineSegments = [...new Set(tripleLineEventSteps.map(step => Math.min(2, Math.floor(((step - 1) / segmentDivisor) * 3))))].sort();
  return {
    actionCount: actions.length,
    clearEvents,
    totalClearedLines,
    tripleLineEvents,
    tripleLineEventSteps,
    tripleLineSegments,
    maxConsecutiveClearStreak,
    maxNoClearSteps,
    firstClearStep,
    minIntermediateOccupiedCells: Number.isFinite(minIntermediateOccupiedCells)
      ? minIntermediateOccupiedCells
      : initial.board.cells.flat().filter(Boolean).length,
    clearRatio: actions.length ? clearEvents / actions.length : 0,
    finalStatus: final.status,
    score: final.score,
  };
}

function goalReached(stats: QualityRouteStats, goals: QualityRouteGoals): boolean {
  return stats.actionCount >= goals.minActions
    && stats.clearEvents >= goals.minClearEvents
    && stats.clearRatio >= goals.minClearRatio
    && stats.tripleLineEvents >= goals.minTripleLineEvents
    && stats.tripleLineSegments.length >= goals.minTripleLineSegments
    && stats.maxConsecutiveClearStreak >= goals.minConsecutiveClearStreak
    && stats.maxNoClearSteps <= goals.maxNoClearSteps
    && stats.minIntermediateOccupiedCells >= goals.minIntermediateBoardCells
    && stats.finalStatus === 'playing';
}

function nodeGoalReached(node: BeamNode, goals: QualityRouteGoals): boolean {
  const tripleSegments = new Set(node.transitions
    .map((transition, index) => clearLines(transition.clear) >= 3
      ? Math.min(2, Math.floor((index / Math.max(1, goals.minActions)) * 3))
      : -1)
    .filter(segment => segment >= 0));
  const intermediateOccupied = node.transitions.slice(0, -1)
    .map(transition => transition.after.board.cells.flat().filter(Boolean).length);
  return node.actions.length >= goals.minActions
    && node.clearEvents >= goals.minClearEvents
    && node.clearEvents / Math.max(1, node.actions.length) >= goals.minClearRatio
    && node.tripleLineEvents >= goals.minTripleLineEvents
    && tripleSegments.size >= goals.minTripleLineSegments
    && node.maxClearStreak >= goals.minConsecutiveClearStreak
    && node.maxNoClearSteps <= goals.maxNoClearSteps
    && (intermediateOccupied.length === 0 || Math.min(...intermediateOccupied) >= goals.minIntermediateBoardCells)
    && node.snapshot.status === 'playing';
}

function nodeScore(node: BeamNode, goals: QualityRouteGoals): number {
  const occupied = node.snapshot.board.cells.flat().filter(Boolean).length;
  const recentClearBonus = node.transitions.at(-1) ? clearLines(node.transitions.at(-1)!.clear) : 0;
  const remainingGap = Math.max(0, goals.maxNoClearSteps - node.noClearSteps);
  return node.clearEvents * 850
    + node.tripleLineEvents * 9_000
    + node.maxClearStreak * 1_800
    + recentClearBonus * recentClearBonus * 500
    + node.snapshot.score * 0.2
    + (node.snapshot.status === 'playing' ? 30 : 0)
    + occupied * 0.08
    - Math.max(0, goals.minIntermediateBoardCells - occupied) * 2_000
    + remainingGap * 30
    - node.noClearSteps * node.noClearSteps * 90
    - (node.snapshot.status === 'game-over' ? 100_000 : 0);
}

interface MaskPlacement {
  shapeId: string;
  anchor: GridCell;
  masks: number[];
  size: number;
}

interface AdaptiveNode {
  rows: number[];
  placements: Array<{ shapeId: string; anchor: GridCell; lines: number }>;
  clearEvents: number;
  tripleLineEvents: number;
  tripleSegmentsMask: number;
  clearStreak: number;
  maxClearStreak: number;
  noClearSteps: number;
  maxNoClearSteps: number;
  minOccupied: number;
  score: number;
  shapeCounts: Record<string, number>;
}

const FULL_ROW_MASK = 0xff;

const MASK_PLACEMENTS: MaskPlacement[] = SHAPES.flatMap(shape => {
  const placements: MaskPlacement[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if (shape.cells.some(([dr, dc]) => row + dr >= 8 || col + dc >= 8)) continue;
      const masks = Array<number>(8).fill(0);
      for (const [dr, dc] of shape.cells) masks[row + dr] = (masks[row + dr] ?? 0) | (1 << (col + dc));
      placements.push({ shapeId: shape.id, anchor: { row, col }, masks, size: shape.cells.length });
    }
  }
  return placements;
});

function popCount(value: number): number {
  let current = value >>> 0;
  current -= (current >>> 1) & 0x55555555;
  current = (current & 0x33333333) + ((current >>> 2) & 0x33333333);
  return (((current + (current >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function occupiedRows(rows: number[]): number {
  return rows.reduce((total, row) => total + popCount(row), 0);
}

function nextRandom(state: { value: number }): number {
  state.value = (Math.imul(state.value, 1_664_525) + 1_013_904_223) >>> 0;
  return state.value / 0x1_0000_0000;
}

function adaptiveOpeningRows(seed: number, candidateIndex: number): number[] {
  const provenCavityPattern = [0b10110001, 0b11110001, 0b11110000, 0b01111111, 0b01000111, 0b01101111, 0b01111111, 0b01111111];
  if (candidateIndex < 4) {
    const mirrored = provenCavityPattern.map(row => Number.parseInt(row.toString(2).padStart(8, '0').split('').reverse().join(''), 2));
    const seededVariant = (candidateIndex + (seed >>> 0)) % 4;
    if (seededVariant === 0) return [...provenCavityPattern];
    if (seededVariant === 1) return mirrored;
    if (seededVariant === 2) return [...provenCavityPattern].reverse();
    return [...mirrored].reverse();
  }
  const random = { value: (seed ^ Math.imul(candidateIndex + 1, 0x9e3779b1)) >>> 0 };
  const rows = Array<number>(8).fill(FULL_ROW_MASK);
  const cavityShapes = ['square-3', 't-4', 'tri-v', 'l-5', 'line5-h'];
  const cavityCount = 3 + (candidateIndex % 3);
  for (let cavity = 0; cavity < cavityCount; cavity += 1) {
    const shapeId = cavityShapes[(candidateIndex + cavity) % cavityShapes.length]!;
    const options = MASK_PLACEMENTS.filter(placement => placement.shapeId === shapeId);
    const selected = options[Math.floor(nextRandom(random) * options.length)]!;
    for (let row = 0; row < 8; row += 1) rows[row] = (rows[row] ?? 0) & ~(selected.masks[row] ?? 0);
  }
  for (let row = 0; row < 8; row += 1) {
    if (rows[row] === FULL_ROW_MASK) rows[row] = (rows[row] ?? 0) & ~(1 << Math.floor(nextRandom(random) * 8));
  }
  for (let col = 0; col < 8; col += 1) {
    if (rows.every(row => (row & (1 << col)) !== 0)) {
      const row = Math.floor(nextRandom(random) * 8);
      rows[row] = (rows[row] ?? 0) & ~(1 << col);
    }
  }
  while (occupiedRows(rows) > 48) {
    const row = Math.floor(nextRandom(random) * 8);
    const col = Math.floor(nextRandom(random) * 8);
    rows[row] = (rows[row] ?? 0) & ~(1 << col);
  }
  return candidateIndex % 2 === 0 ? rows : [...rows].reverse();
}

function boardFromRows(rows: number[], seed: number): BoardState {
  const board: BoardState = {
    rows: 8,
    cols: 8,
    cells: rows.map(row => Array.from({ length: 8 }, (_, col) => (row & (1 << col)) !== 0 ? 'cyan' : null)),
  };
  return clusterColorizeBoard(board, seed);
}

function maskNodeScore(node: AdaptiveNode, goals: QualityRouteGoals, depth: number, jitter: number): number {
  const occupied = occupiedRows(node.rows);
  const scheduledTriples = Math.min(goals.minTripleLineEvents, Math.floor(depth / 6) + 1);
  let potential = 0;
  for (const row of node.rows) potential += popCount(row) ** 2;
  for (let col = 0; col < 8; col += 1) {
    let cells = 0;
    for (const row of node.rows) cells += (row >> col) & 1;
    potential += cells ** 2;
  }
  return Math.min(node.tripleLineEvents, scheduledTriples) * 1_500
    + node.clearEvents * 190
    + Math.min(node.maxClearStreak, 4) * 110
    + occupied * 12
    + potential * 0.55
    + Object.keys(node.shapeCounts).length * 24
    - (node.shapeCounts['square-3'] ?? 0) * 2
    - Math.max(0, goals.minIntermediateBoardCells - occupied) * 8_000
    - Math.max(0, occupied - 54) * 1_000
    - node.noClearSteps * 120
    + jitter;
}

function searchAdaptiveCandidate(rows: number[], goals: QualityRouteGoals, tieSeed: number): AdaptiveNode | null {
  const random = { value: (tieSeed + 1) >>> 0 };
  const seed: AdaptiveNode = {
    rows,
    placements: [],
    clearEvents: 0,
    tripleLineEvents: 0,
    tripleSegmentsMask: 0,
    clearStreak: 0,
    maxClearStreak: 0,
    noClearSteps: 0,
    maxNoClearSteps: 0,
    minOccupied: occupiedRows(rows),
    score: 0,
    shapeCounts: {},
  };
  let beam: AdaptiveNode[] = [seed];
  for (let depth = 0; depth < goals.minActions && beam.length; depth += 1) {
    const deduped = new Map<string, AdaptiveNode>();
    for (const node of beam) {
      for (const placement of MASK_PLACEMENTS) {
        if (node.placements.length >= 2
          && node.placements.at(-1)?.shapeId === placement.shapeId
          && node.placements.at(-2)?.shapeId === placement.shapeId) continue;
        if (node.rows.some((row, index) => (row & (placement.masks[index] ?? 0)) !== 0)) continue;
        const placed = node.rows.map((row, index) => row | (placement.masks[index] ?? 0));
        const fullRows = placed.map((row, index) => row === FULL_ROW_MASK ? index : -1).filter(index => index >= 0);
        let fullColumns = FULL_ROW_MASK;
        for (const row of placed) fullColumns &= row;
        const lines = fullRows.length + popCount(fullColumns);
        const noClearSteps = lines > 0 ? 0 : node.noClearSteps + 1;
        if (noClearSteps > goals.maxNoClearSteps) continue;
        if (depth === 0 && lines === 0) continue;
        const after = placed.map(row => row === FULL_ROW_MASK ? 0 : row & ~fullColumns);
        const occupied = occupiedRows(after);
        if (depth < goals.minActions - 1 && occupied < goals.minIntermediateBoardCells) continue;
        if (occupied > 54) continue;
        const clearEvents = node.clearEvents + (lines > 0 ? 1 : 0);
        const tripleLineEvents = node.tripleLineEvents + (lines >= 3 ? 1 : 0);
        const clearStreak = lines > 0 ? node.clearStreak + 1 : 0;
        const segment = Math.min(2, Math.floor((depth / Math.max(1, goals.minActions)) * 3));
        const child: AdaptiveNode = {
          rows: after,
          placements: [...node.placements, { shapeId: placement.shapeId, anchor: placement.anchor, lines }],
          clearEvents,
          tripleLineEvents,
          tripleSegmentsMask: node.tripleSegmentsMask | (lines >= 3 ? (1 << segment) : 0),
          clearStreak,
          maxClearStreak: Math.max(node.maxClearStreak, clearStreak),
          noClearSteps,
          maxNoClearSteps: Math.max(node.maxNoClearSteps, noClearSteps),
          minOccupied: Math.min(node.minOccupied, occupied),
          score: 0,
          shapeCounts: { ...node.shapeCounts, [placement.shapeId]: (node.shapeCounts[placement.shapeId] ?? 0) + 1 },
        };
        child.score = maskNodeScore(child, goals, depth, nextRandom(random) * 32);
        const key = `${after.join(',')}:${noClearSteps}:${Math.min(tripleLineEvents, goals.minTripleLineEvents)}:${child.tripleSegmentsMask}:${Math.min(clearStreak, goals.minConsecutiveClearStreak)}`;
        const previous = deduped.get(key);
        if (!previous || previous.score < child.score) deduped.set(key, child);
      }
    }
    const ranked = [...deduped.values()].sort((left, right) => right.score - left.score);
    const buckets = new Map<string, AdaptiveNode[]>();
    for (const node of ranked) {
      const occupiedBand = Math.floor(occupiedRows(node.rows) / 8);
      const key = `${Math.min(node.tripleLineEvents, goals.minTripleLineEvents)}:${node.tripleSegmentsMask}:${Math.min(node.maxClearStreak, goals.minConsecutiveClearStreak)}:${occupiedBand}`;
      const bucket = buckets.get(key) ?? [];
      if (bucket.length < 3) bucket.push(node);
      buckets.set(key, bucket);
    }
    const selected = [...buckets.values()].flat();
    const selectedSet = new Set(selected);
    for (const node of ranked) {
      if (selected.length >= goals.beamWidth) break;
      if (!selectedSet.has(node)) selected.push(node);
    }
    beam = selected.sort((left, right) => right.score - left.score).slice(0, goals.beamWidth);
  }
  return beam.find(node => node.clearEvents >= goals.minClearEvents
    && node.clearEvents / Math.max(1, node.placements.length) >= goals.minClearRatio
    && node.tripleLineEvents >= goals.minTripleLineEvents
    && popCount(node.tripleSegmentsMask) >= goals.minTripleLineSegments
    && node.maxClearStreak >= goals.minConsecutiveClearStreak
    && node.maxNoClearSteps <= goals.maxNoClearSteps
    && node.minOccupied >= goals.minIntermediateBoardCells) ?? null;
}

export function planAdaptiveQualityRoute(
  seed: number,
  goals: QualityRouteGoals,
  makeAction: (index: number, snapshot: GameSnapshot, move: LegalMove) => PlacementAction,
): QualityRoutePlan {
  let expandedStates = 0;
  for (let candidateIndex = 0; candidateIndex < goals.initializerCandidates; candidateIndex += 1) {
    const openingRows = adaptiveOpeningRows(seed, candidateIndex);
    const candidate = searchAdaptiveCandidate(openingRows, goals, seed ^ Math.imul(candidateIndex + 1, 0x9e3779b1));
    expandedStates += goals.minActions * goals.beamWidth * MASK_PLACEMENTS.length;
    if (!candidate) continue;
    const shapeBatches = Array.from({ length: Math.ceil(candidate.placements.length / 3) }, (_, batchIndex) => {
      const shapes = candidate.placements.slice(batchIndex * 3, batchIndex * 3 + 3).map(item => item.shapeId);
      while (shapes.length < 3) shapes.push('single');
      return shapes;
    });
    shapeBatches.push(['single', 'domino-h', 'domino-v']);
    const fixedPieceSupply = shapeBatches.map((shapeIds, setIndex) => createPieceSet(seed, setIndex, shapeIds));
    const initial = createGame(boardFromRows(openingRows, seed + candidateIndex), seed, fixedPieceSupply[0], fixedPieceSupply);
    const actions: PlacementAction[] = [];
    let cursor = cloneSnapshot(initial);
    for (const [index, placement] of candidate.placements.entries()) {
      const piece = cursor.pieces[index % 3];
      if (!piece || piece.shapeId !== placement.shapeId || piece.used) break;
      const move: LegalMove = { pieceId: piece.id, anchor: placement.anchor, immediateLines: placement.lines, clearedCells: 0, heuristic: 0 };
      const action = makeAction(index, cursor, move);
      const transition = applyPlacement(cursor, action);
      if (!transition) break;
      actions.push(action);
      cursor = transition.after;
    }
    if (actions.length !== candidate.placements.length) continue;
    const stats = statsFor(initial, actions);
    if (!goalReached(stats, goals)) continue;
    return {
      actions,
      stats,
      expandedStates,
      goalReached: true,
      reason: 'Joint initializer, three-piece supply, and placement search reached all event goals; native replay confirmed the route.',
      initial,
      initializerCandidate: candidateIndex,
    };
  }
  return {
    actions: [],
    stats: statsFor(createGame(), []),
    expandedStates,
    goalReached: false,
    reason: 'Joint search exhausted all initializer and supply candidates before reaching every event goal.',
  };
}

export function planQualityRoute(
  initial: GameSnapshot,
  goals: QualityRouteGoals,
  makeAction: (index: number, snapshot: GameSnapshot, move: LegalMove) => PlacementAction,
): QualityRoutePlan {
  const seed: BeamNode = {
    snapshot: cloneSnapshot(initial), actions: [], transitions: [], score: 0,
    clearEvents: 0, tripleLineEvents: 0, clearStreak: 0, maxClearStreak: 0,
    noClearSteps: 0, maxNoClearSteps: 0,
  };
  let beam: BeamNode[] = [seed];
  let best = seed;
  let expandedStates = 0;
  const searchDepth = Math.max(goals.minActions + 12, goals.minActions);
  for (let depth = 0; depth < searchDepth && beam.length; depth += 1) {
    const next: BeamNode[] = [];
    for (const node of beam) {
      if (nodeGoalReached(node, goals)) {
        best = node;
        break;
      }
      const legal = listLegalMoves(node.snapshot);
      expandedStates += legal.length;
      const ranked = legal
        .slice(0, Math.max(goals.branchWidth, 1))
        .sort((left, right) => {
          const clearDifference = right.immediateLines - left.immediateLines;
          return clearDifference || right.heuristic - left.heuristic;
        });
      for (const move of ranked) {
        const action = makeAction(node.actions.length, node.snapshot, move);
        const transition = applyPlacement(node.snapshot, action);
        if (!transition) continue;
        const lines = clearLines(transition.clear);
        const clearEvents = node.clearEvents + (lines > 0 ? 1 : 0);
        const tripleLineEvents = node.tripleLineEvents + (lines >= 3 ? 1 : 0);
        const clearStreak = lines > 0 ? node.clearStreak + 1 : 0;
        const child: BeamNode = {
          snapshot: transition.after,
          actions: [...node.actions, action],
          transitions: [...node.transitions, transition],
          score: 0,
          clearEvents,
          tripleLineEvents,
          clearStreak,
          maxClearStreak: Math.max(node.maxClearStreak, clearStreak),
          noClearSteps: lines > 0 ? 0 : node.noClearSteps + 1,
          maxNoClearSteps: Math.max(node.maxNoClearSteps, lines > 0 ? 0 : node.noClearSteps + 1),
        };
        child.score = nodeScore(child, goals);
        next.push(child);
      }
    }
    const goalCandidate = next.find(node => nodeGoalReached(node, goals));
    if (goalCandidate) {
      best = goalCandidate;
      break;
    }
    next.sort((left, right) => right.score - left.score);
    beam = next.slice(0, Math.max(goals.beamWidth, 1));
    if (beam[0] && beam[0].score > best.score) best = beam[0];
  }
  const stats = statsFor(initial, best.actions);
  return {
    actions: best.actions,
    stats,
    expandedStates,
    goalReached: goalReached(stats, goals),
    reason: goalReached(stats, goals)
      ? 'Event goals reached by native beam search.'
      : 'Search budget exhausted before all event goals were reached.',
  };
}

export function qualityRouteStats(initial: GameSnapshot, actions: PlacementAction[]): QualityRouteStats {
  return statsFor(initial, actions);
}
