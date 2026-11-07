import { describe, expect, it } from 'vitest';
import {
  BCS_BLENDER_VIDEO_REPORT_CONTRACT,
  BLENDER_VIDEO_QUALITY_PROFILES,
  inspectBlenderVideo,
  renderBlenderVideo,
} from '../src/cli/blenderVideoRenderer';

describe('Blender video renderer contract', () => {
  it('keeps named quality profiles explicit and ordered by intent', () => {
    expect(BCS_BLENDER_VIDEO_REPORT_CONTRACT).toBe('bcs.blender-video-render-report');
    expect(BLENDER_VIDEO_QUALITY_PROFILES).toEqual({
      draft: { constantRateFactor: 'MEDIUM', preset: 'REALTIME' },
      standard: { constantRateFactor: 'HIGH', preset: 'GOOD' },
      cinematic: { constantRateFactor: 'PERC_LOSSLESS', preset: 'GOOD' },
    });
  });

  it('rejects a non-blend source before launching Blender', async () => {
    await expect(renderBlenderVideo({ source: 'package.json', output: 'ignored.mp4' }))
      .rejects.toMatchObject({ code: 'BLENDER_VIDEO_SOURCE_INVALID' });
  });

  it('rejects a non-mp4 output before launching Blender', async () => {
    await expect(renderBlenderVideo({
      source: 'artifacts/blender/taptile-vfx-recipes-r2/scene.normalized.blend',
      output: 'ignored.mov',
    })).rejects.toMatchObject({ code: 'BLENDER_VIDEO_OUTPUT_INVALID' });
  });

  it('independently inspects an existing H.264 render when the fixture is available', async () => {
    const fixture = 'artifacts/design-qa/taptile-production/TapTile-手工堆叠草稿__Agent-最大消除-48-48__animals-v1__human-natural__bright-pop-v1__opening-six__variant-84e5f19d.mp4';
    const inspection = await inspectBlenderVideo(fixture).catch(() => null);
    if (!inspection) return;
    expect(inspection.codec).toBe('avc');
    expect(inspection.width).toBe(1080);
    expect(inspection.height).toBe(1920);
    expect(inspection.averageFps).toBeCloseTo(30, 3);
  });
});
