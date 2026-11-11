import { describe, expect, it } from 'vitest';
import { createWavAsset, mergeProductionAudioAsset } from '../src/contracts/audioAsset';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import {
  compileProductionAudio,
  compileProductionAudioAsync,
  verifyProductionAudioAssets,
} from '../src/nativeReference/agent-director/audioMix';
import {
  parseProductionDirection,
  type ProductionAudio,
} from '../src/nativeReference/agent-director/contracts';
import { createBCDemo } from '../src/games/block-crush/demo';
import { readBCProject, bcProduction } from '../src/games/block-crush/document';
import { createBBWorkPackage, openBBWorkPackage } from '../src/contracts/bbWorkPackage';
import { editBBProductionAudio, editBCProductionAudio } from '../src/contracts/editProductionAudio';
import { ordinaryProject } from './fixtures/ordinaryProject';
import { compileBCPlayback, mixBCAudio } from '../src/games/block-crush/timeline';
import { isValidPlacementContract } from '../src/contracts/validateContract';
import type { CompiledFrameSource } from '../src/nativeReference/game-runtime/frameSource';

async function constantAsset(id: string, level: number, seconds: number) {
  const count = Math.round(48000 * seconds),
    bytes = new Uint8Array(44 + count * 2),
    view = new DataView(bytes.buffer);
  const text = (at: number, value: string) =>
    [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 48000, true);
  view.setUint32(28, 96000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, level * 32768, true);
  return createWavAsset(bytes, id, `${id}.wav`);
}
const base = () => compileNativeTake(ordinaryProject(), 'synthetic-take').frameSource;
function clock(): CompiledFrameSource {
  const source = base();
  return {
    ...source,
    fps: 10,
    totalFrames: 50,
    evaluate(frame: number) {
      return {
        ...source.evaluate(0),
        semanticEvents:
          frame === 10 || frame === 12
            ? [
                {
                  id: `event-${frame}`,
                  type:
                    frame === 10
                      ? 'block-placement.placement-committed'
                      : 'block-placement.line-cleared',
                  category: 'commit',
                  tags: [],
                  entityIds: [],
                },
              ]
            : [],
      };
    },
  };
}
async function fixture(): Promise<ProductionAudio> {
  const assets = Object.fromEntries(
    await Promise.all([
      constantAsset('music', 0.25, 5),
      constantAsset('voice', 0.125, 1),
      constantAsset('hit', 0.25, 0.1),
    ]).then((items) => items.map((asset) => [asset.id, asset])),
  );
  return {
    assets,
    mastering: 'preserve-level',
    bgm: { assetId: 'music', gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0 },
    cues: [],
    voices: [
      { id: 'speech', takeId: 'synthetic-take', assetId: 'voice', startSeconds: 1, gain: 1 },
    ],
    ducking: {
      enabled: true,
      bgmGain: 0.25,
      sfxGain: 0.5,
      eventTypes: ['*.placement-committed'],
      attackSeconds: 0.1,
      releaseSeconds: 0.2,
    },
  };
}
const sample = (mix: ReturnType<typeof compileProductionAudio>, time: number) =>
  mix.track.data[Math.round(time * 48000) * 2]!;

