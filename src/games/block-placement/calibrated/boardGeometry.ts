// Derived production module; supplied reference files remain unchanged.
/** Internal drawing geometry; authored calibration stays [x,y,pitch].
 * The fourth value comes only from the validated native square board. */
export type CalibratedBoardGeometry = readonly [number, number, number, number?];
export const boardSide = (board: readonly (number | undefined)[]) => board[3] ?? 8;
