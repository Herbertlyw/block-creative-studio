import type { Take } from '../../../nativeReference/domain/types';
import { replayActions } from '../../../nativeReference/games/block-placement/runtime/gameEngine';
import {
  getShape,
  getShapeBounds,
} from '../../../nativeReference/games/block-placement/runtime/shapes';
import {
  measuredReplay,
  measuredCellColor,
} from '../../../nativeReference/games/block-placement/presentation/referenceAppearance';
import type {
  CalibratedDisplayState,
  CalibratedReplayStep,
} from '../../../contracts/calibratedFrame';
import type { ReferenceCalibration } from '../calibrated/parseCalibration';
import { recolorReplay, shapeCellColor } from '../calibrated/tileColors';
import { referenceAudioEvents, referencePraiseLabel } from '../calibrated/referenceAudio';
import { createBBRuleTimeline } from './ruleTimeline';
import { createBBDisplayBoardTimeline } from './displayBoardTimeline';
import { createBBSemanticEventTimeline } from './semanticEventTimeline';
import { validateBBTimelinePlan } from './bbTimelinePlan';
import { normalizeObservedScore } from './observedScoreTrack';
import type { PointerOverlay } from '../../../contracts/observedPointer';
import type { BBPointerTrack } from './pointerTimeline';
import type { BBPieceMotion } from './pieceMotion';
import { referenceRackPose } from '../calibrated/rackPose';
import { screenAtmosphereAllowed } from './atmosphere';
import { normalizeObservedPopups } from './normalizeObservedPopups';
import type { BBRenderAction } from './renderAction';

