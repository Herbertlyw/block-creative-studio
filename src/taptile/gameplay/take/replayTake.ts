import type { CompiledTapTileLevel, TapTileTake } from '../../project';
import { applyTapAction, createInitialTapTileGameState } from '../engine';
import type { TapTileTakeReplayResult } from './types';

export function replayTapTileTake(
  level: CompiledTapTileLevel,
  take: TapTileTake,
): TapTileTakeReplayResult {
  const initial = createInitialTapTileGameState(level);
  const states = [initial];
  const transitions: TapTileTakeReplayResult['transitions'] = [];
  if (take.levelHash !== level.levelHash) {
    return {
      valid: false,
      states,
      transitions,
      error: {
        actionIndex: -1,
        code: 'TAKE_LEVEL_HASH_MISMATCH',
        message: `Take 绑定 ${take.levelHash}，当前关卡为 ${level.levelHash}。`,
      },
    };
  }
  let state = initial;
  for (const [actionIndex, source] of take.actions.entries()) {
    const transition = applyTapAction(level, state, {
      id: source.id,
      type: 'tap',
      actor: source.actor,
      tileId: source.tileId,
    });
    transitions.push(transition);
    if (!transition.accepted) {
      return {
        valid: false,
        states,
        transitions,
        error: {
          actionIndex,
          code: `TAKE_ACTION_${transition.rejectReason?.toUpperCase().replaceAll('-', '_') ?? 'REJECTED'}`,
          message: transition.rejectReason === 'blocked'
            ? `动作 ${actionIndex + 1} 无效：${source.tileId} 仍被 ${(transition.blockerIds ?? []).join('、')} 阻挡。`
            : `动作 ${actionIndex + 1} 无效：${source.tileId}（${transition.rejectReason ?? 'rejected'}）。`,
          tileId: source.tileId,
          ...(transition.blockerIds ? { blockerIds: [...transition.blockerIds] } : {}),
        },
      };
    }
    state = transition.after;
    states.push(state);
  }
  return { valid: true, states, transitions };
}
