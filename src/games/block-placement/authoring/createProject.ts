import { GameRegistry } from '../../../nativeReference/game-runtime/gameRegistry';
import { validateStudioProjectDocumentV2 } from '../../../nativeReference/game-runtime/projectDocument';
import {
  GAME_PROJECT_CONTRACT,
  GAME_PROJECT_CONTRACT_VERSION,
  STUDIO_PROJECT_V2_FORMAT,
  STUDIO_PROJECT_V2_VERSION,
  type StudioProjectDocumentV2,
} from '../../../nativeReference/game-runtime/projectEnvelope';
import {
  GAME_REPLAY_CONTRACT,
  GAME_REPLAY_CONTRACT_VERSION,
  splitPointerPlacement,
} from '../../../nativeReference/game-runtime/replayEnvelope';
import { blockPlacementDefinition } from '../../../nativeReference/games/block-placement/definition';
import {
  BLOCK_PLACEMENT_CONFIG_SCHEMA_ID,
  BLOCK_PLACEMENT_GAME_ID,
  BLOCK_PLACEMENT_MODULE_VERSION,
  BLOCK_PLACEMENT_RULESET_ID,
  BLOCK_PLACEMENT_RULESET_VERSION,
  BLOCK_PLACEMENT_SEMANTIC_ACTION_SCHEMA_ID,
  BLOCK_PLACEMENT_STATE_SCHEMA_ID,
} from '../../../nativeReference/games/block-placement/manifest';
import {
  parseBlockPlacementConfig,
  parseBlockPlacementAction,
} from '../../../nativeReference/games/block-placement/schemas';
import { createEmptyBoard } from '../../../nativeReference/games/block-placement/runtime/boardPresets';
import {
  createGame,
  createPieceSet,
  listLegalMoves,
  replayActions,
} from '../../../nativeReference/games/block-placement/runtime/gameEngine';
import { getShape } from '../../../nativeReference/games/block-placement/runtime/shapes';
import type {
  BoardState,
  PieceInstance,
  PlacementAction,
} from '../../../nativeReference/domain/types';
import { RHYTHM_PRESETS } from '../../../nativeReference/director/rhythmPresets';
import { classicBlastStyle } from '../../../nativeReference/renderer/stylePresets';

type PieceSpec = { shapeId: string; color?: string; cellColors?: string[] };
export function buildBBFixedSupply(value: unknown, seed: number): PieceInstance[][] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500)
    throw new Error('固定供给须包含 1–500 轮。');
  return value.map((round, setIndex) => {
    if (!Array.isArray(round) || round.length !== 3)
      throw new Error(`第 ${setIndex + 1} 轮须包含三个候选。`);
    const specs = round.map((raw: unknown) =>
      typeof raw === 'string' ? { shapeId: raw } : raw,
    ) as PieceSpec[];
    for (const spec of specs)
      if (
        !spec ||
        typeof spec !== 'object' ||
        typeof spec.shapeId !== 'string' ||
        Object.keys(spec).some((key) => !['shapeId', 'color', 'cellColors'].includes(key))
      )
        throw new Error('候选包含未知或无效字段。');
      else getShape(spec.shapeId);
    const pieces = createPieceSet(
      seed,
      setIndex,
      specs.map((spec) => spec.shapeId),
    );
    return pieces.map((piece, index) => ({
      ...piece,
      ...(specs[index]!.color !== undefined
        ? { color: specs[index]!.color as PieceInstance['color'] }
        : {}),
      ...(specs[index]!.cellColors !== undefined
        ? { cellColors: specs[index]!.cellColors as NonNullable<PieceInstance['cellColors']> }
        : {}),
    }));
  });
}

function checked(value: unknown): StudioProjectDocumentV2 {
  const games = new GameRegistry();
  games.register(blockPlacementDefinition);
  const { parsed: _parsed, ...document } = validateStudioProjectDocumentV2(value, games);
  return document;
}

