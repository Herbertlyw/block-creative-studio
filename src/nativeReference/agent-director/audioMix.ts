import {soundEventAudible} from './audioEvents';
import type { FixedFrameAudioTrack } from '../exporter/fixedFrameExporter';
import type { CompiledFrameSource } from '../game-runtime/frameSource';
import { requireInlineProductionAudio } from './contracts';
import type { ProductionAudio, ProductionAudioAsset, ProductionAudioCue } from './contracts';
import { voiceDuckingEnvelope } from './voiceDucking';

export interface ProductionScheduledCue {
  eventType: string;
  eventId: string;
  assetId: string;
  frameIndex: number;
  startSample: number;
  sourceOffsetSamples: number;
  sourceSha256: string;
  durationSamples: number;
  sourceDurationSamples: number;
  truncated: boolean;
  alignmentErrorSeconds: number;
}

export interface CompiledProductionAudio {
  intentionallySilent: boolean;
  track: FixedFrameAudioTrack;
  packId: string;
  pcmHash: string;
  scheduledCues: ProductionScheduledCue[];
  scheduledVoices: Array<{ id: string; takeId: string; assetId: string; startSample: number; sourceOffsetSamples: number; durationSamples: number; truncated: boolean }>;
  peakBeforeLimit: number;
  peakAfterLimit: number;
  clippedSampleCount: number;
  sourceAssets: Array<{ id: string; sha256: string; mimeType: string }>;
  diagnostics: { missingAssetIds: string[]; missingCueEventTypes: string[]; unusedCueEventTypes: string[]; unusedVoiceIds: string[]; truncatedCueCount: number; maximumAlignmentErrorSeconds: number };
}

const COMMON_CUES = [
  {eventType:'mahjong.pick',assetId:'builtin:soft-hit',gain:.5},
  {eventType:'mahjong.land',assetId:'builtin:tight-hit',gain:.45},
  {eventType:'mahjong.match',assetId:'builtin:clear',gain:.7},
  {eventType:'mahjong.rejected-tap',assetId:'builtin:error',gain:.45},
  {eventType:'mahjong.warning',assetId:'builtin:warning',gain:.35},
  {eventType:'mahjong.win',assetId:'builtin:outcome',gain:.6},
  {eventType:'mahjong.loss',assetId:'builtin:error',gain:.55},
  {eventType:'tap.accepted',assetId:'builtin:soft-hit',gain:.5},
  {eventType:'tap.rejected',assetId:'builtin:error',gain:.45},
  {eventType:'match.resolved',assetId:'builtin:clear',gain:.7},
  {eventType:'game.won',assetId:'builtin:outcome',gain:.6},
  {eventType:'game.lost',assetId:'builtin:error',gain:.55},
  {eventType:'*.input-rejected',assetId:'builtin:error',gain:.45},
];
const BUILTIN_PACKS = {
  'arcade-clean-v1': {
    cues: [
      ...COMMON_CUES,
      { eventType: '*.placement-committed', assetId: 'builtin:soft-hit', gain: 0.52 },
      { eventType: '*.piece-committed', assetId: 'builtin:soft-hit', gain: 0.52 },
      { eventType: '*.line-cleared', assetId: 'builtin:clear', gain: 0.72 },
      { eventType: '*.cross-cleared', assetId: 'builtin:clear', gain: 0.82 },
      { eventType: '*.blocks-eliminated', assetId: 'builtin:clear', gain: 0.72 },
      { eventType: '*.game-over', assetId: 'builtin:outcome', gain: 0.58 },
      { eventType: '*.outcome', assetId: 'builtin:outcome', gain: 0.58 },
    ],
  },
  'tense-pulse-v1': {
    bgm: { assetId: 'builtin:bgm-tense', gain: 0.2, loop: true },
    cues: [
      ...COMMON_CUES,
      { eventType: '*.placement-committed', assetId: 'builtin:tight-hit', gain: 0.62 },
      { eventType: '*.piece-committed', assetId: 'builtin:tight-hit', gain: 0.62 },
      { eventType: '*.line-cleared', assetId: 'builtin:clear', gain: 0.82 },
      { eventType: '*.cross-cleared', assetId: 'builtin:clear', gain: 0.9 },
      { eventType: '*.blocks-eliminated', assetId: 'builtin:clear', gain: 0.82 },
      { eventType: '*.game-over', assetId: 'builtin:outcome', gain: 0.68 },
      { eventType: '*.outcome', assetId: 'builtin:outcome', gain: 0.68 },
    ],
  },
} as const;
export const BUILTIN_AUDIO_IDS = new Set(['builtin:soft-hit', 'builtin:tight-hit', 'builtin:clear', 'builtin:outcome', 'builtin:error', 'builtin:warning', 'builtin:bgm-tense', 'builtin:bgm-calm']);
export function productionSoundLibrary(){return [...BUILTIN_AUDIO_IDS].map(id=>({id,kind:id.includes(':bgm-')?'bgm':'sfx',name:({'builtin:soft-hit':'轻触','builtin:tight-hit':'落槽','builtin:clear':'消除','builtin:outcome':'完成','builtin:error':'错误点击','builtin:warning':'容量提醒','builtin:bgm-tense':'紧张脉冲','builtin:bgm-calm':'轻快木琴'} as Record<string,string>)[id]}));}
export function productionDefaultCues(packId='arcade-clean-v1'):NonNullable<ProductionAudio['cues']>{if(!Object.hasOwn(BUILTIN_PACKS,packId))throw new Error(`AUDIO_PACK_UNSUPPORTED: ${packId}`);const pack=BUILTIN_PACKS[packId as keyof typeof BUILTIN_PACKS];return pack.cues.map(c=>({...c}));}

