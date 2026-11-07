import { parseDropReferenceCalibration } from './profiles/referenceCalibration';
import type { RuntimeSchema } from '../../game-runtime/contracts';
import { GameSchemaError } from '../../game-runtime/errors';
import {
  BLOCK_CRUSH_DROP_ACTION_SCHEMA_ID,
  BLOCK_CRUSH_DROP_CONFIG_SCHEMA_ID,
  BLOCK_CRUSH_DROP_SCHEMA_VERSION,
  BLOCK_CRUSH_DROP_STATE_SCHEMA_ID,
} from './manifest';
import type {
  BlockCrushDropAction,
  BlockCrushDropCell,
  BlockCrushDropConfig,
  BlockCrushDropPieceDefinition,
  BlockCrushDropState,
  BlockCrushDropTrayPiece,
} from './types';

function fail(path: string, detail: string): never {
  throw new GameSchemaError('INVALID_VALUE', `${path}: ${detail}`, { path });
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160) {
    fail(path, 'must be a string of 1–160 characters');
  }
  return value;
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail(path, `must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a finite number between ${minimum} and ${maximum}`);
  }
  return value;
}

function coordinate(value: unknown, path: string, columns: number, rows: number) {
  const source = record(value, path);
  return {
    x: integer(source.x, `${path}.x`, 0, columns - 1),
    y: integer(source.y, `${path}.y`, 0, rows - 1),
  };
}

function cell(value: unknown, path: string, columns: number, rows: number): BlockCrushDropCell {
  const source = record(value, path);
  return {
    id: string(source.id, `${path}.id`),
    kind: string(source.kind, `${path}.kind`),
    ...coordinate(source, path, columns, rows),
    ...(source.groupId !== undefined ? { groupId: string(source.groupId, `${path}.groupId`) } : {}),
  };
}

function piece(value: unknown, path: string): BlockCrushDropPieceDefinition {
  const source = record(value, path);
  if (!Array.isArray(source.cells) || source.cells.length === 0 || source.cells.length > 16) {
    fail(`${path}.cells`, 'must contain 1–16 coordinates');
  }
  const cells = source.cells.map((item, index) => {
    const coordinateSource = record(item, `${path}.cells[${index}]`);
    return {
      x: integer(coordinateSource.x, `${path}.cells[${index}].x`, -8, 8),
      y: integer(coordinateSource.y, `${path}.cells[${index}].y`, -8, 8),
    };
  });
  const uniqueCoordinates = new Set(cells.map((item) => `${item.x}:${item.y}`));
  if (uniqueCoordinates.size !== cells.length) fail(`${path}.cells`, 'coordinates must be unique');
  if (!Array.isArray(source.allowedQuarterTurns) || source.allowedQuarterTurns.length === 0) {
    fail(`${path}.allowedQuarterTurns`, 'must contain at least one quarter turn');
  }
  const allowedQuarterTurns = source.allowedQuarterTurns.map(
    (item, index) => integer(item, `${path}.allowedQuarterTurns[${index}]`, 0, 3) as 0 | 1 | 2 | 3,
  );
  if (new Set(allowedQuarterTurns).size !== allowedQuarterTurns.length) {
    fail(`${path}.allowedQuarterTurns`, 'quarter turns must be unique');
  }
  return {
    id: string(source.id, `${path}.id`),
    kind: string(source.kind, `${path}.kind`),
    cells,
    allowedQuarterTurns,
  };
}

