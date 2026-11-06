import type { BBGhostFrame } from '../planning/ghostTimeline';

/** Visit the validated ghost in shape order; styles choose how each cell is painted. */
export function paintGhostCells(
  ghost: BBGhostFrame,
  cells: readonly (readonly [number, number])[],
  paint: (row: number, col: number, localRow: number, localCol: number, index: number) => void,
): void {
  if (!ghost.anchor) {
    if (ghost.cells.length) throw new Error('BB_GHOST_CELLS_WITHOUT_ANCHOR');
    return;
  }
  if (ghost.cells.length !== cells.length)
    throw new Error(`BB_GHOST_SHAPE_MISMATCH:${ghost.actionId}`);
  for (const [index, [localRow, localCol]] of cells.entries()) {
    const cell = ghost.cells[index],
      row = ghost.anchor.row + localRow,
      col = ghost.anchor.col + localCol;
    if (!cell || cell.row !== row || cell.col !== col)
      throw new Error(`BB_GHOST_CELL_MISMATCH:${ghost.actionId}:${index}`);
    paint(row, col, localRow, localCol, index);
  }
}