export function productionBgm(audio:ProductionAudio):ProductionAudio['bgm'] { return audio.bgm ?? (audio.selectedPackId==='tense-pulse-v1'?{assetId:'builtin:bgm-tense',gain:.2,loop:true}:undefined); }

export function productionAudioMuted(audio:ProductionAudio){const bgm=productionBgm(audio);return audio.masterGain===0||((audio.sfxEnabled===false||audio.sfxGain===0)&&(!bgm||bgm.enabled===false||bgm.gain===0)&&!(audio.voices??[]).some(voice=>voice.enabled!==false&&voice.gain!==0));}

export function productionAudioCatalog() {
  return Object.entries(BUILTIN_PACKS).map(([id, value]) => ({
    id,
    cueEventTypes: value.cues.map((cue) => cue.eventType),
    bgm: 'bgm' in value ? value.bgm.assetId : null,
  }));
}

/** Validate references without allocating or rendering a PCM track. */
export function validateProductionAudioReferences(audio: ProductionAudio): void {
  productionDefaultCues(audio.selectedPackId);
  const ids = [productionBgm(audio)?.assetId, ...(audio.cues ?? []).map(cue => cue.assetId), ...(audio.voices ?? []).map(cue => cue.assetId)];
  for (const id of ids) {
    if (!id) continue;
    if (id.startsWith('builtin:') ? !BUILTIN_AUDIO_IDS.has(id) : !Object.hasOwn(audio.assets ?? {}, id))
      throw new Error(`AUDIO_ASSET_UNKNOWN: ${id}`);
  }
}

export function validateProductionVoiceTakes(audio: ProductionAudio, takeIds: readonly string[]): void {
  for (const voice of audio.voices ?? [])
    if (!takeIds.includes(voice.takeId)) throw new Error(`AUDIO_VOICE_TAKE_UNKNOWN: ${voice.id}; Take ${voice.takeId}`);
}

