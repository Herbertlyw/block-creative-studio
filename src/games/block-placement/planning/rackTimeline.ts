import type { CalibratedDisplayState } from '../../../contracts/calibratedFrame';
import type { CalibratedDisplayPiece } from '../../../contracts/calibratedFrame';
import {
  getShape,
  getShapeBounds,
} from '../../../nativeReference/games/block-placement/runtime/shapes';

export interface BBRackLayout {
  readonly centers: readonly [number, number, number];
  readonly centerY: number;
  readonly cellPitch: number;
  readonly cellFaceSize: number;
  readonly positions: Readonly<Record<string, readonly [number, number]>>;
  readonly cellSizes: Readonly<Record<string, number>>;
  readonly revealTimes: Readonly<Record<string, number>>;
  readonly revealSeconds: number;
  readonly previewIntervals: readonly {
    readonly pieceId: string;
    readonly start: number;
    readonly end: number;
  }[];
}
export interface BBRackDrawable {
  readonly piece: CalibratedDisplayPiece;
  readonly cells: Array<[number, number]>;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly pitch: number;
  readonly rows: number;
  readonly cols: number;
  readonly reveal: number;
}
export function bbRackPose(layout: BBRackLayout, piece: CalibratedDisplayPiece) {
  const shape = getShape(piece.shapeId),
    { rows, cols } = getShapeBounds(shape),
    pitch = layout.cellSizes[piece.id] ?? layout.cellPitch,
    size = layout.cellSizes[piece.id] ?? layout.cellFaceSize;
  const center = layout.positions[piece.id] ?? [layout.centers[piece.slotIndex], layout.centerY],
    x = center[0]!,
    y = center[1]!;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(size) ||
    size <= 0 ||
    !Number.isFinite(pitch) ||
    pitch <= 0
  )
    throw new Error(`BB_RACK_GEOMETRY_INVALID:${piece.id}`);
  return {
    cells: shape.cells.map(([r, c]) => [r, c] as [number, number]),
    x: x - (cols * pitch) / 2,
    y: y - (rows * pitch) / 2,
    size,
    pitch,
    rows,
    cols,
  };
}

/** Presentation snapshots retain independently authored display colors. */
export interface BBRackTimeline {
  readonly initial: CalibratedDisplayState;
  readonly steps: readonly {
    readonly actionId: string;
    readonly before: CalibratedDisplayState;
    readonly after: CalibratedDisplayState;
  }[];
  readonly revealTimes: Readonly<Record<string, number>> | null;
  /** When configured, queued pieces carry a presentation asset identity. */
  readonly queuedColorPrefix: string | null;
}

/** Rack supply is selected using committed state, not the next action's future board. */
export function evaluateBBRack(
  plan: BBRackTimeline,
  completedCount: number,
  activeIndex: number,
  time: number,
): CalibratedDisplayState {
  const committed = completedCount ? plan.steps[completedCount - 1] : undefined;
  if (completedCount && !committed) throw new Error('BB_RACK_COMMIT_MISSING');
  const current = committed?.after ?? plan.initial,
    reveals = plan.revealTimes;
  if (!reveals || !current.pieces.length || !current.pieces.every((piece) => piece.used))
    return structuredClone(current);
  const queued = current.fixedPieceSupply?.find(
    (batch) => batch[0]?.setIndex === (current.setIndex ?? -1) + 1,
  );
  const next = plan.steps[activeIndex + 1]?.before;
  const candidate =
    next ??
    (queued
      ? {
          ...current,
          pieces: queued.map((piece) => ({
            ...piece,
            used: false,
            ...(plan.queuedColorPrefix === null
              ? {}
              : { color: `${plan.queuedColorPrefix}${piece.id}` }),
          })),
        }
      : undefined);
  if (!candidate) return structuredClone(current);
  const visible = candidate.pieces.some(
    (piece) => !piece.used && reveals[piece.id] !== undefined && time >= reveals[piece.id]!,
  );
  return structuredClone(visible ? candidate : current);
}

/** All coordinates are design pixels; material-specific face size stays with the material. */
export function evaluateBBRackDrawables(
  layout: BBRackLayout,
  rack: CalibratedDisplayState,
  time: number,
  activePieceId: string | null,
): BBRackDrawable[] {
  const preview = layout.previewIntervals.find((item) => time >= item.start && time < item.end);
  return rack.pieces.flatMap((piece) => {
    if (piece.used || piece.id === preview?.pieceId || piece.id === activePieceId) return [];
    const pose = bbRackPose(layout, piece);
    const revealAt = layout.revealTimes[piece.id] ?? 0,
      span = layout.revealSeconds;
    const u = Math.max(0, Math.min(1, span ? (time - revealAt) / span : 1)),
      reveal = time < revealAt ? 0 : span ? u * u * (3 - 2 * u) : 1;
    return [{ piece: structuredClone(piece), ...pose, reveal }];
  });
}
