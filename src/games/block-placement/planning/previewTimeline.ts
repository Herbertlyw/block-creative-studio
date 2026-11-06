import type { CalibratedDisplayState } from '../../../contracts/calibratedFrame';
import { sampleLinearTrack } from './linearTrack';
import { bbRackPose, type BBRackLayout } from './rackTimeline';
import { dragPreviewAnchor } from './ghostGeometry';

export interface BBPreviewDrag {
  readonly pieceId: string;
  readonly slot: number;
  readonly start: number;
  readonly end: number;
  readonly motion: Array<[number, number, number, number]>;
  readonly returnToRack?: boolean;
}
export interface BBPreviewPlan {
  readonly drags: readonly BBPreviewDrag[];
  readonly board: readonly [number, number, number] | null;
  readonly offsetX: number;
  readonly lift: number;
}
export interface BBPreviewFrame {
  readonly event: BBPreviewDrag;
  readonly piece: {
    readonly id: string;
    readonly color: string;
    readonly cells: readonly (readonly [number, number])[];
  };
  readonly pose: { x: number; y: number; size: number };
  readonly anchor: { row: number; col: number } | null;
}

/** An uncommitted preview never creates or consumes a gameplay action. */
export function evaluateBBPreview(
  plan: BBPreviewPlan,
  layout: BBRackLayout,
  rack: CalibratedDisplayState,
  board: readonly (readonly (string | null)[])[],
  time: number,
): BBPreviewFrame | null {
  const event = plan.drags.find((item) => time >= item.start && time < item.end);
  if (!event) return null;
  const piece = rack.pieces.find(
    (item) => item.id === event.pieceId && item.slotIndex === event.slot && !item.used,
  );
  if (!piece) throw new Error('REFERENCE_PREVIEW_DRAG_STATE_MISMATCH');
  if (!plan.board) throw new Error('BB_PREVIEW_BOARD_MISSING');
  const rackPose = bbRackPose(layout, piece),
    last = event.motion.at(-1);
  if (!last) throw new Error('BB_PREVIEW_MOTION_MISSING');
  const final: readonly [number, number, number] =
    event.returnToRack === false
      ? [last[1], last[2], last[3]]
      : [rackPose.x, rackPose.y, rackPose.size];
  const points = [
    { time: event.start, value: [rackPose.x, rackPose.y, rackPose.size] as const },
    ...event.motion.map(([at, x, y, size]) => ({ time: at, value: [x, y, size] as const })),
    { time: event.end, value: final },
  ];
  const [x, y, size] = sampleLinearTrack(points, time, Number.MIN_VALUE),
    progress = (time - event.start) / (event.end - event.start);
  const anchor =
    dragPreviewAnchor(
      rackPose.cells,
      board,
      x + plan.offsetX,
      y - plan.lift,
      size,
      plan.board,
      progress,
    ) ??
    dragPreviewAnchor(rackPose.cells, board, x, y, size, plan.board, progress) ??
    null;
  return {
    event: structuredClone(event),
    piece: {
      id: piece.id,
      color: piece.color,
      cells: rackPose.cells.map(([row, col]) => [row, col] as const),
    },
    pose: { x, y, size },
    anchor,
  };
}
