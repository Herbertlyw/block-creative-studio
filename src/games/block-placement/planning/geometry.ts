export interface BBGeometry {
  readonly canvas: { readonly width: number; readonly height: number };
  readonly board: {
    readonly x: number;
    readonly y: number;
    readonly pitch: number;
    readonly cell: number;
    readonly rows: number;
    readonly cols: number;
  };
  readonly fit: 'contain' | 'stretch';
}

/** A single explicit mapping between design pixels and output pixels. */
export function bbDesignTransform(geometry: BBGeometry, width: number, height: number) {
  const { canvas, board, fit } = geometry;
  if (
    ![
      width,
      height,
      canvas.width,
      canvas.height,
      board.x,
      board.y,
      board.pitch,
      board.cell,
      board.rows,
      board.cols,
    ].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    canvas.width <= 0 ||
    canvas.height <= 0 ||
    board.pitch <= 0 ||
    board.cell <= 0 ||
    !Number.isInteger(board.rows) ||
    !Number.isInteger(board.cols) ||
    board.rows <= 0 ||
    board.cols <= 0 ||
    !['contain', 'stretch'].includes(fit)
  )
    throw new Error('BB_GEOMETRY_INVALID');
  const rawX = width / canvas.width,
    rawY = height / canvas.height;
  const sx = fit === 'contain' ? Math.min(rawX, rawY) : rawX,
    sy = fit === 'contain' ? sx : rawY;
  const left = (width - canvas.width * sx) / 2,
    top = (height - canvas.height * sy) / 2;
  return {
    sx,
    sy,
    left,
    top,
    designToOutput: (x: number, y: number) => ({ x: left + x * sx, y: top + y * sy }),
    outputToDesign: (x: number, y: number) => ({ x: (x - left) / sx, y: (y - top) / sy }),
  };
}
