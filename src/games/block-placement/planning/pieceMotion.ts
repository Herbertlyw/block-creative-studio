import { boardAnchorFromNormalizedPointer } from '../../../nativeReference/games/block-placement/profiles/layout';
import { sampleLinearTrack, type LinearTrackPoint } from './linearTrack';
import type { BBPointerSample } from './pointerTimeline';

/** Explicit position strategies, independent from the document that supplied them. */
export type BBPieceMotion = {
  readonly actionId: string;
  readonly pieceId: string;
  readonly cells: readonly (readonly [number, number])[];
  readonly rows: number;
  readonly cols: number;
  readonly target: { readonly row: number; readonly col: number };
  readonly color: string;
  readonly cellColors: readonly string[] | null;
  readonly placement:
    | {
        readonly kind: 'pointer-center';
        readonly canvasWidth: number;
        readonly canvasHeight: number;
        readonly gap: number | null;
      }
    | {
        readonly kind: 'box';
        readonly from: readonly [number, number, number];
        readonly to: readonly [number, number, number];
        readonly arcHeight: number;
        readonly sizeEaseFactor: number;
        readonly points: readonly LinearTrackPoint<readonly [number, number, number]>[];
      };
};
export interface BBPieceMotionFrame {
  readonly actionId: string;
  readonly pieceId: string;
  readonly cells: readonly (readonly [number, number])[];
  readonly color: string;
  readonly cellColors: readonly string[] | null;
  readonly target: { readonly row: number; readonly col: number };
  readonly hover: { row: number; col: number } | null;
  /** Position spaces and anchors are explicit. Size may be supplied by the material-dependent layer. */
  readonly pose: {
    readonly x: number;
    readonly y: number;
    readonly size: number;
    readonly pitch: number;
    readonly space: 'design';
    readonly anchor: 'center' | 'top-left';
  };
  readonly progress: number;
}

/** One motion sampler: placement strategy is plan data, not an alternate game evaluator. */
export function evaluateBBPieceMotion(
  track: BBPieceMotion | undefined,
  progress: number | null,
  timeSeconds: number,
  pointer: BBPointerSample | null,
): BBPieceMotionFrame | null {
  if (!track) return null;
  if (progress === null || !Number.isFinite(progress))
    throw new Error(`BB_PIECE_PROGRESS_MISSING:${track.actionId}`);
  const position = track.placement;
  if (position.kind === 'pointer-center') {
    if (!pointer || pointer.actionId !== track.actionId || pointer.space !== 'normalized')
      throw new Error(`BB_PIECE_POINTER_MISSING:${track.actionId}`);
    const u = Math.max(0, Math.min(1, progress / 0.25)),
      pickup = 1 - (1 - u) ** 3;
    const pitch = position.gap === null ? 54 + 60 * pickup : 50 + 62 * pickup;
    const size =
      position.gap === null
        ? 50 + 60 * pickup
        : pitch - (Math.max(0, Math.min(8, position.gap)) * pitch) / 112;
    return {
      actionId: track.actionId,
      pieceId: track.pieceId,
      cells: track.cells.map(([row, col]) => [row, col] as const),
      color: track.color,
      cellColors: track.cellColors ? [...track.cellColors] : null,
      target: { ...track.target },
      hover: boardAnchorFromNormalizedPointer(pointer, { rows: track.rows, cols: track.cols }),
      pose: {
        x: pointer.x * position.canvasWidth,
        y: pointer.y * position.canvasHeight,
        size,
        pitch,
        space: 'design',
        anchor: 'center',
      },
      progress,
    };
  }
  const [fromX, fromY, fromSize] = position.from,
    [toX, toY, toSize] = position.to;
  const q = Math.max(0, Math.min(1, progress * position.sizeEaseFactor)),
    eased = q * q * (3 - 2 * q);
  let x = fromX + (toX - fromX) * progress,
    y = fromY + (toY - fromY) * progress - position.arcHeight * Math.sin(Math.PI * progress),
    size = fromSize + (toSize - fromSize) * eased;
  if (position.points.length)
    [x, y, size] = sampleLinearTrack(position.points, timeSeconds, 0.0001);
  return {
    actionId: track.actionId,
    pieceId: track.pieceId,
    cells: track.cells.map(([row, col]) => [row, col] as const),
    color: track.color,
    cellColors: track.cellColors ? [...track.cellColors] : null,
    target: { ...track.target },
    hover: null,
    pose: { x, y, size, pitch: size, space: 'design', anchor: 'top-left' },
    progress,
  };
}
