import type { CompiledTapTileTake } from '../director';
import type { AudioCueRef, AudioPack, TapTileProjectV2 } from '../project';
import type { CompiledTapTileCut } from './cut';

export type TapTileAudioCueKind = 'tap' | 'pickup' | 'traySettle' | 'match' | 'shatter' | 'warning' | 'win' | 'outro';

export interface ScheduledTapTileAudioCue {
  id: string;
  kind: TapTileAudioCueKind;
  eventId: string;
  assetId: string;
  sourceFrame: number;
  finalFrame: number;
  startSample: number;
  durationSamples: number;
  volume: number;
}

export interface CompiledTapTileAudioMix {
  id: string;
  packId: string;
  sampleRate: number;
  numberOfChannels: 2;
  data: Float32Array;
  durationSeconds: number;
  scheduledCues: ScheduledTapTileAudioCue[];
  peakBeforeLimit: number;
  peakAfterLimit: number;
  peakLimit: number;
  pcmHash: string;
}

interface CueEvent {
  kind: TapTileAudioCueKind;
  eventId: string;
  sourceFrame: number;
  cue: AudioCueRef;
}

function uintHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function chooseVariant(cue: AudioCueRef, seed: number, eventId: string, kind: TapTileAudioCueKind): string {
  if (cue.assetIds.length === 0) throw new Error(`AUDIO_CUE_EMPTY: ${kind}`);
  const index = uintHash(`${seed}:${eventId}:${kind}`) % cue.assetIds.length;
  return cue.assetIds[index]!;
}

function cueDurationSeconds(assetId: string): number {
  if (assetId.includes('outro')) return 1.25;
  if (assetId.includes('win')) return 0.92;
  if (assetId.includes('match')) return 0.42;
  if (assetId.includes('shatter')) return 0.34;
  if (assetId.includes('warning')) return 0.48;
  if (assetId.includes('pickup')) return 0.16;
  if (assetId.includes('settle')) return 0.14;
  return 0.11;
}

function synthesizeCue(assetId: string, sampleRate: number): Float32Array {
  const duration = cueDurationSeconds(assetId);
  const length = Math.max(1, Math.round(duration * sampleRate));
  const output = new Float32Array(length);
  const wood = assetId.includes('wood');
  const variant = (uintHash(assetId) % 97) / 97;
  let noiseState = uintHash(`${assetId}:noise`) || 1;
  const noise = (): number => {
    noiseState = (Math.imul(noiseState, 1664525) + 1013904223) >>> 0;
    return (noiseState / 0xffffffff) * 2 - 1;
  };
  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate;
    const progress = index / Math.max(1, length - 1);
    const decay = Math.pow(1 - progress, wood ? 2.5 : 1.65);
    let value: number;
    if (assetId.includes('outro')) {
      const chord = [261.63, 329.63, 392].reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * time), 0) / 3;
      value = chord * Math.sin(Math.PI * Math.min(1, progress * 1.5)) * Math.pow(1 - progress, 0.45);
    } else if (assetId.includes('win')) {
      const step = Math.min(3, Math.floor(progress * 4));
      const frequency = [523.25, 659.25, 783.99, 1046.5][step]!;
      value = Math.sin(2 * Math.PI * frequency * time) * decay;
    } else if (assetId.includes('match')) {
      const frequency = (wood ? 220 : 420) + 520 * progress + variant * 45;
      value = (Math.sin(2 * Math.PI * frequency * time) * 0.72 + Math.sin(2 * Math.PI * frequency * 1.5 * time) * 0.28) * decay;
    } else if (assetId.includes('shatter')) {
      value = (noise() * 0.76 + Math.sin(2 * Math.PI * (820 - progress * 530) * time) * 0.24) * decay;
    } else if (assetId.includes('warning')) {
      const gate = Math.floor(time * 12) % 2 === 0 ? 1 : 0.22;
      value = Math.sin(2 * Math.PI * (wood ? 330 : 660) * time) * gate * decay;
    } else if (assetId.includes('pickup')) {
      const frequency = (wood ? 180 : 390) + progress * (wood ? 170 : 510);
      value = Math.sin(2 * Math.PI * frequency * time) * decay;
    } else if (assetId.includes('settle')) {
      value = (Math.sin(2 * Math.PI * (wood ? 145 : 260) * time) + noise() * (wood ? 0.2 : 0.06)) * decay;
    } else {
      value = (Math.sin(2 * Math.PI * (wood ? 210 : 520 + variant * 80) * time) + noise() * (wood ? 0.16 : 0.03)) * decay;
    }
    output[index] = Math.max(-1, Math.min(1, value));
  }
  return output;
}

function collectCueEvents(compiled: CompiledTapTileTake, cut: CompiledTapTileCut, pack: AudioPack): CueEvent[] {
  const events: CueEvent[] = [];
  for (const entry of compiled.events) {
    if (cut.sourceFrameToFinalFrame(entry.frame) === null) continue;
    if (entry.event.type === 'tap.accepted' || entry.event.type === 'tap.rejected') {
      events.push({ kind: 'tap', eventId: entry.id, sourceFrame: entry.frame, cue: pack.tap });
    } else if (entry.event.type === 'tile.fly-to-tray' && pack.pickup) {
      events.push({ kind: 'pickup', eventId: entry.id, sourceFrame: entry.frame, cue: pack.pickup });
    } else if (entry.event.type === 'tray.reordered') {
      events.push({ kind: 'traySettle', eventId: entry.id, sourceFrame: entry.frame, cue: pack.traySettle });
    } else if (entry.event.type === 'match.resolved') {
      events.push({ kind: 'match', eventId: entry.id, sourceFrame: entry.frame, cue: pack.match });
      if (pack.shatter) events.push({ kind: 'shatter', eventId: `${entry.id}:shatter`, sourceFrame: entry.frame, cue: pack.shatter });
    } else if (entry.event.type === 'tray.warning' && pack.warning) {
      events.push({ kind: 'warning', eventId: entry.id, sourceFrame: entry.frame, cue: pack.warning });
    } else if (entry.event.type === 'game.won' && pack.win) {
      events.push({ kind: 'win', eventId: entry.id, sourceFrame: entry.frame, cue: pack.win });
    }
  }
  if (cut.outroFrames > 0 && pack.outro) {
    events.push({ kind: 'outro', eventId: `${cut.id}:outro`, sourceFrame: cut.sourceEndFrame, cue: pack.outro });
  }
  return events;
}

