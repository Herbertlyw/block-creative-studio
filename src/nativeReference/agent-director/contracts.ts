import type { StudioProjectDocumentV2 } from '../game-runtime/projectEnvelope';

export const PRODUCTION_DIRECTION_VERSION = '1.0.0' as const;
export const PRODUCTION_AUDIO_MAX_BASE64 = 64_000_000;

export interface ProductionActionTiming {
  actionId: string;
  sourceStartFrame: number;
  sourceEndFrame: number;
  durationScale?: number;
  holdBeforeFrames?: number;
  holdAfterFrames?: number;
}

export interface ProductionCamera {
  renderer: string;
  zoom?: number;
  panX?: number;
  panY?: number;
  /** Camera-local X/Y translation in reference pixels at 1920px frame height. */
  microX?: number;
  microY?: number;
  shakeIntensity?: number;
}

export interface ProductionEffects {
  intensity?: number;
  exposure?: number;
  saturation?: number;
  vignette?: number;
  feedbackText?: { text: string; eventType: string; durationFrames: number };
}

export type ProductionAudioAssetStorage =
  | { encoding: 'base64'; data: string; ref?: undefined }
  /** Bytes live outside the JSON; resolved to base64 in one Node step before render. */
  | { encoding: 'ref'; ref: string; data?: undefined };

export interface ProductionAudioAssetBase {
  id: string;
  kind: 'audio';
  mimeType: 'audio/wav' | 'audio/x-wav';
  sha256: string;
  sourceName: string;
  provenance?: { sourcePath?: string; assetRef?: string; sourceRef?: string; originalSha256?: string; originalMimeType?: string; conversion?: string };
}

export type ProductionAudioAsset = ProductionAudioAssetBase & ProductionAudioAssetStorage;

/** Narrows to the inline form; audio bytes are resolved before anything decodes them. */
export function requireInlineProductionAudio(asset: ProductionAudioAsset): ProductionAudioAssetBase & { encoding: 'base64'; data: string } {
  if (asset.encoding !== 'base64') throw new Error(`AUDIO_ASSET_UNRESOLVED_REF: ${asset.id}`);
  return asset;
}

export interface ProductionAudioCue {
  eventType: string;
  /** Optional exact occurrence; overrides an unscoped cue of the same matching type. */
  eventId?: string;
  assetId: string;
  gain?: number;
  offsetSeconds?: number;
}

export interface ProductionAudio {
  selectedPackId?: string;
  masterGain?: number;
  /** Opt-in reference audio path; the default soft limiter remains unchanged. */
  mastering?: 'soft-limit' | 'preserve-level';
  sfxEnabled?: boolean;
  sfxGain?: number;
  bgm?: { assetId: string; enabled?: boolean; gain?: number; loop?: boolean; startSeconds?: number; sourceOffsetSeconds?: number; fadeInSeconds?: number; fadeOutSeconds?: number };
  cues?: ProductionAudioCue[];
  assets?: Record<string, ProductionAudioAsset>;
}

export interface ProductionClip {
  id: string;
  takeId: string;
  source: { takeHash: string; frameSourceHash: string };
  startFrame: number;
  endFrame: number;
  crop?: { x: number; y: number; width: number; height: number };
}

export interface ProductionDirectionV1 {
  version: typeof PRODUCTION_DIRECTION_VERSION;
  presentation?: {
    sourceFrameSourceHash: string;
    actionTimings: ProductionActionTiming[];
  };
  camera?: ProductionCamera;
  effects?: ProductionEffects;
  audio?: ProductionAudio;
  clips?: ProductionClip[];
  selectedClipId?: string;
}

function fail(path: string, message: string): never {
  const error = new Error(`${path}: ${message}`) as Error & { code: string; path: string };
  error.code = 'PRODUCTION_DIRECTION_INVALID';
  error.path = path;
  throw error;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value as Record<string, unknown>;
}

function exact(source: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(source).find((key) => !allowed.includes(key));
  if (unknown) fail(`${path}.${unknown}`, 'unknown field');
}

