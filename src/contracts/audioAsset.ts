import { encodeBase64Bytes, sha256Hex } from '../nativeReference/agent-assets/image';
import { validateProductionAudioAsset } from '../nativeReference/agent-director/audioMix';
import type { ProductionAudioAsset } from '../nativeReference/agent-director/contracts';

/** Re-importing identical bytes must retain provenance and all existing bindings.
 * A caller-chosen ID never authorizes replacing another track's bytes. */
export function mergeProductionAudioAsset(
  assets: Record<string, ProductionAudioAsset> | undefined,
  asset: ProductionAudioAsset,
): Record<string, ProductionAudioAsset> {
  const existing = assets && Object.hasOwn(assets, asset.id) ? assets[asset.id] : undefined;
  if (
    existing &&
    (existing.sha256 !== asset.sha256 ||
      existing.encoding !== 'base64' ||
      asset.encoding !== 'base64' ||
      existing.data !== asset.data)
  )
    throw new Error(`AUDIO_ASSET_ID_CONFLICT: ${asset.id}；原素材与所有声音绑定保留。`);
  return { ...assets, [asset.id]: existing ?? asset };
}

/** Shared byte validation for workbench and CLI WAV imports. */
export async function createWavAsset(bytes: Uint8Array, id: string, sourceName: string) {
  if (!bytes.length || bytes.length > 16 * 1024 * 1024) throw new Error('WAV 为空或超过 16 MiB。');
  const asset = {
    id,
    kind: 'audio' as const,
    encoding: 'base64' as const,
    mimeType: 'audio/wav' as const,
    data: encodeBase64Bytes(bytes),
    sourceName,
    sha256: await sha256Hex(bytes),
  };
  validateProductionAudioAsset(asset);
  return asset;
}
