type Cells = readonly (readonly [number, number])[];
type Pose =
  | { readonly x: number; readonly y: number; readonly pitch: number; readonly anchor: 'top-left' }
  | {
      readonly x: number;
      readonly y: number;
      readonly pitch: number;
      readonly anchor: 'center';
      readonly rows: number;
      readonly cols: number;
    };

/** Visit the actual shape cells in order; the painter owns only the material. */
export function eachPieceCell(
  cells: Cells,
  pose: Pose,
  paint: (x: number, y: number, row: number, col: number, index: number) => void,
): void {
  for (const [index, [row, col]] of cells.entries()) {
    const x =
      pose.anchor === 'center'
        ? pose.x + (col - (pose.cols - 1) / 2) * pose.pitch
        : pose.x + col * pose.pitch;
    const y =
      pose.anchor === 'center'
        ? pose.y + (row - (pose.rows - 1) / 2) * pose.pitch
        : pose.y + row * pose.pitch;
    paint(x, y, row, col, index);
  }
}
