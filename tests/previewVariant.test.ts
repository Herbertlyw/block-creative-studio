import { describe, expect, it } from 'vitest';
import { resolvePreviewVariant } from '../src/contracts/previewVariant';

describe('preview variant selection', () => {
  it('follows changed project settings until a temporary override is chosen', () => {
    const work = (lookKey: string, clearFromLook: string) => ({
      direction: { style: { workbenchVariantV1: { lookKey, clearFromLook } } },
    });
    const a = work('clean', 'garden'),
      b = work('garden', 'clean');
    expect(resolvePreviewVariant(a, null)).toEqual({
      lookKey: 'clean',
      clearFromLook: 'garden',
      route: 'v2',
    });
    expect(resolvePreviewVariant(b, null)).toEqual({
      lookKey: 'garden',
      clearFromLook: 'clean',
      route: 'v2',
    });
    const override = { lookKey: 'temporary', clearFromLook: '', route: 'bridge' } as const;
    expect(resolvePreviewVariant(b, override)).toEqual(override);
    expect(resolvePreviewVariant(b, null).lookKey).toBe('garden');
    expect(resolvePreviewVariant({}, null).lookKey).toBe('');
  });
});
