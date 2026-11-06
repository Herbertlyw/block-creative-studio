import { audioCuesForTake } from '../domain/audioCues';
import type { CompiledTake, StudioTestAudio } from '../domain/types';

/** Program-generated diagnostic sounds; all timing is on the compiled output clock. */
export function makeTestAudioPcm(
  compiled: CompiledTake,
  audio: StudioTestAudio,
  sampleRate: number,
): Float32Array {
  const length = Math.max(1, Math.ceil((compiled.totalFrames / compiled.fps) * sampleRate));
  const channel = new Float32Array(length);
  const bedGain = audio.bgmGain ?? 0;
  if (bedGain > 0) {
    const startAt = Math.max(0, Math.floor((audio.bgmStartSeconds ?? 0) * sampleRate));
    const offset = Math.max(0, Math.floor((audio.bgmSourceOffsetSeconds ?? 0) * sampleRate));
    const phrase = sampleRate * 2;
    for (let index = startAt; index < length; index += 1) {
      const local = offset + index - startAt;
      const phraseIndex = audio.bgmLoop === false ? local : local % phrase;
      if (audio.bgmLoop === false && local >= phrase) break;
      let sample = Math.sin((2 * Math.PI * 110 * phraseIndex) / sampleRate);
      if (audio.bgmPattern === 'melody-v1') {
        const noteLength = sampleRate / 2;
        const note = Math.floor(phraseIndex / noteLength);
        const noteFrame = phraseIndex % noteLength;
        const frequency = [220, 277.18, 329.63, 440][note] ?? 220;
        const envelope = Math.min(
          1,
          noteFrame / (sampleRate * 0.01),
          (noteLength - noteFrame) / (sampleRate * 0.03),
        );
        sample =
          Math.sin((2 * Math.PI * frequency * noteFrame) / sampleRate) * Math.max(0, envelope);
      }
      channel[index] = (channel[index] ?? 0) + sample * bedGain * 0.25;
    }
  }
  for (const cue of audioCuesForTake(compiled)) {
    const frequency =
      cue.kind === 'cross-cleared'
        ? 330
        : cue.kind === 'line-cleared'
          ? 220
          : cue.kind === 'praise'
            ? 660
            : cue.kind === 'game-over'
              ? 140
              : 880;
    const override =
      audio.cueOverrides?.find(
        (entry) => entry.kind === cue.kind && entry.eventId === cue.eventId,
      ) ??
      audio.cueOverrides?.find((entry) => entry.kind === cue.kind && entry.eventId === undefined);
    const start = Math.round(
      (cue.frame * sampleRate) / compiled.fps + (override?.offsetSeconds ?? 0) * sampleRate,
    );
    const count = Math.floor(sampleRate * (cue.kind === 'place' ? 0.045 : 0.09));
    for (let index = Math.max(0, -start); index < count && start + index < length; index += 1) {
      const sample =
        Math.sin((2 * Math.PI * frequency * index) / sampleRate) *
        audio.sfxGain *
        (override?.gain ?? 1) *
        (1 - index / count);
      channel[start + index] = (channel[start + index] ?? 0) + sample;
    }
  }
  return channel;
}