function settlementOverride(
  value: unknown,
  path: string,
  rows: number,
): NonNullable<BlockCrushDropConfig['rules']['settlementByTurn']>[number] {
  const r = record(value, path),
    allowed = [
      'maxRowsPerClear',
      'maxRowsPerClearByCycle',
      'clearRowOrder',
      'cascadeLimit',
      'cascadeLimitBoundary',
      'frontierReleaseLifetime',
      'releaseCellIdsByCycle',
      'holdCellIdsByCycle',
      'gravityStopByCycle',
      'contactStackByCycle',
      'adjacentBelowClearCandidate',
      'fieldTickByCycle',
    ];
  for (const key of Object.keys(r))
    if (!allowed.includes(key)) fail(`${path}.${key}`, 'unknown settlement override');
  let maxRowsPerClearByCycle: number[] | undefined;
  if (r.maxRowsPerClearByCycle !== undefined) {
    if (!Array.isArray(r.maxRowsPerClearByCycle) || r.maxRowsPerClearByCycle.length > 64)
      fail(`${path}.maxRowsPerClearByCycle`, 'must contain at most 64 cycles');
    maxRowsPerClearByCycle = r.maxRowsPerClearByCycle.map((limit, i) =>
      integer(limit, `${path}.maxRowsPerClearByCycle.${i}`, 1, rows),
    );
  }
  if (
    r.clearRowOrder !== undefined &&
    r.clearRowOrder !== 'bottom-up' &&
    r.clearRowOrder !== 'top-down'
  )
    fail(`${path}.clearRowOrder`, 'must be bottom-up or top-down');
  if (
    r.cascadeLimitBoundary !== undefined &&
    !['after-gravity', 'before-gravity'].includes(String(r.cascadeLimitBoundary))
  )
    fail(`${path}.cascadeLimitBoundary`, 'must be after-gravity or before-gravity');
  if (
    r.frontierReleaseLifetime !== undefined &&
    !['persistent', 'wave'].includes(String(r.frontierReleaseLifetime))
  )
    fail(`${path}.frontierReleaseLifetime`, 'must be persistent or wave');
  const parseCycleIds = (
    key: 'releaseCellIdsByCycle' | 'holdCellIdsByCycle',
  ): string[][] | undefined => {
    const cycles = r[key];
    if (cycles === undefined) return undefined;
    if (!Array.isArray(cycles) || cycles.length > 64)
      fail(`${path}.${key}`, 'must contain at most 64 cycles');
    return cycles.map((v, i) => {
      if (!Array.isArray(v) || v.length > 2048)
        fail(`${path}.${key}.${i}`, 'must contain at most 2048 cell ids');
      const ids = v.map((id, j) => string(id, `${path}.${key}.${i}.${j}`));
      if (new Set(ids).size !== ids.length) fail(`${path}.${key}.${i}`, 'cell ids must be unique');
      return ids;
    });
  };
  const releaseCellIdsByCycle = parseCycleIds('releaseCellIdsByCycle'),
    holdCellIdsByCycle = parseCycleIds('holdCellIdsByCycle');
  let gravityStopByCycle: Array<'settled' | 'first-completed-row'> | undefined;
  if (r.gravityStopByCycle !== undefined) {
    if (!Array.isArray(r.gravityStopByCycle) || r.gravityStopByCycle.length > 64)
      fail(`${path}.gravityStopByCycle`, 'must contain at most 64 cycles');
    gravityStopByCycle = r.gravityStopByCycle.map((mode, i) => {
      if (mode !== 'settled' && mode !== 'first-completed-row')
        fail(`${path}.gravityStopByCycle.${i}`, 'must be settled or first-completed-row');
      return mode;
    });
  }
  let contactStackByCycle: NonNullable<
    BlockCrushDropConfig['rules']['settlementByTurn']
  >[number]['contactStackByCycle'];
  if (r.contactStackByCycle !== undefined) {
    if (!Array.isArray(r.contactStackByCycle) || r.contactStackByCycle.length > 64)
      fail(`${path}.contactStackByCycle`, 'must contain at most 64 cycles');
    contactStackByCycle = r.contactStackByCycle.map((cycle, i) => {
      if (!Array.isArray(cycle) || cycle.length > 2048)
        fail(`${path}.contactStackByCycle.${i}`, 'must contain at most 2048 contacts');
      const contacts = cycle.map((value, j) => {
        const contactPath = `${path}.contactStackByCycle.${i}.${j}`,
          contact = record(value, contactPath);
        for (const key of Object.keys(contact))
          if (!['cellId', 'landingInsetRows', 'coveredCellIds'].includes(key))
            fail(`${contactPath}.${key}`, 'unknown contact stack control');
        const cellId = string(contact.cellId, `${contactPath}.cellId`);
        if (
          !Array.isArray(contact.coveredCellIds) ||
          contact.coveredCellIds.length === 0 ||
          contact.coveredCellIds.length > 2048
        )
          fail(`${contactPath}.coveredCellIds`, 'must contain 1–2048 exact covered cell ids');
        const coveredCellIds = contact.coveredCellIds.map((id, k) =>
          string(id, `${contactPath}.coveredCellIds.${k}`),
        );
        if (
          new Set(coveredCellIds).size !== coveredCellIds.length ||
          coveredCellIds.includes(cellId)
        )
          fail(`${contactPath}.coveredCellIds`, 'must be unique and exclude the mover');
        return {
          cellId,
          landingInsetRows: integer(
            contact.landingInsetRows,
            `${contactPath}.landingInsetRows`,
            1,
            2,
          ) as 1 | 2,
          coveredCellIds,
        };
      });
      if (new Set(contacts.map((contact) => contact.cellId)).size !== contacts.length)
        fail(`${path}.contactStackByCycle.${i}`, 'mover ids must be unique within a cycle');
      return contacts;
    });
  }
  if (
    r.adjacentBelowClearCandidate !== undefined &&
    typeof r.adjacentBelowClearCandidate !== 'boolean'
  )
    fail(`${path}.adjacentBelowClearCandidate`, 'must be boolean');
  let fieldTickByCycle: number[] | undefined;
  if (r.fieldTickByCycle !== undefined) {
    if (!Array.isArray(r.fieldTickByCycle) || r.fieldTickByCycle.length > 64)
      fail(`${path}.fieldTickByCycle`, 'must contain at most 64 cycles');
    fieldTickByCycle = r.fieldTickByCycle.map((tick, i) =>
      integer(tick, `${path}.fieldTickByCycle.${i}`, 0, 100_000_000),
    );
    if (fieldTickByCycle.some((tick, i) => i > 0 && tick < fieldTickByCycle![i - 1]!))
      fail(`${path}.fieldTickByCycle`, 'ticks must be monotonic');
  }
  return {
    ...(r.maxRowsPerClear === undefined
      ? {}
      : { maxRowsPerClear: integer(r.maxRowsPerClear, `${path}.maxRowsPerClear`, 1, rows) }),
    ...(maxRowsPerClearByCycle?.length ? { maxRowsPerClearByCycle } : {}),
    ...(r.clearRowOrder === undefined
      ? {}
      : { clearRowOrder: r.clearRowOrder as 'bottom-up' | 'top-down' }),
    ...(r.cascadeLimit === undefined
      ? {}
      : { cascadeLimit: integer(r.cascadeLimit, `${path}.cascadeLimit`, 1, 64) }),
    ...(r.cascadeLimitBoundary === undefined
      ? {}
      : { cascadeLimitBoundary: r.cascadeLimitBoundary as 'after-gravity' | 'before-gravity' }),
    ...(r.frontierReleaseLifetime === undefined
      ? {}
      : { frontierReleaseLifetime: r.frontierReleaseLifetime as 'persistent' | 'wave' }),
    ...(releaseCellIdsByCycle ? { releaseCellIdsByCycle } : {}),
    ...(holdCellIdsByCycle ? { holdCellIdsByCycle } : {}),
    ...(gravityStopByCycle ? { gravityStopByCycle } : {}),
    ...(contactStackByCycle?.some((cycle) => cycle.length) ? { contactStackByCycle } : {}),
    ...(r.adjacentBelowClearCandidate === true ? { adjacentBelowClearCandidate: true } : {}),
    ...(fieldTickByCycle?.length ? { fieldTickByCycle } : {}),
  };
}

