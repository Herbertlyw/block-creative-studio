import { cloneSnapshot, createProjectGame, diagnoseReplay } from './gameEngine';
import { parseStudioBundle, type StudioBundle } from './projectValidation';
import type { BoardState, PieceInstance, ProjectSpec, Take, TileColor } from './types';

const COLOR_CYCLE: TileColor[] = ['coral', 'amber', 'lime', 'cyan', 'blue', 'violet'];

function nextColor(color: TileColor): TileColor {
  const index = COLOR_CYCLE.indexOf(color);
  if (index < 0) return color;
  return COLOR_CYCLE[(index + 1) % COLOR_CYCLE.length] ?? color;
}

function remapBoard(board: BoardState): BoardState {
  return {
    ...board,
    cells: board.cells.map((row) => row.map((cell) => (cell ? nextColor(cell) : null))),
  };
}

function remapPiece(piece: PieceInstance): PieceInstance {
  return {
    ...piece,
    color: nextColor(piece.color),
    ...(piece.cellColors ? { cellColors: piece.cellColors.map((color) => nextColor(color)) } : {}),
  };
}

function remapTake(take: Take): Take {
  const initial = cloneSnapshot(take.initial);
  initial.board = remapBoard(initial.board);
  initial.pieces = initial.pieces.map(remapPiece);
  if (initial.fixedPieceSupply)
    initial.fixedPieceSupply = initial.fixedPieceSupply.map((batch) => batch.map(remapPiece));
  const diagnosis = diagnoseReplay(initial, take.actions);
  if (!diagnosis.ok) {
    throw new Error(`换色后第 ${diagnosis.index + 1} 步不再合法：${diagnosis.reason}`);
  }
  return {
    ...take,
    initial,
    actions: take.actions.map((action) => ({
      ...action,
      anchor: { ...action.anchor },
      pointerPath: action.pointerPath.map((sample) => ({ ...sample })),
    })),
  };
}

export function omitTakeAction(take: Take, actionIndex: number): Take {
  if (!Number.isInteger(actionIndex) || actionIndex < 0 || actionIndex >= take.actions.length) {
    throw new Error('要删除的动作序号不存在。');
  }
  const actions = take.actions.filter((_, index) => index !== actionIndex);
  const diagnosis = diagnoseReplay(take.initial, actions);
  if (!diagnosis.ok) {
    throw new Error(
      `删除第 ${actionIndex + 1} 步后，第 ${diagnosis.index + 1} 步不再合法：${diagnosis.reason}`,
    );
  }
  return {
    ...take,
    initial: cloneSnapshot(take.initial),
    actions: actions.map((action) => ({
      ...action,
      anchor: { ...action.anchor },
      pointerPath: action.pointerPath.map((sample) => ({ ...sample })),
    })),
  };
}

/** Rotates every tile color on the setup and on each Take initial state. Actions and timing stay put. */
export function rotateBundleColors(bundle: StudioBundle): StudioBundle {
  return {
    format: bundle.format,
    version: bundle.version,
    project: {
      ...bundle.project,
      setupBoard: remapBoard(bundle.project.setupBoard),
      setupPieces: bundle.project.setupPieces.map(remapPiece),
      ...(bundle.project.fixedPieceSupply
        ? {
            fixedPieceSupply: bundle.project.fixedPieceSupply.map((batch) => batch.map(remapPiece)),
          }
        : {}),
    },
    takes: bundle.takes.map(remapTake),
  };
}

/** Reject a setup edit atomically when any saved action becomes invalid. */
export function rebaseTakesForSetup(project: ProjectSpec, takes: Take[]): Take[] {
  const initial = createProjectGame(project);
  return takes.map((take) => {
    const diagnosis = diagnoseReplay(initial, take.actions);
    if (!diagnosis.ok) {
      throw new Error(
        `修改未应用：Take「${take.name}」的第 ${diagnosis.index + 1} 步（${diagnosis.actionId}）不再合法：${diagnosis.reason} 原工程和动作均已保留。`,
      );
    }
    return { ...take, initial: cloneSnapshot(initial), actions: structuredClone(take.actions) };
  });
}

/** Validate the whole edited take and preserve action identities and all untouched fields. */
export function replaceTakeActions(
  bundle: StudioBundle,
  takeId: string,
  actions: Take['actions'],
): Take {
  const take = bundle.takes.find((item) => item.id === takeId);
  if (!take) throw new Error('找不到要编辑的 Take。');
  const diagnosis = diagnoseReplay(take.initial, actions);
  if (!diagnosis.ok)
    throw new Error(
      `修改未应用：第 ${diagnosis.index + 1} 步（${diagnosis.actionId}）不再合法：${diagnosis.reason} 原动作已保留。`,
    );
  // Reuse the import validator for coordinate, duration and pointer path bounds.
  const parsed = parseStudioBundle({
    ...bundle,
    takes: bundle.takes.map((item) => (item.id === takeId ? { ...item, actions } : item)),
  });
  return parsed.takes.find((item) => item.id === takeId)!;
}
