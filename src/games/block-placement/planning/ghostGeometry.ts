// Derived production module; supplied reference files remain unchanged.
type Cell = readonly [number, number];
type Anchor = { row: number; col: number };

function checkedGeometry(
  cells: readonly (readonly number[])[],
  board: readonly (readonly unknown[])[],
): { cells: Cell[]; width: number } {
  const width = board[0]?.length;
  if (!width || board.some((row) => row.length !== width))
    throw new Error('CALIBRATED_PREVIEW_BOARD_INVALID');
  if (!cells.length) throw new Error('CALIBRATED_PREVIEW_SHAPE_INVALID');
  const checked = cells.map((cell) => {
    const [row, col] = cell;
    if (
      cell.length !== 2 ||
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      row === undefined ||
      col === undefined ||
      row < 0 ||
      col < 0
    )
      throw new Error('CALIBRATED_PREVIEW_SHAPE_INVALID');
    return [row, col] as const;
  });
  return { cells: checked, width };
}

function fits(
  cells: readonly Cell[],
  board: readonly (readonly unknown[])[],
  anchor: Anchor,
  width: number,
): boolean {
  return cells.every(([r, c]) => {
    const row = anchor.row + r,
      col = anchor.col + c;
    return row >= 0 && row < board.length && col >= 0 && col < width && board[row]?.[col] === null;
  });
}

/** Snap the moving piece, never its eventual recorded destination. */
export function dragPreviewAnchor(
  cells: readonly (readonly number[])[],
  board: readonly (readonly unknown[])[],
  x: number,
  y: number,
  size: number,
  boardGeometry: readonly number[],
  progress: number,
): Anchor | undefined {
  const geometry = checkedGeometry(cells, board);
  const [gx, gy, pitch] = boardGeometry;
  if (
    gx === undefined ||
    gy === undefined ||
    pitch === undefined ||
    ![gx, gy, pitch, x, y, size, progress].every(Number.isFinite) ||
    pitch <= 0 ||
    size <= 0
  )
    throw new Error('CALIBRATED_PREVIEW_GEOMETRY_INVALID');
  if (progress < 0.12 || size < pitch * 0.92) return;
  const col = Math.round((x - gx) / pitch),
    row = Math.round((y - gy) / pitch);
  if (
    Math.abs(x - gx - col * pitch) > pitch * 0.45 ||
    Math.abs(y - gy - row * pitch) > pitch * 0.45
  )
    return;
  return fits(geometry.cells, board, { row, col }, geometry.width) ? { row, col } : undefined;
}

/** Completed lines are a hypothetical legal drop, never an early board mutation. */
export function completedPreviewLines(
  cells: readonly (readonly number[])[],
  board: readonly (readonly unknown[])[],
  anchor: Anchor,
  clearAxes: 'rows' | 'columns' | 'both' = 'both',
  clearTrigger: 'line-complete' | 'board-full' = 'line-complete',
) {
  const geometry = checkedGeometry(cells, board);
  if (!Number.isInteger(anchor.row) || !Number.isInteger(anchor.col))
    throw new Error('CALIBRATED_PREVIEW_ANCHOR_INVALID');
  if (!fits(geometry.cells, board, anchor, geometry.width))
    return { rows: [] as number[], cols: [] as number[] };
  const occupied = board.map((row) => row.map((value) => value != null));
  for (const [r, c] of geometry.cells) {
    const row = occupied[anchor.row + r];
    if (!row) throw new Error('CALIBRATED_PREVIEW_BOARD_INVALID');
    row[anchor.col + c] = true;
  }
  if (clearTrigger === 'board-full' && occupied.some((row) => row.some((value) => !value)))
    return { rows: [], cols: [] };
  return {
    rows:
      clearAxes === 'columns' ? [] : occupied.flatMap((row, r) => (row.every(Boolean) ? [r] : [])),
    cols:
      clearAxes === 'rows'
        ? []
        : Array.from({ length: geometry.width }, (_, c) => c).filter((c) =>
            occupied.every((row) => row[c]),
          ),
  };
}
