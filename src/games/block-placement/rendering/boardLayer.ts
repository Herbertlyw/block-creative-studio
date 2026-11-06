import type { BBBoardDrawable } from '../planning/bbTimelinePlan';

/** Preserve layer order while both styles consume the same validated board cells. */
export function paintBoardCells(
  cells: readonly BBBoardDrawable[],
  order: 'slots' | 'occupied' | 'interleaved',
  painters: { slot?: (cell: BBBoardDrawable) => void; occupied?: (cell: BBBoardDrawable) => void },
): void {
  for (const cell of cells) {
    if (order !== 'occupied') painters.slot?.(cell);
    if (order !== 'slots' && cell.color !== null) painters.occupied?.(cell);
  }
}
