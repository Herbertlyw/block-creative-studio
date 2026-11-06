import { expect, it } from 'vitest';
import { invalidateObservedGeometry } from '../src/contracts/observedGeometryDraft';
it('invalidates every affected confirmation without discarding unknown data', () => {
  const original = {
    confirmed: true,
    extra: { untouched: 1 },
    motions: [
      { actionId: 'a', confirmed: true, points: [1] },
      { actionId: 'b', confirmed: true, extra: 'kept' },
    ],
  };
  const result = JSON.parse(invalidateObservedGeometry(JSON.stringify(original)));
  expect(result).toEqual({
    ...original,
    confirmed: false,
    motions: original.motions.map((m) => ({ ...m, confirmed: false })),
  });
  expect(invalidateObservedGeometry('{broken')).toBe('{broken');
});