function placementOverride(
  value: unknown,
  path: string,
): NonNullable<BlockCrushDropConfig['rules']['placementByTurn']>[number] {
  const source = record(value, path);
  for (const key of Object.keys(source)) {
    if (key !== 'landingInsetRows' && key !== 'replaceCellIds')
      fail(`${path}.${key}`, 'unknown placement override');
  }
  if (Object.keys(source).length === 0) return {};
  const landingInsetRows = integer(source.landingInsetRows, `${path}.landingInsetRows`, 0, 2);
  if (!Array.isArray(source.replaceCellIds) || source.replaceCellIds.length > 16) {
    fail(`${path}.replaceCellIds`, 'must contain at most 16 cell ids');
  }
  const replaceCellIds = source.replaceCellIds.map((id, index) =>
    string(id, `${path}.replaceCellIds.${index}`),
  );
  if (new Set(replaceCellIds).size !== replaceCellIds.length)
    fail(`${path}.replaceCellIds`, 'cell ids must be unique');
  return landingInsetRows === 0 && replaceCellIds.length === 0
    ? {}
    : { landingInsetRows, replaceCellIds };
}

export function parseBlockCrushDropConfig(value: unknown, path = '$'): BlockCrushDropConfig {
  const source = record(value, path);
  const columns = integer(source.columns, `${path}.columns`, 2, 64);
  const rows = integer(source.rows, `${path}.rows`, 4, 64);
  if (!Array.isArray(source.initialCells)) fail(`${path}.initialCells`, 'must be an array');
  const initialCells = source.initialCells.map((item, index) =>
    cell(item, `${path}.initialCells[${index}]`, columns, rows),
  );
  if (new Set(initialCells.map((item) => item.id)).size !== initialCells.length) {
    fail(`${path}.initialCells`, 'cell ids must be unique');
  }
  if (new Set(initialCells.map((item) => `${item.x}:${item.y}`)).size !== initialCells.length) {
    fail(`${path}.initialCells`, 'cell coordinates must be unique');
  }
  if (!Array.isArray(source.pieces) || source.pieces.length === 0)
    fail(`${path}.pieces`, 'must be a non-empty array');
  const pieces = source.pieces.map((item, index) => piece(item, `${path}.pieces[${index}]`));
  if (new Set(pieces.map((item) => item.id)).size !== pieces.length)
    fail(`${path}.pieces`, 'piece ids must be unique');
  const pieceIds = new Set(pieces.map((item) => item.id));
  if (!Array.isArray(source.trayBatches) || source.trayBatches.length === 0) {
    fail(`${path}.trayBatches`, 'must be a non-empty array');
  }
  const trayBatches = source.trayBatches.map((batch, batchIndex): BlockCrushDropTrayPiece[] => {
    if (!Array.isArray(batch) || batch.length === 0 || batch.length > 3) {
      fail(`${path}.trayBatches[${batchIndex}]`, 'must contain 1–3 tray slots');
    }
    return batch.map((item, slotIndex) => {
      const trayPiece = record(item, `${path}.trayBatches[${batchIndex}][${slotIndex}]`);
      const pieceId = string(
        trayPiece.pieceId,
        `${path}.trayBatches[${batchIndex}][${slotIndex}].pieceId`,
      );
      if (!pieceIds.has(pieceId)) {
        fail(
          `${path}.trayBatches[${batchIndex}][${slotIndex}].pieceId`,
          `unknown piece ${pieceId}`,
        );
      }
      const quarterTurns = integer(
        trayPiece.quarterTurns,
        `${path}.trayBatches[${batchIndex}][${slotIndex}].quarterTurns`,
        0,
        3,
      ) as 0 | 1 | 2 | 3;
      const definition = pieces.find((candidate) => candidate.id === pieceId)!;
      if (!definition.allowedQuarterTurns.includes(quarterTurns)) {
        fail(
          `${path}.trayBatches[${batchIndex}][${slotIndex}].quarterTurns`,
          `piece ${pieceId} does not allow quarter turn ${quarterTurns}`,
        );
      }
      return { pieceId, quarterTurns };
    });
  });
  const rules = record(source.rules, `${path}.rules`);
  let placementByTurn: BlockCrushDropConfig['rules']['placementByTurn'];
  if (rules.placementByTurn !== undefined) {
    const maxTurns = Math.min(
      1000,
      trayBatches.reduce((count, batch) => count + batch.length, 0),
    );
    if (!Array.isArray(rules.placementByTurn) || rules.placementByTurn.length > maxTurns) {
      fail(`${path}.rules.placementByTurn`, `must contain at most ${maxTurns} supplied turns`);
    }
    const parsed = rules.placementByTurn.map((value, index) =>
      placementOverride(value, `${path}.rules.placementByTurn.${index}`),
    );
    // Omitted and explicitly empty controls preserve existing config/state identity.
    if (parsed.some((value) => value.landingInsetRows !== undefined)) placementByTurn = parsed;
  }
  if (rules.pieceSource !== 'three-slot-tray')
    fail(`${path}.rules.pieceSource`, 'must be three-slot-tray');
  if (rules.placement !== 'tray-drag-release-then-vertical-fall') {
    fail(`${path}.rules.placement`, 'must be tray-drag-release-then-vertical-fall');
  }
  if (rules.rotation !== 'fixed-from-tray')
    fail(`${path}.rules.rotation`, 'must be fixed-from-tray');
  if (rules.clear !== 'newly-completed-horizontal-rows') {
    fail(`${path}.rules.clear`, 'must be newly-completed-horizontal-rows');
  }
  if (rules.gravity !== 'vertical-after-release') {
    fail(`${path}.rules.gravity`, 'must be vertical-after-release');
  }
  if (
    rules.settlement !== undefined &&
    rules.settlement !== 'piece-frontier-cascade' &&
    rules.settlement !== 'contact-clear-cascade' &&
    rules.settlement !== 'split-settle-cascade' &&
    rules.settlement !== 'retained-piece-cascade' &&
    rules.settlement !== 'clear-frontier-cascade' &&
    rules.settlement !== 'cut-component-cascade'
  ) {
    fail(
      `${path}.rules.settlement`,
      'must be piece-frontier-cascade, contact-clear-cascade, split-settle-cascade, retained-piece-cascade, clear-frontier-cascade or cut-component-cascade',
    );
  }
  const settlementOptions = settlementOverride(
    Object.fromEntries(
      ['cascadeLimitBoundary', 'frontierReleaseLifetime']
        .filter((k) => rules[k] !== undefined)
        .map((k) => [k, rules[k]]),
    ),
    `${path}.rules`,
    rows,
  );
  let settlementByTurn: BlockCrushDropConfig['rules']['settlementByTurn'];
  if (rules.settlementByTurn !== undefined) {
    if (!Array.isArray(rules.settlementByTurn) || rules.settlementByTurn.length > 1000)
      fail(`${path}.rules.settlementByTurn`, 'must contain at most 1000 turns');
    if (!rules.settlement)
      fail(`${path}.rules.settlementByTurn`, 'requires a cascade settlement policy');
    settlementByTurn = rules.settlementByTurn.map((v, i) =>
      settlementOverride(v, `${path}.rules.settlementByTurn.${i}`, rows),
    );
  }
  if (
    (settlementOptions.frontierReleaseLifetime ||
      settlementByTurn?.some((v) => v.frontierReleaseLifetime)) &&
    rules.settlement !== 'clear-frontier-cascade'
  )
    fail(`${path}.rules.frontierReleaseLifetime`, 'requires clear-frontier-cascade');
  if (rules.frontierReleaseMinRows !== undefined && rules.settlement !== 'clear-frontier-cascade')
    fail(`${path}.rules.frontierReleaseMinRows`, 'requires clear-frontier-cascade');
  if (rules.frontierReleaseScope !== undefined) {
    if (rules.settlement !== 'clear-frontier-cascade')
      fail(`${path}.rules.frontierReleaseScope`, 'requires clear-frontier-cascade');
    if (
      rules.frontierReleaseScope !== 'all-columns' &&
      rules.frontierReleaseScope !== 'retained-piece-columns'
    )
      fail(`${path}.rules.frontierReleaseScope`, 'must be all-columns or retained-piece-columns');
  }
  const fieldMotion = record(rules.fieldMotion, `${path}.rules.fieldMotion`);
  if (fieldMotion.kind !== 'continuous-rise') {
    fail(`${path}.rules.fieldMotion.kind`, 'must be continuous-rise');
  }
  if (!Array.isArray(fieldMotion.incomingRows)) {
    fail(`${path}.rules.fieldMotion.incomingRows`, 'must be an array');
  }
  const incomingRows = fieldMotion.incomingRows.map((item, index) => {
    if (typeof item !== 'string' || item.length !== columns || /[^01]/.test(item)) {
      fail(
        `${path}.rules.fieldMotion.incomingRows[${index}]`,
        `must contain exactly ${columns} binary cells`,
      );
    }
    return item;
  });
  let pauses: BlockCrushDropConfig['rules']['fieldMotion']['pauses'];
  let rateChanges: BlockCrushDropConfig['rules']['fieldMotion']['rateChanges'];
  if (fieldMotion.rateChanges !== undefined) {
    if (!Array.isArray(fieldMotion.rateChanges) || fieldMotion.rateChanges.length > 1000)
      fail('fieldMotion.rateChanges', 'must be an array of at most 1000 rates');
    rateChanges = (fieldMotion.rateChanges as unknown[]).map((value) => {
      const rate = record(value, 'fieldMotion.rateChange');
      return {
        startTick: finite(rate.startTick, 'rateChange.startTick', 0, 108000),
        multiplier: finite(rate.multiplier, 'rateChange.multiplier', 0, 10),
      };
    });
    if (
      rateChanges.some(
        (rate, index) => index > 0 && rate.startTick <= rateChanges![index - 1]!.startTick,
      )
    )
      fail('fieldMotion.rateChanges', 'must have strictly increasing start ticks');
  }
  if (fieldMotion.pauses !== undefined) {
    if (!Array.isArray(fieldMotion.pauses) || fieldMotion.pauses.length > 1000)
      fail(`${path}.rules.fieldMotion.pauses`, 'must be an array of at most 1000 intervals');
    pauses = (fieldMotion.pauses as unknown[]).map((value, index) => {
      const range = record(value, `${path}.rules.fieldMotion.pauses[${index}]`);
      const startTick = finite(range.startTick, 'pause.startTick', 0, 108000);
      const endTick = finite(range.endTick, 'pause.endTick', 0, 108000);
      if (endTick <= startTick) fail('pause.endTick', 'must follow startTick');
      return { startTick, endTick };
    });
    if (pauses.some((range, index) => index > 0 && range.startTick < pauses![index - 1]!.endTick))
      fail('fieldMotion.pauses', 'must be ordered without overlap');
  }
  if (rules.collapse !== 'compact-rows-above-clear') {
    fail(`${path}.rules.collapse`, 'must be compact-rows-above-clear');
  }
  const scoring = record(rules.scoring, `${path}.rules.scoring`);
  const presentation = record(source.presentation, `${path}.presentation`);
  if (
    presentation.layout !== 'top-queue-full-height' &&
    presentation.layout !== 'side-tray-narrow'
  ) {
    fail(`${path}.presentation.layout`, 'must be top-queue-full-height or side-tray-narrow');
  }
  if (presentation.tile !== 'embossed-star' && presentation.tile !== 'ivory-pyramid') {
    fail(`${path}.presentation.tile`, 'must be embossed-star or ivory-pyramid');
  }
  if (presentation.hud !== 'timer-score-queue' && presentation.hud !== 'score-progress') {
    fail(`${path}.presentation.hud`, 'must be timer-score-queue or score-progress');
  }
  const referenceCalibration =
    presentation.referenceCalibration === undefined
      ? undefined
      : parseDropReferenceCalibration(presentation.referenceCalibration);
  if (referenceCalibration?.incomingCellColors?.some((row) => row.length !== columns))
    fail(
      `${path}.presentation.referenceCalibration.incomingCellColors`,
      `each row must contain exactly ${columns} colors`,
    );
  for (const item of [
    ...(referenceCalibration?.pieceTracks ?? []),
    ...(referenceCalibration?.queuePreviews ?? []),
  ]) {
    if (item.pieceId && !pieceIds.has(item.pieceId))
      fail(`${path}.presentation.referenceCalibration`, `unknown piece ${item.pieceId}`);
  }
  return {
    columns,
    rows,
    initialCells,
    pieces,
    trayBatches,
    rules: {
      pieceSource: 'three-slot-tray',
      placement: 'tray-drag-release-then-vertical-fall',
      rotation: 'fixed-from-tray',
      clear: 'newly-completed-horizontal-rows',
      gravity: 'vertical-after-release',
      ...(rules.settlement
        ? {
            settlement: rules.settlement as NonNullable<
              BlockCrushDropConfig['rules']['settlement']
            >,
          }
        : {}),
      ...settlementOptions,
      ...(settlementByTurn ? { settlementByTurn } : {}),
      ...(placementByTurn ? { placementByTurn } : {}),
      ...(rules.maxRowsPerClear === undefined
        ? {}
        : {
            maxRowsPerClear: integer(
              rules.maxRowsPerClear,
              `${path}.rules.maxRowsPerClear`,
              1,
              rows,
            ),
          }),
      ...(rules.cascadeLimit === undefined
        ? {}
        : { cascadeLimit: integer(rules.cascadeLimit, `${path}.rules.cascadeLimit`, 1, 64) }),
      ...(rules.frontierReleaseMinRows === undefined
        ? {}
        : {
            frontierReleaseMinRows: integer(
              rules.frontierReleaseMinRows,
              `${path}.rules.frontierReleaseMinRows`,
              1,
              rows,
            ),
          }),
      ...(rules.frontierReleaseScope === undefined
        ? {}
        : {
            frontierReleaseScope: rules.frontierReleaseScope as
              | 'all-columns'
              | 'retained-piece-columns',
          }),
      fieldMotion: {
        kind: 'continuous-rise',
        ticksPerCell: finite(
          fieldMotion.ticksPerCell,
          `${path}.rules.fieldMotion.ticksPerCell`,
          1,
          3_600,
        ),
        ...(pauses ? { pauses } : {}),
        ...(rateChanges ? { rateChanges } : {}),
        incomingRows,
      },
      collapse: 'compact-rows-above-clear',
      scoring: {
        placedCell: finite(scoring.placedCell, `${path}.rules.scoring.placedCell`, 0, 1_000_000),
        eliminatedCell: finite(
          scoring.eliminatedCell,
          `${path}.rules.scoring.eliminatedCell`,
          0,
          1_000_000,
        ),
        successiveClearMultiplier: finite(
          scoring.successiveClearMultiplier,
          `${path}.rules.scoring.successiveClearMultiplier`,
          0,
          100,
        ),
        chainMultiplier: finite(
          scoring.chainMultiplier,
          `${path}.rules.scoring.chainMultiplier`,
          0,
          100,
        ),
      },
    },
    presentation: {
      ...(referenceCalibration === undefined ? {} : { referenceCalibration }),
      layout: presentation.layout,
      tile: presentation.tile,
      hud: presentation.hud,
    } as BlockCrushDropConfig['presentation'],
  };
}