function text(value: unknown, path: string, maximum = 240): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(path, `must be a non-empty string up to ${maximum} characters`);
  return value;
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a finite number in ${minimum}..${maximum}`);
  }
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail(path, `must be an integer >= ${minimum}`);
  return value as number;
}

function optionalNumber(source: Record<string, unknown>, key: string, path: string, minimum: number, maximum: number): number | undefined {
  return source[key] === undefined ? undefined : finite(source[key], `${path}.${key}`, minimum, maximum);
}

function parseActionTiming(value: unknown, index: number): ProductionActionTiming {
  const path = `$.presentation.actionTimings[${index}]`;
  const source = object(value, path);
  exact(source, ['actionId', 'sourceStartFrame', 'sourceEndFrame', 'durationScale', 'holdBeforeFrames', 'holdAfterFrames'], path);
  const start = integer(source.sourceStartFrame, `${path}.sourceStartFrame`);
  const end = integer(source.sourceEndFrame, `${path}.sourceEndFrame`);
  if (end < start) fail(`${path}.sourceEndFrame`, 'must be >= sourceStartFrame');
  return {
    actionId: text(source.actionId, `${path}.actionId`, 180),
    sourceStartFrame: start,
    sourceEndFrame: end,
    ...(source.durationScale === undefined ? {} : { durationScale: finite(source.durationScale, `${path}.durationScale`, 0.1, 8) }),
    ...(source.holdBeforeFrames === undefined ? {} : { holdBeforeFrames: integer(source.holdBeforeFrames, `${path}.holdBeforeFrames`) }),
    ...(source.holdAfterFrames === undefined ? {} : { holdAfterFrames: integer(source.holdAfterFrames, `${path}.holdAfterFrames`) }),
  };
}

function parseAsset(value: unknown, key: string): ProductionAudioAsset {
  const path = `$.audio.assets.${key}`;
  const source = object(value, path);
  exact(source, ['id', 'kind', 'mimeType', 'encoding', 'data', 'ref', 'sha256', 'sourceName', 'provenance'], path);
  const id = text(source.id, `${path}.id`, 180);
  if (id !== key) fail(`${path}.id`, 'must match its dictionary key');
  if (source.kind !== 'audio') fail(`${path}.kind`, 'must be audio');
  if (source.mimeType !== 'audio/wav' && source.mimeType !== 'audio/x-wav') fail(`${path}.mimeType`, 'only WAV is supported');
  // Audio is stored inline as base64, or as a reference resolved before render.
  // `data` and `ref` are mutually exclusive so a stale copy can never shadow the other.
  const referenced = source.encoding === 'ref';
  if (!referenced && source.encoding !== 'base64') fail(`${path}.encoding`, 'must be base64 or ref');
  if (referenced === (source.data !== undefined)) fail(`${path}.data`, referenced ? 'must be absent on a reference' : 'is required');
  if (referenced === (source.ref === undefined)) fail(`${path}.ref`, referenced ? 'is required' : 'must be absent on inline audio');
  let data = '';
  if (referenced) {
    text(source.ref, `${path}.ref`, 2048);
  } else {
    data = text(source.data, `${path}.data`, PRODUCTION_AUDIO_MAX_BASE64);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) fail(`${path}.data`, 'must be canonical base64');
  }
  const sha256 = text(source.sha256, `${path}.sha256`, 64);
  if (!/^[a-f0-9]{64}$/.test(sha256)) fail(`${path}.sha256`, 'must be a lowercase SHA-256 digest');
  let provenance: ProductionAudioAsset['provenance'];
  if (source.provenance !== undefined) {
    const raw = object(source.provenance, `${path}.provenance`);
    exact(raw, ['sourcePath','assetRef','sourceRef','originalSha256','originalMimeType','conversion'], `${path}.provenance`);
    provenance = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, text(value, `${path}.provenance.${key}`, 4096)]));
    if (provenance.originalSha256 && !/^[a-f0-9]{64}$/.test(provenance.originalSha256)) fail(`${path}.provenance.originalSha256`, 'must be a lowercase SHA-256 digest');
  }
  return {
    id, kind: 'audio', mimeType: source.mimeType, sha256,
    ...(referenced ? { encoding: 'ref' as const, ref: source.ref as string } : { encoding: 'base64' as const, data }),
    // Early rendered projects omitted this display-only label. Preserve their
    // bytes and timing, using the already validated asset id when reopening.
    sourceName: source.sourceName === undefined ? id : text(source.sourceName, `${path}.sourceName`, 240), ...(provenance ? { provenance } : {}),
  };
}

export function parseProductionDirection(value: unknown): ProductionDirectionV1 {
  const source = object(value, '$.direction.production');
  exact(source, ['version', 'presentation', 'camera', 'effects', 'audio', 'clips', 'selectedClipId'], '$.direction.production');
  if (source.version !== PRODUCTION_DIRECTION_VERSION) fail('$.direction.production.version', `must be ${PRODUCTION_DIRECTION_VERSION}`);
  const result: ProductionDirectionV1 = { version: PRODUCTION_DIRECTION_VERSION };
  if (source.presentation !== undefined) {
    const presentation = object(source.presentation, '$.presentation');
    exact(presentation, ['sourceFrameSourceHash', 'actionTimings'], '$.presentation');
    if (!Array.isArray(presentation.actionTimings) || presentation.actionTimings.length > 500) fail('$.presentation.actionTimings', 'must be an array of at most 500 entries');
    const actionTimings = presentation.actionTimings.map(parseActionTiming);
    if (new Set(actionTimings.map((item) => item.actionId)).size !== actionTimings.length) fail('$.presentation.actionTimings', 'actionId values must be unique');
    const sorted = [...actionTimings].sort((a, b) => a.sourceStartFrame - b.sourceStartFrame);
    if (sorted.some((item, index) => index > 0 && item.sourceStartFrame <= sorted[index - 1]!.sourceEndFrame)) fail('$.presentation.actionTimings', 'source ranges must not overlap');
    result.presentation = { sourceFrameSourceHash: text(presentation.sourceFrameSourceHash, '$.presentation.sourceFrameSourceHash', 240), actionTimings };
  }
  if (source.camera !== undefined) {
    const camera = object(source.camera, '$.camera');
    exact(camera, ['renderer', 'zoom', 'panX', 'panY', 'microX', 'microY', 'shakeIntensity'], '$.camera');
    const zoom = optionalNumber(camera, 'zoom', '$.camera', 0.5, 2);
    const panX = optionalNumber(camera, 'panX', '$.camera', -1, 1);
    const panY = optionalNumber(camera, 'panY', '$.camera', -1, 1);
    const microX = optionalNumber(camera, 'microX', '$.camera', -240, 240);
    const microY = optionalNumber(camera, 'microY', '$.camera', -240, 240);
    const shakeIntensity = optionalNumber(camera, 'shakeIntensity', '$.camera', 0, 2);
    result.camera = {
      renderer: text(camera.renderer, '$.camera.renderer', 120),
      ...(zoom === undefined ? {} : { zoom }),
      ...(panX === undefined ? {} : { panX }),
      ...(panY === undefined ? {} : { panY }),
      ...(microX === undefined ? {} : { microX }),
      ...(microY === undefined ? {} : { microY }),
      ...(shakeIntensity === undefined ? {} : { shakeIntensity }),
    };
  }
  if (source.effects !== undefined) {
    const effects = object(source.effects, '$.effects');
    exact(effects, ['intensity', 'exposure', 'saturation', 'vignette', 'feedbackText'], '$.effects');
    const intensity = optionalNumber(effects, 'intensity', '$.effects', 0, 2);
    const exposure = optionalNumber(effects, 'exposure', '$.effects', 0.5, 2);
    const saturation = optionalNumber(effects, 'saturation', '$.effects', 0, 2);
    const vignette = optionalNumber(effects, 'vignette', '$.effects', 0, 1);
    result.effects = {
      ...(intensity === undefined ? {} : { intensity }),
      ...(exposure === undefined ? {} : { exposure }),
      ...(saturation === undefined ? {} : { saturation }),
      ...(vignette === undefined ? {} : { vignette }),
      ...(effects.feedbackText === undefined ? {} : { feedbackText: (()=>{const feedback=object(effects.feedbackText,'$.effects.feedbackText');exact(feedback,['text','eventType','durationFrames'],'$.effects.feedbackText');return{text:text(feedback.text,'$.effects.feedbackText.text',80),eventType:text(feedback.eventType,'$.effects.feedbackText.eventType',180),durationFrames:integer(feedback.durationFrames,'$.effects.feedbackText.durationFrames',1)};})() }),
    };
  }
  if (source.audio !== undefined) {
    const audio = object(source.audio, '$.audio');
    exact(audio, ['selectedPackId', 'masterGain', 'mastering', 'sfxEnabled', 'sfxGain', 'bgm', 'cues', 'assets'], '$.audio');
    if (audio.mastering !== undefined && audio.mastering !== 'soft-limit' && audio.mastering !== 'preserve-level') fail('$.audio.mastering','must be soft-limit or preserve-level');
    if(audio.sfxEnabled!==undefined&&typeof audio.sfxEnabled!=='boolean')fail('$.audio.sfxEnabled','must be a boolean');
    const assets = audio.assets === undefined ? undefined : Object.fromEntries(Object.entries(object(audio.assets, '$.audio.assets')).map(([key, asset]) => [key, parseAsset(asset, key)]));
    let bgm: ProductionAudio['bgm'];
    if (audio.bgm !== undefined) {
      const raw = object(audio.bgm, '$.audio.bgm');
      exact(raw, ['assetId', 'enabled', 'gain', 'loop', 'startSeconds', 'sourceOffsetSeconds', 'fadeInSeconds', 'fadeOutSeconds'], '$.audio.bgm');
      if (raw.loop !== undefined && typeof raw.loop !== 'boolean') fail('$.audio.bgm.loop', 'must be a boolean');
      if(raw.enabled!==undefined&&typeof raw.enabled!=='boolean')fail('$.audio.bgm.enabled','must be a boolean');
      bgm = { assetId: text(raw.assetId, '$.audio.bgm.assetId', 180), ...(raw.gain === undefined ? {} : { gain: finite(raw.gain, '$.audio.bgm.gain', 0, 2) }), ...(raw.loop === undefined ? {} : { loop: raw.loop }) };
      if(raw.enabled!==undefined)bgm.enabled=raw.enabled;
      for(const key of ['startSeconds','sourceOffsetSeconds','fadeInSeconds','fadeOutSeconds'] as const)if(raw[key]!==undefined)bgm[key]=finite(raw[key],`$.audio.bgm.${key}`,0,key.startsWith('fade')?30:3600);
    }
    let cues: ProductionAudioCue[] | undefined;
    if (audio.cues !== undefined) {
      if (!Array.isArray(audio.cues) || audio.cues.length > 100) fail('$.audio.cues', 'must be an array of at most 100 entries');
      cues = audio.cues.map((value, index) => {
        const path = `$.audio.cues[${index}]`, cue = object(value, path);
        exact(cue, ['eventType', 'eventId', 'assetId', 'gain', 'offsetSeconds'], path);
        return { eventType: text(cue.eventType, `${path}.eventType`, 180), ...(cue.eventId === undefined ? {} : { eventId: text(cue.eventId, `${path}.eventId`, 512) }), assetId: text(cue.assetId, `${path}.assetId`, 180), ...(cue.gain === undefined ? {} : { gain: finite(cue.gain, `${path}.gain`, 0, 2) }), ...(cue.offsetSeconds === undefined ? {} : { offsetSeconds: finite(cue.offsetSeconds, `${path}.offsetSeconds`, -2, 10) }) };
      });
    }
    result.audio = { ...(audio.selectedPackId === undefined ? {} : { selectedPackId: text(audio.selectedPackId, '$.audio.selectedPackId', 180) }), ...(audio.masterGain === undefined ? {} : { masterGain: finite(audio.masterGain, '$.audio.masterGain', 0, 2) }), ...(bgm ? { bgm } : {}), ...(cues ? { cues } : {}), ...(assets ? { assets } : {}) };
    if(audio.sfxEnabled!==undefined)result.audio.sfxEnabled=audio.sfxEnabled;
    if(audio.mastering!==undefined)result.audio.mastering=audio.mastering as NonNullable<ProductionAudio['mastering']>;
    if(audio.sfxGain!==undefined)result.audio.sfxGain=finite(audio.sfxGain,'$.audio.sfxGain',0,2);
  }
  if (source.clips !== undefined) {
    if (!Array.isArray(source.clips) || source.clips.length > 100) fail('$.clips', 'must be an array of at most 100 entries');
    result.clips = source.clips.map((value, index) => {
      const path = `$.clips[${index}]`, clip = object(value, path);
      exact(clip, ['id', 'takeId', 'source', 'startFrame', 'endFrame', 'crop'], path);
      const sourceBinding = object(clip.source, `${path}.source`);
      exact(sourceBinding, ['takeHash', 'frameSourceHash'], `${path}.source`);
      const startFrame = integer(clip.startFrame, `${path}.startFrame`), endFrame = integer(clip.endFrame, `${path}.endFrame`);
      if (endFrame < startFrame) fail(`${path}.endFrame`, 'must be >= startFrame');
      let crop: ProductionClip['crop'];
      if (clip.crop !== undefined) {
        const raw = object(clip.crop, `${path}.crop`); exact(raw, ['x', 'y', 'width', 'height'], `${path}.crop`);
        crop = { x: integer(raw.x, `${path}.crop.x`), y: integer(raw.y, `${path}.crop.y`), width: integer(raw.width, `${path}.crop.width`, 1), height: integer(raw.height, `${path}.crop.height`, 1) };
      }
      return { id: text(clip.id, `${path}.id`, 180), takeId: text(clip.takeId, `${path}.takeId`, 180), source: { takeHash: text(sourceBinding.takeHash, `${path}.source.takeHash`, 240), frameSourceHash: text(sourceBinding.frameSourceHash, `${path}.source.frameSourceHash`, 240) }, startFrame, endFrame, ...(crop ? { crop } : {}) };
    });
    if (new Set(result.clips.map((clip) => clip.id)).size !== result.clips.length) fail('$.clips', 'clip ids must be unique');
  }
  if (source.selectedClipId !== undefined) {
    result.selectedClipId = text(source.selectedClipId, '$.selectedClipId', 180);
    if (!result.clips?.some((clip) => clip.id === result.selectedClipId)) fail('$.selectedClipId', 'must reference a declared clip');
  }
  return result;
}

export function productionFromDocument(document: StudioProjectDocumentV2): ProductionDirectionV1 | undefined {
  const value = document.direction?.production;
  return value === undefined ? undefined : parseProductionDirection(value);
}

export function withProduction(document: StudioProjectDocumentV2, production: ProductionDirectionV1): StudioProjectDocumentV2 {
  const copy = structuredClone(document);
  copy.direction = { ...(copy.direction ?? { rhythm: {} }), production };
  return copy;
}
