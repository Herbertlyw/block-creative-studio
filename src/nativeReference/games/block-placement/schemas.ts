import {parseReferenceClearRules} from './runtime/clearRules';
import { createEmptyBoard } from '../../domain/boardPresets';
import { getShape, TILE_COLORS } from '../../domain/shapes';
import type { BoardState, GameSnapshot, GridCell, PieceInstance, PlacementAction, TileColor } from '../../domain/types';
import { BOARD_SIZE } from '../../domain/types';
import type { RuntimeSchema } from '../../game-runtime/contracts';
import { GameSchemaError } from '../../game-runtime/errors';
import {
  BLOCK_PLACEMENT_ACTION_SCHEMA_ID,
  BLOCK_PLACEMENT_CONFIG_SCHEMA_ID,
  BLOCK_PLACEMENT_SCHEMA_VERSION,
  BLOCK_PLACEMENT_SEMANTIC_ACTION_SCHEMA_ID,
  BLOCK_PLACEMENT_STATE_SCHEMA_ID,
} from './manifest';

export interface BlockPlacementConfig {
  clearAxes?: GameSnapshot['clearAxes'];
  clearTrigger?: GameSnapshot['clearTrigger'];
  referenceClearRules?: GameSnapshot['referenceClearRules'];
  board?: BoardState;
  pieces?: PieceInstance[];
  fixedPieceSupply?: PieceInstance[][];
}

export interface BlockPlacementSemanticAction {
  pieceId: string;
  anchor: GridCell;
}

const COLORS = new Set<string>(TILE_COLORS);
function parseClearAxes(value:unknown,path:string):NonNullable<GameSnapshot['clearAxes']>{
  if(value!=='rows'&&value!=='columns'&&value!=='both')fail(path,'must be rows, columns, or both');
  return value;
}

function parseClearTrigger(value:unknown,path:string):NonNullable<GameSnapshot['clearTrigger']>{
 if(value!=='line-complete'&&value!=='board-full')fail(path,'must be line-complete or board-full');return value;
}

