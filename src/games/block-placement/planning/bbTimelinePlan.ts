import { evaluateBBRuleTimeline, type BBRuleFrame, type BBRuleTimeline } from './ruleTimeline';
import {
  evaluateBBDisplayBoard,
  type BBDisplayBoard,
  type BBDisplayBoardTimeline,
} from './displayBoardTimeline';
import { evaluateBBSemanticEvents, type BBSemanticEventTimeline } from './semanticEventTimeline';
import type { SemanticGameEvent } from '../../../nativeReference/game-runtime/presentationPacket';
import { evaluateBBScore, type BBScoreTimeline } from './scoreTimeline';
import { evaluateBBPointer, type BBPointerTrack, type BBPointerSample } from './pointerTimeline';
import { evaluateBBPieceMotion, type BBPieceMotion, type BBPieceMotionFrame } from './pieceMotion';
import {
  evaluateBBRack,
  evaluateBBRackDrawables,
  type BBRackTimeline,
  type BBRackLayout,
  type BBRackDrawable,
} from './rackTimeline';
import type { CalibratedDisplayState } from '../../../contracts/calibratedFrame';
import {
  evaluateBBClears,
  evaluateBBPlacement,
  evaluateBBAtmosphere,
  type BBClearTrack,
  type BBClearSample,
  type BBPlacementTrack,
  type BBPlacementSample,
} from './feedbackTimeline';
import { evaluateBBGhost, type BBGhostPolicy, type BBGhostFrame } from './ghostTimeline';
import { evaluateBBCamera, type BBCameraTimeline } from './cameraTimeline';
import {
  evaluateBBScorePopups,
  type BBScorePopupTrack,
  type BBScorePopup,
} from './scorePopupTimeline';
import { evaluateBBPreview, type BBPreviewPlan, type BBPreviewFrame } from './previewTimeline';
import type { BBRenderAction } from './renderAction';
import { bbDesignTransform, type BBGeometry } from './geometry';
import { selectionGlowAt, type BBSelectionGlow } from './selectionGlowTimeline';
import type { ReferenceAppearance } from '../../../nativeReference/games/block-placement/presentation/referenceAppearance';

