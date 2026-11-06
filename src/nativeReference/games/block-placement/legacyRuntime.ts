import { createEmptyBoard } from '../../domain/boardPresets';
import { applyPlacement, createGame, createPieceSet, listLegalMoves } from '../../domain/gameEngine';
import type { GameSnapshot, GameTransition } from '../../domain/types';
import type { GameRuntime } from '../../game-runtime/contracts';
import { GameRuntimeError } from '../../game-runtime/errors';
import { stableHash } from '../../headless/stableHash';
import type { BlockPlacementConfig, BlockPlacementSemanticAction } from './schemas';

export function hashBlockPlacementState(state: GameSnapshot): string {
  return stableHash({
    board: state.board,
    ...(state.clearAxes?{clearAxes:state.clearAxes}:{}), ...(state.clearTrigger?{clearTrigger:state.clearTrigger}:{}), ...(state.referenceClearRules?{referenceClearRules:state.referenceClearRules}:{}),
    pieces: state.pieces,
    seed: state.seed,
    setIndex: state.setIndex,
    turn: state.turn,
    score: state.score,
    combo: state.combo,
    status: state.status,
    ...(state.fixedPieceSupply ? { fixedPieceSupply: state.fixedPieceSupply } : {}),
    ...(state.supplyExhausted ? { supplyExhausted: true } : {}),
  });
}

function placementFromSemantic(
  action: BlockPlacementSemanticAction,
  stepIndex: number,
) {
  return {
    id: `runtime-${stepIndex}-${action.pieceId}-${action.anchor.row}-${action.anchor.col}`,
    actor: 'agent' as const,
    pieceId: action.pieceId,
    anchor: { ...action.anchor },
    durationFrames: 16,
    pointerPath: [],
  };
}

export const blockPlacementLegacyRuntime: GameRuntime<
  BlockPlacementConfig,
  GameSnapshot,
  BlockPlacementSemanticAction,
  GameTransition
> = {
  createInitialState(config, seed) {
    const board = config.board ?? createEmptyBoard();
    const pieces = config.fixedPieceSupply?.[0] ?? config.pieces ?? createPieceSet(seed, 0);
    return createGame(board, seed, pieces, config.fixedPieceSupply,config.clearAxes,config.clearTrigger,config.referenceClearRules);
  },
  hashState: hashBlockPlacementState,
  listLegalActions(state) {
    return listLegalMoves(state).map((move) => ({
      pieceId: move.pieceId,
      anchor: { ...move.anchor },
    }));
  },
  resolve(state, action, context) {
    const transition = applyPlacement(state, placementFromSemantic(action, context.stepIndex));
    if (!transition) {
      throw new GameRuntimeError(
        'ILLEGAL_ACTION',
        `Placement ${action.pieceId} at ${action.anchor.row},${action.anchor.col} is not legal in the current state.`,
        { details: { pieceId: action.pieceId, anchor: action.anchor } },
      );
    }
    return transition;
  },
  stateAfter(resolution) {
    return resolution.after;
  },
};
