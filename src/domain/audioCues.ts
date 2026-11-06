import type { CompiledTake } from './types';
import { blastPraiseTier, type BlastPraiseTierId } from './praise';

export type AudioCueKind = 'place' | 'line-cleared' | 'cross-cleared' | 'praise' | 'game-over';

export interface AudioCue {
  kind: AudioCueKind;
  seconds: number;
  frame: number;
  actionId: string;
  eventId: string;
  praise?: BlastPraiseTierId;
}

/** One semantic event per action and frame. Cross clears do not also emit a line-cleared event. */
export function audioCuesForTake(compiled: CompiledTake): AudioCue[] {
  const cues: AudioCue[] = [];
  const seen = new Set<string>();
  const push = (cue: AudioCue): void => {
    const key = `${cue.kind}:${cue.frame}:${cue.actionId}:${cue.praise ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    cues.push(cue);
  };

  for (const action of compiled.actions) {
    push({
      kind: 'place',
      eventId: `commit-${action.action.id}`,
      seconds: (action.releaseFrame + 1) / compiled.fps,
      frame: action.releaseFrame + 1,
      actionId: action.action.id,
    });
    const lineCount = action.transition.clear.rows.length + action.transition.clear.cols.length;
    if (lineCount > 0) {
      // The release frame still displays the dragged piece; clear can only appear afterwards.
      const visibleClearFrame = Math.max(action.clearStartFrame, action.releaseFrame + 1);
      const cross =
        action.transition.clear.rows.length > 0 && action.transition.clear.cols.length > 0;
      push({
        kind: cross ? 'cross-cleared' : 'line-cleared',
        eventId: `${cross ? 'cross' : 'line'}-${action.action.id}`,
        seconds: visibleClearFrame / compiled.fps,
        frame: visibleClearFrame,
        actionId: action.action.id,
      });
      push({
        kind: 'praise',
        eventId: `praise-${action.action.id}`,
        seconds: visibleClearFrame / compiled.fps,
        frame: visibleClearFrame,
        actionId: action.action.id,
        praise: blastPraiseTier(action.transition.after.combo, lineCount),
      });
    }
    if (action.transition.after.status === 'game-over') {
      push({
        kind: 'game-over',
        eventId: 'over-terminal',
        seconds: action.endFrame / compiled.fps,
        frame: action.endFrame,
        actionId: action.action.id,
      });
    }
  }
  return cues;
}
