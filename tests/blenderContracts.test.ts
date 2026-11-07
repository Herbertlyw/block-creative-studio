import { describe, expect, it } from 'vitest';
import {
  isBlenderCompileReport,
  isBlenderSceneExchange,
  validateBlenderCompileReport,
  validateBlenderSceneExchange,
} from '../src/headless/blenderContracts';

function exchangeFixture(): Record<string, unknown> {
  const tile = (id: string, x: number) => ({
    id,
    role: 'tile',
    primitive: 'rounded-box',
    position: [x, 0, 0],
    rotationEulerDegrees: [0, 0, 0],
    scale: [1, 1, 1],
    dimensions: [1, 0.3, 1],
    bevelRadius: 0.1,
    material: { baseColor: '#ffffff', roughness: 0.3, metallic: 0 },
  });
  return {
    contract: 'bcs.blender-scene-exchange',
    contractVersion: '1.0.0',
    id: 'test-match-package',
    seed: 7,
    output: { width: 1080, height: 1920, fps: 30, frameStart: 1, frameEnd: 60, alphaMode: 'opaque' },
    coordinates: { handedness: 'right', upAxis: 'Z', unit: 'meter', unitScale: 1 },
    camera: { type: 'orthographic', location: [0, -10, 0], target: [0, 0, 0], orthographicScale: 10 },
    stage: { backgroundColor: '#102A55', groundColor: '#224F87' },
    assets: [],
    entities: [tile('a', -1), tile('b', 0), tile('c', 1)],
    tracks: [],
    events: [{ id: 'match-1', type: 'match', frame: 24, entityIds: ['a', 'b', 'c'], center: [0, 0, 0], intensity: 1 }],
  };
}

function reportFixture(): Record<string, unknown> {
  const output = (role: string, suffix: string) => ({
    role,
    path: `D:/compiled/${suffix}`,
    sha256: 'a'.repeat(64),
    byteLength: 42,
  });
  return {
    contract: 'bcs.blender-compile-report',
    contractVersion: '1.0.0',
    packageId: 'test-match-package',
    status: 'passed',
    source: { path: 'D:/source.json', sha256: 'b'.repeat(64) },
    blender: { version: '5.2.1 LTS', engine: 'BLENDER_EEVEE' },
    render: { width: 1080, height: 1920, fps: 30, frameStart: 1, frameEnd: 60, alphaMode: 'opaque' },
    metrics: { objectCount: 12, meshCount: 8, materialCount: 5, triangleCount: 2048, compileDurationMs: 900 },
    quality: {
      structure: 'passed',
      visual: 'passed',
      resolvedAssetCount: 0,
      unresolvedAssetIds: [],
      fallbackFaceEntityIds: [],
    },
    outputs: [
      output('scene-exchange', 'scene-exchange.json'),
      output('source-artifact', 'source-artifact.json'),
      output('normalized-blend', 'scene.normalized.blend'),
      output('scene-glb', 'scene.glb'),
      output('preview', 'preview.png'),
    ],
    warnings: [],
    errors: [],
  };
}

describe('Blender scene exchange contract', () => {
  it('accepts the fixed-camera match vertical slice', () => {
    const exchange = exchangeFixture();
    expect(validateBlenderSceneExchange(exchange)).toEqual([]);
    expect(isBlenderSceneExchange(exchange)).toBe(true);
  });

  it('rejects duplicate ids, unsupported coordinates, and non-triple matches', () => {
    const exchange = exchangeFixture();
    exchange.coordinates = { handedness: 'left', upAxis: 'Y', unit: 'centimeter', unitScale: 0.01 };
    const entities = exchange.entities as Array<Record<string, unknown>>;
    entities[1]!.id = 'a';
    const events = exchange.events as Array<Record<string, unknown>>;
    events[0]!.entityIds = ['a', 'b'];
    const codes = validateBlenderSceneExchange(exchange).map((candidate) => candidate.code);
    expect(codes).toContain('BLENDER_COORDINATES_UNSUPPORTED');
    expect(codes).toContain('BLENDER_ENTITY_ID_DUPLICATE');
    expect(codes).toContain('BLENDER_MATCH_CARDINALITY_INVALID');
    expect(isBlenderSceneExchange(exchange)).toBe(false);
  });

  it('warns about a review resolution without rejecting an otherwise valid package', () => {
    const exchange = exchangeFixture();
    (exchange.output as Record<string, unknown>).width = 540;
    (exchange.output as Record<string, unknown>).height = 960;
    const issues = validateBlenderSceneExchange(exchange);
    expect(issues).toMatchObject([{ code: 'BLENDER_OUTPUT_PROFILE_NONSTANDARD', severity: 'warning' }]);
    expect(isBlenderSceneExchange(exchange)).toBe(true);
  });

  it('validates image face references and blocks asset path traversal', () => {
    const exchange = exchangeFixture();
    exchange.assets = [{
      id: 'fruit-face',
      kind: 'image',
      source: { type: 'package-path', path: 'assets/fruit.png' },
      width: 256,
      height: 256,
      hasAlpha: true,
      contentHash: 'c'.repeat(64),
    }];
    const firstTile = (exchange.entities as Array<Record<string, unknown>>)[0]!;
    firstTile.face = {
      layers: [{
        id: 'fruit-layer',
        source: { kind: 'image', assetId: 'fruit-face' },
        transform: { x: 0.5, y: 0.5, scaleX: 0.9, scaleY: 0.9, rotationDeg: 0, opacity: 1 },
      }],
    };
    expect(validateBlenderSceneExchange(exchange)).toEqual([]);

    ((exchange.assets as Array<Record<string, unknown>>)[0]!.source as Record<string, unknown>).path = '../escape.png';
    expect(validateBlenderSceneExchange(exchange).map((candidate) => candidate.code))
      .toContain('BLENDER_ASSET_PATH_INVALID');
  });

  it('validates bounded declarative match VFX recipes without executing code', () => {
    const exchange = exchangeFixture();
    const event = (exchange.events as Array<Record<string, unknown>>)[0]!;
    event.vfx = {
      style: 'shatter',
      durationFrames: 22,
      fragmentCount: 24,
      fragmentScale: 1,
      radialSpread: 2.5,
      gravity: 1.35,
      shockwave: true,
      glowStrength: 4.5,
      palette: ['#75D94C', '#F7F2E7'],
    };
    expect(validateBlenderSceneExchange(exchange)).toEqual([]);
    (event.vfx as Record<string, unknown>).fragmentCount = 10_000;
    expect(validateBlenderSceneExchange(exchange).map((candidate) => candidate.code))
      .toContain('BLENDER_MATCH_VFX_INTEGER_INVALID');
  });
});

describe('Blender compile report contract', () => {
  it('accepts a complete report and rejects missing machine-verifiable outputs', () => {
    const report = reportFixture();
    expect(validateBlenderCompileReport(report)).toEqual([]);
    expect(isBlenderCompileReport(report)).toBe(true);

    (report.outputs as unknown[]).splice(2, 2);
    const codes = validateBlenderCompileReport(report).map((candidate) => candidate.code);
    expect(codes).toContain('BLENDER_REPORT_OUTPUTS_INCOMPLETE');
    expect(isBlenderCompileReport(report)).toBe(false);
  });

  it('does not allow a passed report to hide errors', () => {
    const report = reportFixture();
    report.errors = ['render failed'];
    expect(validateBlenderCompileReport(report).map((candidate) => candidate.code))
      .toContain('BLENDER_REPORT_PASSED_WITH_ERRORS');
  });
});
