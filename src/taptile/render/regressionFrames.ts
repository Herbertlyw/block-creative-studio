import type { CompiledTapTileTake } from '../director';

export type TapTileRegressionFrameLabel =
  | 'initial'
  | 'first-click'
  | 'first-flight-midpoint'
  | 'first-tray-reorder'
  | 'first-match'
  | 'warning-6-of-7'
  | 'terminal'
  | 'ending';

export interface TapTileRegressionFrame {
  label: TapTileRegressionFrameLabel;
  frameNumber: number;
}

export function selectTapTileRegressionFrames(compiled: CompiledTapTileTake): TapTileRegressionFrame[] {
  const result: TapTileRegressionFrame[] = [{ label: 'initial', frameNumber: 0 }];
  const first = compiled.actions[0];
  if (first) {
    result.push({ label: 'first-click', frameNumber: first.timing.pressFrame });
    result.push({ label: 'first-flight-midpoint', frameNumber: Math.floor((first.timing.flightStartFrame + first.timing.flightEndFrame) / 2) });
    result.push({ label: 'first-tray-reorder', frameNumber: first.timing.trayReorderEndFrame });
  }
  const match = compiled.actions.find((action) => action.transition.matchedTileIds.length > 0);
  if (match) result.push({ label: 'first-match', frameNumber: match.timing.matchStartFrame });
  const warning = compiled.events.find((event) => event.event.type === 'tray.warning');
  if (warning) result.push({ label: 'warning-6-of-7', frameNumber: warning.frame });
  const terminal = compiled.events.find((event) => event.event.type === 'game.won' || event.event.type === 'game.lost');
  if (terminal) result.push({ label: 'terminal', frameNumber: terminal.frame });
  result.push({ label: 'ending', frameNumber: compiled.totalFrames - 1 });
  const byLabel = new Map(result.map((entry) => [entry.label, entry]));
  return [...byLabel.values()];
}
