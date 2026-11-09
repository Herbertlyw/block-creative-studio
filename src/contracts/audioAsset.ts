import { encodeBase64Bytes, sha256Hex } from '../nativeReference/agent-assets/image';
import { validateProductionAudioAsset } from '../nativeReference/agent-director/audioMix';

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