export async function verifyProductionAudioAssets(audio: ProductionAudio): Promise<void> {
  for (const asset of Object.values(audio.assets ?? {})) {
    const bytes = base64Bytes(requireInlineProductionAudio(asset).data, asset.id);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const actual = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
    if (actual !== asset.sha256) throw new Error(`AUDIO_ASSET_HASH_MISMATCH: ${asset.id}`);
  }
}

function base64Bytes(data: string, assetId: string): Uint8Array {
  let decoded: string;
  try { decoded = atob(data); }
  catch { throw new Error(`AUDIO_BASE64_INVALID: ${assetId}`); }
  const result = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) result[index] = decoded.charCodeAt(index);
  return result;
}

function readAscii(view: DataView, offset: number, length: number): string {
  return Array.from({ length }, (_, index) => String.fromCharCode(view.getUint8(offset + index))).join('');
}

export interface AudioSample { data: Float32Array; sampleRate: number; channels: 1 | 2 }

export function decodeWav(asset: ProductionAudioAsset): AudioSample {
  const bytes = base64Bytes(requireInlineProductionAudio(asset).data, asset.id), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 44 || readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') throw new Error(`AUDIO_WAV_INVALID: ${asset.id}`);
  let offset = 12, format: { encoding: number; channels: number; sampleRate: number; bits: number } | undefined, dataOffset = -1, dataLength = 0;
  while (offset + 8 <= view.byteLength) {
    const id = readAscii(view, offset, 4), length = view.getUint32(offset + 4, true), body = offset + 8;
    if (body + length > view.byteLength) throw new Error(`AUDIO_WAV_INVALID: ${asset.id}`);
    if (id === 'fmt ' && length >= 16) format = { encoding: view.getUint16(body, true), channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    if (id === 'data') { dataOffset = body; dataLength = length; break; }
    offset = body + length + (length % 2);
  }
  if (!format || dataOffset < 0 || ![1, 3].includes(format.encoding) || ![1, 2].includes(format.channels) || ![16, 32].includes(format.bits) || format.sampleRate < 8_000 || format.sampleRate > 192_000) {
    throw new Error(`AUDIO_WAV_UNSUPPORTED: ${asset.id}; use mono/stereo PCM16 or float32 WAV`);
  }
  if ((format.encoding === 1 && format.bits !== 16) || (format.encoding === 3 && format.bits !== 32)) throw new Error(`AUDIO_WAV_UNSUPPORTED: ${asset.id}`);
  const bytesPerSample = format.bits / 8, blockAlign = bytesPerSample * format.channels;
  if (dataLength === 0 || dataLength % blockAlign !== 0) throw new Error(`AUDIO_WAV_DATA_ALIGNMENT_INVALID: ${asset.id}`);
  const frameCount = dataLength / blockAlign, samples = new Float32Array(frameCount * format.channels);
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < format.channels; channel += 1) {
      const cursor = dataOffset + (frame * format.channels + channel) * bytesPerSample;
      const sample = format.encoding === 1 ? view.getInt16(cursor, true) / 32768 : view.getFloat32(cursor, true);
      if (!Number.isFinite(sample)) throw new Error(`AUDIO_WAV_SAMPLE_INVALID: ${asset.id}`);
      samples[frame * format.channels + channel] = Math.max(-1, Math.min(1, sample));
    }
  }
  return { data: samples, sampleRate: format.sampleRate, channels: format.channels as 1 | 2 };
}

export function validateProductionAudioAsset(asset: ProductionAudioAsset): { sampleRate:number; sampleCount:number; channels:1|2 } {
  const decoded=decodeWav(asset);
  return {sampleRate:decoded.sampleRate,sampleCount:decoded.data.length / decoded.channels,channels:decoded.channels};
}

