import type {
  CompiledTake,
  RhythmProfile,
  PresentationFrame,
} from '../../../nativeReference/domain/types';
import { stableHash } from '../../../nativeReference/headless/stableHash';
import {
  pieceCellColor,
  pieceCells,
} from '../../../nativeReference/games/block-placement/runtime/gameEngine';
import { blockPlacementPacketFromFrame } from '../presentation/packet';
import {
  createBBSemanticEventTimeline,
  type BBSemanticEventTimeline,
  type BBSemanticEventSpan,
} from './semanticEventTimeline';
import { createBBRuleTimeline, type BBRuleTimeline } from './ruleTimeline';
import { createBBDisplayBoardTimeline, type BBDisplayBoardTimeline } from './displayBoardTimeline';
import { validateBBTimelinePlan, type BBTimelinePlan } from './bbTimelinePlan';
import { createBBScoreTimeline } from './scoreTimeline';
import {
  getShape,
  getShapeBounds,
} from '../../../nativeReference/games/block-placement/runtime/shapes';
import {
  boardPieceCenterNormalized,
  blockPlacementLayoutProfile,
} from '../../../nativeReference/games/block-placement/profiles/layout';
import type { BBPointerTrack } from './pointerTimeline';
import type { BBPieceMotion } from './pieceMotion';
import type { BBScorePopupTrack } from './scorePopupTimeline';
import type { BBRenderAction } from './renderAction';

/** Transitional authored input. This is not yet the complete cross-input BBPlan. */
export interface AuthoredTakePlan extends BBTimelinePlan {
  readonly rules: BBRuleTimeline;
  readonly display: BBDisplayBoardTimeline;
  readonly events: BBSemanticEventTimeline;
  readonly identity: string;
}

