import type { GameRuntime } from '../../game-runtime/contracts';
import {
  ELIMINATION_RESOLUTION_TRACE_CONTRACT,
  ELIMINATION_RESOLUTION_TRACE_VERSION,
  assertEliminationResolutionTrace,
  type EliminationEntityDelta,
  type EliminationResolutionStep,
} from '../../game-runtime/eliminationResolutionTrace';
import { GameRuntimeError } from '../../game-runtime/errors';
import { stableHash } from '../../headless/stableHash';
import { blockCrushFieldClock } from './fieldClock';
import type {
  BlockCrushDropAction,
  BlockCrushDropCell,
  BlockCrushDropConfig,
  BlockCrushDropCoordinate,
  BlockCrushDropPieceDefinition,
  BlockCrushDropResolution,
  BlockCrushDropState,
  BlockCrushDropTrayPiece,
} from './types';

function cellKey(cell: BlockCrushDropCoordinate): string {
  return `${cell.x}:${cell.y}`;
}

function sortCells(cells: BlockCrushDropCell[]): BlockCrushDropCell[] {
  return [...cells].sort(
    (left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id),
  );
}

function contactStackGroups(cells: BlockCrushDropCell[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const cell of cells) {
    const ids = groups.get(cellKey(cell)) ?? [];
    ids.push(cell.id);
    groups.set(cellKey(cell), ids);
  }
  return [...groups.values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => ids.sort())
    .sort((a, b) => a[0]!.localeCompare(b[0]!));
}

function advanceRisingField(
  state: BlockCrushDropState,
  impactTick: number,
): {
  cells: BlockCrushDropCell[];
  deltas: EliminationEntityDelta[];
  riseOffsetTicks: number;
  incomingRowIndex: number;
} {
  if (impactTick < state.tick) {
    throw new GameRuntimeError(
      'ILLEGAL_ACTION',
      `Impact tick ${impactTick} precedes current tick ${state.tick}.`,
      { details: { impactTick, currentTick: state.tick } },
    );
  }
  const { ticksPerCell, incomingRows } = state.config.rules.fieldMotion;
  const elapsedTicks =
    blockCrushFieldClock(state.config, impactTick) - blockCrushFieldClock(state.config, state.tick);
  const accumulatedTicks = state.riseOffsetTicks + elapsedTicks;
  const risenRows = Math.floor(accumulatedTicks / ticksPerCell);
  let incomingRowIndex = state.incomingRowIndex;
  let cells = state.cells.map((cell) => ({ ...cell }));
  for (let row = 0; row < risenRows; row += 1) {
    cells = cells
      .map((cell) => ({ ...cell, y: cell.y + 1 }))
      .filter((cell) => cell.y < state.config.rows);
    const pattern =
      incomingRows.length > 0
        ? incomingRows[incomingRowIndex % incomingRows.length]!
        : '0'.repeat(state.config.columns);
    [...pattern].forEach((value, x) => {
      if (value !== '1') return;
      cells.push({
        id: `rising-row-${incomingRowIndex}-${x}`,
        kind: state.config.presentation.tile,
        x,
        y: 0,
      });
    });
    incomingRowIndex += 1;
  }
  const beforeById = new Map(state.cells.map((cell) => [cell.id, cell]));
  const afterById = new Map(cells.map((cell) => [cell.id, cell]));
  const deltas: EliminationEntityDelta[] = [];
  for (const before of state.cells) {
    const after = afterById.get(before.id);
    if (!after) {
      deltas.push({ kind: 'remove', entityId: before.id, from: { x: before.x, y: before.y } });
    } else if (after.x !== before.x || after.y !== before.y) {
      deltas.push({
        kind: 'move',
        entityId: before.id,
        from: { x: before.x, y: before.y },
        to: { x: after.x, y: after.y },
      });
    }
  }
  for (const after of cells) {
    if (beforeById.has(after.id)) continue;
    deltas.push({
      kind: 'spawn',
      entityId: after.id,
      from: { x: after.x, y: -1 },
      to: { x: after.x, y: after.y },
    });
  }
  return {
    cells: sortCells(cells),
    deltas,
    riseOffsetTicks: accumulatedTicks % ticksPerCell,
    incomingRowIndex,
  };
}

function rotateCell(
  cell: BlockCrushDropCoordinate,
  quarterTurns: 0 | 1 | 2 | 3,
): BlockCrushDropCoordinate {
  switch (quarterTurns) {
    case 1:
      return { x: cell.y, y: -cell.x };
    case 2:
      return { x: -cell.x, y: -cell.y };
    case 3:
      return { x: -cell.y, y: cell.x };
    default:
      return { ...cell };
  }
}

export function rotatedShape(
  piece: BlockCrushDropPieceDefinition,
  quarterTurns: 0 | 1 | 2 | 3,
): BlockCrushDropCoordinate[] {
  const rotated = piece.cells.map((cell) => rotateCell(cell, quarterTurns));
  const minimumX = Math.min(...rotated.map((cell) => cell.x));
  const minimumY = Math.min(...rotated.map((cell) => cell.y));
  return rotated
    .map((cell) => ({ x: cell.x - minimumX, y: cell.y - minimumY }))
    .sort((left, right) => left.y - right.y || left.x - right.x);
}

