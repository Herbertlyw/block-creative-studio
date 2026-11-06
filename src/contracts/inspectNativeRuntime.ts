import { GameRegistry } from '../nativeReference/game-runtime/gameRegistry';
import { validateStudioProjectDocumentV2 } from '../nativeReference/game-runtime/projectDocument';
import { blockPlacementDefinition } from '../nativeReference/games/block-placement/definition';
import type { GameSnapshot } from '../nativeReference/domain/types';
import type { BlockPlacementSemanticAction } from '../nativeReference/games/block-placement/schemas';

export interface NativeBoardPreview {
  cells: GameSnapshot['board']['cells'];
  score: number;
  combo: number;
  turn: number;
}

export interface NativeRuntimeAudit {
  validated: boolean;
  message: string;
  takes: Array<{
    takeId: string;
    actions: number;
    legal: boolean;
    detail: string;
    frames: NativeBoardPreview[];
  }>;
}

/** Uses the separately isolated reference registry, state parser, hash and rules.
 * It does not render, resolve assets, validate interaction readiness, or persist parsed data. */
export function inspectNativeRuntime(document: unknown): NativeRuntimeAudit {
  try {
    const registry = new GameRegistry();
    registry.register(blockPlacementDefinition);
    const checked = validateStudioProjectDocumentV2(document, registry);
    const results = checked.parsed.takes.map(({ replay, actions }) => {
      let state = structuredClone(checked.parsed.initialState) as GameSnapshot;
      const boardFrame = (): NativeBoardPreview => ({
        cells: state.board.cells.map((row) => [...row]),
        score: state.score,
        combo: state.combo,
        turn: state.turn,
      });
      const frames = [boardFrame()];
      for (const [index, action] of actions.entries()) {
        try {
          const transition = blockPlacementDefinition.runtime.resolve(
            state,
            action as BlockPlacementSemanticAction,
            { seed: replay.seed, stepIndex: index },
          );
          state = blockPlacementDefinition.runtime.stateAfter(transition);
          frames.push(boardFrame());
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          return {
            takeId: replay.takeId,
            actions: actions.length,
            legal: false,
            frames,
            detail: `第 ${index + 1} 步（${replay.actions[index]?.id ?? '未知动作'}）不合法：${detail}`,
          };
        }
      }
      return {
        takeId: replay.takeId,
        actions: actions.length,
        legal: true,
        frames,
        detail: `逐步检查 ${actions.length} 个语义动作通过。最终状态哈希 ${blockPlacementDefinition.runtime.hashState(state)}。`,
      };
    });
    return {
      validated: true,
      message: `参考注册表、工程解析及初始状态哈希 ${checked.game.initialState.stateHash} 已核对。原文和未识别字段未改动；其他字段未必被参考解析器消费。`,
      takes: results,
    };
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error ? String(error.code) : 'ERROR';
    return {
      validated: false,
      message: `原生状态或合同未通过（${code}）：${error instanceof Error ? error.message : String(error)}`,
      takes: [],
    };
  }
}