export function parseBlockCrushDropState(value: unknown, path = '$'): BlockCrushDropState {
  const source = record(value, path);
  const config = parseBlockCrushDropConfig(source.config, `${path}.config`);
  if (!Array.isArray(source.cells)) fail(`${path}.cells`, 'must be an array');
  const cells = source.cells.map((item, index) =>
    cell(item, `${path}.cells[${index}]`, config.columns, config.rows),
  );
  if (new Set(cells.map((item) => item.id)).size !== cells.length)
    fail(`${path}.cells`, 'cell ids must be unique');
  const turn = integer(source.turn, `${path}.turn`, 0, 1_000_000);
  const cellsAtCoordinate = new Map<string, string[]>();
  for (const item of cells) {
    const key = `${item.x}:${item.y}`,
      ids = cellsAtCoordinate.get(key) ?? [];
    ids.push(item.id);
    cellsAtCoordinate.set(key, ids);
  }
  const overlappingGroups = [...cellsAtCoordinate.values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => ids.sort());
  let contactStackGroups: string[][] | undefined;
  if (source.contactStackGroups !== undefined) {
    if (!Array.isArray(source.contactStackGroups) || source.contactStackGroups.length > 2048)
      fail(`${path}.contactStackGroups`, 'must contain at most 2048 contact groups');
    const groups = source.contactStackGroups.map((value, i) => {
      if (!Array.isArray(value) || value.length < 2 || value.length > 2048)
        fail(`${path}.contactStackGroups.${i}`, 'must contain 2–2048 real cell ids');
      const ids = value.map((id, j) => string(id, `${path}.contactStackGroups.${i}.${j}`)).sort();
      if (new Set(ids).size !== ids.length)
        fail(`${path}.contactStackGroups.${i}`, 'cell ids must be unique');
      return ids;
    });
    const declaredContacts =
      config.rules.settlementByTurn
        ?.slice(0, turn)
        .flatMap((override) => override.contactStackByCycle?.flat() ?? []) ?? [];
    for (const [i, ids] of groups.entries()) {
      if (
        !overlappingGroups.some(
          (actual) => actual.length === ids.length && actual.every((id, j) => id === ids[j]),
        )
      )
        fail(
          `${path}.contactStackGroups.${i}`,
          'must exactly describe one actual same-coordinate group',
        );
      if (
        !declaredContacts.some((contact) =>
          ids.every((id) => id === contact.cellId || contact.coveredCellIds.includes(id)),
        )
      )
        fail(
          `${path}.contactStackGroups.${i}`,
          'must match an explicit contact from an executed turn',
        );
    }
    if (
      new Set(groups.flat()).size !== groups.flat().length ||
      groups.length !== overlappingGroups.length
    )
      fail(`${path}.contactStackGroups`, 'must account for every overlap exactly once');
    if (groups.length) contactStackGroups = groups.sort((a, b) => a[0]!.localeCompare(b[0]!));
  } else if (overlappingGroups.length)
    fail(
      `${path}.cells`,
      'cell coordinates must be unique unless exact contactStackGroups are declared',
    );
  let mobileCellIds: string[] | undefined;
  if (
    config.rules.settlement === 'retained-piece-cascade' ||
    config.rules.settlement === 'clear-frontier-cascade' ||
    config.rules.settlement === 'piece-frontier-cascade'
  ) {
    if (!Array.isArray(source.mobileCellIds))
      fail(
        `${path}.mobileCellIds`,
        'retained-piece and clear-frontier cascade require an explicit list',
      );
    const present = new Set(cells.map((item) => item.id));
    mobileCellIds = source.mobileCellIds.map((item, index) =>
      string(item, `${path}.mobileCellIds[${index}]`),
    );
    if (
      new Set(mobileCellIds).size !== mobileCellIds.length ||
      mobileCellIds.some((id) => !present.has(id))
    ) {
      fail(`${path}.mobileCellIds`, 'must contain unique surviving cell ids');
    }
  } else if (source.mobileCellIds !== undefined) {
    fail(`${path}.mobileCellIds`, 'requires a retained-piece or clear-frontier cascade policy');
  }
  const status = source.status;
  if (status !== 'playing' && status !== 'won' && status !== 'game-over') {
    fail(`${path}.status`, 'must be playing, won, or game-over');
  }
  return {
    config,
    cells,
    ...(mobileCellIds === undefined ? {} : { mobileCellIds }),
    ...(contactStackGroups === undefined ? {} : { contactStackGroups }),
    batchIndex: integer(source.batchIndex, `${path}.batchIndex`, 0, config.trayBatches.length),
    remainingTraySlots: (() => {
      if (!Array.isArray(source.remainingTraySlots))
        fail(`${path}.remainingTraySlots`, 'must be an array');
      const activeLength = config.trayBatches[Number(source.batchIndex)]?.length ?? 0;
      const slots = source.remainingTraySlots.map((item, index) =>
        integer(item, `${path}.remainingTraySlots[${index}]`, 0, Math.max(0, activeLength - 1)),
      );
      if (new Set(slots).size !== slots.length)
        fail(`${path}.remainingTraySlots`, 'slots must be unique');
      return slots;
    })(),
    tick: integer(source.tick, `${path}.tick`, 0, 100_000_000),
    riseOffsetTicks: finite(
      source.riseOffsetTicks,
      `${path}.riseOffsetTicks`,
      0,
      config.rules.fieldMotion.ticksPerCell,
    ),
    incomingRowIndex: integer(source.incomingRowIndex, `${path}.incomingRowIndex`, 0, 100_000_000),
    turn,
    score: finite(source.score, `${path}.score`, 0, Number.MAX_SAFE_INTEGER),
    combo: integer(source.combo, `${path}.combo`, 0, 1_000_000),
    clearEventCount: integer(source.clearEventCount, `${path}.clearEventCount`, 0, 1_000_000),
    status,
  };
}

