import { encodeBase64Bytes, sha256Hex } from '../nativeReference/agent-assets/image';
import {
  productionDefaultCues,
  validateProductionAudioAsset,
} from '../nativeReference/agent-director/audioMix';
import type {
  ProductionAudio,
  ProductionAudioCue,
  ProductionDirectionV1,
} from '../nativeReference/agent-director/contracts';
import { openBBWorkPackage, updateBBWorkPackageProject, type BBWorkPackage } from './bbWorkPackage';
import { hasReferenceCalibration } from './hasReferenceCalibration';
import { pruneSupersededAssets } from './pruneSupersededAssets';

export type AudioRole = 'bgm' | 'placement' | 'clear';
export const BB_AUDIO_EVENTS = {
  placement: ['block-placement.placement-committed', '*.placement-committed'],
  clear: [
    'block-placement.reference-clear-body',
    'block-placement.reference-clear-heavy',
    'block-placement.line-cleared',
    'block-placement.cross-cleared',
    '*.line-cleared',
    '*.cross-cleared',
  ],
} as const;

/** Add or replace one role, retaining other cues and the user's existing mix settings. */
export async function setNativeWorkAudio(
  work: BBWorkPackage,
  role: AudioRole,
  file: Pick<File, 'name' | 'size' | 'arrayBuffer'>,
): Promise<BBWorkPackage> {
  if (!['bgm', 'placement', 'clear'].includes(role)) throw new Error(`不支持的音频角色：${role}`);
  const original = await openBBWorkPackage(work);
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > 16 * 1024 * 1024)
    throw new Error('WAV 为空或超过 16 MiB。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size) throw new Error('WAV 字节数与文件声明不一致。');
  const doc = structuredClone(original.project) as {
    direction: { production?: ProductionDirectionV1 };
  };
  const production = doc.direction.production ?? { version: '1.0.0' as const };
  const audio: ProductionAudio = production.audio ?? {
    masterGain: 1,
    sfxGain: 1,
    mastering: 'preserve-level',
    assets: {},
    cues: [],
  };
  const oldIds = new Set<string>();
  const sha256 = await sha256Hex(bytes),
    id = `work-audio-${sha256}`;
  const asset = {
    id,
    kind: 'audio' as const,
    mimeType: 'audio/wav' as const,
    sourceName: file.name,
    encoding: 'base64' as const,
    sha256,
    data: encodeBase64Bytes(bytes),
  };
  validateProductionAudioAsset(asset);
  const assets = audio.assets ?? {};
  const existing = assets[id];
  if (
    existing &&
    (existing.sha256 !== sha256 || existing.encoding !== 'base64' || existing.data !== asset.data)
  )
    throw new Error(`音频素材标识冲突：${id}。`);
  assets[id] = asset;
  audio.assets = assets;
  if (role === 'bgm') {
    if (audio.bgm) oldIds.add(audio.bgm.assetId);
    audio.bgm = audio.bgm
      ? { ...audio.bgm, assetId: id }
      : { assetId: id, startSeconds: 0, sourceOffsetSeconds: 0, gain: 0.2, loop: true };
  } else {
    // Materialize default cues before editing one role, so other default sounds survive.
    const allCues: ProductionAudioCue[] = audio.cues ?? productionDefaultCues(audio.selectedPackId);
    const events: readonly string[] = BB_AUDIO_EVENTS[role];
    const matching = allCues.filter((cue) => events.includes(cue.eventType));
    if (matching.length) {
      for (const cue of matching) {
        oldIds.add(cue.assetId);
        cue.assetId = id;
      }
    } else {
      const eventTypes =
        role === 'placement'
          ? ['block-placement.placement-committed']
          : hasReferenceCalibration(doc)
            ? ['block-placement.reference-clear-body', 'block-placement.reference-clear-heavy']
            : ['block-placement.line-cleared', 'block-placement.cross-cleared'];
      allCues.push(...eventTypes.map((eventType) => ({ eventType, assetId: id, gain: 0.5 })));
    }
    audio.cues = allCues;
  }
  production.audio = audio;
  doc.direction.production = production;
  oldIds.delete(id);
  pruneSupersededAssets(doc, oldIds);
  return updateBBWorkPackageProject(original, doc);
}