function trayPieceForAction(
  state: BlockCrushDropState,
  action: BlockCrushDropAction,
): { piece: BlockCrushDropPieceDefinition; trayPiece: BlockCrushDropTrayPiece } {
  const batch = state.config.trayBatches[state.batchIndex];
  if (!batch || !state.remainingTraySlots.includes(action.traySlot)) {
    throw new GameRuntimeError(
      'ILLEGAL_ACTION',
      `Tray slot ${action.traySlot} is not available in batch ${state.batchIndex}.`,
      {
        details: {
          batchIndex: state.batchIndex,
          remainingTraySlots: state.remainingTraySlots,
          action,
        },
      },
    );
  }
  const trayPiece = batch[action.traySlot];
  if (!trayPiece) {
    throw new GameRuntimeError('ILLEGAL_ACTION', `Tray slot ${action.traySlot} is empty.`, {
      details: action,
    });
  }
  const piece = state.config.pieces.find((candidate) => candidate.id === trayPiece.pieceId);
  if (!piece) {
    throw new GameRuntimeError('ILLEGAL_ACTION', `Unknown piece ${trayPiece.pieceId}.`, {
      details: action,
    });
  }
  if (!piece.allowedQuarterTurns.includes(trayPiece.quarterTurns)) {
    throw new GameRuntimeError(
      'ILLEGAL_ACTION',
      `Piece ${piece.id} does not allow authored quarter turn ${trayPiece.quarterTurns}.`,
      { details: action },
    );
  }
  return { piece, trayPiece };
}

function dropCoordinates(
  state: BlockCrushDropState,
  piece: BlockCrushDropPieceDefinition,
  trayPiece: BlockCrushDropTrayPiece,
  action: BlockCrushDropAction,
): BlockCrushDropCoordinate[] | undefined {
  const shape = rotatedShape(piece, trayPiece.quarterTurns);
  const occupied = new Set(state.cells.map(cellKey));
  const withinColumns = shape.every((cell) => {
    const x = action.release.x + cell.x;
    return x >= 0 && x < state.config.columns;
  });
  if (!withinColumns) return undefined;

  const canOccupyDuringDrop = (anchorY: number) =>
    shape.every((cell) => {
      const coordinate = { x: action.release.x + cell.x, y: anchorY + cell.y };
      if (coordinate.y < 0) return false;
      if (coordinate.y >= state.config.rows) return true;
      return !occupied.has(cellKey(coordinate));
    });

  let anchorY = action.release.y;
  if (!canOccupyDuringDrop(anchorY)) return undefined;
  while (canOccupyDuringDrop(anchorY - 1)) anchorY -= 1;
  const coordinates = shape.map((cell) => ({
    x: action.release.x + cell.x,
    y: anchorY + cell.y,
  }));
  return coordinates.every((cell) => cell.y < state.config.rows) ? coordinates : undefined;
}

function authoredLanding(
  state: BlockCrushDropState,
  safe: BlockCrushDropCoordinate[],
): {
  coordinates: BlockCrushDropCoordinate[];
  replaced: BlockCrushDropCell[];
} {
  const override = state.config.rules.placementByTurn?.[state.turn];
  if (!override || override.landingInsetRows === undefined)
    return { coordinates: safe, replaced: [] };
  if (
    !Number.isInteger(override.landingInsetRows) ||
    override.landingInsetRows < 0 ||
    override.landingInsetRows > 2
  ) {
    throw new GameRuntimeError(
      'ILLEGAL_ACTION',
      `Placement turn ${state.turn} inset must be an integer from 0 to 2.`,
    );
  }
  const coordinates = safe.map((cell) => ({ x: cell.x, y: cell.y - override.landingInsetRows! }));
  if (
    coordinates.some(
      (cell) =>
        cell.x < 0 || cell.x >= state.config.columns || cell.y < 0 || cell.y >= state.config.rows,
    )
  ) {
    throw new GameRuntimeError(
      'ILLEGAL_ACTION',
      `Placement turn ${state.turn} inset leaves the board.`,
    );
  }
  const targets = new Set(coordinates.map(cellKey));
  const replaced = state.cells.filter((cell) => targets.has(cellKey(cell)));
  const expected = new Set(override.replaceCellIds ?? []);
  if (
    expected.size !== (override.replaceCellIds?.length ?? 0) ||
    replaced.length !== expected.size ||
    replaced.some((cell) => !expected.has(cell.id))
  ) {
    throw new GameRuntimeError(
      'ILLEGAL_ACTION',
      `Placement turn ${state.turn} replacement ids do not match the overlapped cells exactly.`,
      {
        details: { expected: [...expected], actual: replaced.map((cell) => cell.id) },
      },
    );
  }
  return { coordinates, replaced };
}

function legalActions(
  state: BlockCrushDropState,
  checkAuthoredPlacement = true,
): BlockCrushDropAction[] {
  if (state.status !== 'playing') return [];
  const batch = state.config.trayBatches[state.batchIndex];
  if (!batch) return [];
  const actions: BlockCrushDropAction[] = [];
  for (const traySlot of state.remainingTraySlots) {
    const trayPiece = batch[traySlot];
    const piece = state.config.pieces.find((candidate) => candidate.id === trayPiece?.pieceId);
    if (!trayPiece || !piece) continue;
    for (let x = 0; x < state.config.columns; x += 1) {
      const action = { traySlot, impactTick: state.tick, release: { x, y: state.config.rows } };
      const safe = dropCoordinates(state, piece, trayPiece, action);
      if (!safe) continue;
      if (checkAuthoredPlacement) {
        try {
          authoredLanding(state, safe);
        } catch {
          continue;
        }
      }
      actions.push(action);
    }
  }
  return actions;
}

