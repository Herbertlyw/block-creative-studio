import type { TapTileScenarioProfile, TapTileScenarioProfileId } from './types';

export const TAPTILE_SCENARIO_PROFILES: readonly TapTileScenarioProfile[] = Object.freeze([
  { id: 'max-clear', name: '最大消除', description: '无法清台时也返回当前预算内消除最多的安全轨迹。' },
  { id: 'safe-win', name: '稳定通关', description: '优先三消、解锁和低槽位占用。' },
  { id: 'danger-rescue', name: '险境翻盘', description: '至少触发一次 6/7 警告，再恢复并通关。' },
  { id: 'combo-heavy', name: '连续三消', description: '优先紧邻的三消节点与连贯消除。' },
  { id: 'fast-clear', name: '快速清台', description: '在可通关前提下减少动作与中间状态。' },
  { id: 'intentional-fail', name: '刻意失败', description: '构造槽位填满的失败剧情。' },
]);

export function getTapTileScenarioProfile(id: TapTileScenarioProfileId): TapTileScenarioProfile {
  return TAPTILE_SCENARIO_PROFILES.find((profile) => profile.id === id)
    ?? TAPTILE_SCENARIO_PROFILES.find((profile) => profile.id === 'safe-win')
    ?? TAPTILE_SCENARIO_PROFILES[0]!;
}
