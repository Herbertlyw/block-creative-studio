import { BOARD_SIZE, type BoardState, type TileColor } from './types';
import { TILE_COLORS } from './shapes';

export function createEmptyBoard(): BoardState {
  return {
    rows: BOARD_SIZE,
    cols: BOARD_SIZE,
    cells: Array.from({ length: BOARD_SIZE }, () => Array<TileColor | null>(BOARD_SIZE).fill(null)),
  };
}

export function cloneBoard(board: BoardState): BoardState {
  return { rows: board.rows, cols: board.cols, cells: board.cells.map((row) => [...row]) };
}

function fill(board: BoardState, row: number, cols: number[], color: TileColor): void {
  for (const col of cols) {
    const line = board.cells[row];
    if (line) line[col] = color;
  }
}

export function createShowcaseBoard(): BoardState {
  const board = createEmptyBoard();
  fill(board, 2, [0, 1, 2, 4, 5, 6], 'violet');
  fill(board, 3, [0, 1, 2, 3, 4, 6, 7], 'cyan');
  fill(board, 4, [0, 1, 3, 4, 5, 6, 7], 'blue');
  fill(board, 5, [0, 2, 3, 4, 5, 7], 'lime');
  fill(board, 6, [0, 1, 2, 4, 5, 6], 'amber');
  fill(board, 7, [0, 1, 3, 4, 6, 7], 'coral');
  return board;
}

export function createCrossClearBoard(): BoardState {
  const board = createEmptyBoard();
  for (let col = 0; col < BOARD_SIZE; col += 1)
    if (col !== 4) {
      const line = board.cells[5];
      if (line) line[col] = TILE_COLORS[col % TILE_COLORS.length] ?? 'blue';
    }
  for (let row = 0; row < BOARD_SIZE; row += 1)
    if (row !== 5) {
      const line = board.cells[row];
      if (line) line[4] = TILE_COLORS[(row + 2) % TILE_COLORS.length] ?? 'blue';
    }
  fill(board, 7, [0, 1, 6, 7], 'blue');
  return board;
}

export function createDenseRescueBoard(): BoardState {
  const board = createEmptyBoard();
  for (let row = 1; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const open = (row === 1 && col >= 4) || (row === 3 && col <= 2) || (row === 6 && col >= 5);
      if (!open && (row + col) % 4 !== 0) {
        const line = board.cells[row];
        if (line) line[col] = TILE_COLORS[(row * 3 + col) % TILE_COLORS.length] ?? 'blue';
      }
    }
  }
  return board;
}

export const BOARD_PRESETS = [
  { id: 'showcase', label: '展示局', create: createShowcaseBoard },
  { id: 'cross-clear', label: '横纵双消', create: createCrossClearBoard },
  { id: 'dense-rescue', label: '险境救场', create: createDenseRescueBoard },
  { id: 'empty', label: '空棋盘', create: createEmptyBoard },
] as const;
