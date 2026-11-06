import type { CompiledFrameSource } from '../nativeReference/game-runtime/frameSource';
import type { BBTestAudio, BBTestCueKind } from '../contracts/bbSyntheticAudio';

function cueKind(type: string): BBTestCueKind | null {
  if (type === 'block-placement.placement-committed') return 'place';
  if (
    type === 'block-placement.line-cleared' ||
    type === 'block-placement.reference-clear-body' ||
    type === 'block-placement.reference-clear-heavy'
  )
    return 'line-cleared';
  if (type === 'block-placement.cross-cleared') return 'cross-cleared';
  if (type.startsWith('block-placement.praise-')) return 'praise';
  if (type === 'block-placement.game-over') return 'game-over';
  return null;
}

/** Existing diagnostic tones, driven by semantic events instead of another action clock. */
export function makeBBDefaultTestAudio(
  source: CompiledFrameSource,
  profile: 'authored' | 'observed',
  sampleRate = 48000,
) {
  const pcm = new Float32Array(Math.ceil((source.totalFrames * sampleRate) / source.fps)),
    seen = new Set<string>();
  for (let frame = 0; frame < source.totalFrames; frame++)
    for (const event of source.evaluate(frame).semanticEvents) {
      const placement = event.type === 'block-placement.placement-committed';
      const clear =
        profile === 'observed'
          ? event.type === 'block-placement.reference-clear-body'
          : ['block-placement.line-cleared', 'block-placement.cross-cleared'].includes(event.type);
      const key = JSON.stringify([event.type, event.id]);
      if ((!placement && !clear) || seen.has(key)) continue;
      seen.add(key);
      const start = Math.round((frame * sampleRate) / source.fps),
        count = Math.round(0.035 * sampleRate),
        frequency = placement ? 660 : 990,
        gain = profile === 'observed' ? 0.3 : 0.35;
      for (let i = 0; i < count && start + i < pcm.length; i++)
        pcm[start + i] =
          (pcm[start + i] ?? 0) +
          gain *
            Math.sin((Math.PI * i) / count) *
            Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    }
  return pcm;
}

/** Generated test sounds on the same semantic-event clock as production WAV. */
export function makeBBConfiguredTestAudio(
  source: CompiledFrameSource,
  config: BBTestAudio,
  sampleRate = 48000,
) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
    throw new Error('测试音采样率无效。');
  const length = Math.max(1, Math.ceil((source.totalFrames * sampleRate) / source.fps)),
    pcm = new Float32Array(length);
  const startAt = Math.floor(config.bgmStartSeconds * sampleRate),
    offset = Math.floor(config.bgmSourceOffsetSeconds * sampleRate),
    phrase = sampleRate * 2;
  if (config.bgmGain > 0)
    for (let index = startAt; index < length; index++) {
      const local = offset + index - startAt;
      if (!config.bgmLoop && local >= phrase) break;
      const phraseIndex = config.bgmLoop ? local % phrase : local;
      let sample = Math.sin((2 * Math.PI * 110 * phraseIndex) / sampleRate);
      if (config.bgmPattern === 'melody-v1') {
        const noteLength = sampleRate / 2,
          note = Math.floor(phraseIndex / noteLength),
          noteFrame = phraseIndex % noteLength;
        const frequency = [220, 277.18, 329.63, 440][note] ?? 220;
        const envelope = Math.min(
          1,
          noteFrame / (sampleRate * 0.01),
          (noteLength - noteFrame) / (sampleRate * 0.03),
        );
        sample =
          Math.sin((2 * Math.PI * frequency * noteFrame) / sampleRate) * Math.max(0, envelope);
      }
      pcm[index] = (pcm[index] ?? 0) + sample * config.bgmGain * 0.25;
    }
  const seen = new Set<string>(),
    matched = new Set<number>(),
    events: Array<{
      id: string;
      kind: BBTestCueKind;
      frame: number;
      startSample: number;
      truncated: boolean;
    }> = [];
  for (let frame = 0; frame < source.totalFrames; frame++)
    for (const event of source.evaluate(frame).semanticEvents) {
      const kind = cueKind(event.type),
        key = JSON.stringify([event.type, event.id]);
      if (!kind || seen.has(key)) continue;
      seen.add(key);
      let override = config.cueOverrides.findIndex(
        (item) => item.kind === kind && item.eventId === event.id,
      );
      if (override < 0)
        override = config.cueOverrides.findIndex(
          (item) => item.kind === kind && item.eventId === undefined,
        );
      if (override >= 0) matched.add(override);
      const setting = config.cueOverrides[override],
        start = Math.round(
          (frame * sampleRate) / source.fps + (setting?.offsetSeconds ?? 0) * sampleRate,
        );
      const count = Math.floor(sampleRate * (kind === 'place' ? 0.045 : 0.09)),
        frequency =
          kind === 'cross-cleared'
            ? 330
            : kind === 'line-cleared'
              ? 220
              : kind === 'praise'
                ? 660
                : kind === 'game-over'
                  ? 140
                  : 880;
      for (let index = Math.max(0, -start); index < count && start + index < length; index++)
        pcm[start + index] =
          (pcm[start + index] ?? 0) +
          Math.sin((2 * Math.PI * frequency * index) / sampleRate) *
            config.sfxGain *
            (setting?.gain ?? 1) *
            (1 - index / count);
      events.push({
        id: event.id,
        kind,
        frame,
        startSample: start,
        truncated: start < 0 || start + count > length,
      });
    }
  const unused = config.cueOverrides.filter((_, index) => !matched.has(index));
  let clipped = 0;
  for (const value of pcm) if (Math.abs(value) > 1) clipped++;
  let tail = 0;
  for (let i = Math.max(0, length - Math.ceil(sampleRate * 0.01)); i < length; i++)
    tail = Math.max(tail, Math.abs(pcm[i] ?? 0));
  const warnings = [
    unused.length ? `${unused.length} 个测试音覆盖未命中当前 Take。` : '',
    events.some((event) => event.truncated) ? '部分测试音超出视频边界。' : '',
    clipped ? `${clipped} 个测试音采样超出幅度范围。` : '',
    tail > 1e-4 ? '视频结尾仍有测试音，未自动淡出。' : '',
  ]
    .filter(Boolean)
    .join('');
  return { pcm, events, warning: warnings };
}