/** Common rule, board, motion, geometry and event plan for BB frame evaluation. */
export interface BBTimelinePlan {
  readonly takeId: string;
  readonly fps: number;
  readonly totalFrames: number;
  readonly rules: BBRuleTimeline;
  readonly display: BBDisplayBoardTimeline;
  readonly events: BBSemanticEventTimeline;
  readonly score: BBScoreTimeline;
  readonly actions: readonly BBActionTimeline[];
  readonly pointers: readonly BBPointerTrack[];
  readonly pieces: readonly BBPieceMotion[];
  readonly rack: BBRackTimeline;
  readonly rackLayout: BBRackLayout;
  readonly clears: readonly BBClearTrack[];
  readonly previousClearActions: number;
  readonly ghosts: readonly BBGhostPolicy[];
  readonly placements: readonly BBPlacementTrack[];
  readonly visualStatePolicy: {
    readonly held: 'before' | 'after';
    readonly board: 'visual' | 'snapshot';
    readonly score: 'timeline' | 'snapshot';
    readonly placedCombo: 'before' | 'snapshot';
  };
  readonly camera: BBCameraTimeline;
  readonly atmosphere: { readonly enabled: boolean; readonly endSeconds: number | null };
  readonly scorePopups: readonly BBScorePopupTrack[];
  readonly preview: BBPreviewPlan;
  readonly renderActions: readonly BBRenderAction[];
  readonly geometry: BBGeometry;
  readonly selectionGlow: BBSelectionGlow | null;
  readonly recolorFlash: boolean;
  readonly boardSurface: NonNullable<ReferenceAppearance['boardSurface']> | null;
}
export interface BBActionTimeline {
  readonly actionId: string;
  readonly startSeconds: number;
  readonly commitSeconds: number;
  readonly clearStartSeconds: number;
  /** End of the held-board clear phase; visual effects may have their own tracks. */
  readonly clearEndSeconds: number;
  /** An absent end keeps the last observed action available for later effects. */
  readonly endSeconds: number | null;
  readonly hasClear: boolean;
  /** The source clock preserves authored integer frame boundaries or measured seconds. */
  readonly motion: {
    clock: 'frame' | 'seconds';
    start: number;
    end: number;
    minimumSpan: number;
    easing: 'smoothstep' | 'easeOutCubic' | 'easeInOutCubic' | 'easeOutBack';
  };
}
export type BBActionPhase = 'initial' | 'drag' | 'placed' | 'clearing' | 'settled';
export interface BBBoardDrawable {
  row: number;
  col: number;
  x: number;
  y: number;
  size: number;
  color: string | null;
}
export interface BBTimelineFrame {
  takeId: string;
  frameIndex: number;
  fps: number;
  totalFrames: number;
  timeSeconds: number;
  rules: BBRuleFrame;
  board: BBDisplayBoard;
  /** Palette-surface overrides affect appearance, never the logical board. */
  renderBoard: BBDisplayBoard;
  boardSurface: NonNullable<ReferenceAppearance['boardSurface']> | null;
  boardDrawables: BBBoardDrawable[];
  displayStage: 'initial' | 'held' | 'final';
  events: SemanticGameEvent[];
  hud: { score: number; pulse: number };
  pointer: BBPointerSample | null;
  drag: BBPieceMotionFrame | null;
  rack: CalibratedDisplayState;
  rackDrawables: BBRackDrawable[];
  clearEffects: BBClearSample[];
  ghost: BBGhostFrame | null;
  visualState: CalibratedDisplayState;
  placement: BBPlacementSample | null;
  cameraPunch: number;
  camera: { x: number; y: number; scale: number };
  atmosphereAge: number | null;
  scorePopups: BBScorePopup[];
  preview: BBPreviewFrame | null;
  activeRender: BBRenderAction | null;
  clearRenders: Array<{ effect: BBClearSample; render: BBRenderAction }>;
  geometry: BBGeometry;
  selectionGlow: { config: BBSelectionGlow; amount: number } | null;
  previewSelectionGlow: { config: BBSelectionGlow; amount: number } | null;
  recolorFlash: {
    actionId: string;
    cells: Array<{ row: number; col: number }>;
    opacity: number;
  } | null;
  activeAction: {
    index: number;
    actionId: string;
    phase: Exclude<BBActionPhase, 'initial'>;
    rawProgress: number | null;
    progress: number | null;
  } | null;
}