function newlyCompletedHorizontalRows(
  state: BlockCrushDropState,
  cells: BlockCrushDropCell[],
  candidateRows: Set<number>,
): number[] {
  const counts = new Map<number, Set<number>>();
  for (const cell of cells) {
    const columns = counts.get(cell.y) ?? new Set<number>();
    columns.add(cell.x);
    counts.set(cell.y, columns);
  }
  return [...counts.entries()]
    .filter(([row, columns]) => candidateRows.has(row) && columns.size === state.config.columns)
    .map(([row]) => row)
    .sort((left, right) => left - right);
}

/**
 * Compact rows across cleared horizontal lines. This is a row-index transform,
 * not a support or rigid-body solve: holes and unsupported-looking silhouettes
 * remain, while every cell above a cleared row crosses exactly that row.
 */
function compactRowsAboveClears(
  cells: BlockCrushDropCell[],
  clearedRows: number[],
): {
  cells: BlockCrushDropCell[];
  deltas: EliminationEntityDelta[];
} {
  const orderedCuts = [...clearedRows].sort((left, right) => left - right);
  const deltas: EliminationEntityDelta[] = [];
  const compacted = cells.map((cell) => {
    const crossedCuts = orderedCuts.filter((row) => row < cell.y).length;
    if (crossedCuts === 0) return { ...cell };
    const moved = { ...cell, y: cell.y - crossedCuts };
    deltas.push({
      kind: 'move',
      entityId: cell.id,
      from: { x: cell.x, y: cell.y },
      to: { x: moved.x, y: moved.y },
    });
    return moved;
  });
  return { cells: sortCells(compacted), deltas };
}

export function hashBlockCrushDropState(state: BlockCrushDropState): string {
  return stableHash({
    config: state.config,
    cells: sortCells(state.cells),
    ...(state.mobileCellIds === undefined
      ? {}
      : { mobileCellIds: [...state.mobileCellIds].sort() }),
    ...(state.contactStackGroups === undefined
      ? {}
      : {
          contactStackGroups: state.contactStackGroups
            .map((ids) => [...ids].sort())
            .sort((a, b) => a[0]!.localeCompare(b[0]!)),
        }),
    batchIndex: state.batchIndex,
    remainingTraySlots: [...state.remainingTraySlots],
    tick: state.tick,
    riseOffsetTicks: state.riseOffsetTicks,
    incomingRowIndex: state.incomingRowIndex,
    turn: state.turn,
    score: state.score,
    combo: state.combo,
    clearEventCount: state.clearEventCount,
    status: state.status,
  });
}

/** Only this input's surviving cells fall. Terrain is a scrolling silhouette,
 * not a sand pile: dropping every historical cell would destroy its tunnels. */
function settleActiveCells(
  cells: BlockCrushDropCell[],
  activeIds: Set<string>,
  stopAtFirstRowColumns?: number,
) {
  if (stopAtFirstRowColumns !== undefined) {
    const movedCells = cells.map((cell) => ({ ...cell }));
    const active = movedCells.filter((cell) => activeIds.has(cell.id));
    const occupied = new Map<string, number>();
    for (const cell of movedCells)
      occupied.set(cellKey(cell), (occupied.get(cellKey(cell)) ?? 0) + 1);
    const completeRows = () => {
      const columns = new Map<number, Set<number>>();
      for (const cell of movedCells) {
        const xs = columns.get(cell.y) ?? new Set<number>();
        xs.add(cell.x);
        columns.set(cell.y, xs);
      }
      return new Set(
        [...columns].filter(([, xs]) => xs.size === stopAtFirstRowColumns).map(([row]) => row),
      );
    };
    // A cell moves at most once per pass. The finite bound follows from every
    // active y decreasing, and bottom-to-top ordering propagating vacancies.
    const limit = Math.max(0, ...active.map((cell) => cell.y)) + 1;
    for (let pass = 0; pass < limit; pass += 1) {
      const beforeRows = completeRows();
      let changed = false;
      active.sort((a, b) => a.y - b.y || a.x - b.x);
      for (const cell of active) {
        if (cell.y === 0 || occupied.has(cellKey({ x: cell.x, y: cell.y - 1 }))) continue;
        const previousKey = cellKey(cell),
          count = occupied.get(previousKey)!;
        if (count === 1) occupied.delete(previousKey);
        else occupied.set(previousKey, count - 1);
        cell.y -= 1;
        occupied.set(cellKey(cell), (occupied.get(cellKey(cell)) ?? 0) + 1);
        changed = true;
      }
      if (!changed || [...completeRows()].some((row) => !beforeRows.has(row))) break;
    }
    const originals = new Map(cells.map((cell) => [cell.id, cell]));
    const deltas: EliminationEntityDelta[] = active.flatMap((cell) => {
      const before = originals.get(cell.id)!;
      return before.y === cell.y
        ? []
        : [
            {
              kind: 'move' as const,
              entityId: cell.id,
              from: { x: before.x, y: before.y },
              to: { x: cell.x, y: cell.y },
            },
          ];
    });
    return { cells: sortCells(movedCells), deltas };
  }
  const occupied = new Set(cells.filter((cell) => !activeIds.has(cell.id)).map(cellKey));
  const deltas: EliminationEntityDelta[] = [];
  const settled = new Map<string, BlockCrushDropCell>();
  for (const cell of cells
    .filter((item) => activeIds.has(item.id))
    .sort((a, b) => a.y - b.y || a.x - b.x)) {
    let y = cell.y;
    while (y > 0 && !occupied.has(cellKey({ x: cell.x, y: y - 1 }))) y -= 1;
    const moved = { ...cell, y };
    settled.set(cell.id, moved);
    occupied.add(cellKey(moved));
    if (y !== cell.y)
      deltas.push({
        kind: 'move',
        entityId: cell.id,
        from: { x: cell.x, y: cell.y },
        to: { x: cell.x, y },
      });
  }
  return { cells: sortCells(cells.map((cell) => settled.get(cell.id) ?? cell)), deltas };
}

