import { expect, it } from 'vitest';
import { assertRenderResourcePolicy } from '../src/nativeReference/rendering/resourcePolicy';
import type { RenderBackendAdapter } from '../src/nativeReference/rendering/backendRegistry';
const backend = {
  id: 'test',
  renderer: 'reference-2d',
  letterboxFromDesign: false,
  supportedPresentationSchemas: [],
  createStage: () => {
    throw new Error('not called');
  },
} satisfies RenderBackendAdapter;
it('requires explicit bundled asset identity, reason and payload', () => {
  const prepared = assertRenderResourcePolicy(
    {
      mode: 'bundled-assets',
      bundleId: 'verified-bundle',
      reason: 'verified images',
      runtimeAssets: { background: 'data:image/png;base64,...' },
    },
    { backend },
  );
  expect(prepared.readiness).toBe('ready');
  expect(prepared.planHash).toBe('bundled-assets:verified-bundle');
  expect(() =>
    assertRenderResourcePolicy(
      { mode: 'bundled-assets', bundleId: '', reason: 'verified', runtimeAssets: {} },
      { backend },
    ),
  ).toThrow(/bundleId/);
  expect(() =>
    assertRenderResourcePolicy(
      { mode: 'bundled-assets', bundleId: 'x', reason: '', runtimeAssets: {} },
      { backend },
    ),
  ).toThrow(/reason/);
  expect(() =>
    assertRenderResourcePolicy(
      { mode: 'bundled-assets', bundleId: 'x', reason: 'verified', runtimeAssets: undefined },
      { backend },
    ),
  ).toThrow(/runtimeAssets/);
});
