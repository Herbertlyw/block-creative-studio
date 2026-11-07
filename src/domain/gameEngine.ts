import { cloneBoard, createEmptyBoard } from './boardPresets';
import { hash32, seededInt } from './rng';
import { createRuntimeId } from './runtimeId';
import { getShape, SHAPES, TILE_COLORS } from './shapes';
import {
  BOARD_SIZE,
  type BoardState,
  type ClearResult,
  type GameSnapshot,
  type GameTransition,
  type GridCell,
  type LegalMove,
  type PieceInstance,
  type PlacementAction,
  type Take,
  type TileColor,
} from './types';

const GENERATED_SHAPES = SHAPES.filter((shape) => shape.id !== 'square-3');

export function cloneSnapshot(snapshot: GameSnapshot): GameSnapshot {
  return {
    ...snapshot,
    board: cloneBoard(snapshot.board),
    pieces: snapshot.pieces.map((piece) => ({
      ...piece,
      ...(piece.cellColors ? { cellColors: [...piece.cellColors] } : {}),
    })),
  };
}

const TILE_FINGERPRINT_CODE: Record<TileColor, string> = {
  coral: '0',
  amber: '1',
  lime: '2',
  cyan: '3',
  blue: '4',
  violet: '5',
  rose: '6',
};

export function boardFingerprint(board: BoardState): string {
  return board.cells
    .map((row) => row.map((cell) => (cell ? TILE_FINGERPRINT_CODE[cell] : '.')).join(''))
    .join('/');
}

export function createPieceSet(seed: number, setIndex: number, shapeIds?: string[]): PieceInstance[] {
  return Array.from({ length: 3 }, (_, slotIndex) => {
    const requestedShape = shapeIds?.[slotIndex];
    const shape = requestedShape
      ? getShape(requestedShape)
      : GENERATED_SHAPES[
          seededInt(hash32(seed + setIndex * 809), slotIndex * 17 + 5, GENERATED_SHAPES.length)
        ];
    if (!shape) throw new Error('Unable to select a generated piece shape.');

    const color = TILE_COLORS[
      seededInt(hash32(seed + setIndex * 991), slotIndex * 29 + 11, TILE_COLORS.length)
    ];
    if (!color) throw new Error('Unable to select a generated tile color.');

    const generatedCellColors = requestedShape
      ? undefined
      : shape.cells.map((_, cellIndex) =>
          TILE_COLORS[
            seededInt(
              hash32(seed + setIndex * 1297 + slotIndex * 131),
              cellIndex * 43 + 19,
              TILE_COLORS.length,
            )
          ] ?? color,
        );

    return {
      id: `piece-${setIndex}-${slotIndex}-${shape.id}`,
      shapeId: shape.id,
      color,
      used: false,
      setIndex,
      slotIndex,
      ...(generatedCellColors ? { cellColors: generatedCellColors } : {}),
    };
  });
}

export function createGame(
  board: BoardState = createEmptyBoard(),
  seed = 41782,
  pieces: PieceInstance[] = createPieceSet(seed, 0),
): GameSnapshot {
  const snapshot: GameSnapshot = {
    board: cloneBoard(board),
    pieces: pieces.map((piece) => ({
      ...piece,
      used: false,
      ...(piece.cellColors ? { cellColors: [...piece.cellColors] } : {}),
    })),
    seed,
    setIndex: pieces[0]?.setIndex ?? 0,
    turn: 0,
    score: 0,
    combo: 0,
    status: 'playing',
  };
  if (!hasAnyLegalMove(snapshot)) snapshot.status = 'game-over';
  return snapshot;
}

export function pieceCells(piece: PieceInstance, anchor: GridCell): GridCell[] {
  return getShape(piece.shapeId).cells.map(([row, col]) => ({
    row: anchor.row + row,
    col: anchor.col + col,
  }));
}

export function pieceCellColor(piece: PieceInstance, cellIndex: number): TileColor {
  return piece.cellColors?.[cellIndex] ?? piece.color;
}

export function pieceColors(piece: PieceInstance): TileColor[] {
  return getShape(piece.shapeId).cells.map((_, index) => pieceCellColor(piece, index));
}

export function canPlace(board: BoardState, piece: PieceInstance, anchor: GridCell): boolean {
  if (piece.used) return false;
  return pieceCells(piece, anchor).every(
    ({ row, col }) =>
      row >= 0 && row < board.rows && col >= 0 && col < board.cols && board.cells[row]?.[col] === null,
  );
}

export function findLegalAnchors(board: BoardState, piece: PieceInstance): GridCell[] {
  const anchors: GridCell[] = [];
  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      if (canPlace(board, piece, { row, col })) anchors.push({ row, col });
    }
  }
  return anchors;
}