export function synthesizeProductionSound(assetId: string, sampleRate: number, durationSeconds?: number): Float32Array {
  const duration = durationSeconds ?? (assetId.includes(':bgm-') ? 16 : assetId.includes('error') ? .18 : assetId.includes('warning') ? .28 : assetId.includes('outcome') ? 0.8 : assetId.includes('clear') ? 0.34 : 0.12);
  const data = new Float32Array(Math.max(1, Math.round(sampleRate * duration)));
  let seed = 0x811c9dc5;
  for (const char of assetId) { seed ^= char.charCodeAt(0); seed = Math.imul(seed, 0x01000193); }
  for (let index = 0; index < data.length; index += 1) {
    const t = index / sampleRate, p = index / Math.max(1, data.length - 1);
    if(assetId==='builtin:bgm-calm'){
      const beat=Math.floor(t/.5),local=t%.5,notes=[261.63,329.63,392,523.25,392,329.63,293.66,392,220,261.63,329.63,440,329.63,261.63,293.66,196],frequency=notes[beat%notes.length]!;
      const env=Math.sin(Math.PI/2*Math.min(1,local/.012))*Math.exp(-local*8)*Math.min(1,(.5-local)/.025);
      data[index]=(Math.sin(2*Math.PI*frequency*local)+.22*Math.sin(2*Math.PI*frequency*2*local))*env*.35;
    } else if (assetId === 'builtin:bgm-tense') {
      const phase = t % 0.5, envelope = Math.exp(-phase * 8);
      data[index] = (Math.sin(Math.PI * 2 * 82 * t) * 0.6 + Math.sin(Math.PI * 2 * 164 * t) * 0.16) * envelope;
    } else {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 0xffffffff * 2 - 1;
      const base = assetId.includes('error') ? 240-p*110 : assetId.includes('warning') ? 390+Math.floor(t*10)%2*120 : assetId.includes('clear') ? 520 + p * 680 : assetId.includes('outcome') ? 262 + Math.floor(p * 4) * 86 : assetId.includes('tight') ? 310 : 220;
      data[index] = (Math.sin(Math.PI * 2 * base * t) * 0.8 + noise * (assetId.includes('clear') ? 0.2 : 0.04)) * Math.pow(1 - p, 2);
    }
  }
  return data;
}

function matches(pattern: string, eventType: string): boolean {
  return pattern.startsWith('*.') ? eventType.endsWith(pattern.slice(1)) : pattern === eventType;
}

function sampleAt(source: AudioSample, sampleIndex: number, targetRate: number, channel: 0 | 1): number {
  const sourceIndex = sampleIndex * source.sampleRate / targetRate;
  const left = Math.floor(sourceIndex), fraction = sourceIndex - left;
  const lane = Math.min(channel, source.channels - 1), index = left * source.channels + lane;
  return (source.data[index] ?? 0) * (1 - fraction) + (source.data[index + source.channels] ?? source.data[index] ?? 0) * fraction;
}