describe('Take speech and shared ducking semantics', () => {
  it('keeps async preview/export PCM identical and accepts cancellation during long mixing', async () => {
    const audio = await fixture();
    const synchronous = compileProductionAudio(clock(), audio);
    expect((await compileProductionAudioAsync(clock(), audio)).track.data).toEqual(
      synchronous.track.data,
    );
    const controller = new AbortController();
    const long = { ...clock(), totalFrames: 600 };
    const timer = setTimeout(() => controller.abort(), 0);
    try {
      await expect(
        compileProductionAudioAsync(long, audio, 48000, undefined, controller.signal),
      ).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      clearTimeout(timer);
    }
  });
  it('keeps old PCM exactly unchanged without speech or with disabled ducking', () => {
    const audio = parseProductionDirection(ordinaryProject().direction.production).audio!;
    const before = compileProductionAudio(base(), audio);
    const after = compileProductionAudio(base(), {
      ...audio,
      voices: [],
      ducking: {
        enabled: false,
        bgmGain: 0,
        sfxGain: 0,
        eventTypes: ['*.placement-committed'],
        attackSeconds: 0,
        releaseSeconds: 0,
      },
    });
    expect(after.pcmHash).toBe(before.pcmHash);
    expect(after.track.data).toEqual(before.track.data);
  });
  it('ducks only BGM and chosen SFX, leaves speech independent of the SFX bus, and restores smoothly', async () => {
    const audio = await fixture();
    audio.cues = [
      { eventType: 'block-placement.placement-committed', assetId: 'hit' },
      { eventType: 'block-placement.line-cleared', assetId: 'hit' },
    ];
    const mix = compileProductionAudio(clock(), audio);
    expect(sample(mix, 0.8)).toBeCloseTo(0.25);
    expect(sample(mix, 0.95)).toBeCloseTo(0.15625);
    expect(sample(mix, 1.05)).toBeCloseTo(0.25 * 0.25 + 0.125 + 0.25 * 0.5);
    expect(sample(mix, 1.25)).toBeCloseTo(0.25 * 0.25 + 0.125 + 0.25);
    expect(sample(mix, 2.1)).toBeCloseTo(0.15625);
    expect(sample(mix, 2.3)).toBeCloseTo(0.25);
    expect(mix.scheduledVoices[0]).toMatchObject({
      id: 'speech',
      startSample: 48000,
      durationSamples: 48000,
      truncated: false,
    });
    expect(mix.clippedSampleCount).toBe(0);
    const mutedSfx = compileProductionAudio(clock(), { ...audio, sfxEnabled: false });
    expect(sample(mutedSfx, 1.05)).toBeCloseTo(0.25 * 0.25 + 0.125);
    audio.voices![0]!.gain = 0;
    audio.sfxEnabled = false;
    expect(sample(compileProductionAudio(clock(), audio), 1.5)).toBeCloseTo(0.25);
  });
  it('merges overlapping and adjacent speech without stacking attenuation and crops the same full-Take envelope', async () => {
    const audio = await fixture();
    audio.voices!.push(
      { ...audio.voices![0]!, id: 'overlap', startSeconds: 1.5 },
      { ...audio.voices![0]!, id: 'near', startSeconds: 2.7 },
    );
    const mix = compileProductionAudio(clock(), audio);
    expect(sample(mix, 1.75)).toBeCloseTo(0.25 * 0.25 + 0.125 * 2);
    expect(sample(mix, 2.6)).toBeCloseTo(0.25 * 0.25); // held over a short speech gap
    const crop = compileProductionAudio(clock(), audio, 48000, { startFrame: 9, endFrame: 39 });
    expect(crop.track.data).toEqual(mix.track.data.slice(43200 * 2, 192000 * 2));
    expect(crop.scheduledVoices).toHaveLength(3);
    const inside = compileProductionAudio(clock(), audio, 48000, { startFrame: 15, endFrame: 19 });
    expect(inside.track.data).toEqual(mix.track.data.slice(72000 * 2, 96000 * 2));
  });
  it('uses source offsets and voice fades, rejects invalid offsets, and excludes other Takes', async () => {
    const audio = await fixture();
    audio.bgm!.enabled = false;
    Object.assign(audio.voices![0]!, {
      sourceOffsetSeconds: 0.5,
      fadeInSeconds: 0.1,
      fadeOutSeconds: 0.1,
    });
    const mix = compileProductionAudio(clock(), audio);
    expect(sample(mix, 1)).toBe(0);
    expect(sample(mix, 1.05)).toBeCloseTo(0.0625);
    expect(sample(mix, 1.2)).toBeCloseTo(0.125);
    expect(sample(mix, 1.45)).toBeCloseTo(0.0625, 4);
    expect(sample(mix, 1.6)).toBe(0);
    expect(mix.scheduledVoices[0]!.sourceOffsetSamples).toBe(24000);
    audio.voices![0]!.takeId = 'another';
    expect(compileProductionAudio(clock(), audio).scheduledVoices).toEqual([]);
    audio.voices![0]!.takeId = 'synthetic-take';
    audio.voices![0]!.sourceOffsetSeconds = 1;
    expect(() => compileProductionAudio(clock(), audio)).toThrow(
      /AUDIO_VOICE_OFFSET_OUT_OF_RANGE: speech/,
    );
  });
  it('strictly preserves supported fields and rejects duplicate IDs, unknown fields and corrupt assets', async () => {
    const audio = await fixture();
    const originalAsset = {
      ...audio.assets!.voice!,
      provenance: { sourceRef: 'synthetic-original' },
      sourceName: 'original.wav',
    };
    const originalAssets = { voice: originalAsset };
    expect(mergeProductionAudioAsset(originalAssets, audio.assets!.voice!).voice).toBe(
      originalAsset,
    );
    expect(() =>
      mergeProductionAudioAsset(originalAssets, { ...audio.assets!.music!, id: 'voice' }),
    ).toThrow(/AUDIO_ASSET_ID_CONFLICT: voice/);
    expect(originalAssets.voice).toBe(originalAsset);
    expect(
      mergeProductionAudioAsset({}, { ...audio.assets!.voice!, id: 'constructor' }).constructor,
    ).toMatchObject({ id: 'constructor' });
    expect(parseProductionDirection({ version: '1.0.0', audio }).audio).toEqual(audio);
    expect(() =>
      parseProductionDirection({
        version: '1.0.0',
        audio: { ...audio, voices: [...audio.voices!, ...audio.voices!] },
      }),
    ).toThrow(/duplicate voice/);
    expect(() =>
      parseProductionDirection({ version: '1.0.0', audio: { ...audio, unknown: true } }),
    ).toThrow();
    audio.assets!.voice!.sha256 = '0'.repeat(64);
    await expect(verifyProductionAudioAssets(audio)).rejects.toThrow(/HASH_MISMATCH: voice/);
    delete audio.assets!.voice;
    expect(() => compileProductionAudio(clock(), audio)).toThrow(/AUDIO_ASSET_UNKNOWN: voice/);
    await expect(createWavAsset(new Uint8Array([0, 1, 2]), 'broken', 'broken.wav')).rejects.toThrow(
      /AUDIO_WAV_INVALID: broken/,
    );
    const invalidBase64 = await fixture();
    (invalidBase64.assets!.voice! as { data: string }).data = '***bad base64***';
    await expect(verifyProductionAudioAssets(invalidBase64)).rejects.toThrow(
      /AUDIO_BASE64_INVALID: voice/,
    );
  });
  it('roundtrips BB and BC independently, preserves gameplay and unrelated tracks, and retains originals on failure', async () => {
    const audio = await fixture();
    const original = await createBBWorkPackage(ordinaryProject(), null, null);
    const originalText = JSON.stringify(original);
    const edited = await editBBProductionAudio(original, audio);
    expect(isValidPlacementContract(edited.project)).toBe(true);
    const reopened = await openBBWorkPackage(JSON.parse(JSON.stringify(edited)));
    expect((reopened.project as any).direction.production.audio).toEqual(audio);
    expect((reopened.project as any).takes).toEqual((original.project as any).takes);
    const bgmOnly = structuredClone(audio);
    bgmOnly.bgm!.gain = 0;
    const next = await editBBProductionAudio(edited, bgmOnly);
    expect((next.project as any).direction.production.audio.voices).toEqual(audio.voices);
    expect((next.project as any).direction.production.audio.cues).toEqual(audio.cues);
    const bad = structuredClone(audio);
    bad.voices![0]!.takeId = 'absent';
    await expect(editBBProductionAudio(original, bad)).rejects.toThrow(/AUDIO_VOICE_TAKE_UNKNOWN/);
    expect(JSON.stringify(original)).toBe(originalText);
    const bc = createBCDemo(),
      bcBefore = JSON.stringify(bc);
    const bcAudio = structuredClone(audio);
    bcAudio.voices![0]!.takeId = bc.takes[0]!.takeId;
    const bcEdited = await editBCProductionAudio(bc, bcAudio);
    const bcReopened = readBCProject(JSON.parse(JSON.stringify(bcEdited)));
    expect(bcProduction(bcReopened).audio).toEqual(bcAudio);
    expect(bcReopened.takes).toEqual(bc.takes);
    expect(
      (await mixBCAudio(compileBCPlayback(bcReopened, bc.takes[0]!.takeId, true)))!.scheduledVoices,
    ).toHaveLength(1);
    expect(JSON.stringify(bc)).toBe(bcBefore);
  });
});
