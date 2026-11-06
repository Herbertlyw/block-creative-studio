// Derived production module; supplied reference files remain unchanged.
import type { ReferenceCalibration } from '../../../nativeReference/games/block-placement/presentation/referenceCalibration';
import type { SemanticGameEvent } from '../../../nativeReference/game-runtime/presentationPacket';

type AudioStep = {
  clear: { cells: unknown[]; rows: number[]; cols: number[] };
  after: { combo: number };
};
export function referencePraiseLabel(
  spec: ReferenceCalibration,
  step: AudioStep,
  index: number,
): string {
  const a = spec.actions[index]!,
    combo = a.combo ?? step.after.combo;
  return (
    a.label ??
    (spec.theme === 'grey'
      ? combo > 1
        ? `Combo ${combo}`
        : step.clear.rows.length + step.clear.cols.length > 2
          ? 'Great!'
          : 'Good!'
      : `Combo ${combo || 1}`)
  );
}

/** Calibrated picture times, not native action durations, own audio synchronization. */
export function referenceAudioEvents(spec: ReferenceCalibration, steps: AudioStep[], fps: number) {
  const frames = new Map<number, SemanticGameEvent[]>();
  let streak = 0,
    lastClear = -Infinity,
    lastIndex = -Infinity;
  function add(time: number, type: string, id: string, payload: Record<string, unknown>) {
    const frame = Math.ceil(time * fps - 1e-7);
    if (frame >= Math.round(spec.duration * fps)) return;
    const event: SemanticGameEvent = {
      id,
      type,
      category: type.includes('placement') ? 'commit' : 'resolve',
      tags: ['calibrated-audio'],
      entityIds: [id.split(':')[0]!],
      payload: { ...payload, timeSeconds: time },
    };
    frames.set(frame, [...(frames.get(frame) ?? []), event]);
  }
  steps.forEach((step, i) => {
    const a = spec.actions[i]!;
    add(a.release, 'block-placement.placement-committed', `${a.actionId}:placement`, {});
    if (!step.clear.cells.length) return;
    // Up to two setup moves can preserve a chain; a long pause or fresh Good/Great resets it.
    const label = referencePraiseLabel(spec, step, i);
    const reset = i - lastIndex > 3 || a.clear - lastClear > 4 || /^(Good|Great)!?$/i.test(label);
    streak = reset ? 1 : streak + 1;
    lastClear = a.clear;
    lastIndex = i;
    const rung = Math.min(7, streak - 1),
      lines = step.clear.rows.length + step.clear.cols.length;
    add(
      a.clear,
      lines >= 3 ? 'block-placement.reference-clear-heavy' : 'block-placement.reference-clear-body',
      `${a.actionId}:clear-body`,
      { lines, streak },
    );
    add(a.clear, `block-placement.reference-clear-tone-${rung}`, `${a.actionId}:clear-tone`, {
      lines,
      streak,
      semitones: rung,
    });
    const word = a.perfect ? 'perfect' : label.toLowerCase().replace(/!$/, '');
    if (
      ['good', 'great', 'excellent', 'amazing', 'perfect', 'fantastic', 'unbelievable'].includes(
        word,
      )
    ) {
      add(a.clear + 0.08, `block-placement.praise-${word}`, `${a.actionId}:praise`, { word });
    }
  });
  return frames;
}
