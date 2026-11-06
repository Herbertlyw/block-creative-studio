import { cloneBoard, createEmptyBoard } from './boardPresets';
import {
  applyPlacement as applyNativePlacement,
  detectClear as detectNativeClear,
  hasAnyLegalMove as hasNativeLegalMove,
  pieceCells,
  findLegalAnchors,
} from '../nativeReference/games/block-placement/runtime/gameEngine';
export {
  pieceCells,
  pieceCellColor,
  pieceColors,
  canPlace,
  findLegalAnchors,
  hasAnyLegalMove,
} from '../nativeReference/games/block-placement/runtime/gameEngine';
import { hash32, seededInt } from './rng';
import { createRuntimeId } from './runtimeId';
import { pointerLandingForPlacement } from '../director/boardLayout';
import { buildAgentPointerPath } from '../director/pointerPath';
import { getShape, getShapeBounds, TILE_COLORS } from './shapes';
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
  type ClearAxes,
  type ClearTrigger,
  type ReferenceClearRule,
  type SeedSupplyVersion,
} from './types';

// Frozen order from the reference snapshot before its opt-in authored poses are appended.
const GENERATED_SHAPE_IDS = [
  'single',
  'domino-h',
  'domino-v',
  'tri-h',
  'tri-v',
  'line4-h',
  'line4-v',
  'line5-h',
  'line5-v',
  'square-2',
  'l-3',
  'l-5',
  'j-5',
  't-4',
  's-4',
  'z-4',
  'plus-5',
] as const;
const GENERATED_SHAPES = GENERATED_SHAPE_IDS.map(getShape);
const REFERENCE_TILE_COLORS: TileColor[] = [...TILE_COLORS, 'rose'];

function clonePiece(piece: PieceInstance): PieceInstance {
  return {
    ...piece,
    ...(piece.cellColors ? { cellColors: [...piece.cellColors] } : {}),
  };
}

