import { describe, expect, it } from 'vitest';
import {
  assertTapTileBlenderVfxCompatibility,
  createTapTileBlenderVfxAsset,
  validateTapTileBlenderGlb,
  validateTapTileBlenderVfxGlb,
} from '../src/taptile/blender';
import { createMinimalGlb } from './glbFixture';

describe('TapTile Blender GLB runtime gate', () => {
  it('accepts self-contained TapTile geometry with a fixed camera', () => {
    const result = validateTapTileBlenderGlb(createMinimalGlb({
      triangleCount: 2,
      nodeInstances: 3,
      semanticExtras: true,
      fixedCamera: true,
      timeline: { frameStart: 1, frameEnd: 60, frameCount: 60, fps: 30 },
    }));
    expect(result).toMatchObject({ hasFixedCamera: true, tileEntityCount: 3 });
    expect(result.inspection.triangleCount).toBe(6);
    expect(result.inspection.timeline).toEqual({ frameStart: 1, frameEnd: 60, frameCount: 60, fps: 30 });
  });

  it('rejects generic or camera-free GLB before Three.js parsing', () => {
    expect(() => validateTapTileBlenderGlb(createMinimalGlb({ fixedCamera: true })))
      .toThrow('TAPTILE_SEMANTICS_MISSING');
    expect(() => validateTapTileBlenderGlb(createMinimalGlb({ semanticExtras: true })))
      .toThrow('FIXED_CAMERA_MISSING');
  });

  it('accepts an isolated camera + VFX GLB without carrying tile textures', () => {
    const result = validateTapTileBlenderVfxGlb(createMinimalGlb({
      triangleCount: 2,
      nodeInstances: 2,
      semanticExtras: true,
      semanticRoles: ['match-core', 'match-fragment'],
      vfxStyle: 'shatter',
      vfxFragmentCount: 96,
      fixedCamera: true,
      timeline: { frameStart: 1, frameEnd: 60, frameCount: 60, fps: 30 },
    }));
    expect(result).toMatchObject({ hasFixedCamera: true, tileEntityCount: 0, effectNodeCount: 1, effectFragmentCount: 96 });
    expect(result.inspection.semanticRoles).not.toContain('tile');
    expect(result.inspection.textureCount).toBe(0);
  });

  it('binds a VFX layer to the exact match event set, not merely a same-length timeline', async () => {
    const asset = await createTapTileBlenderVfxAsset(createMinimalGlb({
      triangleCount: 2,
      nodeInstances: 2,
      semanticExtras: true,
      semanticRoles: ['match-core', 'match-fragment'],
      semanticIds: ['action-a:match::core', 'action-a:match::dense-shards'],
      vfxStyle: 'shatter',
      vfxFragmentCount: 96,
      fixedCamera: true,
      timeline: { frameStart: 1, frameEnd: 60, frameCount: 60, fps: 30 },
    }), 'scene.vfx.glb');
    expect(() => assertTapTileBlenderVfxCompatibility(asset, {
      totalFrames: 60,
      fps: 30,
      matchEventIds: ['action-a:match'],
    })).not.toThrow();
    expect(() => assertTapTileBlenderVfxCompatibility(asset, {
      totalFrames: 60,
      fps: 30,
      matchEventIds: ['action-b:match'],
    })).toThrow('BLENDER_VFX_EVENT_MISMATCH');
  });

  it('rejects stable ids reused across different VFX roles', () => {
    expect(() => validateTapTileBlenderVfxGlb(createMinimalGlb({
      triangleCount: 2,
      nodeInstances: 2,
      semanticExtras: true,
      semanticRoles: ['match-core', 'match-fragment'],
      semanticIds: ['duplicate-vfx-id', 'duplicate-vfx-id'],
      vfxStyle: 'shatter',
      vfxFragmentCount: 96,
      fixedCamera: true,
      timeline: { frameStart: 1, frameEnd: 60, frameCount: 60, fps: 30 },
    }))).toThrow('BLENDER_VFX_STABLE_ID_INVALID');
  });
});