/** A cut releases only the touched placed pieces. Terrain and intact pieces
 * retain their cavities. Four-neighbour fragments each fall as a rigid body. */
function settleCutComponents(
  cells: BlockCrushDropCell[],
  cutGroups: Set<string>,
  topology: BlockCrushDropCell[],
) {
  const byPosition = new Map(topology.map((cell) => [cellKey(cell), cell]));
  const visited = new Set<string>();
  const components: BlockCrushDropCell[][] = [];
  for (const seed of topology) {
    if (!seed.groupId || !cutGroups.has(seed.groupId) || visited.has(seed.id)) continue;
    const component: BlockCrushDropCell[] = [],
      pending = [seed];
    visited.add(seed.id);
    while (pending.length) {
      const cell = pending.pop()!;
      component.push(cell);
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const neighbor = byPosition.get(cellKey({ x: cell.x + dx, y: cell.y + dy }));
        if (neighbor?.groupId === seed.groupId && !visited.has(neighbor.id)) {
          visited.add(neighbor.id);
          pending.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  const occupied = new Set(cells.map(cellKey));
  const result = new Map(cells.map((cell) => [cell.id, { ...cell }]));
  // Repeat because an upper fragment may initially be held by another fragment.
  let moved: boolean;
  do {
    moved = false;
    for (const component of components) {
      const current = component.map((cell) => result.get(cell.id)!);
      current.forEach((cell) => occupied.delete(cellKey(cell)));
      let distance = 0;
      while (
        current.every(
          (cell) =>
            cell.y - distance > 0 &&
            !occupied.has(cellKey({ x: cell.x, y: cell.y - distance - 1 })),
        )
      )
        distance++;
      for (const cell of current) {
        const next = { ...cell, y: cell.y - distance };
        result.set(cell.id, next);
        occupied.add(cellKey(next));
      }
      moved ||= distance > 0;
    }
  } while (moved);
  const deltas: EliminationEntityDelta[] = [];
  for (const cell of cells) {
    const next = result.get(cell.id)!;
    if (next.y !== cell.y)
      deltas.push({
        kind: 'move',
        entityId: cell.id,
        from: { x: cell.x, y: cell.y },
        to: { x: next.x, y: next.y },
      });
  }
  return { cells: sortCells([...result.values()]), deltas };
}

export const blockCrushDropRuntime: GameRuntime<
  BlockCrushDropConfig,
  BlockCrushDropState,
  BlockCrushDropAction,
  BlockCrushDropResolution
> = {
  createInitialState(config) {
    const firstBatch = config.trayBatches[0];
    return {
      config: structuredClone(config),
      cells: sortCells(structuredClone(config.initialCells)),
      ...(config.rules.settlement === 'retained-piece-cascade' ||
      config.rules.settlement === 'clear-frontier-cascade' ||
      config.rules.settlement === 'piece-frontier-cascade'
        ? { mobileCellIds: [] }
        : {}),
      batchIndex: 0,
      remainingTraySlots: firstBatch ? firstBatch.map((_, index) => index) : [],
      tick: 0,
      riseOffsetTicks: 0,
      incomingRowIndex: 0,
      turn: 0,
      score: 0,
      combo: 0,
      clearEventCount: 0,
      status: firstBatch ? 'playing' : 'won',
    };
  },
  hashState: hashBlockCrushDropState,
  listLegalActions: legalActions,
  resolve(state, action, context) {
    if (state.status !== 'playing') {
      throw new GameRuntimeError(
        'ILLEGAL_ACTION',
        `Cannot act while game status is ${state.status}.`,
        { details: action },
      );
    }
    const { piece, trayPiece } = trayPieceForAction(state, action);
    const fieldAdvance = advanceRisingField(state, action.impactTick);
    const advancedState: BlockCrushDropState = {
      ...state,
      cells: fieldAdvance.cells,
      tick: action.impactTick,
      riseOffsetTicks: fieldAdvance.riseOffsetTicks,
      incomingRowIndex: fieldAdvance.incomingRowIndex,
    };
    const safeCoordinates = dropCoordinates(advancedState, piece, trayPiece, action);
    if (!safeCoordinates) {
      throw new GameRuntimeError(
        'ILLEGAL_ACTION',
        'The released piece cannot settle inside the board.',
        { details: action },
      );
    }
    const { coordinates, replaced } = authoredLanding(advancedState, safeCoordinates);
    const replacedIds = new Set(replaced.map((cell) => cell.id));

    const actionId = `runtime-${context.stepIndex}-tick-${action.impactTick}-batch-${state.batchIndex}-slot-${action.traySlot}-x-${action.release.x}-y-${action.release.y}`;
    const beforeStateHash = hashBlockCrushDropState(state);
    const shape = rotatedShape(piece, trayPiece.quarterTurns);
    const committed = coordinates.map(
      (coordinate, index): BlockCrushDropCell => ({
        id: `${actionId}:cell:${index}`,
        kind: piece.kind,
        ...(state.config.rules.settlement === 'cut-component-cascade' ? { groupId: actionId } : {}),
        ...coordinate,
      }),
    );
    let cells = sortCells([
      ...advancedState.cells
        .filter((cell) => !replacedIds.has(cell.id))
        .map((cell) => ({ ...cell })),
      ...committed,
    ]);
    const commitDeltas = [
      ...fieldAdvance.deltas,
      ...replaced.map((cell) => ({
        kind: 'remove' as const,
        entityId: cell.id,
        from: { x: cell.x, y: cell.y },
      })),
      ...committed.map((cell, index) => ({
        kind: 'spawn' as const,
        entityId: cell.id,
        from: {
          x: action.release.x + shape[index]!.x,
          y: action.release.y + shape[index]!.y,
        },
        to: { x: cell.x, y: cell.y },
      })),
    ];
    const steps: EliminationResolutionStep[] = [
      {
        id: `${actionId}:commit`,
        phase: 'commit',
        cycleIndex: 0,
        entityIds: replaced.length
          ? [...new Set(commitDeltas.map((delta) => delta.entityId))]
          : commitDeltas.map((delta) => delta.entityId),
        deltas: commitDeltas,
        metrics: { score: committed.length * state.config.rules.scoring.placedCell },
        tags: [
          'tray-select',
          `tray-slot-${action.traySlot}`,
          'tray-drag',
          'release-pose',
          'vertical-fall',
          'impact',
          ...(action.impactTick > state.tick ? ['continuous-field-rise'] : []),
          ...(replaced.length ? ['authored-landing-inset', 'exact-cell-replacement'] : []),
        ],
      },
    ];

    let cycleIndex = 0;
    let scoreDelta = committed.length * state.config.rules.scoring.placedCell;
    let combo = 0;
    let candidateRows = new Set(committed.map((cell) => cell.y));
    const activeIds = new Set(committed.map((cell) => cell.id));
    let gravityPass = 0;
    const authoredSettlement = state.config.rules.settlementByTurn?.[state.turn];
    let fieldCursor = advancedState;
    const maxRowsPerClear =
      authoredSettlement?.maxRowsPerClear ??
      state.config.rules.maxRowsPerClear ??
      state.config.rows;
    const topDownRows = authoredSettlement?.clearRowOrder === 'top-down';
    const cascadeLimit =
      authoredSettlement?.cascadeLimit ?? state.config.rules.cascadeLimit ?? Infinity;
    const capBeforeGravity =
      (authoredSettlement?.cascadeLimitBoundary ?? state.config.rules.cascadeLimitBoundary) ===
      'before-gravity';
    const waveTerrain =
      (authoredSettlement?.frontierReleaseLifetime ??
        state.config.rules.frontierReleaseLifetime) === 'wave';
    const temporaryTerrainIds = new Set<string>();
    let frontierReleased = false;
    const applyActiveGravity = (afterClear = false) => {
      if (
        !state.config.rules.settlement ||
        state.config.rules.settlement === 'cut-component-cascade'
      )
        return false;
      const holdIds = new Set(
        afterClear ? (authoredSettlement?.holdCellIdsByCycle?.[cycleIndex] ?? []) : [],
      );
      for (const id of holdIds) {
        if (!cells.some((cell) => cell.id === id))
          throw new Error(
            `Settlement turn ${state.turn} cycle ${cycleIndex} cannot hold missing cell ${id}`,
          );
        if (!activeIds.has(id))
          throw new Error(
            `Settlement turn ${state.turn} cycle ${cycleIndex} cannot hold inactive cell ${id}`,
          );
      }
      const gravityIds = holdIds.size
        ? new Set([...activeIds].filter((id) => !holdIds.has(id)))
        : activeIds;
      const stopAtFirstRow =
        afterClear &&
        authoredSettlement?.gravityStopByCycle?.[cycleIndex] === 'first-completed-row';
      const settled = settleActiveCells(
        cells,
        gravityIds,
        stopAtFirstRow ? state.config.columns : undefined,
      );
      if (settled.deltas.length === 0) return false;
      cells = settled.cells;
      for (const delta of settled.deltas) if (delta.kind === 'move') candidateRows.add(delta.to.y);
      steps.push({
        id: `${actionId}:active-gravity:${gravityPass++}`,
        phase: 'reconfigure',
        cycleIndex,
        entityIds: settled.deltas.map((delta) => delta.entityId),
        deltas: settled.deltas,
        tags: ['active-cell-gravity', 'partial-piece-fall', 'grid-resnap'],
      });
      return true;
    };
    if (state.config.rules.settlement === 'split-settle-cascade') {
      candidateRows.clear();
      applyActiveGravity();
      for (const cell of cells) if (activeIds.has(cell.id)) candidateRows.add(cell.y);
    }
    while (true) {
      const completedRows = newlyCompletedHorizontalRows(advancedState, cells, candidateRows);
      const cycleRowLimit =
        authoredSettlement?.maxRowsPerClearByCycle?.[cycleIndex] ?? maxRowsPerClear;
      const rows = topDownRows
        ? completedRows.slice(-cycleRowLimit)
        : completedRows.slice(0, cycleRowLimit);
      if (rows.length === 0) {
        // A contact without a match can still release unsupported active cells.
        // Do this only before the first clear; later cycles already settled below.
        if (
          cycleIndex === 0 &&
          state.config.rules.settlement !== 'piece-frontier-cascade' &&
          state.config.rules.settlement !== 'retained-piece-cascade' &&
          state.config.rules.settlement !== 'clear-frontier-cascade' &&
          applyActiveGravity()
        )
          continue;
        break;
      }
      // A removed support row releases the upper region resting on it.
      // Terrain below the clear keeps its authored cavities; do not collapse the whole board.
      if (waveTerrain) {
        for (const id of temporaryTerrainIds) activeIds.delete(id);
        temporaryTerrainIds.clear();
      }
      if (
        state.config.rules.settlement === 'clear-frontier-cascade' &&
        ((!waveTerrain && frontierReleased) ||
          rows.length >= (state.config.rules.frontierReleaseMinRows ?? 1))
      ) {
        frontierReleased = true;
        const retainedIds = new Set(state.mobileCellIds ?? []);
        const retainedColumns =
          state.config.rules.frontierReleaseScope === 'retained-piece-columns'
            ? new Set(cells.filter((cell) => retainedIds.has(cell.id)).map((cell) => cell.x))
            : undefined;
        for (const cell of cells) {
          if (
            (!retainedColumns || retainedColumns.has(cell.x)) &&
            rows.some((row) => cell.y > row)
          ) {
            if (waveTerrain && !activeIds.has(cell.id) && !state.mobileCellIds?.includes(cell.id))
              temporaryTerrainIds.add(cell.id);
            activeIds.add(cell.id);
          }
        }
      }
      if (state.config.rules.settlement === 'piece-frontier-cascade') {
        const retained = new Set(state.mobileCellIds ?? []);
        for (const cell of cells)
          if (retained.has(cell.id) && rows.some((row) => cell.y > row)) activeIds.add(cell.id);
      }
      const removed = cells.filter((cell) => rows.includes(cell.y));
      steps.push({
        id: `${actionId}:detect:${cycleIndex}`,
        phase: 'detect',
        cycleIndex,
        entityIds: removed.map((cell) => cell.id),
        deltas: [],
        tags: ['newly-completed-horizontal-row'],
      });
      cells = cells.filter((cell) => !rows.includes(cell.y));
      const cycleScore =
        removed.length *
        state.config.rules.scoring.eliminatedCell *
        (1 + state.clearEventCount * state.config.rules.scoring.successiveClearMultiplier) *
        (1 + cycleIndex * state.config.rules.scoring.chainMultiplier);
      scoreDelta += cycleScore;
      combo = cycleIndex + 1;
      steps.push({
        id: `${actionId}:resolve:${cycleIndex}`,
        phase: 'resolve',
        cycleIndex,
        entityIds: removed.map((cell) => cell.id),
        deltas: removed.map((cell) => ({
          kind: 'remove' as const,
          entityId: cell.id,
          from: { x: cell.x, y: cell.y },
        })),
        metrics: { score: cycleScore, combo: 1 },
        tags: ['eliminate', 'newly-completed-horizontal-row', 'cleared-row-debris'],
      });
      const cutTopology = cells;
      const compacted = compactRowsAboveClears(cells, rows);
      cells = compacted.cells;
      steps.push({
        id: `${actionId}:reconfigure:${cycleIndex}`,
        phase: 'reconfigure',
        cycleIndex,
        entityIds: compacted.deltas.map((delta) => delta.entityId),
        deltas: compacted.deltas,
        tags: ['row-compaction', 'shift-above-cleared-row', 'grid-resnap'],
      });
      // A bounded top-down batch can leave a completed candidate below every
      // cleared row. It does not move, so motion destinations alone lose it.
      // Carry only already-eligible completed rows through the same row-index
      // transform; the next detection still rechecks occupancy after gravity.
      const deferredRows = completedRows
        .filter((row) => !rows.includes(row))
        .map((row) => row - rows.filter((clearedRow) => clearedRow < row).length);
      candidateRows = new Set([
        ...deferredRows,
        ...compacted.deltas.flatMap((delta) => (delta.kind === 'move' ? [delta.to.y] : [])),
      ]);
      // Previously released pieces can lose their support in a later turn.
      // Initial and incoming terrain keep their authored cavities.
      if (
        state.config.rules.settlement === 'retained-piece-cascade' ||
        state.config.rules.settlement === 'clear-frontier-cascade'
      ) {
        for (const id of state.mobileCellIds ?? []) activeIds.add(id);
      }
      for (const id of authoredSettlement?.releaseCellIdsByCycle?.[cycleIndex] ?? []) {
        if (!cells.some((cell) => cell.id === id))
          throw new Error(
            `Settlement turn ${state.turn} cycle ${cycleIndex} cannot release missing cell ${id}`,
          );
        if (waveTerrain && !activeIds.has(id) && !state.mobileCellIds?.includes(id))
          temporaryTerrainIds.add(id);
        activeIds.add(id);
      }
      let cycleFieldShift = 0;
      const fieldTick = authoredSettlement?.fieldTickByCycle?.[cycleIndex];
      if (fieldTick !== undefined) {
        const risen = advanceRisingField({ ...fieldCursor, cells }, fieldTick);
        cycleFieldShift = risen.incomingRowIndex - fieldCursor.incomingRowIndex;
        candidateRows = new Set([...candidateRows].map((row) => row + cycleFieldShift));
        cells = risen.cells;
        fieldCursor = {
          ...fieldCursor,
          cells,
          tick: fieldTick,
          riseOffsetTicks: risen.riseOffsetTicks,
          incomingRowIndex: risen.incomingRowIndex,
        };
        steps.push({
          id: `${actionId}:field-advance:${cycleIndex}`,
          phase: 'reconfigure',
          cycleIndex,
          entityIds: [...new Set(risen.deltas.map((delta) => delta.entityId))],
          deltas: risen.deltas,
          metrics: {
            objectives: {
              canonicalFieldTick: fieldTick,
              riseOffsetTicks: risen.riseOffsetTicks,
              incomingRowIndex: risen.incomingRowIndex,
            },
          },
          tags: [
            'continuous-field-rise',
            'cascade-field-advance',
            `canonical-field-tick-${fieldTick}`,
          ],
        });
      }
      if (state.config.rules.settlement === 'cut-component-cascade') {
        const cutGroups = new Set(removed.flatMap((cell) => (cell.groupId ? [cell.groupId] : [])));
        const settled = settleCutComponents(cells, cutGroups, cutTopology);
        cells = settled.cells;
        for (const delta of settled.deltas)
          if (delta.kind === 'move') candidateRows.add(delta.to.y);
        if (settled.deltas.length)
          steps.push({
            id: `${actionId}:cut-gravity:${cycleIndex}`,
            phase: 'reconfigure',
            cycleIndex,
            entityIds: settled.deltas.map((delta) => delta.entityId),
            deltas: settled.deltas,
            tags: ['cut-component-gravity', 'partial-piece-fall', 'grid-resnap'],
          });
      } else if (!(capBeforeGravity && cycleIndex + 1 >= cascadeLimit)) applyActiveGravity(true);
      const contacts = authoredSettlement?.contactStackByCycle?.[cycleIndex] ?? [];
      if (contacts.length && capBeforeGravity && cycleIndex + 1 >= cascadeLimit)
        throw new GameRuntimeError(
          'ILLEGAL_ACTION',
          `Settlement turn ${state.turn} cycle ${cycleIndex} cannot apply a contact after a before-gravity cascade boundary.`,
        );
      for (const [contactIndex, contact] of contacts.entries()) {
        const mover = cells.find((cell) => cell.id === contact.cellId);
        if (!mover || !activeIds.has(contact.cellId))
          throw new GameRuntimeError(
            'ILLEGAL_ACTION',
            `Settlement turn ${state.turn} cycle ${cycleIndex} contact mover must be an existing active cell.`,
            { details: { cellId: contact.cellId } },
          );
        const to = { x: mover.x, y: mover.y - contact.landingInsetRows };
        if (to.y < 0 || to.y >= state.config.rows)
          throw new GameRuntimeError(
            'ILLEGAL_ACTION',
            `Settlement turn ${state.turn} cycle ${cycleIndex} contact leaves the board.`,
          );
        if (
          cells.some(
            (cell) =>
              cell.id !== mover.id && cell.x === mover.x && cell.y > to.y && cell.y < mover.y,
          )
        )
          throw new GameRuntimeError(
            'ILLEGAL_ACTION',
            `Settlement turn ${state.turn} cycle ${cycleIndex} contact crosses an undeclared occupied row.`,
          );
        const covered = cells.filter(
          (cell) => cell.id !== mover.id && cell.x === to.x && cell.y === to.y,
        );
        const expected = new Set(contact.coveredCellIds);
        if (
          covered.length === 0 ||
          expected.size !== contact.coveredCellIds.length ||
          covered.length !== expected.size ||
          covered.some((cell) => !expected.has(cell.id))
        )
          throw new GameRuntimeError(
            'ILLEGAL_ACTION',
            `Settlement turn ${state.turn} cycle ${cycleIndex} contact covered ids must match the destination exactly.`,
            { details: { expected: [...expected], actual: covered.map((cell) => cell.id) } },
          );
        if (covered.some((cell) => !activeIds.has(cell.id)))
          throw new GameRuntimeError(
            'ILLEGAL_ACTION',
            `Settlement turn ${state.turn} cycle ${cycleIndex} contact may cover only active released cells.`,
          );
        cells = sortCells(cells.map((cell) => (cell.id === mover.id ? { ...cell, ...to } : cell)));
        candidateRows.add(to.y);
        steps.push({
          id: `${actionId}:contact-stack:${cycleIndex}:${contactIndex}`,
          phase: 'reconfigure',
          cycleIndex,
          entityIds: [mover.id, ...covered.map((cell) => cell.id)],
          deltas: [{ kind: 'move', entityId: mover.id, from: { x: mover.x, y: mover.y }, to }],
          tags: [
            'active-cell-gravity',
            'covered-contact-stack',
            'preserve-covered-identities',
            'grid-resnap',
          ],
        });
      }
      if (authoredSettlement?.adjacentBelowClearCandidate) {
        const adjacentRow = Math.min(...rows) - 1 + cycleFieldShift;
        const columns = new Set(
          cells.filter((cell) => cell.y === adjacentRow).map((cell) => cell.x),
        );
        if (adjacentRow >= 0 && columns.size === state.config.columns)
          candidateRows.add(adjacentRow);
      }
      steps.push({
        id: `${actionId}:settle:${cycleIndex}`,
        phase: 'settle',
        cycleIndex,
        entityIds: cells.map((cell) => cell.id),
        deltas: [],
        tags: ['stable', 'grid-resnap'],
      });
      cycleIndex += 1;
      if (cycleIndex >= cascadeLimit) break;
    }
    if (waveTerrain) for (const id of temporaryTerrainIds) activeIds.delete(id);
    if (
      authoredSettlement?.releaseCellIdsByCycle?.some(
        (ids, index) => index >= cycleIndex && ids.length > 0,
      )
    )
      throw new Error(`Settlement turn ${state.turn} references a clear cycle that did not occur`);
    if ((authoredSettlement?.maxRowsPerClearByCycle?.length ?? 0) > cycleIndex)
      throw new Error(`Settlement turn ${state.turn} references a clear cycle that did not occur`);
    if (
      authoredSettlement?.holdCellIdsByCycle?.some(
        (ids, index) => index >= cycleIndex && ids.length > 0,
      ) ||
      authoredSettlement?.gravityStopByCycle?.some(
        (mode, index) => index >= cycleIndex && mode !== 'settled',
      )
    )
      throw new Error(`Settlement turn ${state.turn} references a clear cycle that did not occur`);
    if (
      authoredSettlement?.contactStackByCycle?.some(
        (contacts, index) => index >= cycleIndex && contacts.length > 0,
      ) ||
      (authoredSettlement?.fieldTickByCycle?.length ?? 0) > cycleIndex
    )
      throw new GameRuntimeError(
        'ILLEGAL_ACTION',
        `Settlement turn ${state.turn} references a clear cycle that did not occur.`,
      );
    if (cycleIndex === 0) {
      steps.push({
        id: `${actionId}:settle:0`,
        phase: 'settle',
        cycleIndex: 0,
        entityIds: committed.map((cell) => cell.id),
        deltas: [],
        tags: ['stable'],
      });
    }

    let batchIndex = state.batchIndex;
    let remainingTraySlots = state.remainingTraySlots.filter((slot) => slot !== action.traySlot);
    if (remainingTraySlots.length === 0) {
      batchIndex += 1;
      remainingTraySlots = state.config.trayBatches[batchIndex]?.map((_, index) => index) ?? [];
    }
    const provisional: BlockCrushDropState = {
      config: state.config,
      cells,
      ...(state.config.rules.settlement === 'retained-piece-cascade' ||
      state.config.rules.settlement === 'clear-frontier-cascade' ||
      state.config.rules.settlement === 'piece-frontier-cascade'
        ? {
            mobileCellIds: cells
              .filter((cell) => activeIds.has(cell.id) || state.mobileCellIds?.includes(cell.id))
              .map((cell) => cell.id)
              .sort(),
          }
        : {}),
      ...(contactStackGroups(cells).length
        ? { contactStackGroups: contactStackGroups(cells) }
        : {}),
      batchIndex,
      remainingTraySlots,
      tick: fieldCursor.tick,
      riseOffsetTicks: fieldCursor.riseOffsetTicks,
      incomingRowIndex: fieldCursor.incomingRowIndex,
      turn: state.turn + 1,
      score: state.score + scoreDelta,
      combo,
      clearEventCount:
        state.clearEventCount +
        (state.config.rules.settlement ? cycleIndex : cycleIndex > 0 ? 1 : 0),
      status: batchIndex >= state.config.trayBatches.length ? 'won' : 'playing',
    };
    // Overrides apply at their action's authored impact tick. A future field rise
    // can make its exact IDs available, so current-tick override rejection alone
    // must not terminate the game before that action can be replayed.
    const after: BlockCrushDropState =
      provisional.status === 'playing' && legalActions(provisional, false).length === 0
        ? { ...provisional, status: 'game-over' }
        : provisional;
    steps.push({
      id: `${actionId}:outcome`,
      phase: 'outcome',
      cycleIndex: Math.max(cycleIndex - 1, 0),
      entityIds: [],
      deltas: [],
      metrics: { score: scoreDelta, combo, status: after.status },
      tags: [after.status],
    });
    const trace = assertEliminationResolutionTrace({
      contract: ELIMINATION_RESOLUTION_TRACE_CONTRACT,
      contractVersion: ELIMINATION_RESOLUTION_TRACE_VERSION,
      actionId,
      beforeStateHash,
      afterStateHash: hashBlockCrushDropState(after),
      steps,
    });
    return { before: state, after, action: structuredClone(action), trace };
  },
  stateAfter(resolution) {
    return resolution.after;
  },
};
