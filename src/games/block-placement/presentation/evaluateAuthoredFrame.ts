// Compatibility packet adapter. All visual state is sampled by the BB timeline.
import { TILE_COLORS } from '../../../nativeReference/games/block-placement/runtime/shapes';
import type {
  GameSnapshot,
  PresentationFrame,
  TileColor,
} from '../../../nativeReference/domain/types';
import type { CalibratedDisplayState } from '../../../contracts/calibratedFrame';
import type { BBTimelineFrame } from '../planning/bbTimelinePlan';

const colors = new Set<string>(TILE_COLORS);
function nativeColor(color: string): TileColor {
  if (!colors.has(color)) throw new Error(`BB_AUTHORED_COLOR_UNSUPPORTED:${color}`);
  return color as TileColor;
}
/** Authored game colors are checked before adapting the broader display palette. */
function nativeSnapshot(state: CalibratedDisplayState): GameSnapshot {
  for (const row of state.board.cells)
    for (const color of row) if (color !== null) nativeColor(color);
  const verify = (piece: CalibratedDisplayState['pieces'][number]) => {
    nativeColor(piece.color);
    piece.cellColors?.forEach(nativeColor);
  };
  state.pieces.forEach(verify);
  state.fixedPieceSupply?.forEach((batch) => batch.forEach(verify));
  return structuredClone(state) as GameSnapshot;
}

/** Project a shared frame to the existing 3D scene's packet; no game or timing re-evaluation. */
export function authoredPacketFrame(
  sampled: BBTimelineFrame,
  fps: number,
  totalFrames: number,
): PresentationFrame {
  const snapshot = nativeSnapshot(sampled.visualState),
    board = structuredClone(snapshot.board),
    current = sampled.activeAction;
  const base: PresentationFrame = {
    frame: sampled.frameIndex,
    fps,
    totalFrames,
    snapshot,
    board,
    cameraPunch: sampled.cameraPunch,
  };
  if (!current || current.phase === 'settled') return base;
  if (current.phase === 'drag') {
    const drag = sampled.drag,
      pointer = sampled.pointer;
    if (
      !drag ||
      drag.actionId !== current.actionId ||
      !pointer ||
      pointer.actionId !== current.actionId ||
      pointer.space !== 'normalized'
    )
      throw new Error('BB_AUTHORED_DRAG_MISSING');
    const piece = snapshot.pieces.find((candidate) => candidate.id === drag.pieceId);
    if (!piece) throw new Error(`BB_AUTHORED_PIECE_MISSING:${drag.pieceId}`);
    return {
      ...base,
      currentActionId: current.actionId,
      hiddenPieceId: drag.pieceId,
      draggedPiece: { piece, anchor: drag.hover ?? { row: -1, col: -1 }, progress: drag.progress },
      pointer: { x: pointer.x, y: pointer.y, pressed: pointer.pressed },
    };
  }
  if (current.phase === 'placed') {
    const placement = sampled.placement,
      pointer = sampled.pointer;
    if (
      !placement ||
      placement.actionId !== current.actionId ||
      placement.progress === null ||
      !pointer ||
      pointer.actionId !== current.actionId ||
      pointer.space !== 'normalized'
    )
      throw new Error('BB_AUTHORED_PLACEMENT_MISSING');
    const cells = placement.cells.map(({ row, col, logicalColor }) => ({
      row,
      col,
      color: nativeColor(logicalColor),
    }));
    return {
      ...base,
      currentActionId: current.actionId,
      ...(cells.length
        ? {
            placementFeedback: {
              cells,
              progress: placement.progress,
              placementPoints: placement.placementPoints,
            },
          }
        : {}),
      pointer: { x: pointer.x, y: pointer.y, pressed: pointer.pressed },
    };
  }
  const clear = sampled.clearEffects.find((effect) => effect.actionId === current.actionId);
  if (!clear || clear.progress === null) throw new Error('BB_AUTHORED_CLEAR_MISSING');
  return {
    ...base,
    currentActionId: current.actionId,
    clearing: {
      clear: {
        rows: clear.rows,
        cols: clear.cols,
        cells: clear.cells.map(({ row, col, logicalColor }) => ({
          row,
          col,
          color: nativeColor(logicalColor),
        })),
      },
      progress: clear.progress,
      seed: clear.seed,
    },
  };
}