/** Build observation inputs without changing the source document or Take order. */
export function normalizeObservedTake(
  take: Take,
  calibration: ReferenceCalibration,
  fps: number,
  pointer: PointerOverlay | null = null,
) {
  if (!Number.isInteger(fps) || fps < 1) throw new Error('BB_OBSERVED_FPS_INVALID');
  const steps = replayActions(take.initial, take.actions).map((step) => {
    const piece = step.before.pieces.find((item) => item.id === step.action.pieceId);
    if (!piece) throw new Error(`BB_OBSERVED_PIECE_MISSING:${step.action.id}`);
    return {
      ...step,
      piece,
      placedCells: getShape(piece.shapeId).cells.map(([r, c]) => ({
        row: r + step.action.anchor.row,
        col: c + step.action.anchor.col,
      })),
    };
  });
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i],
      timing = calibration.actions[i];
    if (!step || !timing || step.action.id !== timing.actionId)
      throw new Error(`CALIBRATED_FRAME_ACTION_MISMATCH:${i}`);
    const next = steps[i + 1],
      nextTiming = calibration.actions[i + 1];
    if (next && (!nextTiming || next.action.id !== nextTiming.actionId))
      throw new Error(`CALIBRATED_FRAME_ACTION_MISMATCH:${i + 1}`);
    if (step.clear.cells.length && next && nextTiming && nextTiming.release < timing.clear)
      throw new Error(
        `CALIBRATED_OVERLAPPING_CLEAR_UNSUPPORTED:${step.action.id}:${next.action.id}：前一步清除演出尚未结束时，后一步已释放；当前单层显示棋盘无法可靠表达，请重新确认动作时间。`,
      );
  }
  if (steps.length !== calibration.actions.length)
    throw new Error('CALIBRATED_FRAME_ACTION_COUNT_MISMATCH');
  const rules = createBBRuleTimeline(
    take.initial,
    steps.map((step, index) => {
      const timing = calibration.actions[index];
      if (!timing) throw new Error(`CALIBRATED_FRAME_ACTION_MISMATCH:${index}`);
      return {
        actionId: step.action.id,
        startSeconds: timing.start,
        commitSeconds: timing.release,
        after: step.after,
      };
    }),
  );
  const totalFrames = Math.round(calibration.duration * fps);
  const observedEvents = referenceAudioEvents(calibration, steps, fps);
  const events = createBBSemanticEventTimeline(
    totalFrames,
    [...observedEvents].flatMap(([frame, items]) =>
      items.map((event) => ({ startFrame: frame, endFrame: frame + 1, event })),
    ),
  );
  const score = normalizeObservedScore(calibration, fps, totalFrames);
  const measured = measuredReplay(take.initial, steps, calibration.appearance);
  const displayed = recolorReplay(
    measured.initial,
    measured.steps,
    calibration.tileColors,
    calibration.tileMaterial,
  ) as { initial: CalibratedDisplayState; steps: CalibratedReplayStep[] };
  const display = createBBDisplayBoardTimeline(
    displayed.initial.board.cells,
    displayed.steps.map((step, index) => {
      const action = calibration.actions[index];
      if (!action || action.actionId !== step.action.id)
        throw new Error(`CALIBRATED_FRAME_ACTION_MISMATCH:${index}`);
      const placed = step.before.board.cells.map((row) => [...row]);
      for (const cell of step.placedCells) {
        const row = placed[cell.row];
        if (!row || cell.col < 0 || cell.col >= row.length)
          throw new Error('CALIBRATED_FRAME_CELL_INVALID');
        row[cell.col] = step.placedColors?.[`${cell.row},${cell.col}`] ?? step.piece.color;
      }
      return {
        actionId: step.action.id,
        commitSeconds: action.release,
        finalBoardSeconds: action.clear,
        placed,
        after: step.after.board.cells,
      };
    }),
  );
  const actions = steps.map((step, index) => {
    const timing = calibration.actions[index];
    if (!timing) throw new Error(`CALIBRATED_FRAME_ACTION_MISMATCH:${index}`);
    return {
      actionId: step.action.id,
      startSeconds: timing.start,
      commitSeconds: timing.release,
      clearStartSeconds: timing.clear,
      clearEndSeconds: timing.clear,
      endSeconds: timing.clear,
      hasClear: step.clear.cells.length > 0,
      motion: {
        clock: 'seconds' as const,
        start: timing.start,
        end: timing.release,
        minimumSpan: Number.MIN_VALUE,
        easing: 'smoothstep' as const,
      },
    };
  });
  const pointers: BBPointerTrack[] = (pointer?.tracks ?? []).map((track) => {
    const first = track.points[0],
      last = track.points.at(-1);
    if (!first || !last || track.points.length < 2 || !pointer)
      throw new Error(`BB_OBSERVED_POINTER_INVALID:${track.actionId}`);
    return {
      actionId: track.actionId,
      clock: 'seconds',
      space: 'design',
      scope: 'independent',
      start: first.time,
      end: last.time,
      points: track.points.map((point) => ({
        time: point.time,
        value: [point.x, point.y] as const,
      })),
      minimumSpan: Number.MIN_VALUE,
      radius: pointer.style.radius,
    };
  });
  const pieces: BBPieceMotion[] = displayed.steps.map((step, index) => {
    const timing = calibration.actions[index];
    if (!timing || step.action.id !== timing.actionId)
      throw new Error(`CALIBRATED_FRAME_ACTION_MISMATCH:${index}`);
    const shape = getShape(step.piece.shapeId),
      bounds = getShapeBounds(shape),
      rack = referenceRackPose(calibration, step.piece, shape.cells);
    const [gx, gy, pitch] = calibration.board,
      tx = gx + step.action.anchor.col * pitch,
      ty = gy + step.action.anchor.row * pitch;
    const points: Array<[number, number, number, number]> = timing.motion?.length
      ? [
          ...(timing.motion[0]?.[0] === timing.start
            ? []
            : [[timing.start, rack.x, rack.y, rack.size] as [number, number, number, number]]),
          ...timing.motion,
          [timing.release, tx, ty, pitch],
        ]
      : [];
    const cellColors = shape.cells.map(([row, col]) =>
      measuredCellColor(
        calibration.appearance,
        shapeCellColor(step.piece.color, row, col, calibration.tileMaterial),
        row,
        col,
      ),
    );
    return {
      actionId: step.action.id,
      pieceId: step.piece.id,
      cells: shape.cells,
      rows: bounds.rows,
      cols: bounds.cols,
      target: step.action.anchor,
      color: step.piece.color,
      cellColors,
      placement: {
        kind: 'box',
        from: [rack.x, rack.y, rack.size],
        to: [tx, ty, pitch],
        arcHeight: 90,
        sizeEaseFactor: 3.8,
        points: points.map(([at, x, y, size]) => ({ time: at, value: [x, y, size] as const })),
      },
    };
  });
  const rack = {
    initial: displayed.initial,
    steps: displayed.steps.map((step) => ({
      actionId: step.action.id,
      before: step.before,
      after: step.after,
    })),
    revealTimes: calibration.appearance?.rackRevealTimes ?? null,
    queuedColorPrefix: 'observed-piece:',
  };
  const rackLayout = {
    centers:
      calibration.rackCenters ??
      calibration.appearance?.rackCenters ??
      ([236, 540, 844] as [number, number, number]),
    centerY: calibration.rackY,
    cellPitch: calibration.rackCell,
    cellFaceSize: calibration.rackCell,
    positions: calibration.appearance?.rackPositions ?? {},
    cellSizes: calibration.appearance?.rackCellSizes ?? {},
    revealTimes: calibration.appearance?.rackRevealTimes ?? {},
    revealSeconds: calibration.appearance?.rackRevealSeconds ?? 0,
    previewIntervals: calibration.previewDrags ?? [],
  };
  const clears = displayed.steps.map((step, index) => {
    const timing = calibration.actions[index];
    if (!timing || timing.actionId !== step.action.id)
      throw new Error(`CALIBRATED_FRAME_ACTION_MISMATCH:${index}`);
    const board = display.steps[index]?.placed;
    if (!board) throw new Error(`BB_CLEAR_BOARD_MISSING:${step.action.id}`);
    const cells = step.clear.cells.map((cell) => {
      const color = board[cell.row]?.[cell.col];
      if (color === null || color === undefined)
        throw new Error(`BB_CLEAR_COLOR_MISSING:${step.action.id}:${cell.row}:${cell.col}`);
      return { row: cell.row, col: cell.col, color, logicalColor: cell.color };
    });
    const combo = timing.combo ?? step.after.combo,
      label = referencePraiseLabel(calibration, step, index),
      effects = calibration.effects;
    const like =
      effects?.likes?.enabled && timing.like !== 'none'
        ? (timing.like ??
          (effects.likes.trigger === 'combo' && combo >= effects.likes.minCombo
            ? effects.likes.style
            : undefined))
        : undefined;
    const feedback = effects
      ? {
          like,
          rim: !!effects.butterflyRim?.enabled && combo >= effects.butterflyRim.minCombo,
          celebrate: !!effects.perfectCelebration?.enabled && timing.perfect === true,
        }
      : null;
    return {
      actionId: step.action.id,
      commitSeconds: timing.release,
      clearSeconds: timing.clear,
      timeScale: timing.clearTimeScale ?? 1,
      rows: step.clear.rows,
      cols: step.clear.cols,
      cells,
      combo,
      seed: index * 101,
      progressFrames: null,
      praiseLabel: label,
      feedback,
      atmosphereEligible: screenAtmosphereAllowed(
        label,
        combo,
        step.clear.rows.length + step.clear.cols.length,
        !!timing.perfect,
      ),
    };
  });
  const ghosts = calibration.actions.map((timing) => ({
    kind: 'proximity' as const,
    board: calibration.board,
    offsetX: calibration.appearance?.landingPreview?.offsetX ?? 0,
    lift: calibration.appearance?.landingPreview?.lift ?? 0,
    linePreview: !!(timing.linePreview ?? calibration.appearance?.linePreview),
    lineUntil: calibration.appearance?.linePreviewUntil ?? null,
  }));
  const placements = displayed.steps.map((step, index) => {
    const board = display.steps[index]?.placed;
    if (!board) throw new Error(`BB_PLACED_BOARD_MISSING:${step.action.id}`);
    const cells = step.placedCells.map((cell, cellIndex) => {
      const color = board[cell.row]?.[cell.col],
        logicalColor = step.piece.cellColors?.[cellIndex] ?? steps[index]?.piece.color;
      if (color === null || color === undefined || logicalColor === undefined)
        throw new Error(`BB_PLACED_COLOR_MISSING:${step.action.id}:${cell.row}:${cell.col}`);
      return { ...cell, color, logicalColor };
    });
    return {
      actionId: step.action.id,
      cells,
      placementPoints: step.placementPoints,
      progressFrames: null,
    };
  });
  const visualStatePolicy = {
    held: 'before' as const,
    board: 'snapshot' as const,
    score: 'snapshot' as const,
    placedCombo: 'snapshot' as const,
  };
  const camera = {
    translation: calibration.shakeTrack ?? null,
    impactStyle: calibration.effects?.library?.impact ?? null,
    impulses: displayed.steps.flatMap((step, index) => {
      if (!step.clear.cells.length) return [];
      const timing = calibration.actions[index];
      if (!timing) throw new Error(`CALIBRATED_FRAME_ACTION_MISMATCH:${index}`);
      return [
        {
          clearSeconds: timing.clear,
          lineCount: step.clear.rows.length + step.clear.cols.length,
          allClear: step.after.board.cells.every((row) => row.every((cell) => cell === null)),
        },
      ];
    }),
  };
  const atmosphere = {
    enabled: !!calibration.effects?.screenAtmosphere?.enabled,
    endSeconds: calibration.endCardStart ?? null,
  };
  const scorePopups = normalizeObservedPopups(
    calibration,
    displayed.steps,
    displayed.initial.board.cols,
  );
  const preview = {
    drags: calibration.previewDrags ?? [],
    board: calibration.board,
    offsetX: calibration.appearance?.landingPreview?.offsetX ?? 0,
    lift: calibration.appearance?.landingPreview?.lift ?? 0,
  };
  const geometry = {
    canvas: { width: 1080, height: 1920 },
    board: {
      x: calibration.board[0],
      y: calibration.board[1],
      pitch: calibration.board[2],
      cell: calibration.board[2],
      rows: take.initial.board.rows,
      cols: take.initial.board.cols,
    },
    fit: 'stretch' as const,
  };
  const renderActions: BBRenderAction[] = displayed.steps.map((step, index) => {
    const source = calibration.actions[index];
    if (!source) throw new Error(`CALIBRATED_FRAME_ACTION_MISMATCH:${index}`);
    const timing = {
      actionId: source.actionId,
      start: source.start,
      release: source.release,
      clear: source.clear,
      slot: source.slot,
      ...(source.clearFace === undefined ? {} : { clearFace: source.clearFace }),
      ...(source.linePreview === undefined ? {} : { linePreview: source.linePreview }),
      ...(source.clearStyle === undefined ? {} : { clearStyle: source.clearStyle }),
      ...(source.perfect === undefined ? {} : { perfect: source.perfect }),
      ...(source.rainbowGapSeconds === undefined
        ? {}
        : { rainbowGapSeconds: source.rainbowGapSeconds }),
      ...(source.rainbowReverse === undefined ? {} : { rainbowReverse: source.rainbowReverse }),
      ...(source.rainbowCells === undefined ? {} : { rainbowCells: source.rainbowCells }),
    };
    return structuredClone({
      step: {
        action: { id: step.action.id },
        before: { board: { cells: step.before.board.cells } },
        after: { board: { cells: step.after.board.cells }, combo: step.after.combo },
        piece: { id: step.piece.id, shapeId: step.piece.shapeId, color: step.piece.color },
        clear: step.clear,
        placedCells: step.placedCells,
        ...(step.placedColors ? { placedColors: step.placedColors } : {}),
      },
      timing,
    });
  });
  const plan = {
    takeId: take.id,
    fps,
    totalFrames,
    rules,
    display,
    events,
    displayed,
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
    selectionGlow: structuredClone(calibration.effects?.selectionGlow ?? null),
    recolorFlash: calibration.appearance?.recolorFlash === true,
    boardSurface: structuredClone(calibration.appearance?.boardSurface ?? null),
    previousClearActions: 3,
  };
  validateBBTimelinePlan(plan);
  return plan;
}
