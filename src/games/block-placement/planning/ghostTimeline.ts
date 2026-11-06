import { clearRuleAt } from '../../../nativeReference/games/block-placement/runtime/clearRules';
import { dragPreviewAnchor, completedPreviewLines } from './ghostGeometry';
import type { CalibratedDisplayState } from '../../../contracts/calibratedFrame';
import type { BBPieceMotionFrame } from './pieceMotion';

export type BBGhostPolicy =
  | { readonly kind: 'center'; readonly linePreview: boolean }
  | {
      readonly kind: 'proximity';
      readonly board: readonly [number, number, number];
      readonly offsetX: number;
      readonly lift: number;
      readonly linePreview: boolean;
      readonly lineUntil: number | null;
    };
export interface BBGhostFrame {
  readonly actionId: string;
  readonly anchor: { row: number; col: number } | null;
  readonly cells: Array<{ row: number; col: number }>;
  readonly lines: { rows: number[]; cols: number[] } | null;
  readonly progress: number;
}

/** Preview is hypothetical: no cells, score, supply or rule state are mutated. */
export function evaluateBBGhost(
  policy: BBGhostPolicy | undefined,
  drag: BBPieceMotionFrame | null,
  state: CalibratedDisplayState,
  board: readonly (readonly (string | null)[])[],
  time: number,
): BBGhostFrame | null {
  if (!drag || !policy) return null;
  let anchor: { row: number; col: number } | null = null;
  if (policy.kind === 'center') {
    const candidate = drag.hover;
    if (
      candidate &&
      drag.cells.every(([r, c]) => board[candidate.row + r]?.[candidate.col + c] === null)
    )
      anchor = candidate;
  } else {
    if (drag.pose.anchor !== 'top-left') throw new Error('BB_GHOST_POSE_MISMATCH');
    const { x, y, size } = drag.pose;
    anchor =
      dragPreviewAnchor(
        drag.cells,
        board,
        x + policy.offsetX,
        y - policy.lift,
        size,
        policy.board,
        drag.progress,
      ) ??
      dragPreviewAnchor(drag.cells, board, x, y, size, policy.board, drag.progress) ??
      null;
  }
  const cells = anchor
    ? drag.cells.map(([r, c]) => ({ row: anchor!.row + r, col: anchor!.col + c }))
    : [];
  const enabled =
    policy.linePreview &&
    (policy.kind !== 'proximity' || policy.lineUntil === null || time < policy.lineUntil);
  const rule = clearRuleAt(state);
  const lines =
    anchor && enabled
      ? completedPreviewLines(drag.cells, board, anchor, rule.axes, rule.trigger)
      : null;
  return { actionId: drag.actionId, anchor, cells, lines, progress: drag.progress };
}
