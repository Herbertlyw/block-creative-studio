import { describe, expect, it } from 'vitest';
import { inspectGlbArrayBuffer } from '../src/assets/glbInspector';
import { createMinimalGlb } from './glbFixture';

describe('strict GLB inspection', () => {
  it('reads complete self-contained geometry and BCS semantic extras', () => {
    const inspection = inspectGlbArrayBuffer(createMinimalGlb({ triangleCount: 2, semanticExtras: true, vfxStyle: 'burst' }));
    expect(inspection).toMatchObject({
      sceneCount: 1,
      nodeCount: 1,
      meshCount: 1,
      primitiveCount: 1,
      uniqueTriangleCount: 2,
      triangleCount: 2,
      semanticRoles: ['tile'],
      semanticRoleCounts: { tile: 1 },
      vfxStyleCounts: { burst: 1 },
      entityIds: ['test-tile-0'],
      entityIdsByRole: { tile: ['test-tile-0'] },
      generator: 'BCS test fixture',
    });
    expect(inspection.binaryByteLength).toBeGreaterThan(0);
  });

  it('counts shared mesh instances for the runtime triangle budget', () => {
    const inspection = inspectGlbArrayBuffer(createMinimalGlb({ triangleCount: 2, nodeInstances: 3 }));
    expect(inspection.uniqueTriangleCount).toBe(2);
    expect(inspection.triangleCount).toBe(6);
  });

  it('reads an exact Blender timeline contract from the fixed camera', () => {
    const inspection = inspectGlbArrayBuffer(createMinimalGlb({
      semanticExtras: true,
      fixedCamera: true,
      timeline: { frameStart: 1, frameEnd: 2430, frameCount: 2430, fps: 30 },
    }));
    expect(inspection.timeline).toEqual({ frameStart: 1, frameEnd: 2430, frameCount: 2430, fps: 30 });
  });

  it('rejects inconsistent Blender timeline metadata', () => {
    expect(() => inspectGlbArrayBuffer(createMinimalGlb({
      semanticExtras: true,
      fixedCamera: true,
      timeline: { frameStart: 1, frameEnd: 60, frameCount: 61, fps: 30 },
    }))).toThrow('bcs_frame_count');
  });

  it('rejects a valid-looking header when the JSON scene is absent', () => {
    const headerOnly = new ArrayBuffer(12);
    const view = new DataView(headerOnly);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, 12, true);
    expect(() => inspectGlbArrayBuffer(headerOnly)).toThrow('JSON Chunk');
  });

  it('rejects external buffers even when the rest of the GLB is valid', () => {
    expect(() => inspectGlbArrayBuffer(createMinimalGlb({ externalBufferUri: 'mesh.bin' })))
      .toThrow('不允许外部或 data URI Buffer');
  });

  it('enforces a triangle budget before the asset enters IndexedDB', () => {
    expect(() => inspectGlbArrayBuffer(createMinimalGlb({ triangleCount: 4 }), {
      maximumBytes: 1024 * 1024,
      maximumNodes: 10,
      maximumMeshes: 10,
      maximumPrimitives: 10,
      maximumMaterials: 10,
      maximumTextures: 10,
      maximumAnimations: 10,
      maximumTriangles: 3,
    })).toThrow('三角面数 4 超过预算 3');
  });
});
