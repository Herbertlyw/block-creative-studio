import type { GameSnapshot } from './types';

export function parseReferenceClearRules(
  value: unknown,
): NonNullable<GameSnapshot['referenceClearRules']> {
  if (!Array.isArray(value) || value.length > 500) throw new Error('REFERENCE_CLEAR_RULES_INVALID');
  let last = -1;
  return value.map((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      Object.keys(entry).some((key) => !['turn', 'axes', 'trigger'].includes(key)) ||
      !Number.isInteger((entry as { turn?: unknown }).turn) ||
      (entry as { turn: number }).turn < 0 ||
      (entry as { turn: number }).turn > 499 ||
      (entry as { turn: number }).turn <= last ||
      ((entry as { axes?: unknown }).axes === undefined &&
        (entry as { trigger?: unknown }).trigger === undefined) ||
      ((entry as { axes?: unknown }).axes !== undefined &&
        !['rows', 'columns', 'both'].includes(String((entry as { axes?: unknown }).axes))) ||
      ((entry as { trigger?: unknown }).trigger !== undefined &&
        !['line-complete', 'board-full'].includes(String((entry as { trigger?: unknown }).trigger)))
    ) {
      throw new Error('REFERENCE_CLEAR_RULES_INVALID');
    }
    last = (entry as { turn: number }).turn;
    return { ...(entry as NonNullable<GameSnapshot['referenceClearRules']>[number]) };
  });
}

export function clearRuleAt(
  snapshot: Pick<GameSnapshot, 'turn' | 'clearAxes' | 'clearTrigger' | 'referenceClearRules'>,
): {
  axes: 'rows' | 'columns' | 'both';
  trigger: 'line-complete' | 'board-full';
} {
  const override = snapshot.referenceClearRules?.find((entry) => entry.turn === snapshot.turn);
  return {
    axes: override?.axes ?? snapshot.clearAxes ?? 'both',
    trigger: override?.trigger ?? snapshot.clearTrigger ?? 'line-complete',
  };
}