export function validateBBTimelinePlan(plan: BBTimelinePlan): void {
  if (typeof plan.recolorFlash !== 'boolean') throw new Error('BB_RECOLOR_FLASH_INVALID');
  bbDesignTransform(plan.geometry, plan.geometry.canvas.width, plan.geometry.canvas.height);
  const surface = plan.boardSurface;
  if (
    surface !== null &&
    (!surface ||
      !Number.isFinite(surface.start) ||
      !Number.isFinite(surface.end) ||
      surface.start < 0 ||
      surface.end <= surface.start ||
      !Array.isArray(surface.faces) ||
      surface.faces.length !== plan.geometry.board.rows ||
      surface.faces.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== plan.geometry.board.cols ||
          row.some((face) => !Number.isInteger(face) || face < 0),
      ) ||
      (surface.dragPreview !== undefined && typeof surface.dragPreview !== 'boolean'))
  )
    throw new Error('BB_BOARD_SURFACE_INVALID');
  const glow = plan.selectionGlow;
  if (
    glow !== null &&
    (!glow ||
      typeof glow.enabled !== 'boolean' ||
      ![glow.intensity, glow.haloPx, glow.edgePx].every(Number.isFinite) ||
      glow.intensity < 0 ||
      glow.intensity > 1 ||
      glow.haloPx < 0 ||
      glow.haloPx > 40 ||
      glow.edgePx < 0.5 ||
      glow.edgePx > 6)
  )
    throw new Error('BB_SELECTION_GLOW_INVALID');
  if (
    !plan.takeId ||
    !Number.isInteger(plan.fps) ||
    plan.fps < 1 ||
    !Number.isInteger(plan.totalFrames) ||
    plan.totalFrames < 1 ||
    plan.events.totalFrames !== plan.totalFrames ||
    plan.score.scores.length !== plan.totalFrames ||
    plan.score.pulses.length !== plan.totalFrames ||
    plan.rules.actions.length !== plan.display.steps.length ||
    plan.rules.actions.length !== plan.actions.length ||
    plan.pieces.length !== plan.actions.length ||
    plan.rack.steps.length !== plan.actions.length ||
    plan.clears.length !== plan.actions.length ||
    plan.ghosts.length !== plan.actions.length ||
    plan.placements.length !== plan.actions.length ||
    plan.renderActions.length !== plan.actions.length ||
    !Number.isInteger(plan.previousClearActions) ||
    plan.previousClearActions < 0
  )
    throw new Error('BB_TIMELINE_PLAN_MISMATCH');
  for (const [index, action] of plan.rules.actions.entries()) {
    const display = plan.display.steps[index],
      timing = plan.actions[index],
      piece = plan.pieces[index],
      rack = plan.rack.steps[index],
      clear = plan.clears[index],
      placement = plan.placements[index],
      render = plan.renderActions[index];
    if (
      !display ||
      !timing ||
      display.actionId !== action.actionId ||
      display.commitSeconds !== action.commitSeconds ||
      !piece ||
      piece.actionId !== action.actionId ||
      !piece.pieceId ||
      !piece.cells.length ||
      !Number.isInteger(piece.rows) ||
      !Number.isInteger(piece.cols) ||
      piece.rows < 1 ||
      piece.cols < 1 ||
      piece.cells.some(
        ([row, col]) =>
          !Number.isInteger(row) ||
          !Number.isInteger(col) ||
          row < 0 ||
          row >= piece.rows ||
          col < 0 ||
          col >= piece.cols,
      ) ||
      (piece.cellColors !== null &&
        (piece.cellColors.length !== piece.cells.length ||
          piece.cellColors.some((color) => typeof color !== 'string'))) ||
      !Number.isInteger(piece.target.row) ||
      !Number.isInteger(piece.target.col) ||
      typeof piece.color !== 'string' ||
      !rack ||
      rack.actionId !== action.actionId ||
      !Array.isArray(rack.before.pieces) ||
      !Array.isArray(rack.after.pieces) ||
      !clear ||
      clear.actionId !== action.actionId ||
      clear.commitSeconds !== timing.commitSeconds ||
      clear.clearSeconds < clear.commitSeconds ||
      !placement ||
      placement.actionId !== action.actionId ||
      !Number.isFinite(placement.placementPoints) ||
      placement.placementPoints < 0 ||
      !render ||
      render.step.action.id !== action.actionId ||
      render.timing.actionId !== action.actionId ||
      render.step.piece.id !== piece.pieceId ||
      (placement.progressFrames !== null &&
        (![placement.progressFrames.start, placement.progressFrames.span].every(Number.isFinite) ||
          placement.progressFrames.span <= 0)) ||
      ![clear.clearSeconds, clear.timeScale, clear.seed, clear.combo].every(Number.isFinite) ||
      clear.timeScale <= 0 ||
      (clear.progressFrames !== null &&
        (![clear.progressFrames.start, clear.progressFrames.end].every(Number.isFinite) ||
          clear.progressFrames.end < clear.progressFrames.start)) ||
      timing.actionId !== action.actionId ||
      timing.startSeconds !== action.startSeconds ||
      timing.commitSeconds !== action.commitSeconds ||
      ![
        timing.startSeconds,
        timing.commitSeconds,
        timing.clearStartSeconds,
        timing.clearEndSeconds,
      ].every(Number.isFinite) ||
      typeof timing.hasClear !== 'boolean' ||
      (timing.endSeconds !== null && !Number.isFinite(timing.endSeconds)) ||
      !['frame', 'seconds'].includes(timing.motion.clock) ||
      !['smoothstep', 'easeOutCubic', 'easeInOutCubic', 'easeOutBack'].includes(
        timing.motion.easing,
      ) ||
      ![timing.motion.start, timing.motion.end, timing.motion.minimumSpan].every(Number.isFinite) ||
      timing.motion.end < timing.motion.start ||
      timing.motion.minimumSpan <= 0 ||
      timing.clearStartSeconds < timing.commitSeconds ||
      timing.clearEndSeconds < timing.clearStartSeconds ||
      (timing.endSeconds !== null && timing.endSeconds < timing.commitSeconds)
    )
      throw new Error(`BB_TIMELINE_ACTION_MISMATCH:${index}:${action.actionId}`);
    if (
      piece.placement.kind === 'pointer-center' &&
      (![piece.placement.canvasWidth, piece.placement.canvasHeight].every(Number.isFinite) ||
        piece.placement.canvasWidth <= 0 ||
        piece.placement.canvasHeight <= 0 ||
        (piece.placement.gap !== null && !Number.isFinite(piece.placement.gap)))
    )
      throw new Error(`BB_TIMELINE_PIECE_MOTION_INVALID:${action.actionId}`);
    if (piece.placement.kind === 'box') {
      const motion = piece.placement;
      let previous = -Infinity;
      if (
        [...motion.from, ...motion.to, motion.arcHeight, motion.sizeEaseFactor].some(
          (value) => !Number.isFinite(value),
        ) ||
        motion.from[2] <= 0 ||
        motion.to[2] <= 0 ||
        motion.sizeEaseFactor <= 0
      )
        throw new Error(`BB_TIMELINE_PIECE_MOTION_INVALID:${action.actionId}`);
      for (const point of motion.points) {
        if (
          !Number.isFinite(point.time) ||
          point.time < previous ||
          point.value.length !== 3 ||
          !point.value.every(Number.isFinite) ||
          point.value[2] <= 0
        )
          throw new Error(`BB_TIMELINE_PIECE_MOTION_INVALID:${action.actionId}`);
        previous = point.time;
      }
    }
  }
  const layout = plan.rackLayout;
  if (
    layout.centers.length !== 3 ||
    ![
      ...layout.centers,
      layout.centerY,
      layout.cellPitch,
      layout.cellFaceSize,
      layout.revealSeconds,
    ].every(Number.isFinite) ||
    layout.cellPitch <= 0 ||
    layout.cellFaceSize <= 0 ||
    layout.revealSeconds < 0 ||
    Object.values(layout.cellSizes).some((size) => !Number.isFinite(size) || size <= 0) ||
    Object.values(layout.positions).some(
      (point) => point.length !== 2 || !point.every(Number.isFinite),
    ) ||
    Object.values(layout.revealTimes).some((time) => !Number.isFinite(time) || time < 0) ||
    layout.previewIntervals.some(
      (item) =>
        !item.pieceId ||
        ![item.start, item.end].every(Number.isFinite) ||
        item.start < 0 ||
        item.end <= item.start,
    )
  )
    throw new Error('BB_TIMELINE_RACK_LAYOUT_INVALID');
  const statePolicy = plan.visualStatePolicy;
  if (
    !['before', 'after'].includes(statePolicy.held) ||
    !['visual', 'snapshot'].includes(statePolicy.board) ||
    !['timeline', 'snapshot'].includes(statePolicy.score) ||
    !['before', 'snapshot'].includes(statePolicy.placedCombo)
  )
    throw new Error('BB_VISUAL_STATE_POLICY_INVALID');
  for (const [index, ghost] of plan.ghosts.entries()) {
    if (
      typeof ghost.linePreview !== 'boolean' ||
      (ghost.kind === 'proximity' &&
        (![...ghost.board, ghost.offsetX, ghost.lift].every(Number.isFinite) ||
          ghost.board[2] <= 0 ||
          (ghost.lineUntil !== null && (!Number.isFinite(ghost.lineUntil) || ghost.lineUntil < 0))))
    )
      throw new Error(`BB_TIMELINE_GHOST_INVALID:${index}`);
  }
  if (
    typeof plan.atmosphere.enabled !== 'boolean' ||
    (plan.atmosphere.endSeconds !== null &&
      (!Number.isFinite(plan.atmosphere.endSeconds) || plan.atmosphere.endSeconds < 0))
  )
    throw new Error('BB_TIMELINE_ATMOSPHERE_INVALID');
  for (const popup of plan.scorePopups) {
    if (
      !Number.isInteger(popup.actionIndex) ||
      popup.actionIndex < 0 ||
      popup.actionIndex >= plan.actions.length ||
      ![
        popup.clearSeconds,
        popup.delaySeconds,
        popup.durationSeconds,
        popup.x,
        popup.y,
        popup.risePx,
        popup.minY,
        popup.fontSize,
      ].every(Number.isFinite) ||
      popup.delaySeconds < 0 ||
      popup.durationSeconds <= 0 ||
      popup.fontSize <= 0 ||
      !['white', 'gold'].includes(popup.style)
    )
      throw new Error(`BB_TIMELINE_SCORE_POPUP_INVALID:${popup.actionIndex}`);
  }
  const preview = plan.preview;
  if (
    ![preview.offsetX, preview.lift].every(Number.isFinite) ||
    preview.drags.length !== layout.previewIntervals.length ||
    (preview.drags.length > 0 &&
      (!preview.board ||
        preview.board.length !== 3 ||
        !preview.board.every(Number.isFinite) ||
        preview.board[2] <= 0))
  )
    throw new Error('BB_TIMELINE_PREVIEW_INVALID');
  for (const [index, event] of preview.drags.entries()) {
    const interval = layout.previewIntervals[index];
    let previous = event.start;
    if (
      !interval ||
      event.pieceId !== interval.pieceId ||
      event.start !== interval.start ||
      event.end !== interval.end ||
      !Number.isInteger(event.slot) ||
      event.slot < 0 ||
      event.slot > 2 ||
      ![event.start, event.end].every(Number.isFinite) ||
      event.start < 0 ||
      event.end <= event.start ||
      !event.motion.length
    )
      throw new Error(`BB_TIMELINE_PREVIEW_INVALID:${index}`);
    for (const point of event.motion) {
      if (
        point.length !== 4 ||
        !point.every(Number.isFinite) ||
        point[0] <= previous ||
        point[0] >= event.end ||
        point[3] <= 0
      )
        throw new Error(`BB_TIMELINE_PREVIEW_INVALID:${index}`);
      previous = point[0];
    }
  }
  for (const track of plan.pointers) {
    let previous = -Infinity;
    if (
      !plan.actions.some((action) => action.actionId === track.actionId) ||
      !['frame', 'seconds'].includes(track.clock) ||
      !['normalized', 'design'].includes(track.space) ||
      !['active-action', 'independent'].includes(track.scope) ||
      ![track.start, track.end, track.minimumSpan].every(Number.isFinite) ||
      track.end < track.start ||
      track.minimumSpan <= 0 ||
      !track.points.length ||
      (track.radius !== null && (!Number.isFinite(track.radius) || track.radius <= 0)) ||
      (track.settleTo &&
        (![
          track.settleTo.x,
          track.settleTo.y,
          track.settleTo.fromProgress,
          track.settleTo.span,
        ].every(Number.isFinite) ||
          track.settleTo.span <= 0))
    )
      throw new Error(`BB_TIMELINE_POINTER_INVALID:${track.actionId}`);
    for (const point of track.points) {
      if (
        !Number.isFinite(point.time) ||
        point.time < previous ||
        point.value.length !== 2 ||
        !point.value.every(Number.isFinite)
      )
        throw new Error(`BB_TIMELINE_POINTER_INVALID:${track.actionId}`);
      previous = point.time;
    }
  }
}

