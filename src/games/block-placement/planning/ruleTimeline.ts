import type { GameSnapshot } from '../../../nativeReference/domain/types';
import { stableHash } from '../../../nativeReference/headless/stableHash';

/** A rule commit is an instant, independent of any remaining visual effect. */
export interface BBRuleTimelineAction {
  actionId: string;
  startSeconds: number;
  commitSeconds: number;
  after: GameSnapshot;
}
export interface BBRuleTimeline {
  readonly initial: GameSnapshot;
  readonly actions: readonly BBRuleTimelineAction[];
}
export interface BBRuleFrame {
  activeIndex: number;
  completedCount: number;
  gameState: GameSnapshot;
  logicalStateHash: string;
}

/** Called after the unique runtime validates and replays the source actions. */
export function createBBRuleTimeline(
  initial: GameSnapshot,
  actions: readonly BBRuleTimelineAction[],
): BBRuleTimeline {
  const ids = new Set<string>();
  let previous = -Infinity;
  for (const [index, action] of actions.entries()) {
    if (
      !action.actionId ||
      ids.has(action.actionId) ||
      !Number.isFinite(action.startSeconds) ||
      !Number.isFinite(action.commitSeconds) ||
      action.startSeconds < 0 ||
      action.commitSeconds < action.startSeconds ||
      action.commitSeconds <= previous
    )
      throw new Error(`BB_RULE_TIMELINE_INVALID:${index + 1}:${action.actionId}`);
    ids.add(action.actionId);
    previous = action.commitSeconds;
  }
  return structuredClone({ initial, actions });
}

/** Pure and seek-independent. The last started action can overlap a prior commit. */
export function evaluateBBRuleTimeline(plan: BBRuleTimeline, timeSeconds: number): BBRuleFrame {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) throw new Error('BB_RULE_TIME_INVALID');
  let activeIndex = -1,
    completedCount = 0;
  for (const [index, action] of plan.actions.entries()) {
    if (timeSeconds >= action.startSeconds) activeIndex = index;
    if (timeSeconds >= action.commitSeconds) completedCount = index + 1;
  }
  const gameState = structuredClone(
    completedCount ? plan.actions[completedCount - 1]!.after : plan.initial,
  );
  return { activeIndex, completedCount, gameState, logicalStateHash: stableHash(gameState) };
}
