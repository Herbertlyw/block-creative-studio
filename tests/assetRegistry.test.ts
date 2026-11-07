import { describe, expect, it } from 'vitest';
import { AssetRegistry } from '../src/headless/assetRegistry';
import { BcsHeadlessError } from '../src/headless/errors';
import { makeFixture, ref } from './headlessFixtures';

describe('AssetRegistry', () => {
  it('registers and resolves versioned assets without exposing mutable state', () => {
    const fixture = makeFixture();
    const registry = new AssetRegistry(fixture.assets);
    const resolved = registry.resolve(ref('material.copper', 'material-pack', 'b'), { requireHash: true });
    expect(resolved.kind).toBe('material-pack');
    resolved.id = 'mutated';
    expect(registry.resolve(ref('material.copper', 'material-pack', 'b')).id).toBe('material.copper');
  });

  it('rejects duplicate registration and kind mismatch', () => {
    const fixture = makeFixture();
    const registry = new AssetRegistry([fixture.material]);
    expect(() => registry.register(fixture.material)).toThrowError(BcsHeadlessError);
    expect(() => registry.resolve(ref('material.copper', 'effect-pack', 'b'))).toThrowError(
      expect.objectContaining({ code: 'ASSET_KIND_MISMATCH' }),
    );
  });
});