function hashPcm(data: Float32Array): string {
  let hash = 0x811c9dc5;
  for (const sample of data) {
    const value = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    hash ^= value & 255; hash = Math.imul(hash, 0x01000193); hash ^= (value >>> 8) & 255; hash = Math.imul(hash, 0x01000193);
  }
  return `pcm-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

type AudioFrameWindow = { startFrame: number; endFrame: number };

/** Synchronous API retained for validation and Node callers. */
export function compileProductionAudio(frameSource: CompiledFrameSource, audio: ProductionAudio, sampleRate = 48_000, frameWindow?: AudioFrameWindow): CompiledProductionAudio {
  const steps = compileProductionAudioSteps(frameSource, audio, sampleRate, frameWindow);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/** Cooperatively yield so long mixes can report progress and accept cancellation. */
export async function compileProductionAudioAsync(frameSource: CompiledFrameSource, audio: ProductionAudio, sampleRate = 48_000, frameWindow?: AudioFrameWindow, signal?: AbortSignal): Promise<CompiledProductionAudio> {
  signal?.throwIfAborted();
  const steps = compileProductionAudioSteps(frameSource, audio, sampleRate, frameWindow);
  let deadline = performance.now() + 12;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const step = steps.next();
      if (step.done) return step.value;
      if (performance.now() >= deadline) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        deadline = performance.now() + 12;
      }
    }
  } finally { steps.return(undefined as never); }
}

function* compileProductionAudioSteps(frameSource: CompiledFrameSource, audio: ProductionAudio, sampleRate: number, frameWindow?: AudioFrameWindow): Generator<void, CompiledProductionAudio, void> {
  validateProductionAudioReferences(audio);
  const firstFrame = frameWindow?.startFrame ?? 0;
  const lastFrame = frameWindow?.endFrame ?? frameSource.totalFrames - 1;
  if (frameWindow && (!Number.isInteger(firstFrame) || !Number.isInteger(lastFrame) || firstFrame < 0 || lastFrame < firstFrame || lastFrame >= frameSource.totalFrames)) throw new Error('AUDIO_FRAME_WINDOW_INVALID');
  const windowStartSample = Math.round(firstFrame / frameSource.fps * sampleRate);
  const selectedPackId = audio.selectedPackId ?? 'arcade-clean-v1';
  const pack = BUILTIN_PACKS[selectedPackId as keyof typeof BUILTIN_PACKS];
  if (!pack) throw new Error(`AUDIO_PACK_UNSUPPORTED: ${selectedPackId}`);
  const cues: ProductionAudioCue[] = audio.sfxEnabled===false?[]:[...(audio.cues ?? pack.cues)];
  if(audio.sfxEnabled!==false)for(const fallback of COMMON_CUES.filter(c=>c.eventType.includes('rejected'))){if(!cues.some(c=>c.eventType===fallback.eventType))cues.push({...fallback});}
  const bgm:ProductionAudio['bgm'] = productionBgm(audio);
  const fullDurationSamples = Math.max(1, Math.ceil(frameSource.totalFrames / frameSource.fps * sampleRate));
  const durationSamples = frameWindow ? Math.max(1, Math.ceil((lastFrame - firstFrame + 1) / frameSource.fps * sampleRate)) : fullDurationSamples;
  const stereo = new Float32Array(durationSamples * 2), decoded = new Map<string, AudioSample>(), scheduledCues: ProductionScheduledCue[] = [];
  const assets = audio.assets ?? {};
  const sourceFor = (assetId: string, duration?: number): AudioSample => {
    const cached = decoded.get(assetId); if (cached) return cached;
    if (assetId.startsWith('builtin:') && !BUILTIN_AUDIO_IDS.has(assetId)) throw new Error(`AUDIO_ASSET_UNKNOWN: ${assetId}`);
    const source: AudioSample = assetId.startsWith('builtin:') ? { data: synthesizeProductionSound(assetId, sampleRate, duration), sampleRate, channels: 1 } : decodeWav(assets[assetId] ?? (() => { throw new Error(`AUDIO_ASSET_UNKNOWN: ${assetId}`); })());
    decoded.set(assetId, source); return source;
  };
  const voices = (audio.voices ?? []).filter(voice => voice.takeId === frameSource.takeId && voice.enabled !== false).map(voice => {
    const source = sourceFor(voice.assetId);
    const offset = Math.round((voice.sourceOffsetSeconds ?? 0) * sampleRate);
    const sourceFrames = Math.round(source.data.length / source.channels * sampleRate / source.sampleRate);
    if (offset >= sourceFrames) throw new Error(`AUDIO_VOICE_OFFSET_OUT_OF_RANGE: ${voice.id}`);
    return { voice, source, offset, length: sourceFrames - offset, start: Math.round(voice.startSeconds * sampleRate) };
  });
  const duck = audio.ducking;
  const envelope = duck?.enabled ? voiceDuckingEnvelope(
    voices.filter(({ voice }) => voice.gain !== 0).map(({ start, length }) => ({ start, end: start + length })),
    Math.round(duck.attackSeconds * sampleRate), Math.round(duck.releaseSeconds * sampleRate), windowStartSample, durationSamples,
  ) : null;
  const duckGain = (sample: number, target: number) => 1 - (1 - target) * (envelope?.[sample] ?? 0);
  const mix = function* (source: AudioSample, start: number, gain: number, loop: boolean, sourceOffsetSamples = 0, envelope?:(index:number)=>number): Generator<void, number, void> {
    const skipped = Math.max(0, -start);
    start = Math.max(0, start);
    sourceOffsetSamples += skipped;
    const available = durationSamples - start;
    let written = 0;
    for (let index = 0; index < available; index += 1) {
      if (index % 65536 === 0) yield;
      const sourceFrames = Math.max(1, Math.round(source.data.length / source.channels * sampleRate / source.sampleRate));
      const sourcePosition = sourceOffsetSamples + index;
      if (!loop && sourcePosition >= sourceFrames) break;
      const left = (start + index) * 2, right = left + 1;
      stereo[left] = (stereo[left] ?? 0) + sampleAt(source, sourcePosition % sourceFrames, sampleRate, 0) * gain * (envelope?.(index + skipped)??1);
      stereo[right] = (stereo[right] ?? 0) + sampleAt(source, sourcePosition % sourceFrames, sampleRate, 1) * gain * (envelope?.(index + skipped)??1);
      written += 1;
    }
    return written;
  };
  if (bgm&&bgm.enabled!==false) {
    const start=Math.round((bgm.startSeconds??0)*sampleRate),source=sourceFor(bgm.assetId),offset=Math.round((bgm.sourceOffsetSeconds??0)*sampleRate),loop=bgm.loop??true;
    const sourceFrames=Math.round(source.data.length/source.channels*sampleRate/source.sampleRate),length=Math.max(0,Math.min(fullDurationSamples-start,loop?Infinity:sourceFrames-offset)),fadeIn=(bgm.fadeInSeconds??.15)*sampleRate,fadeOut=(bgm.fadeOutSeconds??.3)*sampleRate;
    yield* mix(source,start-windowStartSample,bgm.gain??.2,loop,offset,i=>Math.min(1,fadeIn?i/fadeIn:1,fadeOut?(length-1-i)/fadeOut:1)*duckGain(start-windowStartSample+i,duck?.bgmGain??1));
  }
  const seenIds = new Set<string>();
  let matchedCueIndexes = new Set<number>();
  for (let frame = 0; frame < frameSource.totalFrames; frame += 1) {
    if (frame % 60 === 0) yield;
    const packet = frameSource.evaluate(frame);
    for (const event of packet.semanticEvents) {
      if (seenIds.has(event.id)||!soundEventAudible(event)) continue;
      seenIds.add(event.id);
      const eligible = [...cues.entries()].filter(([, cue]) => (cue.eventId === undefined || cue.eventId === event.id) && matches(cue.eventType, event.type));
      const scoped = eligible.some(([, cue]) => cue.eventId === event.id);
      const selected = scoped ? eligible.filter(([, cue]) => cue.eventId === event.id) : eligible;
      const exact = selected.some(([, cue]) => cue.eventType === event.type);
      for (const [cueIndex, cue] of selected) {
        if (exact ? cue.eventType !== event.type : !matches(cue.eventType, event.type)) continue;
        matchedCueIndexes.add(cueIndex);
        const offset = Math.round((cue.offsetSeconds ?? 0) * sampleRate), unclampedStartSample = Math.round(frame / frameSource.fps * sampleRate) + offset - windowStartSample, startSample = Math.max(0, unclampedStartSample), sourceOffsetSamples = Math.max(0, -unclampedStartSample);
        const source = sourceFor(cue.assetId), sourceDurationSamples = Math.max(1, Math.round(source.data.length / source.channels * sampleRate / source.sampleRate));
        if (frameWindow && (startSample >= durationSamples || sourceOffsetSamples >= sourceDurationSamples)) continue;
        const target = duck?.eventTypes.some(pattern => matches(pattern, event.type)) ? duck.sfxGain : 1;
        const writtenSamples = yield* mix(source, startSample, (cue.gain ?? 1)*(audio.sfxGain??1), false, sourceOffsetSamples, i => duckGain(startSample + i, target));
        const idealStart = (frame - firstFrame) / frameSource.fps + (cue.offsetSeconds ?? 0);
        scheduledCues.push({ eventType: event.type, eventId: event.id, assetId: cue.assetId, frameIndex: frame - firstFrame, startSample, sourceOffsetSamples, sourceSha256: cue.assetId.startsWith('builtin:') ? `builtin:${cue.assetId}` : assets[cue.assetId]!.sha256, durationSamples: writtenSamples, sourceDurationSamples, truncated: sourceOffsetSamples > 0 || sourceOffsetSamples + writtenSamples < sourceDurationSamples, alignmentErrorSeconds: startSample / sampleRate - Math.max(0, idealStart) });
      }
    }

  }
  const scheduledVoices: CompiledProductionAudio['scheduledVoices'] = [];
  for (const { voice, source, start, offset, length } of voices) {
    const relative = start - windowStartSample;
    const skipped = Math.max(0, -relative);
    if (relative >= durationSamples || skipped >= length) continue;
    const fadeIn = (voice.fadeInSeconds ?? 0) * sampleRate, fadeOut = (voice.fadeOutSeconds ?? 0) * sampleRate;
    const written = yield* mix(source, relative, voice.gain ?? 1, false, offset,
      i => Math.min(1, fadeIn ? i / fadeIn : 1, fadeOut ? (length - 1 - i) / fadeOut : 1));
    scheduledVoices.push({ id: voice.id, takeId: voice.takeId, assetId: voice.assetId, startSample: Math.max(0, relative), sourceOffsetSamples: offset + skipped, durationSamples: written, truncated: skipped > 0 || skipped + written < length });
  }
  const master = audio.masterGain ?? 1;
  let peakBeforeLimit = 0, peakAfterLimit = 0, clippedSampleCount = 0;
  for (let index = 0; index < stereo.length; index += 1) {
    if (index % 131072 === 0) yield;
    const raw = stereo[index]! * master; peakBeforeLimit = Math.max(peakBeforeLimit, Math.abs(raw));
    const preserve = audio.mastering === 'preserve-level';
    if (Math.abs(raw) > (preserve ? 1 : 0.96)) clippedSampleCount += 1;
    stereo[index] = preserve ? Math.max(-1, Math.min(1, raw)) : Math.tanh(raw / 0.96) * 0.96;
    peakAfterLimit = Math.max(peakAfterLimit, Math.abs(stereo[index]!));
  }
  return {
    intentionallySilent:productionAudioMuted(audio),
    track: { data: stereo, sampleRate, numberOfChannels: 2, bitrate: 192_000 },
    packId: selectedPackId,
    pcmHash: hashPcm(stereo),
    scheduledCues,
    scheduledVoices,
    peakBeforeLimit,
    peakAfterLimit,
    clippedSampleCount,
    sourceAssets: Object.values(assets).map((asset) => ({ id: asset.id, sha256: asset.sha256, mimeType: asset.mimeType })),
    diagnostics: {
      missingAssetIds: [],
      missingCueEventTypes: [],
      unusedCueEventTypes: [...new Set(cues.filter((_, index) => !matchedCueIndexes.has(index)).map((cue) => cue.eventType))],
      unusedVoiceIds: voices.filter(({ voice }) => voice.gain !== 0 && !scheduledVoices.some(scheduled => scheduled.id === voice.id)).map(({ voice }) => voice.id),
      truncatedCueCount: scheduledCues.filter((cue) => cue.truncated).length,
      maximumAlignmentErrorSeconds: Math.max(0, ...scheduledCues.map((cue) => Math.abs(cue.alignmentErrorSeconds))),
    },
  };
}
