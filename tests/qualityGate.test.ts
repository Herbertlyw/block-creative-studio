import { describe, expect, it } from 'vitest';
import { AssetRegistry } from '../src/headless/assetRegistry';
import { runQualityGate } from '../src/headless/qualityGate';
import { compileVariant } from '../src/headless/variantCompiler';
import { makeFixture } from './headlessFixtures';

describe('runQualityGate', () => {
  it('passes a deterministic, hashed material-aware render plan', () => {
    const fixture = makeFixture();
    const plan = compileVariant(fixture.master, fixture.recipe, new AssetRegistry(fixture.assets), {
      renderer: 'fixed-camera-cinematic',
      requireHashes: true,
    });
    const report = runQualityGate(plan, { strict: true, requireHashes: true });
    expect(report.passed).toBe(true);
    expect(report.metrics.textureMemoryMiB).toBe(62);
    expect(report.metrics.triangleCount).toBe(28000);
  });

  it('rejects unsafe generated plugins before runtime execution exists', () => {
    const fixture = makeFixture({ plugin: true });
    const plan = compileVariant(fixture.master, fixture.recipe, new AssetRegistry(fixture.assets), {
      renderer: 'fixed-camera-cinematic',
      requireHashes: true,
    });
    const report = runQualityGate(plan, { strict: true, requireHashes: true });
    expect(report.passed).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'PLUGIN_PERMISSION_FORBIDDEN', severity: 'error' }),
    );
  });

  it('enforces declared render budgets', () => {
    const fixture = makeFixture();
    const plan = compileVariant(fixture.master, fixture.recipe, new AssetRegistry(fixture.assets), {
      renderer: 'fixed-camera-cinematic',
    });
    const report = runQualityGate(plan, { maxTextureMemoryMiB: 8, maxTriangleCount: 1000 });
    expect(report.passed).toBe(false);
    expect(report.issues.map((candidate) => candidate.code)).toEqual(
      expect.arrayContaining(['TEXTURE_BUDGET_EXCEEDED', 'TRIANGLE_BUDGET_EXCEEDED']),
    );
  });
  it('rejects output ratios that would change the fixed-camera composition', () => {
    const fixture = makeFixture();
    const recipe = {
      ...fixture.recipe,
      lockMode: 'semantic' as const,
      outputOverrides: { width: 1080, height: 1080 },
    };
    const plan = compileVariant(fixture.master, recipe, new AssetRegistry(fixture.assets), {
      renderer: 'fixed-camera-cinematic',
    });
    const report = runQualityGate(plan, { strict: true });
    expect(report.passed).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'CAMERA_OUTPUT_ASPECT_MISMATCH', severity: 'error' }),
    );
  });

});
