import { cloneBoard, createCrossClearBoard, createEmptyBoard } from './boardPresets';
import {
  applyPlacement,
  cloneSnapshot,
  createGame,
  detectClear,
  hasAnyLegalMove,
} from './gameEngine';
import type {
  BoardState,
  GameSnapshot,
  GridCell,
  PieceInstance,
  PlacementAction,
  PresentationFrame,
  Take,
  TileColor,
} from './types';

function piece(
  id: string,
  shapeId: string,
  color: TileColor,
  slotIndex: number,
  setIndex = 0,
): PieceInstance {
  return { id, shapeId, color, used: false, setIndex, slotIndex };
}

function fillRow(board: BoardState, row: number, missingCol: number, color: TileColor): void {
  const line = board.cells[row];
  if (!line) return;
  for (let col = 0; col < board.cols; col += 1) {
    if (col !== missingCol) line[col] = color;
  }
}

function action(
  pieceId: string,
  row: number,
  col: number,
  durationFrames = 18,
): PlacementAction {
  return {
    id: `fix-${pieceId}-${row}-${col}`,
    actor: 'human',
    pieceId,
    anchor: { row, col },
    durationFrames,
    pointerPath: [
      { frameOffset: 0, x: 0.28, y: 0.86 },
      { frameOffset: Math.round(durationFrames * 0.55), x: 0.5, y: 0.58 },
      { frameOffset: durationFrames, x: 0.18 + (col / 7) * 0.64, y: 0.2 + (row / 7) * 0.5 },
    ],
  };
}

function takeFrom(id: string, name: string, initial: GameSnapshot, actions: PlacementAction[]): Take {
  let cursor = cloneSnapshot(initial);
  const applied: PlacementAction[] = [];
  for (const candidate of actions) {
    const transition = applyPlacement(cursor, candidate);
    if (!transition) throw new Error(`Fixture ${id} could not apply ${candidate.id}.`);
    applied.push(transition.action);
    cursor = transition.after;
  }
  return {
    id,
    name,
    createdAt: '2026-09-03T00:00:00.000Z',
    initial: cloneSnapshot(initial),
    actions: applied,
  };
}

export function idleSnapshot(): GameSnapshot {
  const pieces = [
    piece('piece-idle-0-line5-h', 'line5-h', 'coral', 0),
    piece('piece-idle-1-square-2', 'square-2', 'cyan', 1),
    piece('piece-idle-2-tri-v', 'tri-v', 'amber', 2),
  ];
  return createGame(createEmptyBoard(), 20260903, pieces);
}

export function singleClearSnapshot(): GameSnapshot {
  const board = createEmptyBoard();
  fillRow(board, 6, 7, 'lime');
  const pieces = [
    piece('piece-clear-0-single', 'single', 'violet', 0),
    piece('piece-clear-1-domino-h', 'domino-h', 'cyan', 1),
    piece('piece-clear-2-tri-h', 'tri-h', 'amber', 2),
  ];
  return createGame(board, 20260903, pieces);
}

export function consecutiveSnapshot(): GameSnapshot {
  const board = createEmptyBoard();
  fillRow(board, 7, 7, 'coral');
  fillRow(board, 5, 7, 'blue');
  const pieces = [
    piece('piece-seq-0-single', 'single', 'rose', 0),
    piece('piece-seq-1-single', 'single', 'amber', 1),
    piece('piece-seq-2-square-2', 'square-2', 'lime', 2),
  ];
  return createGame(board, 20260903, pieces);
}

export function crossClearSnapshot(): GameSnapshot {
  const board = createCrossClearBoard();
  const pieces = [
    piece('piece-cross-0-single', 'single', 'amber', 0),
    piece('piece-cross-1-domino-v', 'domino-v', 'cyan', 1),
    piece('piece-cross-2-tri-h', 'tri-h', 'lime', 2),
  ];
  return createGame(board, 41782, pieces);
}

export function illegalPreviewSnapshot(): GameSnapshot {
  const board = createEmptyBoard();
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const keepEmpty = (row < 2 && col < 2) || (row === 7 && col === 7);
      if (!keepEmpty) {
        const line = board.cells[row];
        if (line) line[col] = 'blue';
      }
    }
  }
  const pieces = [
    piece('piece-illegal-0-square-3', 'square-3', 'coral', 0),
    piece('piece-illegal-1-square-2', 'square-2', 'cyan', 1),
    piece('piece-illegal-2-single', 'single', 'amber', 2),
  ];
  return createGame(board, 20260903, pieces);
}

export function illegalPreviewAnchor(): GridCell {
  return { row: 3, col: 3 };
}

