import { stableHash } from '../project/stableHash';
import type { AssetManifestEntry, AudioCueRef, TapTileProductionSpec } from '../project/types';
import { createDefaultTapTilePresentationAssets } from '../presentation/assets';

function synthAsset(id: string): AssetManifestEntry {
  return {
    id,
    kind: 'audio',
    source: { type: 'builtin', uri: `synth://${id}` },
    contentHash: stableHash({ id, synthesizer: 'taptile-semantic-audio-v1' }, 'audio'),
    version: '1',
  };
}

function cue(assetIds: string[], volume: number, delayFrames = 0, extras: Partial<AudioCueRef> = {}): AudioCueRef {
  return {
    assetIds,
    volume,
    startOffsetMs: 0,
    fadeInMs: 4,
    fadeOutMs: 28,
    delayFrames,
    peakLimit: 0.92,
    ...extras,
  };
}

const AUDIO_ASSET_IDS = [
  'audio-pop-tap-a', 'audio-pop-tap-b', 'audio-pop-pickup', 'audio-pop-settle',
  'audio-pop-match-a', 'audio-pop-match-b', 'audio-pop-shatter', 'audio-pop-warning',
  'audio-pop-win', 'audio-pop-outro',
  'audio-wood-tap-a', 'audio-wood-tap-b', 'audio-wood-pickup', 'audio-wood-settle',
  'audio-wood-match-a', 'audio-wood-match-b', 'audio-wood-shatter', 'audio-wood-warning',
  'audio-wood-win', 'audio-wood-outro',
] as const;

export function createDefaultTapTileAudioAssets(): Record<string, AssetManifestEntry> {
  return Object.fromEntries(AUDIO_ASSET_IDS.map((id) => [id, synthAsset(id)]));
}

export function createDefaultTapTileProductionSpec(): TapTileProductionSpec {
  return {
    audioPacks: {
      'bright-pop-v1': {
        id: 'bright-pop-v1',
        name: '明亮弹跳',
        peakLimit: 0.9,
        tap: cue(['audio-pop-tap-a', 'audio-pop-tap-b'], 0.42),
        pickup: cue(['audio-pop-pickup'], 0.3, 1),
        traySettle: cue(['audio-pop-settle'], 0.34),
        match: cue(['audio-pop-match-a', 'audio-pop-match-b'], 0.72),
        shatter: cue(['audio-pop-shatter'], 0.34, 1, { fadeOutMs: 55 }),
        warning: cue(['audio-pop-warning'], 0.48),
        win: cue(['audio-pop-win'], 0.74, 1, { fadeOutMs: 90 }),
        outro: cue(['audio-pop-outro'], 0.62, 2, { fadeInMs: 24, fadeOutMs: 120 }),
      },
      'soft-wood-v1': {
        id: 'soft-wood-v1',
        name: '柔和木质',
        peakLimit: 0.88,
        tap: cue(['audio-wood-tap-a', 'audio-wood-tap-b'], 0.34),
        pickup: cue(['audio-wood-pickup'], 0.24, 1),
        traySettle: cue(['audio-wood-settle'], 0.38),
        match: cue(['audio-wood-match-a', 'audio-wood-match-b'], 0.62),
        shatter: cue(['audio-wood-shatter'], 0.27, 1, { fadeOutMs: 70 }),
        warning: cue(['audio-wood-warning'], 0.4),
        win: cue(['audio-wood-win'], 0.68, 1, { fadeOutMs: 110 }),
        outro: cue(['audio-wood-outro'], 0.58, 2, { fadeInMs: 32, fadeOutMs: 150 }),
      },
    },
    selectedAudioPackId: 'bright-pop-v1',
    cuts: {
      'opening-six': {
        id: 'opening-six',
        name: '六步双消开场',
        takeRange: { startActionIndex: 0, endActionIndex: 5 },
        introFrames: 8,
        outroPackId: 'play-now-v1',
      },
      'full-performance-15s': {
        id: 'full-performance-15s',
        name: '全程 15 秒投放版',
        takeRange: { startActionIndex: 0, endActionIndex: 47 },
        timeWarpSegments: [{ sourceStartFrame: 120, sourceEndFrame: 720, speed: 1.25 }],
        introFrames: 12,
        outroPackId: 'play-now-v1',
        targetDurationFrames: 450,
      },
    },
    selectedCutId: 'opening-six',
    outros: {
      'play-now-v1': {
        id: 'play-now-v1',
        name: '立即试玩',
        transitionId: 'soft-zoom',
        headline: '轻点配对，立即通关！',
        ctaLabel: '立即试玩',
        durationFrames: 60,
      },
    },
  };
}

export function ensureTapTileProductionDefaults<T extends { assets: { entries: Record<string, AssetManifestEntry> }; production: TapTileProductionSpec }>(project: T): T {
  const next = structuredClone(project);
  const defaults = createDefaultTapTileProductionSpec();
  next.assets.entries = {
    ...createDefaultTapTileAudioAssets(),
    ...createDefaultTapTilePresentationAssets(),
    ...next.assets.entries,
  };
  next.production = {
    audioPacks: { ...defaults.audioPacks, ...(next.production?.audioPacks ?? {}) },
    selectedAudioPackId: next.production?.selectedAudioPackId ?? defaults.selectedAudioPackId ?? 'bright-pop-v1',
    cuts: { ...defaults.cuts, ...(next.production?.cuts ?? {}) },
    selectedCutId: next.production?.selectedCutId ?? defaults.selectedCutId ?? 'opening-six',
    outros: { ...defaults.outros, ...(next.production?.outros ?? {}) },
  };
  return next;
}
