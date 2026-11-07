import { describe, expect, it } from 'vitest';
import { AssetRegistry } from '../src/headless/assetRegistry';
import { BcsHeadlessError } from '../src/headless/errors';
import { compileVariant, compileVariantMatrix } from '../src/headless/variantCompiler';
import { makeFixture } from './headlessFixtures';

describe('compileVariant', () => {
  it('resolves one immutable plan for a frame-exact material variant', () => {
    const fixture = makeFixture();
    const plan = compileVariant(fixture.master, fixture.recipe, new AssetRegistry(fixture.assets), {
      renderer: 'fixed-camera-cinematic',
      requireHashes: true,
    });
    expect(plan.renderer).toBe('fixed-camera-cinematic');
    expect(plan.slots['tile.material']?.manifest.kind).toBe('material-pack');
    expect(plan.output).toEqual(fixture.master.baseOutput);
    expect(plan.planHash).toMatch(/^fnv1a32:/);
  });

  it('rejects a clear effect whose declared material class is incompatible', () => {
    const fixture = makeFixture({ effectMaterialClass: 'wood' });
    expect(() => compileVariant(fixture.master, fixture.recipe, new AssetRegistry(fixture.assets), {
      renderer: 'fixed-camera-cinematic',
    })).toThrowError(expect.objectContaining({ code: 'EFFECT_MATERIAL_INCOMPATIBLE' }));
  });

  it('rejects director timing changes in frame-exact mode', () => {
    const fixture = makeFixture();
    const recipe = { ...fixture.recipe, directorOverrides: { globalSpeed: 1.1 } };
    expect(() => compileVariant(fixture.master, recipe, new AssetRegistry(fixture.assets), {
      renderer: 'fixed-camera-cinematic',
    })).toThrowError(expect.objectContaining({ code: 'FRAME_EXACT_DIRECTOR_OVERRIDE' }));
  });

  it('isolates failures when compiling a batch matrix', () => {
    const fixture = makeFixture();
    const invalid = { ...fixture.recipe, id: 'variant.invalid', masterId: 'other-master' };
    const result = compileVariantMatrix(
      fixture.master,
      [fixture.recipe, invalid],
      new AssetRegistry(fixture.assets),
      { renderer: 'fixed-camera-cinematic' },
    );
    expect(result.plans).toHaveLength(1);
    expect(result.failures).toEqual([
      expect.objectContaining({ variantId: 'variant.invalid', code: 'VARIANT_MASTER_MISMATCH' }),
    ]);
  });
});
