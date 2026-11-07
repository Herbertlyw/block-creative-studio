import type { TapTileGameState } from '../gameplay';

export function GameplayStageOverlay({
  state,
  warning,
}: {
  state: TapTileGameState;
  warning: boolean;
}) {
  if (state.status === 'won') return <div className="tpt-game-result is-won"><strong>关卡完成</strong><span>Take 可保存并确定性重放</span></div>;
  if (state.status === 'lost') return <div className="tpt-game-result is-lost"><strong>槽位已满</strong><span>重新开始或保存失败 Take</span></div>;
  if (warning) return <div className="tpt-tray-warning">只剩 1 个槽位</div>;
  return null;
}