/** Create a BB document directly from the native state and explicitly authored setup. */
export function createBBProject(options: {
  projectId: string;
  name: string;
  seed: number;
  width: number;
  height: number;
  fps: number;
  board?: BoardState;
  fixedSupply?: unknown;
  initialUsedSlots?: number[];
}): StudioProjectDocumentV2 {
  const { seed, width, height, fps } = options;
  if (
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 2147483647 ||
    ![width, height, fps].every(Number.isInteger) ||
    width < 256 ||
    width > 4096 ||
    height < 256 ||
    height > 4096 ||
    fps < 1 ||
    fps > 120 ||
    !options.projectId ||
    !options.name
  )
    throw new Error('新作品的身份、种子或输出参数无效。');
  const fixed =
    options.fixedSupply === undefined ? undefined : buildBBFixedSupply(options.fixedSupply, seed);
  const config = parseBlockPlacementConfig(
    {
      board: options.board ?? createEmptyBoard(),
      pieces: fixed?.[0] ?? createPieceSet(seed, 0, ['single', 'tri-h', 'square-2']),
      ...(fixed ? { fixedPieceSupply: fixed } : {}),
    },
    '$.setup',
  );
  const state = createGame(
    config.board,
    seed,
    config.pieces,
    config.fixedPieceSupply,
    config.clearAxes,
    config.clearTrigger,
    config.referenceClearRules,
  );
  if (options.initialUsedSlots !== undefined) {
    const slots = options.initialUsedSlots;
    if (
      slots.length > 2 ||
      new Set(slots).size !== slots.length ||
      slots.some((slot) => !Number.isInteger(slot) || slot < 0 || slot > 2)
    )
      throw new Error('初始已用候选无效。');
    for (const piece of state.pieces) piece.used = slots.includes(piece.slotIndex);
    state.status = listLegalMoves(state).length ? 'playing' : 'game-over';
  }
  if (state.status !== 'playing') throw new Error('初始棋盘没有合法放置。');
  const document: StudioProjectDocumentV2 = {
    format: STUDIO_PROJECT_V2_FORMAT,
    version: STUDIO_PROJECT_V2_VERSION,
    id: options.projectId,
    name: options.name,
    game: {
      contract: GAME_PROJECT_CONTRACT,
      contractVersion: GAME_PROJECT_CONTRACT_VERSION,
      game: {
        id: BLOCK_PLACEMENT_GAME_ID,
        moduleVersion: BLOCK_PLACEMENT_MODULE_VERSION,
        rulesetId: BLOCK_PLACEMENT_RULESET_ID,
        rulesetVersion: BLOCK_PLACEMENT_RULESET_VERSION,
      },
      config: {
        schemaId: BLOCK_PLACEMENT_CONFIG_SCHEMA_ID,
        data: {
          board: config.board,
          pieces: config.pieces,
          ...(config.fixedPieceSupply ? { fixedPieceSupply: config.fixedPieceSupply } : {}),
        },
      },
      initialState: {
        schemaId: BLOCK_PLACEMENT_STATE_SCHEMA_ID,
        data: state,
        stateHash: blockPlacementDefinition.runtime.hashState(state),
      },
    },
    production: {
      layoutProfileRef: {
        id: 'layout.vertical',
        version: '1.0.0',
        kind: 'ui-theme',
        contentHash: 'sha256:778b13e5752b159bee8a945ec060d651358fef661526178d6ff2d32b8d9d7861',
      },
      cameraProfileRef: {
        id: 'camera.fixed',
        version: '1.0.0',
        kind: 'camera-profile',
        contentHash: 'sha256:742c4944ae662e8e60e6137dedf032b03c43bd1c82c979e5a99cd5ad831a3259',
      },
      lookPackRef: {
        id: 'block-placement.look.classic-blast',
        version: '1.0.0',
        kind: 'look-pack',
        contentHash: 'builtin:classic-blast-v1',
      },
      output: { width, height, fps, quality: 'standard' },
    },
    takes: [],
    direction: {
      rhythm: structuredClone(RHYTHM_PRESETS['human-natural']),
      style: classicBlastStyle(),
    },
  };
  return checked(document);
}

/** Store authored actions in the native replay contract after legal replay. */
export function appendBBReplay(
  project: StudioProjectDocumentV2,
  takeId: string,
  rawActions: PlacementAction[],
): StudioProjectDocumentV2 {
  const source = checked(project);
  if (!takeId || source.takes.some((take) => take.takeId === takeId))
    throw new Error(`Take ${takeId} 已存在或无效。`);
  const actions = rawActions.map((action, index) =>
    parseBlockPlacementAction(action, `$.actions[${index}]`),
  );
  replayActions(source.game.initialState.data as any, actions);
  const pairs = actions.map((action) =>
    splitPointerPlacement({
      id: action.id,
      actor: action.actor,
      pieceId: action.pieceId,
      anchor: action.anchor,
      durationFrames: action.durationFrames,
      pointerPath: action.pointerPath,
      actionSchemaId: BLOCK_PLACEMENT_SEMANTIC_ACTION_SCHEMA_ID,
    }),
  );
  const next = structuredClone(source);
  next.takes.push({
    contract: GAME_REPLAY_CONTRACT,
    contractVersion: GAME_REPLAY_CONTRACT_VERSION,
    gameId: BLOCK_PLACEMENT_GAME_ID,
    moduleVersion: BLOCK_PLACEMENT_MODULE_VERSION,
    takeId,
    initialStateHash: source.game.initialState.stateHash,
    seed: (source.game.initialState.data as any).seed,
    actions: pairs.map((pair) => pair.semantic),
    interactions: pairs.map((pair) => pair.interaction),
  });
  return checked(next);
}