/** Convert last-drag-frame boundaries into explicit rule and display times. */
export function normalizeAuthoredTake(
  takeId: string,
  compiled: CompiledTake,
  rhythm: RhythmProfile,
  cellGapPx?: number,
): AuthoredTakePlan {
  if (
    !takeId ||
    !Number.isInteger(compiled.fps) ||
    compiled.fps < 1 ||
    !Number.isInteger(compiled.totalFrames) ||
    compiled.totalFrames < 1
  )
    throw new Error('BB_AUTHORED_PLAN_INVALID');
  const { fps } = compiled;
  const rules = createBBRuleTimeline(
    compiled.initial,
    compiled.actions.map((item) => ({
      actionId: item.action.id,
      startSeconds: item.startFrame / fps,
      commitSeconds: (item.releaseFrame + 1) / fps,
      after: item.transition.after,
    })),
  );
  const display = createBBDisplayBoardTimeline(
    compiled.initial.board.cells,
    compiled.actions.map((item) => ({
      actionId: item.action.id,
      commitSeconds: (item.releaseFrame + 1) / fps,
      finalBoardSeconds:
        (item.transition.clear.cells.length ? item.clearEndFrame + 1 : item.releaseFrame + 1) / fps,
      placed: item.transition.placedBoard.cells,
      after: item.transition.after.board.cells,
    })),
  );
  const spans: BBSemanticEventSpan[] = [];
  const scores = Array<number>(compiled.totalFrames).fill(compiled.initial.score);
  const add = (start: number, end: number, frame: PresentationFrame) => {
    const boundedStart = Math.max(0, start),
      boundedEnd = Math.min(compiled.totalFrames, end);
    if (boundedEnd <= boundedStart) return;
    for (const event of blockPlacementPacketFromFrame(takeId, frame).semanticEvents)
      if (event.type !== 'block-placement.game-over')
        spans.push({ startFrame: boundedStart, endFrame: boundedEnd, event });
  };
  let terminal = compiled.initial.status === 'game-over' ? 0 : Infinity;
  for (const item of compiled.actions) {
    const { action, transition } = item;
    const piece = transition.before.pieces.find((candidate) => candidate.id === action.pieceId);
    if (!piece) throw new Error(`BB_AUTHORED_PIECE_MISSING:${action.id}`);
    const base: PresentationFrame = {
      frame: 0,
      fps,
      totalFrames: compiled.totalFrames,
      currentActionId: action.id,
      snapshot: transition.before,
      board: transition.before.board,
      cameraPunch: 0,
    };
    add(item.startFrame, item.releaseFrame + 1, {
      ...base,
      draggedPiece: { piece, anchor: action.anchor, progress: 0 },
    });
    const placedCells = pieceCells(piece, action.anchor).map((cell, index) => ({
      ...cell,
      color: pieceCellColor(piece, index),
    }));
    const commit = item.releaseFrame + 1;
    const clearStart = Math.max(commit, item.clearStartFrame);
    const placementEnd = transition.clear.cells.length ? clearStart : item.endFrame + 1;
    scores.fill(transition.after.score, Math.min(commit, compiled.totalFrames));
    for (let frame = commit; frame < Math.min(placementEnd, compiled.totalFrames); frame++) {
      const progress = Math.max(
        0,
        Math.min(
          1,
          (frame - item.releaseFrame) /
            Math.max(1, Math.round(rhythm.placementSettleFrames / rhythm.globalSpeed)),
        ),
      );
      const points = Math.min(
        transition.placementPoints,
        Math.max(0, Math.ceil(progress * transition.placementPoints)),
      );
      scores[frame] = transition.before.score + points;
    }
    add(commit, placementEnd, {
      ...base,
      snapshot: transition.after,
      placementFeedback: {
        cells: placedCells,
        progress: 0,
        placementPoints: transition.placementPoints,
      },
    });
    if (transition.clear.cells.length) {
      add(clearStart, item.clearEndFrame + 1, {
        ...base,
        snapshot: transition.after,
        clearing: {
          clear: transition.clear,
          progress: 0,
          seed: transition.after.seed + transition.after.turn * 977,
        },
      });
      for (
        let frame = clearStart;
        frame <= item.clearEndFrame && frame < compiled.totalFrames;
        frame++
      ) {
        const progress = Math.max(
          0,
          Math.min(
            1,
            (frame - item.clearStartFrame) / Math.max(1, item.clearEndFrame - item.clearStartFrame),
          ),
        );
        scores[frame] =
          transition.before.score +
          transition.placementPoints +
          Math.round(transition.clearBonusPoints * progress);
      }
    }
    if (transition.after.status === 'game-over') terminal = Math.min(terminal, commit);
  }
  if (terminal < compiled.totalFrames) {
    const frame: PresentationFrame = {
      frame: 0,
      fps,
      totalFrames: compiled.totalFrames,
      snapshot: { ...compiled.final, status: 'game-over' },
      board: compiled.final.board,
      cameraPunch: 0,
    };
    for (const event of blockPlacementPacketFromFrame(takeId, frame).semanticEvents)
      if (event.type === 'block-placement.game-over')
        spans.push({ startFrame: terminal, endFrame: compiled.totalFrames, event });
  }
  const events = createBBSemanticEventTimeline(compiled.totalFrames, spans);
  const score = createBBScoreTimeline(scores, Array<number>(compiled.totalFrames).fill(0));
  const actions = compiled.actions.map((item) => ({
    actionId: item.action.id,
    startSeconds: item.startFrame / fps,
    commitSeconds: (item.releaseFrame + 1) / fps,
    clearStartSeconds: Math.max(item.releaseFrame + 1, item.clearStartFrame) / fps,
    clearEndSeconds:
      Math.max(item.releaseFrame + 1, item.clearStartFrame, item.clearEndFrame + 1) / fps,
    endSeconds: (item.endFrame + 1) / fps,
    hasClear: item.transition.clear.cells.length > 0,
    motion: {
      clock: 'frame' as const,
      start: item.startFrame,
      end: item.releaseFrame,
      minimumSpan: 1,
      easing: rhythm.easing,
    },
  }));
  const pointers: BBPointerTrack[] = compiled.actions.map((item) => {
    const piece = item.transition.before.pieces.find(
      (candidate) => candidate.id === item.action.pieceId,
    );
    if (!piece) throw new Error(`BB_AUTHORED_PIECE_MISSING:${item.action.id}`);
    const landing = boardPieceCenterNormalized(
      item.action.anchor,
      getShapeBounds(getShape(piece.shapeId)),
    );
    const fallback = [
      { frameOffset: 0, x: 0.27 + piece.slotIndex * 0.23, y: 0.88 },
      { frameOffset: Math.round(item.action.durationFrames * 0.45), x: 0.5, y: 0.64 },
      { frameOffset: item.action.durationFrames, ...landing },
    ];
    const path = item.action.pointerPath.length >= 2 ? item.action.pointerPath : fallback;
    return {
      actionId: item.action.id,
      clock: 'frame',
      space: 'normalized',
      scope: 'active-action',
      start: item.startFrame,
      end: item.releaseFrame,
      minimumSpan: 1,
      radius: null,
      points: path.map((point) => ({
        time: item.startFrame + point.frameOffset,
        value: [point.x, point.y] as const,
      })),
      settleTo: { ...landing, fromProgress: 0.82, span: 0.18 },
      showAfterCommit: true,
    };
  });
  const pieces: BBPieceMotion[] = compiled.actions.map((item) => {
    const piece = item.transition.before.pieces.find(
      (candidate) => candidate.id === item.action.pieceId,
    );
    if (!piece) throw new Error(`BB_AUTHORED_PIECE_MISSING:${item.action.id}`);
    const shape = getShape(piece.shapeId),
      bounds = getShapeBounds(shape);
    return {
      actionId: item.action.id,
      pieceId: piece.id,
      cells: shape.cells,
      rows: bounds.rows,
      cols: bounds.cols,
      target: item.action.anchor,
      color: piece.color,
      cellColors: piece.cellColors ?? null,
      placement: {
        kind: 'pointer-center',
        canvasWidth: blockPlacementLayoutProfile.canvas.width,
        canvasHeight: blockPlacementLayoutProfile.canvas.height,
        gap: cellGapPx ?? null,
      },
    };
  });
  const rack = {
    initial: compiled.initial,
    steps: compiled.actions.map(({ action, transition }) => ({
      actionId: action.id,
      before: transition.before,
      after: transition.after,
    })),
    revealTimes: null,
    queuedColorPrefix: null,
  };
  const layout = blockPlacementLayoutProfile.rack;
  const gap = cellGapPx === undefined ? null : Math.max(0, Math.min(8, cellGapPx));
  const rackLayout = {
    centers: layout.centersX,
    centerY: layout.centerY,
    cellPitch: layout.cell,
    cellFaceSize: gap === null ? 48 : 50 - (gap * 50) / 112,
    positions: {},
    cellSizes: {},
    revealTimes: {},
    revealSeconds: 0,
    previewIntervals: [],
  };
  const clears = compiled.actions.map(
    ({ action, transition, releaseFrame, clearStartFrame, clearEndFrame }) => ({
      actionId: action.id,
      commitSeconds: (releaseFrame + 1) / fps,
      clearSeconds: Math.max(releaseFrame + 1, clearStartFrame) / fps,
      timeScale: 1,
      rows: transition.clear.rows,
      cols: transition.clear.cols,
      cells: transition.clear.cells.map((cell) => ({ ...cell, logicalColor: cell.color })),
      combo: transition.after.combo,
      seed: transition.after.seed + transition.after.turn * 977,
      progressFrames: { start: clearStartFrame, end: Math.max(clearStartFrame, clearEndFrame) },
      praiseLabel: null,
      feedback: null,
      atmosphereEligible: false,
    }),
  );
  const ghosts = compiled.actions.map(() => ({ kind: 'center' as const, linePreview: true }));
  const placements = compiled.actions.map(({ action, transition, releaseFrame }) => {
    const piece = transition.before.pieces.find((candidate) => candidate.id === action.pieceId);
    if (!piece) throw new Error(`BB_AUTHORED_PIECE_MISSING:${action.id}`);
    return {
      actionId: action.id,
      cells: pieceCells(piece, action.anchor).map((cell, index) => {
        const color = pieceCellColor(piece, index);
        return { ...cell, color, logicalColor: color };
      }),
      placementPoints: transition.placementPoints,
      progressFrames: {
        start: releaseFrame,
        span: Math.max(1, Math.round(rhythm.placementSettleFrames / rhythm.globalSpeed)),
      },
    };
  });
  const visualStatePolicy = {
    held: 'after' as const,
    board: 'visual' as const,
    score: 'timeline' as const,
    placedCombo: 'before' as const,
  };
  const camera = { translation: null, impactStyle: null, impulses: [] };
  const atmosphere = { enabled: false, endSeconds: null };
  const scorePopups: BBScorePopupTrack[] = [];
  const preview = {
    drags: [],
    board: null,
    offsetX: 0,
    lift: 0,
  } satisfies BBTimelinePlan['preview'];
  const grid = blockPlacementLayoutProfile.board.grid;
  const geometry = {
    canvas: blockPlacementLayoutProfile.canvas,
    board: {
      x: grid.x,
      y: grid.y,
      pitch: grid.pitch,
      cell: grid.cell,
      rows: compiled.initial.board.rows,
      cols: compiled.initial.board.cols,
    },
    fit: 'contain' as const,
  };
  const renderActions: BBRenderAction[] = compiled.actions.map(
    ({ action, transition, startFrame, releaseFrame, clearStartFrame }) => {
      const piece = transition.before.pieces.find((candidate) => candidate.id === action.pieceId);
      if (!piece) throw new Error(`BB_AUTHORED_PIECE_MISSING:${action.id}`);
      return structuredClone({
        step: {
          action: { id: action.id },
          before: { board: { cells: transition.before.board.cells } },
          after: { board: { cells: transition.after.board.cells }, combo: transition.after.combo },
          piece: { id: piece.id, shapeId: piece.shapeId, color: piece.color },
          clear: transition.clear,
          placedCells: pieceCells(piece, action.anchor),
        },
        timing: {
          actionId: action.id,
          start: startFrame / fps,
          release: (releaseFrame + 1) / fps,
          clear: Math.max(releaseFrame + 1, clearStartFrame) / fps,
          slot: piece.slotIndex,
        },
      });
    },
  );
  const plan = {
    takeId,
    fps,
    totalFrames: compiled.totalFrames,
    rules,
    display,
    actions,
    score,
    pointers,
    pieces,
    rack,
    rackLayout,
    clears,
    ghosts,
    placements,
    visualStatePolicy,
    camera,
    atmosphere,
    scorePopups,
    preview,
    renderActions,
    geometry,
    selectionGlow: null,
    recolorFlash: false,
    boardSurface: null,
    previousClearActions: 0,
    events,
    identity: stableHash({ contract: 'bcs.workbench.native-timeline.v5', compiled, rhythm }),
  };
  validateBBTimelinePlan(plan);
  return plan;
}
