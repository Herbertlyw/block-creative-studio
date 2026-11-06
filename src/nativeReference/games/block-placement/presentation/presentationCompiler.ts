import { applyPlacement, cloneSnapshot, pieceCellColor, pieceCells } from '../runtime/gameEngine';
import { getShape, getShapeBounds } from '../runtime/shapes';
import { boardPieceCenterNormalized, boardAnchorFromNormalizedPointer } from '../profiles/layout';
import { buildAgentPointerPath } from './pointerPath';
import type {
  BoardState,
  CompiledAction,
  CompiledTake,
  GameSnapshot,
  PlacementAction,
  PointerSample,
  PresentationFrame,
  RhythmProfile,
  Take,
} from '../../../domain/types';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const mix = (from: number, to: number, amount: number): number => from + (to - from) * amount;

function ease(value: number, kind: RhythmProfile['easing']): number {
  const t = clamp01(value);
  if (kind === 'easeOutCubic') return 1 - (1 - t) ** 3;
  if (kind === 'easeInOutCubic') return t < 0.5 ? 4 * t ** 3 : 1 - ((-2 * t + 2) ** 3) / 2;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function cloneBoard(board: BoardState): BoardState {
  return { rows: board.rows, cols: board.cols, cells: board.cells.map((row) => [...row]) };
}

function snapshotWithBoard(snapshot: GameSnapshot, board: BoardState): GameSnapshot {
  return { ...cloneSnapshot(snapshot), board: cloneBoard(board) };
}

function landingBounds(shapeId: string | undefined): { rows: number; cols: number } {
  if (!shapeId) return { rows: 1, cols: 1 };
  return getShapeBounds(getShape(shapeId));
}

function interpolatePointer(
  samples: PointerSample[],
  elapsedFrame: number,
  durationFrames: number,
  slotIndex: number,
  anchor: { row: number; col: number },
  bounds: { rows: number; cols: number },
): { x: number; y: number } {
  const landing = boardPieceCenterNormalized(anchor, bounds);
  const fallback: PointerSample[] = [
    { frameOffset: 0, x: 0.27 + slotIndex * 0.23, y: 0.88 },
    { frameOffset: Math.round(durationFrames * 0.45), x: 0.5, y: 0.64 },
    { frameOffset: durationFrames, x: landing.x, y: landing.y },
  ];
  const path = samples.length >= 2 ? samples : fallback;
  let point: { x: number; y: number };
  if (elapsedFrame <= (path[0]?.frameOffset ?? 0)) {
    const first = path[0] ?? fallback[0];
    point = { x: first?.x ?? 0.5, y: first?.y ?? 0.88 };
  } else {
    point = path[path.length - 1] ?? fallback[fallback.length - 1] ?? landing;
    for (let index = 1; index < path.length; index += 1) {
      const next = path[index];
      const previous = path[index - 1];
      if (!next || !previous) continue;
      if (elapsedFrame <= next.frameOffset) {
        const local = clamp01(
          (elapsedFrame - previous.frameOffset) /
            Math.max(1, next.frameOffset - previous.frameOffset),
        );
        point = { x: mix(previous.x, next.x, local), y: mix(previous.y, next.y, local) };
        break;
      }
    }
  }
  return { x: point.x ?? landing.x, y: point.y ?? landing.y };
}

function settlePointerToLanding(
  point: { x: number; y: number },
  anchor: { row: number; col: number },
  bounds: { rows: number; cols: number },
  progress: number,
): { x: number; y: number } {
  const landing = boardPieceCenterNormalized(anchor, bounds);
  const settle = clamp01((progress - 0.82) / 0.18);
  if (settle <= 0) return point;
  return { x: mix(point.x, landing.x, settle), y: mix(point.y, landing.y, settle) };
}

function directedDuration(action: PlacementAction, rhythm: RhythmProfile): number {
  const sourceWeight = action.actor === 'human' ? 0.58 : 0.25;
  const blended = action.durationFrames * sourceWeight + rhythm.dragFrames * (1 - sourceWeight);
  return Math.max(5, Math.round(blended / Math.max(0.25, rhythm.globalSpeed)));
}

export function compileTake(take: Take, rhythm: RhythmProfile, fps = 30): CompiledTake {
  let cursor = cloneSnapshot(take.initial);
  let frameCursor = Math.round(0.45 * fps);
  const compiled: CompiledAction[] = [];

  for (const sourceAction of take.actions) {
    frameCursor += Math.max(1, Math.round(rhythm.betweenActionFrames / rhythm.globalSpeed));
    const durationFrames = directedDuration(sourceAction, rhythm);
    const movingPiece = cursor.pieces.find((candidate) => candidate.id === sourceAction.pieceId);
    const bounds = landingBounds(movingPiece?.shapeId);
    const landing = boardPieceCenterNormalized(sourceAction.anchor, bounds);
    const pointerPath = sourceAction.actor === 'agent' && sourceAction.pointerPath.length <= 3
      ? buildAgentPointerPath({
          actionIndex: compiled.length,
          slotIndex: movingPiece?.slotIndex ?? 1,
          landing,
          durationFrames,
        })
      : sourceAction.pointerPath.map((sample) => ({
          ...sample,
          frameOffset: Math.round((sample.frameOffset / Math.max(1, sourceAction.durationFrames)) * durationFrames),
        }));
    const action: PlacementAction = {
      ...sourceAction,
      durationFrames,
      anchor: { ...sourceAction.anchor },
      pointerPath,
    };
    const transition = applyPlacement(cursor, action);
    if (!transition) throw new Error(`无法编译无效动作：${sourceAction.id}`);

    const startFrame = frameCursor + Math.round(rhythm.pickupDelayFrames / rhythm.globalSpeed);
    const releaseFrame = startFrame + durationFrames;
    const clearStartFrame = releaseFrame + Math.round(rhythm.clearDelayFrames / rhythm.globalSpeed);
    const clearEndFrame =
      transition.clear.cells.length > 0
        ? clearStartFrame + Math.max(1, Math.round(rhythm.clearDurationFrames / rhythm.globalSpeed))
        : clearStartFrame;
    const settleEnd = releaseFrame + Math.max(1, Math.round(rhythm.placementSettleFrames / rhythm.globalSpeed));
    const cameraRecoveryEnd =
      transition.clear.cells.length > 0
        ? clearEndFrame + Math.max(1, Math.round(rhythm.cameraRecoveryFrames / rhythm.globalSpeed))
        : clearEndFrame;
    const endFrame = Math.max(cameraRecoveryEnd, settleEnd);

    compiled.push({
      action,
      transition,
      startFrame,
      releaseFrame,
      clearStartFrame,
      clearEndFrame,
      endFrame,
    });
    cursor = transition.after;
    frameCursor = endFrame;
  }

  return {
    id: `compiled-${take.id}-${rhythm.id}`,
    fps,
    totalFrames: Math.max(fps * 2, frameCursor + Math.round(0.8 * fps)),
    actions: compiled,
    initial: cloneSnapshot(take.initial),
    final: cloneSnapshot(cursor),
  };
}

export function evaluateCompiledTake(
  compiled: CompiledTake,
  frame: number,
  rhythm: RhythmProfile,
): PresentationFrame {
  const safeFrame = Math.max(0, Math.min(compiled.totalFrames - 1, Math.round(frame)));
  let stable = compiled.initial;

  for (const compiledAction of compiled.actions) {
    if (safeFrame < compiledAction.startFrame) break;

    const { action, transition } = compiledAction;
    if (safeFrame <= compiledAction.releaseFrame) {
      const rawProgress = clamp01(
        (safeFrame - compiledAction.startFrame) /
          Math.max(1, compiledAction.releaseFrame - compiledAction.startFrame),
      );
      const progress = ease(rawProgress, rhythm.easing);
      const piece = transition.before.pieces.find((candidate) => candidate.id === action.pieceId);
      const bounds = landingBounds(piece?.shapeId);
      const pointer = settlePointerToLanding(
        interpolatePointer(
          action.pointerPath,
          safeFrame - compiledAction.startFrame,
          action.durationFrames,
          piece?.slotIndex ?? 1,
          action.anchor,
          bounds,
        ),
        action.anchor,
        bounds,
        rawProgress,
      );
      const hover = boardAnchorFromNormalizedPointer(pointer, bounds);
      return {
        frame: safeFrame,
        fps: compiled.fps,
        totalFrames: compiled.totalFrames,
        currentActionId: action.id,
        snapshot: cloneSnapshot(transition.before),
        board: cloneBoard(transition.before.board),
        hiddenPieceId: action.pieceId,
        ...(piece
          ? {
              draggedPiece: {
                piece: { ...piece, ...(piece.cellColors ? { cellColors: [...piece.cellColors] } : {}) },
                anchor: hover ?? { row: -1, col: -1 },
                progress,
              },
            }
          : {}),
        pointer: { ...pointer, pressed: true },
        cameraPunch: 0,
      };
    }

    const placedPiece = transition.before.pieces.find((candidate) => candidate.id === action.pieceId);
    const placedCells = placedPiece
      ? pieceCells(placedPiece, action.anchor).map((cell, index) => ({
          ...cell,
          color: pieceCellColor(placedPiece, index),
        }))
      : [];

    const placedFrame = (): PresentationFrame => {
      const placementProgress = clamp01(
        (safeFrame - compiledAction.releaseFrame) /
          Math.max(1, Math.round(rhythm.placementSettleFrames / rhythm.globalSpeed)),
      );
      const scoreSteps = Math.min(
        transition.placementPoints,
        Math.max(0, Math.ceil(placementProgress * transition.placementPoints)),
      );
      const snapshot = snapshotWithBoard(transition.after, transition.placedBoard);
      snapshot.score = transition.before.score + scoreSteps;
      snapshot.combo = transition.before.combo;
      return {
        frame: safeFrame,
        fps: compiled.fps,
        totalFrames: compiled.totalFrames,
        currentActionId: action.id,
        snapshot,
        board: cloneBoard(transition.placedBoard),
        ...(placedCells.length > 0
          ? {
              placementFeedback: {
                cells: placedCells,
                progress: placementProgress,
                placementPoints: transition.placementPoints,
              },
            }
          : {}),
        pointer: {
          ...boardPieceCenterNormalized(action.anchor, landingBounds(placedPiece?.shapeId)),
          pressed: false,
        },
        cameraPunch: 0,
      };
    };

    if (transition.clear.cells.length === 0) {
      // A non-clearing placement only owns the timeline through its settle interval.
      // Afterwards continue scanning so later actions can become active.
      if (safeFrame <= compiledAction.endFrame) return placedFrame();
      stable = transition.after;
      continue;
    }

    if (safeFrame < compiledAction.clearStartFrame) return placedFrame();

    if (safeFrame <= compiledAction.clearEndFrame) {
      const progress = clamp01(
        (safeFrame - compiledAction.clearStartFrame) /
          Math.max(1, compiledAction.clearEndFrame - compiledAction.clearStartFrame),
      );
      const snapshot = snapshotWithBoard(transition.after, transition.placedBoard);
      snapshot.score =
        transition.before.score +
        transition.placementPoints +
        Math.round(transition.clearBonusPoints * progress);
      // Keep the clear confirmation punch short and restrained: the old
      // full-duration pulse made every successful line feel like a large hit.
      const shakeProgress = clamp01(progress / 0.42);
      return {
        frame: safeFrame,
        fps: compiled.fps,
        totalFrames: compiled.totalFrames,
        currentActionId: action.id,
        snapshot,
        board: cloneBoard(transition.placedBoard),
        clearing: {
          clear: transition.clear,
          progress,
          seed: transition.after.seed + transition.after.turn * 977,
        },
        cameraPunch: Math.sin(shakeProgress * Math.PI) * 0.52,
      };
    }

    stable = transition.after;
  }

  return {
    frame: safeFrame,
    fps: compiled.fps,
    totalFrames: compiled.totalFrames,
    snapshot: cloneSnapshot(stable),
    board: cloneBoard(stable.board),
    cameraPunch: 0,
  };
}
