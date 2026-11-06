import {
  buildBBFixedSupply,
  createBBProject,
} from '../games/block-placement/authoring/createProject';
import { blockPlacementDefinition } from '../nativeReference/games/block-placement/definition';
import {
  chooseGreedyMove,
  createGame,
  createPieceSet,
  hasAnyLegalMove,
} from '../nativeReference/games/block-placement/runtime/gameEngine';
import { parseBlockPlacementConfig } from '../nativeReference/games/block-placement/schemas';
import {
  GAME_REPLAY_CONTRACT,
  GAME_REPLAY_CONTRACT_VERSION,
  splitPointerPlacement,
} from '../nativeReference/game-runtime/replayEnvelope';
import { BLOCK_PLACEMENT_SEMANTIC_ACTION_SCHEMA_ID } from '../nativeReference/games/block-placement/manifest';
import { TILE_COLORS } from '../nativeReference/games/block-placement/runtime/shapes';
import type { GameSnapshot } from '../nativeReference/domain/types';
import { createBBWorkPackage, openBBWorkPackage, type BBWorkPackage } from './bbWorkPackage';
import { hasReferenceCalibration } from './hasReferenceCalibration';

/** New works use the reference BB runtime: seven colors, seeded pieces monochrome. */
export async function createNativeWork(seed = 41782): Promise<BBWorkPackage> {
  const document = createBBProject({
    projectId: `bb-${seed}`,
    name: '新 BB 作品',
    seed,
    width: 512,
    height: 864,
    fps: 30,
  });
  return createBBWorkPackage(document, null, null);
}
function assertEditable(work: BBWorkPackage) {
  if (work.pointer || work.source || hasReferenceCalibration(work.project))
    throw new Error(
      '该作品包含已绑定的来源、指针或校准轨道；请在观察编辑器重新标注，不能直接改动 Take。',
    );
}
function replay(project: any, take: any): GameSnapshot {
  let state = structuredClone(project.game.initialState.data) as GameSnapshot;
  for (const [index, item] of take.actions.entries()) {
    try {
      state = blockPlacementDefinition.runtime.stateAfter(
        blockPlacementDefinition.runtime.resolve(state, item.action, {
          seed: take.seed,
          stepIndex: index,
        }),
      );
    } catch (error) {
      throw new Error(
        `Take ${take.takeId} 第 ${index + 1} 步 ${item.id} 不合法：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return state;
}
export function nativeTakeState(work: BBWorkPackage, takeId: string): GameSnapshot {
  const doc = work.project as any,
    take = doc.takes.find((item: any) => item.takeId === takeId);
  if (!take) throw new Error(`找不到 Take ${takeId}。`);
  return replay(doc, take);
}
/** Edit the shared initial board, then revalidate every take and package dependency. */
export async function setNativeWorkBoardCell(
  work: BBWorkPackage,
  row: number,
  col: number,
  color: string | null,
): Promise<BBWorkPackage> {
  const original = await openBBWorkPackage(work);
  assertEditable(original);
  const { editNativeBoardCell } = await import('./editNativeDocument');
  const edited = JSON.parse(editNativeBoardCell(JSON.stringify(original.project), row, col, color));
  const { updateBBWorkPackageProject } = await import('./bbWorkPackage');
  return updateBBWorkPackageProject(original, edited);
}
/** Replace the initial board atomically and revalidate all existing takes. */
export async function setNativeBoardPreset(
  work: BBWorkPackage,
  presetId: string,
): Promise<BBWorkPackage> {
  const original = await openBBWorkPackage(work);
  assertEditable(original);
  const source = original.project as any;
  const { assertGameplayEditSupported } = await import('./editNativeAction');
  assertGameplayEditSupported(source);
  const { BOARD_PRESETS } = await import(
    '../nativeReference/games/block-placement/runtime/boardPresets'
  );
  const preset = BOARD_PRESETS.find((item) => item.id === presetId);
  if (!preset) throw new Error('未知棋盘预设。');
  const initial = source.game.initialState.data;
  if (
    JSON.stringify(source.game.config.data.board) !== JSON.stringify(initial.board) ||
    initial.turn !== 0 ||
    initial.setIndex !== 0 ||
    initial.score !== 0 ||
    initial.combo !== 0 ||
    initial.status !== 'playing' ||
    initial.pieces.some((piece: any) => piece.used)
  )
    throw new Error('初始棋盘与配置不一致或含已进行回合，原作品保留。');
  const edited = structuredClone(source),
    board = preset.create();
  edited.game.config.data.board = structuredClone(board);
  edited.game.initialState.data.board = structuredClone(board);
  if (!hasAnyLegalMove(edited.game.initialState.data))
    throw new Error('棋盘预设没有合法放置，原作品保留。');
  edited.game.initialState.stateHash = blockPlacementDefinition.runtime.hashState(
    edited.game.initialState.data,
  );
  for (const take of edited.takes) {
    take.initialStateHash = edited.game.initialState.stateHash;
    replay(edited, take);
  }
  return validateEditedSupply(edited);
}
export async function createNativeTake(
  work: BBWorkPackage,
  takeId: string,
): Promise<BBWorkPackage> {
  await openBBWorkPackage(work);
  assertEditable(work);
  const doc = structuredClone(work.project) as any;
  if (!/^[\w-]{1,80}$/.test(takeId) || doc.takes.some((item: any) => item.takeId === takeId))
    throw new Error('Take ID 须为不重复的字母、数字、下划线或横线。');
  doc.takes.push({
    contract: GAME_REPLAY_CONTRACT,
    contractVersion: GAME_REPLAY_CONTRACT_VERSION,
    gameId: doc.game.game.id,
    moduleVersion: doc.game.game.moduleVersion,
    takeId,
    initialStateHash: doc.game.initialState.stateHash,
    seed: doc.game.initialState.data.seed,
    actions: [],
    interactions: [],
  });
  return createBBWorkPackage(doc, null, null);
}
export async function deleteNativeTake(
  work: BBWorkPackage,
  takeId: string,
): Promise<BBWorkPackage> {
  await openBBWorkPackage(work);
  assertEditable(work);
  const doc = structuredClone(work.project) as any;
  const index = doc.takes.findIndex((item: any) => item.takeId === takeId);
  if (index < 0) throw new Error(`找不到 Take ${takeId}。`);
  doc.takes.splice(index, 1);
  return createBBWorkPackage(doc, null, null);
}
/** Remove only the selected Take's last action and revalidate the work. */
export async function undoNativeMove(work: BBWorkPackage, takeId: string): Promise<BBWorkPackage> {
  const original = await openBBWorkPackage(work);
  assertEditable(original);
  const doc = original.project as any;
  const index = doc.takes.findIndex((take: any) => take.takeId === takeId);
  if (index < 0) throw new Error(`找不到 Take ${takeId}。`);
  const last = doc.takes[index].actions.length - 1;
  if (last < 0) throw new Error(`Take ${takeId} 没有可撤销的动作。`);
  const { deleteNativeAction } = await import('./editNativeDocument');
  const edited = JSON.parse(deleteNativeAction(JSON.stringify(doc), index, last));
  const { updateBBWorkPackageProject } = await import('./bbWorkPackage');
  return updateBBWorkPackageProject(original, edited);
}
export async function appendNativeMove(
  work: BBWorkPackage,
  takeId: string,
  pieceId: string,
  row: number,
  col: number,
  actor: 'human' | 'agent',
  path: Array<{ frameOffset: number; x: number; y: number }>,
  durationFrames = 15,
): Promise<BBWorkPackage> {
  await openBBWorkPackage(work);
  assertEditable(work);
  const doc = structuredClone(work.project) as any,
    take = doc.takes.find((item: any) => item.takeId === takeId);
  if (!take) throw new Error(`找不到 Take ${takeId}。`);
  const state = replay(doc, take),
    index = take.actions.length;
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    !Number.isInteger(durationFrames) ||
    durationFrames < 1 ||
    path.length < 2 ||
    path[0]?.frameOffset !== 0 ||
    path.at(-1)?.frameOffset !== durationFrames
  )
    throw new Error('动作目标、帧长或路径无效。');
  let last = -1;
  for (const point of path) {
    if (
      !Number.isInteger(point.frameOffset) ||
      point.frameOffset <= last ||
      point.frameOffset > durationFrames ||
      ![point.x, point.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
    )
      throw new Error('路径点须按帧递增且坐标在 0–1 内。');
    last = point.frameOffset;
  }
  const action = { pieceId, anchor: { row, col } };
  try {
    blockPlacementDefinition.runtime.resolve(state, action, { seed: take.seed, stepIndex: index });
  } catch {
    throw new Error(`Take ${takeId} 第 ${index + 1} 步：候选 ${pieceId} 不能放在 ${row},${col}。`);
  }
  const split = splitPointerPlacement({
    id: `${takeId}-action-${index + 1}`,
    actor,
    pieceId,
    anchor: { row, col },
    durationFrames,
    pointerPath: path,
    actionSchemaId: BLOCK_PLACEMENT_SEMANTIC_ACTION_SCHEMA_ID,
  });
  take.actions.push(split.semantic);
  take.interactions.push(split.interaction);
  return createBBWorkPackage(doc, null, null);
}
/** Native engine's deterministic legal-move heuristic; no public-project conversion. */
export async function generateNativeMachineTake(
  work: BBWorkPackage,
  takeId: string,
  count: number,
): Promise<BBWorkPackage> {
  if (!Number.isInteger(count) || count < 1 || count > 100)
    throw new Error('机器动作数须为 1–100。');
  let result = await createNativeTake(work, takeId);
  for (let i = 0; i < count; i++) {
    const state = nativeTakeState(result, takeId),
      move = chooseGreedyMove(state);
    if (!move) break;
    const piece = state.pieces.find((item) => item.id === move.pieceId);
    if (!piece) throw new Error('机器候选不存在。');
    const path = [
      { frameOffset: 0, x: 0.27 + piece.slotIndex * 0.23, y: 0.88 },
      {
        frameOffset: 15,
        x: 0.16 + (move.anchor.col / 7) * 0.68,
        y: 0.18 + (move.anchor.row / 7) * 0.5,
      },
    ];
    result = await appendNativeMove(
      result,
      takeId,
      move.pieceId,
      move.anchor.row,
      move.anchor.col,
      'agent',
      path,
    );
  }
  if (!(result.project as any).takes.find((item: any) => item.takeId === takeId)?.actions.length)
    throw new Error('没有可用的合法机器动作。');
  return result;
}

/** Set fixed rounds and revalidate all existing takes before saving. */
export async function setNativeFixedSupply(
  work: BBWorkPackage,
  rounds: unknown,
): Promise<BBWorkPackage> {
  return setNativeSupply(work, { fixedSupply: rounds });
}

/** Restore the native deterministic seed rule, including the first rack. */
export async function setNativeSeededSupply(work: BBWorkPackage): Promise<BBWorkPackage> {
  const initial = (work.project as any).game?.initialState?.data;
  if (!initial || !Number.isInteger(initial.seed))
    throw new Error('作品的种子无效，无法生成候选。');
  return setNativeSupply(work, { supplyMode: 'seeded', pieces: createPieceSet(initial.seed, 0) });
}

/** Change the seed transactionally, retaining fixed rounds or regenerating the seeded first rack. */
export async function setNativeSeed(work: BBWorkPackage, seed: number): Promise<BBWorkPackage> {
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)
    throw new Error('种子须为 0–2147483647 的整数。');
  const original = await openBBWorkPackage(work);
  assertEditable(original);
  const source = original.project as any;
  const { assertGameplayEditSupported } = await import('./editNativeAction');
  assertGameplayEditSupported(source);
  const initial = source.game.initialState.data;
  const allowed = [
    'board',
    'pieces',
    'fixedPieceSupply',
    'clearAxes',
    'clearTrigger',
    'referenceClearRules',
    'seed',
    'setIndex',
    'turn',
    'score',
    'combo',
    'status',
    'supplyExhausted',
  ];
  if (
    !Object.keys(initial).every((key) => allowed.includes(key)) ||
    initial.turn !== 0 ||
    initial.score !== 0 ||
    initial.combo !== 0 ||
    initial.setIndex !== 0 ||
    initial.status !== 'playing' ||
    initial.supplyExhausted === true ||
    initial.pieces.some((piece: any) => piece.used)
  )
    throw new Error('初始状态包含无法安全重建的内容，原作品保留。');
  const config = source.game.config.data;
  if (
    !Object.keys(config).every((key) =>
      [
        'board',
        'pieces',
        'fixedPieceSupply',
        'clearAxes',
        'clearTrigger',
        'referenceClearRules',
      ].includes(key),
    )
  )
    throw new Error('供给数据包含不能安全修改的扩展，原作品保留。');
  const pieces = initial.fixedPieceSupply
    ? structuredClone(initial.fixedPieceSupply[0])
    : createPieceSet(seed, 0);
  const state = createGame(
    initial.board,
    seed,
    pieces,
    initial.fixedPieceSupply,
    initial.clearAxes,
    initial.clearTrigger,
    initial.referenceClearRules,
  );
  if (state.status !== 'playing') throw new Error('种子产生的候选没有合法放置，原作品保留。');
  const edited = structuredClone(source);
  edited.game.config.data.pieces = structuredClone(pieces);
  edited.game.initialState.data = state;
  edited.game.initialState.stateHash = blockPlacementDefinition.runtime.hashState(state);
  for (const take of edited.takes) {
    take.seed = seed;
    take.initialStateHash = edited.game.initialState.stateHash;
    replay(edited, take);
  }
  return validateEditedSupply(edited);
}

/** Rotate all authored setup colors; later seeded rounds retain the seed rule. */
export async function rotateNativeSetupColors(work: BBWorkPackage): Promise<BBWorkPackage> {
  const original = await openBBWorkPackage(work);
  assertEditable(original);
  const source = original.project as any;
  const { assertGameplayEditSupported } = await import('./editNativeAction');
  assertGameplayEditSupported(source);
  const config = source.game.config.data,
    initial = source.game.initialState.data;
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (
    !equal(config.board, initial.board) ||
    !equal(config.pieces, initial.pieces) ||
    !equal(config.fixedPieceSupply, initial.fixedPieceSupply) ||
    initial.turn !== 0 ||
    initial.setIndex !== 0 ||
    initial.score !== 0 ||
    initial.combo !== 0 ||
    initial.status !== 'playing' ||
    initial.supplyExhausted === true ||
    initial.pieces.some((piece: any) => piece.used)
  )
    throw new Error('初始棋盘或供给副本不一致，不能安全轮换颜色。');
  const allowedConfig = [
    'board',
    'pieces',
    'fixedPieceSupply',
    'clearAxes',
    'clearTrigger',
    'referenceClearRules',
  ];
  const allowedState = [
    ...allowedConfig,
    'seed',
    'setIndex',
    'turn',
    'score',
    'combo',
    'status',
    'supplyExhausted',
  ];
  if (
    !Object.keys(config).every((key) => allowedConfig.includes(key)) ||
    !Object.keys(initial).every((key) => allowedState.includes(key))
  )
    throw new Error('玩法设置包含未知字段，原作品保留。');
  const colors = TILE_COLORS as readonly string[];
  const rotate = (color: string) => {
    const i = colors.indexOf(color);
    if (i < 0) throw new Error(`不支持的方块颜色：${color}`);
    return colors[(i + 1) % colors.length]!;
  };
  const board = structuredClone(initial.board);
  board.cells = board.cells.map((row: Array<string | null>) =>
    row.map((color) => (color === null ? null : rotate(color))),
  );
  const mapPiece = (piece: any) => ({
    ...piece,
    color: rotate(piece.color),
    ...(piece.cellColors ? { cellColors: piece.cellColors.map(rotate) } : {}),
  });
  const fixed = initial.fixedPieceSupply?.map((round: any[]) => round.map(mapPiece));
  const pieces = fixed ? structuredClone(fixed[0]) : initial.pieces.map(mapPiece);
  const state = createGame(
    board,
    initial.seed,
    pieces,
    fixed,
    initial.clearAxes,
    initial.clearTrigger,
    initial.referenceClearRules,
  );
  const edited = structuredClone(source);
  edited.game.config.data.board = structuredClone(board);
  edited.game.config.data.pieces = structuredClone(pieces);
  if (fixed) edited.game.config.data.fixedPieceSupply = structuredClone(fixed);
  edited.game.initialState.data = state;
  edited.game.initialState.stateHash = blockPlacementDefinition.runtime.hashState(state);
  for (const take of edited.takes) {
    take.initialStateHash = edited.game.initialState.stateHash;
    replay(edited, take);
  }
  return validateEditedSupply(edited);
}

async function setNativeSupply(
  work: BBWorkPackage,
  options: Record<string, unknown>,
): Promise<BBWorkPackage> {
  await openBBWorkPackage(work);
  assertEditable(work);
  const source = work.project as any;
  const { assertGameplayEditSupported } = await import('./editNativeAction');
  assertGameplayEditSupported(source);
  const keys = (obj: any, allowed: string[]) =>
    Object.keys(obj ?? {}).every((k) => allowed.includes(k));
  if (
    !keys(source.game.config.data, [
      'board',
      'pieces',
      'fixedPieceSupply',
      'clearAxes',
      'clearTrigger',
      'referenceClearRules',
    ]) ||
    !keys(source.game.initialState.data, [
      'board',
      'pieces',
      'fixedPieceSupply',
      'clearAxes',
      'clearTrigger',
      'referenceClearRules',
      'seed',
      'setIndex',
      'turn',
      'score',
      'combo',
      'status',
      'supplyExhausted',
    ])
  )
    throw new Error('供给数据包含不能安全修改的扩展。');
  if (
    source.game.initialState.data.turn !== 0 ||
    source.game.initialState.data.setIndex !== 0 ||
    source.game.initialState.data.score !== 0 ||
    source.game.initialState.data.combo !== 0 ||
    source.game.initialState.data.status !== 'playing' ||
    source.game.initialState.data.supplyExhausted === true ||
    source.game.initialState.data.pieces.some((piece: any) => piece.used)
  )
    throw new Error('当前初始状态含回合或已使用候选，不能自动重置。');
  const initial = source.game.initialState.data,
    config = source.game.config.data;
  for (const key of ['board', 'clearAxes', 'clearTrigger', 'referenceClearRules'])
    if (JSON.stringify(initial[key]) !== JSON.stringify(config[key]))
      throw new Error(`供给修改发现 ${key} 副本不一致，原作品保留。`);
  const fixed =
    options.fixedSupply !== undefined
      ? buildBBFixedSupply(options.fixedSupply, initial.seed)
      : undefined;
  const parsed = parseBlockPlacementConfig({
    board: initial.board,
    pieces: fixed?.[0] ?? options.pieces,
    clearAxes: initial.clearAxes,
    clearTrigger: initial.clearTrigger,
    referenceClearRules: initial.referenceClearRules,
    ...(fixed ? { fixedPieceSupply: fixed } : {}),
  });
  const state = createGame(
    parsed.board,
    initial.seed,
    parsed.pieces,
    parsed.fixedPieceSupply,
    parsed.clearAxes,
    parsed.clearTrigger,
    parsed.referenceClearRules,
  );
  if (state.status !== 'playing') throw new Error('供给没有合法放置，原作品保留。');
  const edited = structuredClone(source) as any;
  edited.game.config.data = {
    board: parsed.board,
    pieces: parsed.pieces,
    ...(parsed.clearAxes ? { clearAxes: parsed.clearAxes } : {}),
    ...(parsed.clearTrigger ? { clearTrigger: parsed.clearTrigger } : {}),
    ...(parsed.referenceClearRules ? { referenceClearRules: parsed.referenceClearRules } : {}),
    ...(parsed.fixedPieceSupply ? { fixedPieceSupply: parsed.fixedPieceSupply } : {}),
  };
  edited.game.initialState.data = state;
  edited.game.initialState.stateHash = blockPlacementDefinition.runtime.hashState(state);
  for (const take of edited.takes) {
    take.initialStateHash = edited.game.initialState.stateHash;
    replay(edited, take);
  }
  return validateEditedSupply(edited);
}

async function validateEditedSupply(edited: any): Promise<BBWorkPackage> {
  const candidate = await createBBWorkPackage(edited, null, null);
  const { compileNativeTake } = await import('./compileNativeTake');
  const { parseWorkbenchView } = await import('./reference2dView');
  const { resolveSavedWorkbenchVariant } = await import('./workbenchVariant');
  const { compileNativeProductionAudio } = await import('./nativeProductionAudio');
  for (const take of edited.takes) {
    if (!take.actions.length) continue;
    try {
      const compiled = compileNativeTake(edited, take.takeId);
      if (edited.direction?.style?.workbenchView2D !== undefined)
        parseWorkbenchView(
          edited.direction.style.workbenchView2D,
          compiled.compiled.fps,
          compiled.compiled.totalFrames,
        );
      if (edited.direction?.style?.workbenchVariantV1 !== undefined)
        resolveSavedWorkbenchVariant(edited, take.takeId);
      if (edited.direction?.production?.audio)
        await compileNativeProductionAudio(edited, compiled.frameSource);
    } catch (error) {
      throw new Error(
        `Take ${take.takeId} 的帧或素材重验失败：${error instanceof Error ? error.message : String(error)}；原作品保留。`,
      );
    }
  }
  return candidate;
}
