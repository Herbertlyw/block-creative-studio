// Derived production module; supplied reference files remain unchanged.
// Compatibility adapter for the existing observation scene. It only maps a sampled BB frame.
import type { CalibratedFrame } from '../../../contracts/calibratedFrame';
import type { BBTimelineFrame } from '../planning/bbTimelinePlan';

export function calibratedPacketFrame(
  sampled: BBTimelineFrame,
  fps: number,
  totalFrames: number,
): CalibratedFrame {
  const { timeSeconds: time, rules: ruleFrame, frameIndex, events } = sampled;
  const active = sampled.activeAction?.index ?? -1;
  const activeEntry = sampled.activeRender;
  const step = activeEntry?.step,
    timing = activeEntry?.timing;
  const released = !!sampled.activeAction && sampled.activeAction.phase !== 'drag';
  const cleared = !!sampled.activeAction && sampled.activeAction.phase === 'settled';
  // Rule transitions commit at release; the display can hold the placed board
  // until the later clear effect. When a later drag starts before an earlier
  // release, its replay `before` state is in the future and must not be shown.
  const gameState = ruleFrame.gameState;
  const state = sampled.visualState;
  const board = sampled.board;
  let drag: null | { x: number; y: number; size: number } = null;
  if (step && timing && !released) {
    const motion = sampled.drag;
    if (
      !motion ||
      motion.actionId !== step.action.id ||
      motion.pieceId !== step.piece.id ||
      motion.pose.space !== 'design' ||
      motion.pose.anchor !== 'top-left' ||
      motion.pose.size === null
    )
      throw new Error('CALIBRATED_FRAME_DRAG_MISMATCH');
    drag = { x: motion.pose.x, y: motion.pose.y, size: motion.pose.size };
  }
  const rackState = sampled.rack;
  const previewDrag = sampled.preview?.event ?? null,
    previewPose = sampled.preview?.pose ?? null,
    previewAnchor = sampled.preview?.anchor ?? null;
  let dragPreview: CalibratedFrame['dragPreview'] = null;
  if (step && timing && !released && drag) {
    const ghost = sampled.ghost;
    if (!ghost || ghost.actionId !== step.action.id)
      throw new Error('CALIBRATED_FRAME_GHOST_MISMATCH');
    dragPreview = { anchor: ghost.anchor, lines: ghost.lines, progress: ghost.progress };
  }
  const point = sampled.pointer;
  if (point && (point.space !== 'design' || point.radius === null))
    throw new Error('CALIBRATED_FRAME_POINTER_INVALID');
  const sampledPointer =
    point && point.radius !== null
      ? {
          actionId: point.actionId,
          x: point.x,
          y: point.y,
          kind: 'ring' as const,
          radius: point.radius,
        }
      : null;
  const clearEffects: CalibratedFrame['clearEffects'] = [];
  for (const { effect, render } of sampled.clearRenders) {
    const { index } = effect,
      { step: effectStep, timing: action } = render;
    if (effect.actionId !== effectStep.action.id)
      throw new Error('CALIBRATED_FRAME_CLEAR_MISMATCH');
    if (effect.praiseLabel === null) throw new Error('CALIBRATED_FRAME_PRAISE_MISSING');
    clearEffects.push({
      index,
      actionId: effect.actionId,
      age: effect.age,
      clearAge: effect.clearAge,
      combo: effect.combo,
      rows: effect.rows,
      cols: effect.cols,
      cells: effect.cells.map(({ row, col }) => ({ row, col })),
      feedback: effect.feedback,
      step: structuredClone(effectStep),
      timing: structuredClone(action),
      praiseLabel: effect.praiseLabel,
    });
  }
  // Evaluated packets must not let a consumer mutate the source's replay state.
  return {
    frameIndex,
    fps,
    totalFrames,
    time,
    geometry: sampled.geometry,
    active,
    actionId: step?.action.id ?? null,
    activeAction: structuredClone(activeEntry),
    phase: !step
      ? 'initial'
      : !released
        ? 'drag'
        : !cleared
          ? 'placed'
          : step.clear.cells.length
            ? 'post-clear'
            : 'post-placement',
    state: structuredClone(state),
    gameState: structuredClone(gameState),
    board,
    drag,
    dragPreview,
    rackState: structuredClone(rackState),
    rackDrawables: sampled.rackDrawables,
    previewDrag: structuredClone(previewDrag) ?? null,
    previewPose,
    previewAnchor,
    pointer: sampledPointer,
    hud: sampled.hud,
    camera: sampled.camera,
    clearEffects,
    scorePopups: sampled.scorePopups,
    atmosphereAge: sampled.atmosphereAge,
    semanticEvents: structuredClone(events),
  };
}
