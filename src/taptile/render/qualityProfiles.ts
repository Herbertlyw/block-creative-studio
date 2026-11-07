import type { TapTileRenderSpec } from '../project';

export interface TapTileVideoQualityProfile {
  id: TapTileRenderSpec['quality'];
  label: string;
  description: string;
  videoBitrate: number;
  audioBitrate: number;
  keyFrameIntervalSeconds: number;
  renderScale: number;
}

export const TAPTILE_VIDEO_QUALITY_PROFILES: readonly TapTileVideoQualityProfile[] = Object.freeze([
  {
    id: 'preview',
    label: '快速预览',
    description: '1080p30 · 原生像素 · 8 Mbps，适合快速检查动作与节奏。',
    videoBitrate: 8_000_000,
    audioBitrate: 128_000,
    keyFrameIntervalSeconds: 2,
    renderScale: 1,
  },
  {
    id: 'standard',
    label: '标准成片',
    description: '1080p30 · 原生像素 · 14 Mbps，兼顾细节、体积与浏览器稳定性。',
    videoBitrate: 14_000_000,
    audioBitrate: 192_000,
    keyFrameIntervalSeconds: 2,
    renderScale: 1,
  },
  {
    id: 'cinematic',
    label: '高质量成片',
    description: '1620×2880 超采样、微对比补偿后缩回 1080p30 · 24 Mbps，改善牌边、粒子与斜线。',
    videoBitrate: 24_000_000,
    audioBitrate: 192_000,
    keyFrameIntervalSeconds: 1,
    renderScale: 1.5,
  },
]);

export function resolveTapTileVideoQualityProfile(
  quality: TapTileRenderSpec['quality'],
): TapTileVideoQualityProfile {
  return TAPTILE_VIDEO_QUALITY_PROFILES.find((profile) => profile.id === quality)
    ?? TAPTILE_VIDEO_QUALITY_PROFILES[1]!;
}
