import { productionFromDocument } from '../nativeReference/agent-director/contracts';
import {
  compileProductionAudio,
  verifyProductionAudioAssets,
  type CompiledProductionAudio,
} from '../nativeReference/agent-director/audioMix';
import type { CompiledFrameSource } from '../nativeReference/game-runtime/frameSource';
import type { StudioProjectDocumentV2 } from '../nativeReference/game-runtime/projectEnvelope';

/** Use the received production.audio contract and event mixer; caller retains original JSON. */
export async function compileNativeProductionAudio(document: unknown, source: CompiledFrameSource) {
  const production = productionFromDocument(document as StudioProjectDocumentV2);
  if (!production?.audio) throw new Error('工程没有 production.audio。');
  if (
    production.presentation ||
    production.camera ||
    production.effects ||
    production.clips ||
    production.selectedClipId
  ) {
    throw new Error(
      '工程还包含尚未接入的 production 时序、镜头、特效或片段，不能将其当作完整导出。',
    );
  }
  await verifyProductionAudioAssets(production.audio);
  return compileProductionAudio(source, production.audio, 48_000);
}

/** Surface authored cues that did not match this particular frame source. */
export function describeUnmatchedProductionCues(
  document: unknown,
  unused: readonly string[],
): string {
  const production = productionFromDocument(document as StudioProjectDocumentV2);
  const authored = new Set((production?.audio?.cues ?? []).map((cue) => cue.eventType));
  const unmatched = [...new Set(unused.filter((type) => authored.has(type)))];
  return unmatched.length ? `本次回放没有命中以下工程音效事件：${unmatched.join('、')}。` : '';
}

/** Report, but never modify, the PCM the user authored for this particular export. */
export function describeProductionMixWarnings(
  document: unknown,
  mix: CompiledProductionAudio,
): string {
  const warnings = [describeUnmatchedProductionCues(document, mix.diagnostics.unusedCueEventTypes)];
  const truncated = mix.scheduledCues.filter((cue) => cue.truncated);
  if (truncated.length)
    warnings.push(
      `有 ${truncated.length} 个音效超出视频边界而被截断：${truncated.map((cue) => `${cue.eventType} (${cue.eventId})`).join('、')}。`,
    );
  if (mix.clippedSampleCount > 0)
    warnings.push(`混音有 ${mix.clippedSampleCount} 个采样触及限幅；请检查增益。`);
  const { data, numberOfChannels, sampleRate } = mix.track;
  const windowSamples = Math.min(data.length, Math.ceil(sampleRate * 0.01) * numberOfChannels);
  let peak = 0;
  for (let i = data.length - windowSamples; i < data.length; i++)
    peak = Math.max(peak, Math.abs(data[i] ?? 0));
  if (peak > 1e-4)
    warnings.push(
      `视频末尾 10 毫秒音频峰值 ${peak.toFixed(4)}，结束处可能突然中断；未自动添加淡出。`,
    );
  return warnings.filter(Boolean).join('');
}