function hasLegalMoveIgnoringStatus(snapshot: GameSnapshot): boolean {
  return snapshot.pieces.some(
    (piece) => !piece.used && findLegalAnchors(snapshot.board, piece).length > 0,
  );
}

export function hasAnyLegalMove(snapshot: GameSnapshot): boolean {
  return snapshot.status !== 'game-over' && hasLegalMoveIgnoringStatus(snapshot);
}

export function detectClear(board: BoardState): ClearResult {
  const rows: number[] = [];
  const cols: number[] = [];

  for (let row = 0; row < board.rows; row += 1) {
    const current = board.cells[row];
    if (current && current.every((cell) => cell !== null)) rows.push(row);
  }

  for (let col = 0; col < board.cols; col += 1) {
    let full = true;
    for (let row = 0; row < board.rows; row += 1) {
      if (board.cells[row]?.[col] === null || board.cells[row]?.[col] === undefined) {
        full = false;
        break;
      }
    }
    if (full) cols.push(col);
  }

  const keys = new Set<string>();
  const cells: ClearResult['cells'] = [];
  const addCell = (row: number, col: number): void => {
    const key = `${row}:${col}`;
    if (keys.has(key)) return;
    const color = board.cells[row]?.[col];
    if (!color) return;
    keys.add(key);
    cells.push({ row, col, color });
  };

  for (const row of rows) {
    for (let col = 0; col < board.cols; col += 1) addCell(row, col);
  }
  for (const col of cols) {
    for (let row = 0; row < board.rows; row += 1) addCell(row, col);
  }

  return { rows, cols, cells };
}

function scoreTransition(
  pieceSize: number,
  clear: ClearResult,
  combo: number,
): { placementPoints: number; clearBonusPoints: number; total: number } {
  const placementPoints = pieceSize;
  const lineCount = clear.rows.length + clear.cols.length;
  if (lineCount === 0) return { placementPoints, clearBonusPoints: 0, total: placementPoints };
  const lineBonus = lineCount * lineCount * 12;
  const comboBonus = Math.max(0, combo - 1) * 18;
  const clearBonusPoints = clear.cells.length * 2 + lineBonus + comboBonus;
  return { placementPoints, clearBonusPoints, total: placementPoints + clearBonusPoints };
}

export function applyPlacement(snapshot: GameSnapshot, action: PlacementAction): GameTransition | null {
  if (snapshot.status === 'game-over') return null;
  const piece = snapshot.pieces.find((candidate) => candidate.id === action.pieceId);
  if (!piece || piece.used || !canPlace(snapshot.board, piece, action.anchor)) return null;

  const before = cloneSnapshot(snapshot);
  const placedBoard = cloneBoard(snapshot.board);
  for (const [cellIndex, { row, col }] of pieceCells(piece, action.anchor).entries()) {
    const targetRow = placedBoard.cells[row];
    if (!targetRow) throw new Error(`Invalid board row ${row}.`);
    targetRow[col] = pieceCellColor(piece, cellIndex);
  }

  const clear = detectClear(placedBoard);
  const boardAfterClear = cloneBoard(placedBoard);
  for (const { row, col } of clear.cells) {
    const targetRow = boardAfterClear.cells[row];
    if (targetRow) targetRow[col] = null;
  }

  const combo = clear.cells.length > 0 ? snapshot.combo + 1 : 0;
  const score = scoreTransition(getShape(piece.shapeId).cells.length, clear, combo);
  const points = score.total;
  let setIndex = snapshot.setIndex;
  let pieces = snapshot.pieces.map((candidate) =>
    candidate.id === piece.id
      ? { ...candidate, used: true, ...(candidate.cellColors ? { cellColors: [...candidate.cellColors] } : {}) }
      : { ...candidate, ...(candidate.cellColors ? { cellColors: [...candidate.cellColors] } : {}) },
  );

  if (pieces.every((candidate) => candidate.used)) {
    setIndex += 1;
    pieces = createPieceSet(snapshot.seed, setIndex);
  }

  const after: GameSnapshot = {
    board: boardAfterClear,
    pieces,
    seed: snapshot.seed,
    setIndex,
    turn: snapshot.turn + 1,
    score: snapshot.score + points,
    combo,
    status: 'playing',
  };
  if (!hasLegalMoveIgnoringStatus(after)) after.status = 'game-over';

  return {
    before,
    placedBoard,
    after,
    action: {
      ...action,
      anchor: { ...action.anchor },
      pointerPath: action.pointerPath.map((sample) => ({ ...sample })),
    },
    clear,
    placementPoints: score.placementPoints,
    clearBonusPoints: score.clearBonusPoints,
    points,
  };
}

