import {
  compileNativeProductionAudio,
  describeProductionMixWarnings,
} from './nativeProductionAudio';
import { compileBBTimeline } from './compileBBTimeline';
import { hasReferenceCalibration } from './hasReferenceCalibration';

type AudioFile = { name: string; arrayBuffer(): Promise<ArrayBuffer>; size: number };
type Options = {
  bgm?: AudioFile;
  placement?: AudioFile;
  clear?: AudioFile;
  bgmStart: number;
  bgmOffset: number;
  bgmGain: number;
  bgmLoop: boolean;
  cueGain: number;
};

/** Explicitly attach selected WAV bytes; do not replace an existing production direction. */
export async function attachObservedAudio(
  document: unknown,
  options: Options,
  restoreMode: 'current' | 'legacy-clear-body' = 'current',
) {
  const doc = structuredClone(document) as any;
  if (!doc?.direction?.style || doc.direction.production !== undefined)
    throw new Error('仅能为没有 production 设置的 BB 工程附加音频；原工程保留。');
  if (
    ![options.bgmStart, options.bgmOffset, options.bgmGain, options.cueGain].every(
      Number.isFinite,
    ) ||
    options.bgmStart < 0 ||
    options.bgmOffset < 0 ||
    options.bgmGain < 0 ||
    options.bgmGain > 1 ||
    options.cueGain < 0 ||
    options.cueGain > 1 ||
    typeof options.bgmLoop !== 'boolean'
  )
    throw new Error('音频起点、偏移或增益无效。');
  const entries = [
    ['music', options.bgm],
    ['placement', options.placement],
    ['clear', options.clear],
  ] as const;
  if (entries.every(([, file]) => !file)) throw new Error('请至少选择一个 WAV 音频。');
  const assets: Record<string, unknown> = {};
  for (const [id, file] of entries) {
    if (!file) continue;
    if (file.size < 1 || file.size > 16 * 1024 * 1024)
      throw new Error(`${id} 音频为空或超过 16 MiB。`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join(
      '',
    );
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    assets[id] = {
      id,
      kind: 'audio',
      mimeType: 'audio/wav',
      sourceName: file.name,
      encoding: 'base64',
      sha256,
      data: btoa(binary),
    };
  }
  const cues = [];
  if (options.placement)
    cues.push({
      eventType: 'block-placement.placement-committed',
      assetId: 'placement',
      gain: options.cueGain,
    });
  if (options.clear) {
    const clearEvents = hasReferenceCalibration(doc)
      ? restoreMode === 'legacy-clear-body'
        ? ['block-placement.reference-clear-body']
        : ['block-placement.reference-clear-body', 'block-placement.reference-clear-heavy']
      : ['block-placement.line-cleared', 'block-placement.cross-cleared'];
    for (const eventType of clearEvents)
      cues.push({ eventType, assetId: 'clear', gain: options.cueGain });
  }
  doc.direction.production = {
    version: '1.0.0',
    audio: {
      masterGain: 1,
      sfxGain: 1,
      mastering: 'preserve-level',
      assets,
      cues,
      ...(options.bgm
        ? {
            bgm: {
              assetId: 'music',
              startSeconds: options.bgmStart,
              sourceOffsetSeconds: options.bgmOffset,
              gain: options.bgmGain,
              loop: options.bgmLoop,
            },
          }
        : {}),
    },
  };
  const takes = doc.takes.filter(
    (take: any) => Array.isArray(take.actions) && take.actions.length > 0,
  );
  if (!takes.length) throw new Error('请先创建至少一个非空 Take，再绑定音频。');
  const mixes = [];
  for (const take of takes) {
    const { source } = compileBBTimeline(doc, take.takeId);
    mixes.push(await compileNativeProductionAudio(doc, source));
  }
  return {
    document: doc,
    warning: mixes
      .map((mix) => describeProductionMixWarnings(doc, mix))
      .filter(Boolean)
      .join('；'),
    scheduledCues: mixes.flatMap((mix) => mix.scheduledCues),
  };
}
