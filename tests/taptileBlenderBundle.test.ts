import { describe, expect, it } from 'vitest';
import type { BlenderSceneExchange } from '../src/headless/blenderContracts';
import { exportTapTileBlenderBundle } from '../src/taptile/blender';
import { decodeStoredZip } from '../src/taptile/production/projectBundle';

const decoder = new TextDecoder();

function fixture(): BlenderSceneExchange {
  return {
    contract: 'bcs.blender-scene-exchange',
    contractVersion: '1.0.0',
    id: 'bundle-fixture',
    seed: 7,
    output: { width: 1080, height: 1920, fps: 30, frameStart: 1, frameEnd: 30, alphaMode: 'opaque' },
    coordinates: { handedness: 'right', upAxis: 'Z', unit: 'meter', unitScale: 1 },
    camera: { type: 'orthographic', location: [0, -10, 0], target: [0, 0, 0], orthographicScale: 10 },
    stage: { backgroundColor: '#102A55', groundColor: '#224F87' },
    assets: [{
      id: 'fruit face',
      kind: 'image',
      source: { type: 'builtin-uri', uri: '/assets/fruit.png' },
      width: 64,
      height: 64,
      hasAlpha: true,
    }],
    entities: [{
      id: 'tile-a',
      role: 'tile',
      primitive: 'rounded-box',
      position: [0, 0, 0],
      rotationEulerDegrees: [0, 0, 0],
      scale: [1, 1, 1],
      dimensions: [1, 0.3, 1],
      material: { baseColor: '#ffffff', roughness: 0.3, metallic: 0 },
      face: {
        layers: [{
          id: 'face-layer',
          source: { kind: 'image', assetId: 'fruit face' },
          transform: { x: 0.5, y: 0.5, scaleX: 0.9, scaleY: 0.9, rotationDeg: 0, opacity: 1 },
        }],
      },
    }],
    tracks: [],
    events: [],
  };
}

describe('TapTile Blender scene bundle', () => {
  it('embeds images, rewrites sources, and provides checksums without mutating the exchange', async () => {
    const source = fixture();
    const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const result = await exportTapTileBlenderBundle(source, {
      fileNameBase: 'Fruit Take',
      readAsset: async () => imageBytes,
    });
    expect(result.fileName).toBe('Fruit-Take.bcs-blender.zip');
    expect(source.assets[0]?.source).toEqual({ type: 'builtin-uri', uri: '/assets/fruit.png' });
    expect(result.exchange.assets[0]?.source).toEqual({ type: 'package-path', path: 'assets/fruit-face.png' });
    const files = decodeStoredZip(new Uint8Array(await result.blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      'README.txt',
      'assets/fruit-face.png',
      'checksums.json',
      'manifests/blender-bundle.json',
      'scene-exchange.json',
    ]);
    expect(files['assets/fruit-face.png']).toEqual(imageBytes);
    const bundled = JSON.parse(decoder.decode(files['scene-exchange.json'])) as BlenderSceneExchange;
    expect(bundled.assets[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.keys(result.checksums)).toContain('scene-exchange.json');
  });

  it('rejects an asset whose bytes do not match the declared hash', async () => {
    const source = fixture();
    source.assets[0]!.contentHash = '0'.repeat(64);
    await expect(exportTapTileBlenderBundle(source, {
      readAsset: async () => new Uint8Array([1, 2, 3]),
    })).rejects.toThrow('BLENDER_BUNDLE_ASSET_HASH_MISMATCH');
  });
});
