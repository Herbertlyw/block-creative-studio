import type { CompiledTake } from '../nativeReference/domain/types';

export interface NativeTestCue {
  actionId: string;
  kind: 'place' | 'clear';
  frame: number;
  sample: number;
}
/** Diagnostic signals only; these are not V2 production audio or original assets. */
export function makeNativeTestAudio(
  compiled: CompiledTake,
  sampleRate = 48_000,
): { pcm: Float32Array; cues: NativeTestCue[] } {
  const pcm = new Float32Array(Math.ceil((compiled.totalFrames * sampleRate) / compiled.fps));
  const cues: NativeTestCue[] = [];
  for (const action of compiled.actions) {
    const events: Array<{ kind: 'place' | 'clear'; frame: number }> = [
      { kind: 'place', frame: action.releaseFrame + 1 },
    ];
    if (action.transition.clear.cells.length)
      events.push({ kind: 'clear', frame: action.clearStartFrame });
    for (const event of events) {
      const sample = Math.round((event.frame * sampleRate) / compiled.fps);
      cues.push({ actionId: action.action.id, kind: event.kind, frame: event.frame, sample });
      const length = Math.round(sampleRate * 0.035),
        frequency = event.kind === 'place' ? 660 : 990;
      for (let n = 0; n < length && sample + n < pcm.length; n++) {
        const envelope = Math.sin((Math.PI * n) / length);
        pcm[sample + n] =
          (pcm[sample + n] ?? 0) +
          0.35 * envelope * Math.sin((2 * Math.PI * frequency * n) / sampleRate);
      }
    }
  }
  return { pcm, cues };
}
