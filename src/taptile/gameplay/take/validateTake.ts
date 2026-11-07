import type { CompiledTapTileLevel, TapTileTake } from '../../project';
import { tapTileStateHash } from '../stateHash';
import { replayTapTileTake } from './replayTake';
import type { TapTileTakeValidationResult } from './types';

export function validateTapTileTake(
  level: CompiledTapTileLevel,
  take: TapTileTake,
): TapTileTakeValidationResult {
  const replay = replayTapTileTake(level, take);
  const issues: TapTileTakeValidationResult['issues'] = [];
  if (replay.error) issues.push({ ...replay.error });
  if (replay.valid) {
    const finalState = replay.states.at(-1);
    if (!finalState) {
      issues.push({ code: 'TAKE_EMPTY_REPLAY', message: 'Take 没有可验证的最终状态。' });
    } else {
      const actualResult = finalState.status === 'won' ? 'won' : finalState.status === 'lost' ? 'lost' : 'unfinished';
      if (actualResult !== take.result) issues.push({ code: 'TAKE_RESULT_MISMATCH', message: `记录结果为 ${take.result}，重放结果为 ${actualResult}。` });
      const actualHash = tapTileStateHash(finalState);
      if (actualHash !== take.finalStateHash) issues.push({ code: 'TAKE_FINAL_HASH_MISMATCH', message: `记录 finalStateHash 为 ${take.finalStateHash}，重放得到 ${actualHash}。` });
    }
  }
  return { valid: issues.length === 0, issues, replay };
}