export function parseBlockCrushDropAction(value: unknown, path = '$'): BlockCrushDropAction {
  const source = record(value, path);
  const release = record(source.release, `${path}.release`);
  return {
    traySlot: integer(source.traySlot, `${path}.traySlot`, 0, 2),
    impactTick: integer(source.impactTick, `${path}.impactTick`, 0, 100_000_000),
    release: {
      x: integer(release.x, `${path}.release.x`, 0, 63),
      y: integer(release.y, `${path}.release.y`, 0, 64),
    },
  };
}

function serialize<T>(value: T): unknown {
  return structuredClone(value);
}

export const blockCrushDropConfigSchema: RuntimeSchema<BlockCrushDropConfig> = {
  id: BLOCK_CRUSH_DROP_CONFIG_SCHEMA_ID,
  version: BLOCK_CRUSH_DROP_SCHEMA_VERSION,
  parse: parseBlockCrushDropConfig,
  serialize,
};

export const blockCrushDropStateSchema: RuntimeSchema<BlockCrushDropState> = {
  id: BLOCK_CRUSH_DROP_STATE_SCHEMA_ID,
  version: BLOCK_CRUSH_DROP_SCHEMA_VERSION,
  parse: parseBlockCrushDropState,
  serialize,
};

export const blockCrushDropActionSchema: RuntimeSchema<BlockCrushDropAction> = {
  id: BLOCK_CRUSH_DROP_ACTION_SCHEMA_ID,
  version: BLOCK_CRUSH_DROP_SCHEMA_VERSION,
  parse: parseBlockCrushDropAction,
  serialize,
};

export const blockCrushDropSchemas = {
  config: blockCrushDropConfigSchema,
  state: blockCrushDropStateSchema,
  action: blockCrushDropActionSchema,
};
