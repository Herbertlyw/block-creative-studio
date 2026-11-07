import { describe, expect, it } from 'vitest';
import { stableHash, stableStringify } from '../src/headless/stableHash';

describe('stableHash', () => {
  it('is independent of object key insertion order', () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(stableHash({ b: 2, a: 1 })).toBe(stableHash({ a: 1, b: 2 }));
  });
});
