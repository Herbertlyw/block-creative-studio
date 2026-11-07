import type { TapTileBlenderGlbValidation } from './blenderGlbRuntime';
import { validateTapTileBlenderVfxGlb } from './blenderGlbRuntime';

export interface TapTileBlenderVfxAsset {
  fileName: string;
  byteLength: number;
  sha256: string;
  buffer: ArrayBuffer;
  validation: TapTileBlenderGlbValidation;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('BLENDER_VFX_SHA256_UNAVAILABLE');
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', buffer)));
}

export async function createTapTileBlenderVfxAsset(buffer: ArrayBuffer, fileName: string): Promise<TapTileBlenderVfxAsset> {
  const validation = validateTapTileBlenderVfxGlb(buffer);
  const timeline = validation.inspection.timeline;
  if (!timeline) throw new Error('BLENDER_VFX_TIMELINE_MISSING: GLB 必须由新版 BCS 编译并携带精确时间轴。');
  return {
    fileName,
    byteLength: buffer.byteLength,
    sha256: await sha256(buffer),
    buffer,
    validation,
  };
}

export function assertTapTileBlenderVfxCompatibility(
  asset: TapTileBlenderVfxAsset,
  expected: { totalFrames: number; fps: number; matchEventIds?: readonly string[] },
): void {
  const timeline = asset.validation.inspection.timeline;
  if (!timeline) throw new Error('BLENDER_VFX_TIMELINE_MISSING');
  const mismatches: string[] = [];
  if (timeline.frameStart !== 1) mismatches.push(`首帧 ${timeline.frameStart}，预期 1`);
  if (timeline.frameCount !== expected.totalFrames) mismatches.push(`总帧 ${timeline.frameCount}，预期 ${expected.totalFrames}`);
  if (Math.abs(timeline.fps - expected.fps) > 0.0001) mismatches.push(`帧率 ${timeline.fps}，预期 ${expected.fps}`);
  if (mismatches.length > 0) throw new Error(`BLENDER_VFX_TIMELINE_MISMATCH: ${mismatches.join('；')}`);
  if (expected.matchEventIds) {
    const actual = (asset.validation.inspection.entityIdsByRole['match-core'] ?? [])
      .map((id) => id.endsWith('::core') ? id.slice(0, -'::core'.length) : id)
      .sort();
    const wanted = [...new Set(expected.matchEventIds)].sort();
    const missing = wanted.filter((id) => !actual.includes(id));
    const unexpected = actual.filter((id) => !wanted.includes(id));
    if (missing.length > 0 || unexpected.length > 0) {
      throw new Error(`BLENDER_VFX_EVENT_MISMATCH: 缺少 ${missing.join(', ') || '无'}；多出 ${unexpected.join(', ') || '无'}。`);
    }
  }
}