export function illegalPreviewFrame(): PresentationFrame {
  const snapshot = illegalPreviewSnapshot();
  const dragged = snapshot.pieces.find((candidate) => candidate.shapeId === 'square-3');
  if (!dragged) throw new Error('illegal preview fixture is missing square-3.');
  const anchor = illegalPreviewAnchor();
  return {
    frame: 12,
    fps: 30,
    snapshot,
    board: cloneBoard(snapshot.board),
    cameraPunch: 0,
    hiddenPieceId: dragged.id,
    draggedPiece: {
      piece: dragged,
      anchor,
      progress: 1,
      pointerDriven: true,
    },
    pointer: { x: 0.52, y: 0.46, pressed: true },
  };
}

export function endgameSnapshot(): GameSnapshot {
  const board = createEmptyBoard();
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if (!(row === 0 && col === 0)) {
        const line = board.cells[row];
        if (line) line[col] = 'cyan';
      }
    }
  }
  const pieces = [
    piece('piece-end-0-square-2', 'square-2', 'coral', 0),
    piece('piece-end-1-line5-h', 'line5-h', 'amber', 1),
    piece('piece-end-2-plus-5', 'plus-5', 'violet', 2),
  ];
  const snapshot = createGame(board, 20260903, pieces);
  if (snapshot.status !== 'game-over' && !hasAnyLegalMove(snapshot)) snapshot.status = 'game-over';
  return snapshot;
}

export function singleClearTake(): Take {
  return takeFrom('take-single-clear', '公开切片 · 单行清除', singleClearSnapshot(), [
    action('piece-clear-0-single', 6, 7, 20),
  ]);
}

export function consecutiveTake(): Take {
  return takeFrom('take-consecutive-placements', '公开切片 · 连续两次落子', consecutiveSnapshot(), [
    action('piece-seq-0-single', 7, 7, 16),
    action('piece-seq-1-single', 5, 7, 16),
  ]);
}

export function crossClearTake(): Take {
  return takeFrom('take-cross-clear', '公开切片 · 交叉清除', crossClearSnapshot(), [
    action('piece-cross-0-single', 5, 4, 22),
  ]);
}

export function sliceSingleClearTake(): Take {
  return takeFrom('take-slice-single-clear', '6-8s 切片 · 拾取到单行清除', singleClearSnapshot(), [
    action('piece-clear-0-single', 6, 7, 24),
  ]);
}

export interface PublicSceneCatalog {
  id: string;
  label: string;
  snapshot: GameSnapshot;
  take?: Take;
}

export function publicSceneCatalog(): PublicSceneCatalog[] {
  return [
    { id: 'idle', label: 'Idle', snapshot: idleSnapshot() },
    { id: 'pickup', label: 'Pickup', snapshot: idleSnapshot() },
    { id: 'legal-preview', label: 'Legal preview', snapshot: singleClearSnapshot() },
    { id: 'illegal-preview', label: 'Illegal preview', snapshot: illegalPreviewSnapshot() },
    { id: 'single-clear', label: 'Single row clear', snapshot: singleClearSnapshot(), take: singleClearTake() },
    { id: 'cross-clear', label: 'Cross clear', snapshot: crossClearSnapshot(), take: crossClearTake() },
    { id: 'consecutive', label: 'Consecutive placements', snapshot: consecutiveSnapshot(), take: consecutiveTake() },
    { id: 'endgame', label: 'Endgame', snapshot: endgameSnapshot() },
  ];
}

export function sceneStateIdentity(snapshot: GameSnapshot): unknown {
  return {
    board: cloneBoard(snapshot.board),
    pieces: snapshot.pieces.map((item) => ({
      id: item.id,
      shapeId: item.shapeId,
      color: item.color,
      used: item.used,
      slotIndex: item.slotIndex,
      cellColors: item.cellColors ?? null,
    })),
    seed: snapshot.seed,
    setIndex: snapshot.setIndex,
    turn: snapshot.turn,
    score: snapshot.score,
    combo: snapshot.combo,
    status: snapshot.status,
  };
}

export function takeStateIdentity(take: Take): unknown {
  return {
    initial: sceneStateIdentity(take.initial),
    actions: take.actions.map((item) => ({
      actor: item.actor,
      pieceId: item.pieceId,
      anchor: item.anchor,
    })),
  };
}

export function legalPreviewCells(): ReturnType<typeof detectClear> {
  const snapshot = singleClearSnapshot();
  const board = cloneBoard(snapshot.board);
  const row = board.cells[6];
  if (row) row[7] = 'violet';
  return detectClear(board);
}