function fail(path: string, detail: string, code = 'INVALID_VALUE'): never {
  throw new GameSchemaError(code, `${path}: ${detail}`, { path });
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string, maximum = 240): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    fail(path, `must be a string of 1–${maximum} characters`);
  }
  return value;
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a finite number between ${minimum} and ${maximum}`);
  }
  return value;
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  const result = finite(value, path, minimum, maximum);
  if (!Number.isInteger(result)) fail(path, 'must be an integer');
  return result;
}

function parseBoard(value: unknown, path: string): BoardState {
  const source = record(value, path);
  // Preserve the historical 8×8 default while accepting native 6×6 references.
  const rows = integer(source.rows, `${path}.rows`, 6, BOARD_SIZE);
  if (rows !== 6 && rows !== BOARD_SIZE) fail(`${path}.rows`, 'must be 6 or 8');
  const cols = integer(source.cols, `${path}.cols`, rows, rows);
  if (!Array.isArray(source.cells) || source.cells.length !== rows) fail(`${path}.cells`, `must have ${rows} rows`);
  const cells = source.cells.map((rowValue, row) => {
    if (!Array.isArray(rowValue) || rowValue.length !== cols) {
      fail(`${path}.cells[${row}]`, `must have ${cols} columns`);
    }
    return rowValue.map((cell, col) => {
      if (cell === null) return null;
      if (typeof cell !== 'string' || !COLORS.has(cell)) {
        fail(`${path}.cells[${row}][${col}]`, 'color is invalid');
      }
      return cell as TileColor;
    });
  });
  return { rows, cols, cells };
}

function parsePiece(value: unknown, path: string): PieceInstance {
  const source = record(value, path);
  const shapeId = string(source.shapeId, `${path}.shapeId`, 80);
  let shape: ReturnType<typeof getShape>;
  try {
    shape = getShape(shapeId);
  } catch {
    fail(`${path}.shapeId`, `unknown shape ${shapeId}`);
  }

  let cellColors: TileColor[] | undefined;
  if (source.cellColors !== undefined) {
    if (!Array.isArray(source.cellColors)) fail(`${path}.cellColors`, 'must be an array of colors');
    if (source.cellColors.length !== shape.cells.length) {
      fail(`${path}.cellColors`, `must match the shape cell count (${shape.cells.length})`);
    }
    cellColors = source.cellColors.map((color, index) => {
      if (typeof color !== 'string' || !COLORS.has(color)) {
        fail(`${path}.cellColors[${index}]`, 'color is invalid');
      }
      return color as TileColor;
    });
  }

  return {
    id: string(source.id, `${path}.id`, 160),
    shapeId,
    color: typeof source.color === 'string' && COLORS.has(source.color)
      ? source.color as TileColor
      : fail(`${path}.color`, 'color is invalid'),
    used: typeof source.used === 'boolean' ? source.used : fail(`${path}.used`, 'must be a boolean'),
    setIndex: integer(source.setIndex, `${path}.setIndex`, 0, 100_000),
    slotIndex: integer(source.slotIndex, `${path}.slotIndex`, 0, 2),
    ...(cellColors ? { cellColors } : {}),
  };
}

function parsePieces(value: unknown, path: string): PieceInstance[] {
  if (!Array.isArray(value) || value.length !== 3) fail(path, 'must contain exactly three pieces');
  const pieces = value.map((piece, index) => parsePiece(piece, `${path}[${index}]`));
  const slotIndexes = pieces.map((piece) => piece.slotIndex).sort((left, right) => left - right);
  if (slotIndexes.join(',') !== '0,1,2') fail(path, 'slotIndex must cover 0, 1, and 2');
  if (new Set(pieces.map((piece) => piece.id)).size !== 3) fail(path, 'piece ids must be unique');
  if (new Set(pieces.map((piece) => piece.setIndex)).size !== 1) {
    fail(path, 'pieces in one tray must share the same setIndex');
  }
  return pieces;
}

function parseFixedPieceSupply(value: unknown, path: string): PieceInstance[][] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
    fail(path, 'must contain 1–500 complete three-piece rounds');
  }
  return value.map((batch, setIndex) => {
    const pieces = parsePieces(batch, `${path}[${setIndex}]`);
    if (pieces.some((piece) => piece.setIndex !== setIndex)) {
      fail(`${path}[${setIndex}]`, `piece setIndex must be ${setIndex}`);
    }
    if (pieces.some((piece) => piece.used)) fail(`${path}[${setIndex}]`, 'fixed supply pieces must not be marked used');
    return pieces;
  });
}

export function parseBlockPlacementConfig(value: unknown, path = '$'): BlockPlacementConfig {
  const source = record(value, path);
  const config: BlockPlacementConfig = {};
  if(source.referenceClearRules!==undefined)config.referenceClearRules=parseReferenceClearRules(source.referenceClearRules);
  if(source.clearTrigger!==undefined)config.clearTrigger=parseClearTrigger(source.clearTrigger,`${path}.clearTrigger`);
  if(source.clearAxes!==undefined)config.clearAxes=parseClearAxes(source.clearAxes,`${path}.clearAxes`);
  if (source.board !== undefined) config.board = parseBoard(source.board, `${path}.board`);
  if (source.pieces !== undefined) config.pieces = parsePieces(source.pieces, `${path}.pieces`);
  if (source.fixedPieceSupply !== undefined) {
    config.fixedPieceSupply = parseFixedPieceSupply(source.fixedPieceSupply, `${path}.fixedPieceSupply`);
    if (config.pieces && JSON.stringify(config.pieces) !== JSON.stringify(config.fixedPieceSupply[0])) {
      fail(`${path}.pieces`, 'must equal fixedPieceSupply[0] when both are provided');
    }
  }
  return config;
}

export function parseBlockPlacementState(value: unknown, path = '$'): GameSnapshot {
  const source = record(value, path);
  if (!('seed' in source)) fail(`${path}.seed`, 'is required', 'MISSING_FIELD');
  if (!('setIndex' in source)) fail(`${path}.setIndex`, 'is required', 'MISSING_FIELD');
  if (!('turn' in source)) fail(`${path}.turn`, 'is required', 'MISSING_FIELD');
  if (!('score' in source)) fail(`${path}.score`, 'is required', 'MISSING_FIELD');
  if (!('combo' in source)) fail(`${path}.combo`, 'is required', 'MISSING_FIELD');
  if (!('status' in source)) fail(`${path}.status`, 'is required', 'MISSING_FIELD');
  if (!('board' in source)) fail(`${path}.board`, 'is required', 'MISSING_FIELD');
  if (!('pieces' in source)) fail(`${path}.pieces`, 'is required', 'MISSING_FIELD');

  const status = source.status === 'playing' || source.status === 'game-over'
    ? source.status
    : fail(`${path}.status`, 'must be playing or game-over');
  const pieces = parsePieces(source.pieces, `${path}.pieces`);
  const setIndex = integer(source.setIndex, `${path}.setIndex`, 0, 100_000);
  if (pieces.some((piece) => piece.setIndex !== setIndex)) {
    fail(`${path}.pieces`, 'piece setIndex must match the snapshot setIndex');
  }
  const fixedPieceSupply = source.fixedPieceSupply === undefined
    ? undefined
    : parseFixedPieceSupply(source.fixedPieceSupply, `${path}.fixedPieceSupply`);
  if (fixedPieceSupply && setIndex >= fixedPieceSupply.length) {
    fail(`${path}.setIndex`, 'must identify a round in fixedPieceSupply');
  }
  if (source.supplyExhausted !== undefined && typeof source.supplyExhausted !== 'boolean') {
    fail(`${path}.supplyExhausted`, 'must be a boolean');
  }
  return {
    board: parseBoard(source.board, `${path}.board`),
    ...(source.referenceClearRules!==undefined?{referenceClearRules:parseReferenceClearRules(source.referenceClearRules)}:{}),
    ...(source.clearTrigger!==undefined?{clearTrigger:parseClearTrigger(source.clearTrigger,`${path}.clearTrigger`)}:{}),
    ...(source.clearAxes!==undefined?{clearAxes:parseClearAxes(source.clearAxes,`${path}.clearAxes`)}:{}),
    pieces,
    seed: integer(source.seed, `${path}.seed`, 0, 2_147_483_647),
    setIndex,
    turn: integer(source.turn, `${path}.turn`, 0, 100_000),
    score: integer(source.score, `${path}.score`, 0, 2_147_483_647),
    combo: integer(source.combo, `${path}.combo`, 0, 100_000),
    status,
    ...(fixedPieceSupply ? { fixedPieceSupply } : {}),
    ...(source.supplyExhausted === true ? { supplyExhausted: true } : {}),
  };
}

export function parseBlockPlacementAction(value: unknown, path = '$'): PlacementAction {
  const source = record(value, path);
  for (const field of ['id', 'actor', 'pieceId', 'anchor', 'durationFrames', 'pointerPath'] as const) {
    if (!(field in source)) fail(`${path}.${field}`, 'is required', 'MISSING_FIELD');
  }
  const anchorSource = record(source.anchor, `${path}.anchor`);
  if (!Array.isArray(source.pointerPath) || source.pointerPath.length > 10_000) {
    fail(`${path}.pointerPath`, 'must be an array of at most 10000 samples');
  }
  let previousFrame = -1;
  const pointerPath = source.pointerPath.map((sampleValue, index) => {
    const sample = record(sampleValue, `${path}.pointerPath[${index}]`);
    const frameOffset = integer(sample.frameOffset, `${path}.pointerPath[${index}].frameOffset`, 0, 100_000);
    if (frameOffset < previousFrame) fail(`${path}.pointerPath`, 'frameOffset must be non-decreasing');
    previousFrame = frameOffset;
    return {
      frameOffset,
      x: finite(sample.x, `${path}.pointerPath[${index}].x`, 0, 1),
      y: finite(sample.y, `${path}.pointerPath[${index}].y`, 0, 1),
    };
  });
  const durationFrames = integer(source.durationFrames, `${path}.durationFrames`, 1, 10_000);
  if (pointerPath.length > 0 && pointerPath[0]?.frameOffset !== 0) {
    fail(`${path}.pointerPath[0].frameOffset`, 'a non-empty path must start at frame 0');
  }
  if (pointerPath.some((sample) => sample.frameOffset > durationFrames)) {
    fail(`${path}.pointerPath`, 'frameOffset cannot exceed durationFrames');
  }
  return {
    id: string(source.id, `${path}.id`, 180),
    actor: source.actor === 'human' || source.actor === 'agent'
      ? source.actor
      : fail(`${path}.actor`, 'must be human or agent'),
    pieceId: string(source.pieceId, `${path}.pieceId`, 180),
    anchor: {
      row: integer(anchorSource.row, `${path}.anchor.row`, 0, BOARD_SIZE - 1),
      col: integer(anchorSource.col, `${path}.anchor.col`, 0, BOARD_SIZE - 1),
    },
    durationFrames,
    pointerPath,
  };
}

export function parseBlockPlacementSemanticAction(value: unknown, path = '$'): BlockPlacementSemanticAction {
  const source = record(value, path);
  for (const field of ['pieceId', 'anchor'] as const) {
    if (!(field in source)) fail(`${path}.${field}`, 'is required', 'MISSING_FIELD');
  }
  const anchorSource = record(source.anchor, `${path}.anchor`);
  return {
    pieceId: string(source.pieceId, `${path}.pieceId`, 180),
    anchor: {
      row: integer(anchorSource.row, `${path}.anchor.row`, 0, BOARD_SIZE - 1),
      col: integer(anchorSource.col, `${path}.anchor.col`, 0, BOARD_SIZE - 1),
    },
  };
}

function serialize<T>(value: T): unknown {
  return structuredClone(value);
}

export const blockPlacementConfigSchema: RuntimeSchema<BlockPlacementConfig> = {
  id: BLOCK_PLACEMENT_CONFIG_SCHEMA_ID,
  version: BLOCK_PLACEMENT_SCHEMA_VERSION,
  parse: parseBlockPlacementConfig,
  serialize,
};

export const blockPlacementStateSchema: RuntimeSchema<GameSnapshot> = {
  id: BLOCK_PLACEMENT_STATE_SCHEMA_ID,
  version: BLOCK_PLACEMENT_SCHEMA_VERSION,
  parse: parseBlockPlacementState,
  serialize,
};

export const blockPlacementActionSchema: RuntimeSchema<PlacementAction> = {
  id: BLOCK_PLACEMENT_ACTION_SCHEMA_ID,
  version: BLOCK_PLACEMENT_SCHEMA_VERSION,
  parse: parseBlockPlacementAction,
  serialize,
};

export const blockPlacementSemanticActionSchema: RuntimeSchema<BlockPlacementSemanticAction> = {
  id: BLOCK_PLACEMENT_SEMANTIC_ACTION_SCHEMA_ID,
  version: BLOCK_PLACEMENT_SCHEMA_VERSION,
  parse: parseBlockPlacementSemanticAction,
  serialize,
};

export const blockPlacementSchemas = {
  config: blockPlacementConfigSchema,
  state: blockPlacementStateSchema,
  action: blockPlacementSemanticActionSchema,
  replayAction: blockPlacementActionSchema,
};

export function defaultBlockPlacementConfig(): BlockPlacementConfig {
  return { board: createEmptyBoard() };
}