/** Both production inputs sample these values from the same clock and Take. */
export function evaluateBBTimeline(plan: BBTimelinePlan, frameIndex: number): BBTimelineFrame {
  if (
    !Number.isInteger(frameIndex) ||
    frameIndex < 0 ||
    frameIndex >= plan.totalFrames ||
    !Number.isFinite(plan.fps) ||
    plan.fps <= 0
  )
    throw new Error('BB_TIMELINE_FRAME_OUT_OF_RANGE');
  if (
    plan.events.totalFrames !== plan.totalFrames ||
    plan.score.scores.length !== plan.totalFrames ||
    plan.score.pulses.length !== plan.totalFrames ||
    plan.rules.actions.length !== plan.display.steps.length ||
    plan.rules.actions.length !== plan.actions.length ||
    plan.pieces.length !== plan.actions.length ||
    plan.rack.steps.length !== plan.actions.length ||
    plan.clears.length !== plan.actions.length ||
    plan.ghosts.length !== plan.actions.length ||
    plan.placements.length !== plan.actions.length ||
    plan.renderActions.length !== plan.actions.length
  )
    throw new Error('BB_TIMELINE_PLAN_MISMATCH');
  const timeSeconds = frameIndex / plan.fps;
  const rules = evaluateBBRuleTimeline(plan.rules, timeSeconds);
  const displayed = rules.completedCount ? plan.display.steps[rules.completedCount - 1] : undefined;
  if (rules.completedCount && !displayed) throw new Error('BB_TIMELINE_DISPLAY_MISSING');
  const displayStage = !displayed
    ? 'initial'
    : timeSeconds < displayed.finalBoardSeconds
      ? 'held'
      : 'final';
  const timing = rules.activeIndex < 0 ? undefined : plan.actions[rules.activeIndex];
  if (rules.activeIndex >= 0 && !timing) throw new Error('BB_TIMELINE_ACTION_MISSING');
  const phase = timing
    ? timeSeconds < timing.commitSeconds
      ? 'drag'
      : timeSeconds < timing.clearStartSeconds
        ? 'placed'
        : timing.hasClear && timeSeconds < timing.clearEndSeconds
          ? 'clearing'
          : !timing.hasClear && (timing.endSeconds === null || timeSeconds < timing.endSeconds)
            ? 'placed'
            : 'settled'
    : null;
  let rawProgress: number | null = null,
    progress: number | null = null;
  if (timing && phase === 'drag') {
    const motion = timing.motion,
      clock = motion.clock === 'frame' ? frameIndex : timeSeconds;
    rawProgress = Math.max(
      0,
      Math.min(1, (clock - motion.start) / Math.max(motion.minimumSpan, motion.end - motion.start)),
    );
    const t = rawProgress;
    if (motion.easing === 'smoothstep') progress = t * t * (3 - 2 * t);
    else if (motion.easing === 'easeOutCubic') progress = 1 - (1 - t) ** 3;
    else if (motion.easing === 'easeInOutCubic')
      progress = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    else progress = 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
  }
  const activeAction: BBTimelineFrame['activeAction'] =
    timing && phase
      ? { index: rules.activeIndex, actionId: timing.actionId, phase, rawProgress, progress }
      : null;
  const pointer = evaluateBBPointer(plan.pointers, frameIndex, timeSeconds, activeAction);
  const drag = evaluateBBPieceMotion(
    activeAction?.phase === 'drag' ? plan.pieces[activeAction.index] : undefined,
    activeAction?.progress ?? null,
    timeSeconds,
    pointer,
  );
  const rack = evaluateBBRack(plan.rack, rules.completedCount, rules.activeIndex, timeSeconds);
  const rackDrawables = evaluateBBRackDrawables(
    plan.rackLayout,
    rack,
    timeSeconds,
    drag?.pieceId ?? null,
  );
  const clearEffects = evaluateBBClears(
    plan.clears,
    rules.activeIndex,
    timeSeconds,
    frameIndex,
    plan.previousClearActions,
  );
  const displayStep = rules.completedCount ? plan.rack.steps[rules.completedCount - 1] : undefined;
  const policy = plan.visualStatePolicy;
  const displayState = displayStep
    ? displayStage === 'final' || policy.held === 'after'
      ? displayStep.after
      : displayStep.before
    : plan.rack.initial;
  const board = evaluateBBDisplayBoard(plan.display, rules.completedCount, timeSeconds);
  const grid = plan.geometry.board;
  if (board.length !== grid.rows || board.some((row) => row.length !== grid.cols))
    throw new Error('BB_BOARD_GEOMETRY_MISMATCH');
  const boardSurface =
    plan.boardSurface &&
    timeSeconds >= plan.boardSurface.start &&
    timeSeconds < plan.boardSurface.end
      ? plan.boardSurface
      : null;
  const renderBoard = board.map((row, r) =>
    row.map((color, c) =>
      color !== null && boardSurface ? `observed-face:${boardSurface.faces[r]![c]}` : color,
    ),
  );
  const boardDrawables = board.flatMap((row, r) =>
    row.map((color, c) => ({
      row: r,
      col: c,
      x: grid.x + c * grid.pitch,
      y: grid.y + r * grid.pitch,
      size: grid.cell,
      color,
    })),
  );
  const ghost = evaluateBBGhost(
    activeAction ? plan.ghosts[activeAction.index] : undefined,
    drag,
    displayState,
    board,
    timeSeconds,
  );
  const preview = evaluateBBPreview(plan.preview, plan.rackLayout, rack, board, timeSeconds);
  const hud = evaluateBBScore(plan.score, frameIndex),
    visualState = structuredClone(displayState);
  if (policy.board === 'visual')
    visualState.board = { ...visualState.board, cells: board.map((row) => [...row]) };
  if (policy.score === 'timeline') visualState.score = hud.score;
  if (policy.placedCombo === 'before' && activeAction?.phase === 'placed') {
    const before = plan.rack.steps[activeAction.index]?.before;
    if (!before) throw new Error('BB_VISUAL_STATE_ACTION_MISSING');
    visualState.combo = before.combo;
  }
  const placement = evaluateBBPlacement(
    activeAction ? plan.placements[activeAction.index] : undefined,
    activeAction?.phase,
    frameIndex,
  );
  const activeClear =
    activeAction?.phase === 'clearing'
      ? clearEffects.find((effect) => effect.actionId === activeAction.actionId)
      : undefined;
  const clearProgress = activeClear?.progress ?? null,
    shake = clearProgress === null ? 0 : Math.max(0, Math.min(1, clearProgress / 0.42));
  const cameraPunch = clearProgress === null ? 0 : Math.sin(shake * Math.PI) * 0.52;
  const activeRender = activeAction
    ? structuredClone(plan.renderActions[activeAction.index] ?? null)
    : null;
  let recolorFlash: BBTimelineFrame['recolorFlash'] = null;
  if (
    plan.recolorFlash &&
    activeRender &&
    timeSeconds >= activeRender.timing.clear &&
    timeSeconds < activeRender.timing.clear + 0.4
  ) {
    const { step } = activeRender,
      cells: Array<{ row: number; col: number }> = [];
    for (let row = 0; row < grid.rows; row++)
      for (let col = 0; col < grid.cols; col++) {
        const before = step.before.board.cells[row]?.[col],
          after = step.after.board.cells[row]?.[col];
        if (before && after && before !== after) cells.push({ row, col });
      }
    if (cells.length >= grid.rows)
      recolorFlash = {
        actionId: step.action.id,
        cells,
        opacity:
          0.85 * Math.max(0, Math.min(1, (activeRender.timing.clear + 0.4 - timeSeconds) / 0.4)),
      };
  }
  const clearRenders = clearEffects.map((effect) => {
    const original = plan.renderActions[effect.index];
    if (!original || original.step.action.id !== effect.actionId)
      throw new Error(`BB_RENDER_ACTION_MISSING:${effect.actionId}`);
    const render = structuredClone(original),
      step = render.step,
      clearFace = render.timing.clearFace;
    if (boardSurface || clearFace !== undefined) {
      const face = (row: number, col: number) =>
        `observed-face:${clearFace ?? boardSurface!.faces[row]![col]}`;
      step.placedColors = { ...step.placedColors };
      for (const cell of step.clear.cells)
        step.placedColors[`${cell.row},${cell.col}`] = face(cell.row, cell.col);
      step.before.board.cells = step.before.board.cells.map((row, r) =>
        row.map((color, c) => (color === null ? null : face(r, c))),
      );
    }
    return { effect, render };
  });
  const selectionGlow =
    plan.selectionGlow && drag && timing
      ? {
          config: { ...plan.selectionGlow },
          amount: selectionGlowAt(
            plan.selectionGlow,
            timing.startSeconds,
            timing.commitSeconds,
            timeSeconds,
          ),
        }
      : null;
  const previewSelectionGlow =
    plan.selectionGlow && preview
      ? {
          config: { ...plan.selectionGlow },
          amount: selectionGlowAt(
            plan.selectionGlow,
            preview.event.start,
            preview.event.end,
            timeSeconds,
          ),
        }
      : null;
  return {
    takeId: plan.takeId,
    frameIndex,
    fps: plan.fps,
    totalFrames: plan.totalFrames,
    timeSeconds,
    rules,
    board,
    renderBoard,
    boardSurface: boardSurface ? structuredClone(boardSurface) : null,
    boardDrawables,
    displayStage,
    events: evaluateBBSemanticEvents(plan.events, frameIndex),
    hud,
    pointer,
    drag,
    rack,
    rackDrawables,
    clearEffects,
    ghost,
    visualState,
    placement,
    cameraPunch,
    camera: evaluateBBCamera(plan.camera, timeSeconds),
    atmosphereAge: evaluateBBAtmosphere(
      plan.clears,
      rules.activeIndex,
      timeSeconds,
      plan.atmosphere.enabled,
      plan.atmosphere.endSeconds,
    ),
    scorePopups: evaluateBBScorePopups(plan.scorePopups, rules.activeIndex, timeSeconds),
    preview,
    activeRender,
    clearRenders,
    geometry: structuredClone(plan.geometry),
    selectionGlow,
    previewSelectionGlow,
    recolorFlash,
    activeAction,
  };
}