export function cloneSnapshot(snapshot: GameSnapshot): GameSnapshot {
  return {
    ...snapshot,
    board: cloneBoard(snapshot.board),
    pieces: snapshot.pieces.map(clonePiece),
    ...(snapshot.fixedPieceSupply
      ? {
          fixedPieceSupply: snapshot.fixedPieceSupply.map((batch) => batch.map(clonePiece)),
        }
      : {}),
    ...(snapshot.referenceClearRules
      ? { referenceClearRules: snapshot.referenceClearRules.map((rule) => ({ ...rule })) }
      : {}),
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

export interface CreateGameOptions {
  fixedPieceSupply?: PieceInstance[][];
  seedSupplyVersion?: SeedSupplyVersion;
  clearAxes?: ClearAxes;
  clearTrigger?: ClearTrigger;
  referenceClearRules?: ReferenceClearRule[];
}

export function createPieceSet(
  seed: number,
  setIndex: number,
  shapeIds?: string[],
  options?: { multiColor?: boolean; seedSupplyVersion?: SeedSupplyVersion },
): PieceInstance[] {
  const palette =
    options?.seedSupplyVersion === 'reference-worktree-0f237a8f'
      ? REFERENCE_TILE_COLORS
      : TILE_COLORS;
  return Array.from({ length: 3 }, (_, slotIndex) => {
    const requestedShape = shapeIds?.[slotIndex];
    const shape = requestedShape
      ? getShape(requestedShape)
      : GENERATED_SHAPES[
          seededInt(hash32(seed + setIndex * 809), slotIndex * 17 + 5, GENERATED_SHAPES.length)
        ];
    if (!shape) throw new Error('Unable to select a generated piece shape.');

    const color =
      palette[seededInt(hash32(seed + setIndex * 991), slotIndex * 29 + 11, palette.length)];
    if (!color) throw new Error('Unable to select a generated tile color.');

    const useMultiColor =
      options?.multiColor ??
      (options?.seedSupplyVersion === 'reference-worktree-0f237a8f' ? false : !requestedShape);
    const generatedCellColors = useMultiColor
      ? shape.cells.map(
          (_, cellIndex) =>
            palette[
              seededInt(
                hash32(seed + setIndex * 1297 + slotIndex * 131),
                cellIndex * 43 + 19,
                palette.length,
              )
            ] ?? color,
        )
      : undefined;

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
  options?: CreateGameOptions,
): GameSnapshot {
  const snapshot: GameSnapshot = {
    board: cloneBoard(board),
    ...(options?.seedSupplyVersion ? { seedSupplyVersion: options.seedSupplyVersion } : {}),
    ...(options?.clearAxes ? { clearAxes: options.clearAxes } : {}),
    ...(options?.clearTrigger ? { clearTrigger: options.clearTrigger } : {}),
    ...(options?.referenceClearRules
      ? { referenceClearRules: options.referenceClearRules.map((rule) => ({ ...rule })) }
      : {}),
    pieces: pieces.map((piece) => ({
      ...clonePiece(piece),
      used: false,
    })),
    seed,
    setIndex: pieces[0]?.setIndex ?? 0,
    turn: 0,
    score: 0,
    combo: 0,
    status: 'playing',
    ...(options?.fixedPieceSupply
      ? {
          fixedPieceSupply: options.fixedPieceSupply.map((batch) =>
            batch.map((piece) => ({
              ...clonePiece(piece),
              used: false,
            })),
          ),
        }
      : {}),
  };
  if (!hasNativeLegalMove(snapshot)) snapshot.status = 'game-over';
  return snapshot;
}

export function createProjectGame(project: {
  setupBoard: BoardState;
  seed: number;
  setupPieces: PieceInstance[];
  clearAxes?: ClearAxes;
  clearTrigger?: ClearTrigger;
  referenceClearRules?: ReferenceClearRule[];
  fixedPieceSupply?: PieceInstance[][];
  seedSupplyVersion?: SeedSupplyVersion;
}): GameSnapshot {
  return createGame(project.setupBoard, project.seed, project.setupPieces, {
    ...(project.clearAxes ? { clearAxes: project.clearAxes } : {}),
    ...(project.clearTrigger ? { clearTrigger: project.clearTrigger } : {}),
    ...(project.referenceClearRules ? { referenceClearRules: project.referenceClearRules } : {}),
    ...(project.fixedPieceSupply ? { fixedPieceSupply: project.fixedPieceSupply } : {}),
    ...(project.seedSupplyVersion ? { seedSupplyVersion: project.seedSupplyVersion } : {}),
  });
}

export function placementRejectionReason(
  snapshot: GameSnapshot,
  pieceId: string,
  anchor: GridCell,
): string | null {
  if (snapshot.status === 'game-over') return '对局已结束，不能再落子。';
  const piece = snapshot.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) return `找不到候选块 ${pieceId}。`;
  if (piece.used) return `候选块 ${pieceId} 已经用过。`;
  const cells = pieceCells(piece, anchor);
  const outside = cells.filter(
    (cell) =>
      cell.row < 0 ||
      cell.col < 0 ||
      cell.row >= snapshot.board.rows ||
      cell.col >= snapshot.board.cols,
  );
  if (outside.length > 0) {
    return `落点超出 8×8 棋盘（${outside.map((cell) => `${cell.row},${cell.col}`).join(' ')}）。`;
  }
  const blocked = cells.filter((cell) => snapshot.board.cells[cell.row]?.[cell.col]);
  if (blocked.length > 0) {
    return `落点与已有方块重叠（${blocked.map((cell) => `${cell.row},${cell.col}`).join(' ')}）。`;
  }
  return null;
}

/** Use the same BB rule implementation as the native work runtime. */
export function detectClear(
  board: BoardState,
  clearAxes: ClearAxes = 'both',
  clearTrigger: ClearTrigger = 'line-complete',
): ClearResult {
  return detectNativeClear(board, clearAxes, clearTrigger);
}

/**
 * Resolve through the native BB runtime. Until the legacy workbench is removed,
 * its explicit seeded-supply mode remains attached to the state and refreshes
 * its tray with that mode; the placement, clearing and scoring rules are shared.
 */
export function applyPlacement(
  snapshot: GameSnapshot,
  action: PlacementAction,
): GameTransition | null {
  const transition = applyNativePlacement(snapshot, action);
  if (!transition) return null;
  // The native clone retains the rule array by reference; the workbench exposes
  // transition snapshots to editors, so preserve its previous isolation here.
  if (transition.before.referenceClearRules) {
    transition.before.referenceClearRules = structuredClone(transition.before.referenceClearRules);
  }
  const after: GameSnapshot = transition.after;
  if (snapshot.seedSupplyVersion) after.seedSupplyVersion = snapshot.seedSupplyVersion;
  if (!snapshot.fixedPieceSupply && after.setIndex !== snapshot.setIndex) {
    after.pieces = createPieceSet(
      snapshot.seed,
      after.setIndex,
      undefined,
      snapshot.seedSupplyVersion ? { seedSupplyVersion: snapshot.seedSupplyVersion } : undefined,
    );
    after.status = 'playing';
    if (!hasNativeLegalMove(after)) after.status = 'game-over';
  }
  return { ...transition, after };
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
  const diagnosis = diagnoseReplay(initial, actions);
  if (!diagnosis.ok)
    throw new Error(`Take contains invalid action: ${diagnosis.actionId}（${diagnosis.reason}）`);
  return diagnosis.transitions;
}

export function diagnoseReplay(
  initial: GameSnapshot,
  actions: PlacementAction[],
):
  | { ok: true; transitions: GameTransition[] }
  | { ok: false; index: number; actionId: string; reason: string } {
  const transitions: GameTransition[] = [];
  let cursor = cloneSnapshot(initial);
  for (const [index, action] of actions.entries()) {
    const reason = placementRejectionReason(cursor, action.pieceId, action.anchor);
    if (reason) return { ok: false, index, actionId: action.id, reason };
    const transition = applyPlacement(cursor, action);
    if (!transition) return { ok: false, index, actionId: action.id, reason: '落子未能执行。' };
    transitions.push(transition);
    cursor = transition.after;
  }
  return { ok: true, transitions };
}

export function makeAgentTake(initial: GameSnapshot, maximumActions = 9): Take {
  const actions: PlacementAction[] = [];
  let cursor = cloneSnapshot(initial);

  for (let index = 0; index < maximumActions && cursor.status === 'playing'; index += 1) {
    const move = chooseGreedyMove(cursor);
    if (!move) break;
    const activePiece = cursor.pieces.find((piece) => piece.id === move.pieceId);
    if (!activePiece) break;
    const bounds = getShapeBounds(getShape(activePiece.shapeId));
    const action: PlacementAction = {
      id: `agent-action-${index + 1}`,
      actor: 'agent',
      pieceId: move.pieceId,
      anchor: { ...move.anchor },
      durationFrames: 15,
      pointerPath: buildAgentPointerPath({
        actionIndex: index,
        slotIndex: activePiece.slotIndex,
        landing: pointerLandingForPlacement(move.anchor, bounds),
        durationFrames: 15,
      }),
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