function pcmHash(data: Float32Array): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < data.length; index += 1) {
    const quantized = Math.max(-32768, Math.min(32767, Math.round((data[index] ?? 0) * 32767)));
    hash ^= quantized & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (quantized >>> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return `pcm-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function compileTapTileAudioMix(
  project: TapTileProjectV2,
  compiled: CompiledTapTileTake,
  cut: CompiledTapTileCut,
  pack: AudioPack,
  sampleRate = 48_000,
): CompiledTapTileAudioMix {
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000) throw new Error('AUDIO_SAMPLE_RATE_INVALID');
  const frameCount = Math.max(1, Math.ceil((cut.totalFrames / compiled.fps) * sampleRate));
  const stereo = new Float32Array(frameCount * 2);
  const scheduledCues: ScheduledTapTileAudioCue[] = [];
  const events = collectCueEvents(compiled, cut, pack);
  for (const event of events) {
    const finalFrame = event.kind === 'outro'
      ? cut.totalFrames - cut.outroFrames
      : cut.sourceFrameToFinalFrame(event.sourceFrame);
    if (finalFrame === null) continue;
    const assetId = chooseVariant(event.cue, compiled.seed, event.eventId, event.kind);
    const asset = project.assets.entries[assetId];
    if (!asset) throw new Error(`AUDIO_ASSET_MISSING: ${assetId}`);
    if (asset.kind !== 'audio') throw new Error(`AUDIO_ASSET_KIND_INVALID: ${assetId}`);
    if (asset.source.type !== 'builtin' || !asset.source.uri.startsWith('synth://')) {
      throw new Error(`AUDIO_ASSET_DECODER_REQUIRED: ${assetId}`);
    }
    const mono = synthesizeCue(assetId, sampleRate);
    const sourceOffset = Math.max(0, Math.round(event.cue.startOffsetMs / 1000 * sampleRate));
    const delaySamples = Math.round(event.cue.delayFrames / compiled.fps * sampleRate);
    const startSample = Math.max(0, Math.round(finalFrame / compiled.fps * sampleRate) + delaySamples);
    const fadeInSamples = Math.max(0, Math.round(event.cue.fadeInMs / 1000 * sampleRate));
    const fadeOutSamples = Math.max(0, Math.round(event.cue.fadeOutMs / 1000 * sampleRate));
    const cuePeak = Math.max(0.05, Math.min(1, event.cue.peakLimit ?? 1));
    const pan = ((uintHash(`${event.eventId}:pan`) % 201) - 100) / 1000;
    const leftGain = Math.sqrt((1 - pan) / 2) * Math.SQRT2;
    const rightGain = Math.sqrt((1 + pan) / 2) * Math.SQRT2;
    let written = 0;
    for (let sourceIndex = sourceOffset; sourceIndex < mono.length; sourceIndex += 1) {
      const targetIndex = startSample + written;
      if (targetIndex >= frameCount) break;
      const remaining = mono.length - sourceIndex;
      const fadeIn = fadeInSamples === 0 ? 1 : Math.min(1, written / fadeInSamples);
      const fadeOut = fadeOutSamples === 0 ? 1 : Math.min(1, remaining / fadeOutSamples);
      const sample = Math.max(-cuePeak, Math.min(cuePeak, (mono[sourceIndex] ?? 0) * event.cue.volume * fadeIn * fadeOut));
      stereo[targetIndex * 2] = (stereo[targetIndex * 2] ?? 0) + sample * leftGain;
      stereo[targetIndex * 2 + 1] = (stereo[targetIndex * 2 + 1] ?? 0) + sample * rightGain;
      written += 1;
    }
    scheduledCues.push({
      id: `${event.eventId}:${assetId}`,
      kind: event.kind,
      eventId: event.eventId,
      assetId,
      sourceFrame: event.sourceFrame,
      finalFrame,
      startSample,
      durationSamples: written,
      volume: event.cue.volume,
    });
  }
  let peakBeforeLimit = 0;
  for (const sample of stereo) peakBeforeLimit = Math.max(peakBeforeLimit, Math.abs(sample));
  const peakLimit = Math.max(0.1, Math.min(0.99, pack.peakLimit ?? 0.92));
  for (let index = 0; index < stereo.length; index += 1) {
    const sample = stereo[index] ?? 0;
    stereo[index] = Math.tanh(sample / peakLimit) * peakLimit;
  }
  let peakAfterLimit = 0;
  for (const sample of stereo) peakAfterLimit = Math.max(peakAfterLimit, Math.abs(sample));
  const hash = pcmHash(stereo);
  return {
    id: `audio-${uintHash(`${pack.id}:${cut.frameMapHash}:${hash}`).toString(16).padStart(8, '0')}`,
    packId: pack.id,
    sampleRate,
    numberOfChannels: 2,
    data: stereo,
    durationSeconds: frameCount / sampleRate,
    scheduledCues,
    peakBeforeLimit,
    peakAfterLimit,
    peakLimit,
    pcmHash: hash,
  };
}
