import { ordinaryProject } from './fixtures/ordinaryProject';
import { describe, expect, it } from 'vitest';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import {
  compileNativeProductionAudio,
  describeProductionMixWarnings,
  describeUnmatchedProductionCues,
} from '../src/contracts/nativeProductionAudio';
import { isValidPlacementContract } from '../src/contracts/validateContract';
const source = () => JSON.parse(JSON.stringify(ordinaryProject()));

describe('reference production audio', () => {
  it('verifies inline WAV and mixes music with two placements and one cross-clear event', async () => {
    const doc = source(),
      before = JSON.stringify(doc);
    expect(isValidPlacementContract(doc)).toBe(true);
    const { frameSource } = compileNativeTake(doc, 'synthetic-take');
    const result = await compileNativeProductionAudio(doc, frameSource);
    expect(result.track.numberOfChannels).toBe(2);
    expect(result.track.data.length).toBe(241600 * 2);
    expect(result.scheduledCues.map((c) => [c.eventType, c.frameIndex, c.startSample])).toEqual([
      ['block-placement.placement-committed', 50, 80000],
      ['block-placement.cross-cleared', 53, 84800],
      ['block-placement.placement-committed', 121, 193600],
    ]);
    expect(result.track.data.slice(0, 20000).every((x) => x === 0)).toBe(true);
    expect(result.track.data.slice(60000, 61000).some((x) => Math.abs(x) > 0.01)).toBe(true);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('rejects damaged audio, missing audio, and unsupported additional production controls', async () => {
    const doc = source(),
      { frameSource } = compileNativeTake(doc, 'synthetic-take');
    doc.direction.production.audio.assets.music.sha256 = '0'.repeat(64);
    await expect(compileNativeProductionAudio(doc, frameSource)).rejects.toThrow(/HASH_MISMATCH/);
    const missing = source();
    delete missing.direction.production.audio.assets.cue;
    await expect(compileNativeProductionAudio(missing, frameSource)).rejects.toThrow(
      /AUDIO_ASSET_UNKNOWN/,
    );
    const unsupported = source();
    unsupported.direction.production.camera = { renderer: 'reference-2d' };
    await expect(compileNativeProductionAudio(unsupported, frameSource)).rejects.toThrow(
      /尚未接入/,
    );
  });
});

it('reports real end-of-video cue truncation and nonzero PCM tail without modifying the project or mix', async () => {
  const doc = source();
  doc.direction.production.audio.bgm.fadeOutSeconds = 0;
  const sourceFrame = compileNativeTake(doc, 'synthetic-take').frameSource;
  const event = sourceFrame.evaluate(50).semanticEvents[0];
  expect(event).toBeDefined();
  const last = sourceFrame.totalFrames - 1;
  const shifted = {
    ...sourceFrame,
    evaluate(frame: number) {
      const packet = sourceFrame.evaluate(frame);
      return { ...packet, semanticEvents: frame === last ? [event!] : [] };
    },
  };
  const before = JSON.stringify(doc),
    mix = await compileNativeProductionAudio(doc, shifted),
    pcm = mix.track.data.slice();
  expect(mix.scheduledCues.some((cue) => cue.truncated)).toBe(true);
  const warning = describeProductionMixWarnings(doc, mix);
  expect(warning).toContain('被截断');
  expect(warning).toContain('末尾 10 毫秒');
  expect(mix.track.data).toEqual(pcm);
  expect(JSON.stringify(doc)).toBe(before);
  const quiet = {
    ...mix,
    track: { ...mix.track, data: new Float32Array(mix.track.data.length) },
    scheduledCues: [],
    clippedSampleCount: 0,
  };
  expect(describeProductionMixWarnings(doc, quiet)).not.toContain('末尾');
});

it('reports authored cues that the frame source never emits without reporting internal fallback cues', async () => {
  const doc = source();
  doc.direction.production.audio.cues[1].eventType = 'block-placement.reference-clear-body';
  const mix = await compileNativeProductionAudio(
    doc,
    compileNativeTake(doc, 'synthetic-take').frameSource,
  );
  const message = describeUnmatchedProductionCues(doc, mix.diagnostics.unusedCueEventTypes);
  expect(message).toContain('block-placement.reference-clear-body');
  expect(message).not.toContain('mahjong.rejected-tap');
  expect(
    mix.scheduledCues.some((cue) => cue.eventType === 'block-placement.reference-clear-body'),
  ).toBe(false);
});