function occupiedCount(board: BoardState): number {
  return board.cells.reduce(
    (count, row) => count + row.reduce((rowCount, cell) => rowCount + (cell ? 1 : 0), 0),
    0,
  );
}

function mobility(snapshot: GameSnapshot): number {
  return snapshot.pieces.reduce(
    (count, piece) => count + (piece.used ? 0 : findLegalAnchors(snapshot.board, piece).length),
    0,
  );
}

export function listLegalMoves(snapshot: GameSnapshot): LegalMove[] {
  if (snapshot.status === 'game-over') return [];
  const moves: LegalMove[] = [];

  for (const piece of snapshot.pieces) {
    if (piece.used) continue;
    for (const anchor of findLegalAnchors(snapshot.board, piece)) {
      const transition = applyPlacement(snapshot, {
        id: `probe-${piece.id}-${anchor.row}-${anchor.col}`,
        actor: 'agent',
        pieceId: piece.id,
        anchor,
        durationFrames: 16,
        pointerPath: [],
      });
      if (!transition) continue;
      const immediateLines = transition.clear.rows.length + transition.clear.cols.length;
      const openCells = BOARD_SIZE * BOARD_SIZE - occupiedCount(transition.after.board);
      const centerDistance = Math.abs(anchor.row - 3.5) + Math.abs(anchor.col - 3.5);
      const heuristic =
        immediateLines * 600 +
        transition.clear.cells.length * 28 +
        transition.points * 2.5 +
        mobility(transition.after) * 1.4 +
        openCells * 0.25 -
        centerDistance * 0.18;
      moves.push({
        pieceId: piece.id,
        anchor: { ...anchor },
        immediateLines,
        clearedCells: transition.clear.cells.length,
        heuristic,
      });
    }
  }

  return moves.sort((left, right) => right.heuristic - left.heuristic);
}

export function chooseGreedyMove(snapshot: GameSnapshot): LegalMove | null {
  return listLegalMoves(snapshot)[0] ?? null;
}

export function replayActions(initial: GameSnapshot, actions: PlacementAction[]): GameTransition[] {
  const transitions: GameTransition[] = [];
  let cursor = cloneSnapshot(initial);
  for (const action of actions) {
    const transition = applyPlacement(cursor, action);
    if (!transition) throw new Error(`Take contains invalid action: ${action.id}`);
    transitions.push(transition);
    cursor = transition.after;
  }
  return transitions;
}

export function makeAgentTake(initial: GameSnapshot, maximumActions = 9): Take {
  const actions: PlacementAction[] = [];
  let cursor = cloneSnapshot(initial);

  for (let index = 0; index < maximumActions && cursor.status === 'playing'; index += 1) {
    const move = chooseGreedyMove(cursor);
    if (!move) break;
    const activePiece = cursor.pieces.find((piece) => piece.id === move.pieceId);
    if (!activePiece) break;
    const startX = 0.27 + activePiece.slotIndex * 0.23;
    const action: PlacementAction = {
      id: `agent-action-${index + 1}`,
      actor: 'agent',
      pieceId: move.pieceId,
      anchor: { ...move.anchor },
      durationFrames: 15,
      pointerPath: [
        { frameOffset: 0, x: startX, y: 0.88 },
        { frameOffset: 6, x: (startX + 0.5) / 2, y: 0.62 },
        {
          frameOffset: 15,
          x: 0.16 + (move.anchor.col / Math.max(1, BOARD_SIZE - 1)) * 0.68,
          y: 0.18 + (move.anchor.row / Math.max(1, BOARD_SIZE - 1)) * 0.5,
        },
      ],
    };
    const transition = applyPlacement(cursor, action);
    if (!transition) break;
    actions.push(action);
    cursor = transition.after;
  }

  return {
    id: createRuntimeId('agent-take'),
    name: '机器试玩',
    createdAt: new Date().toISOString(),
    initial: cloneSnapshot(initial),
    actions,
  };
}

export function recolorBoardCell(
  board: BoardState,
  cell: GridCell,
  color: TileColor | null,
): BoardState {
  const next = cloneBoard(board);
  const row = next.cells[cell.row];
  if (!row || cell.col < 0 || cell.col >= next.cols) return next;
  row[cell.col] = color;
  return next;
}

export function replacePieceShape(
  pieces: PieceInstance[],
  slotIndex: number,
  shapeId: string,
  color?: TileColor,
): PieceInstance[] {
  getShape(shapeId);
  return pieces.map((piece) =>
    piece.slotIndex === slotIndex
      ? {
          ...piece,
          id: `piece-${piece.setIndex}-${slotIndex}-${shapeId}`,
          shapeId,
          color: color ?? piece.color,
          cellColors: getShape(shapeId).cells.map(() => color ?? piece.color),
          used: false,
        }
      : { ...piece },
  );
}
