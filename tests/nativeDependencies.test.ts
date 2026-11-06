import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectNativeDependencies } from '../src/contracts/inspectNativeDependencies';

describe('V2 dependency inventory', () => {
  it('reports unresolved profiles without claiming the assets are absent', () => {
    const source = JSON.parse(
      readFileSync(new URL('./fixtures/synthetic-v2-structure.json', import.meta.url), 'utf8'),
    );
    const before = JSON.stringify(source);
    const refs = inspectNativeDependencies(source);
    expect(refs.map((ref) => ref.path)).toEqual([
      'production.layoutProfileRef',
      'production.cameraProfileRef',
      'production.lookPackRef',
    ]);
    expect(refs.every((ref) => ref.status === 'unresolved-profile')).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('distinguishes embedded, external, missing and unavailable builtin sounds', () => {
    const refs = inspectNativeDependencies({
      direction: {
        production: {
          audio: {
            bgm: { assetId: 'music' },
            cues: [{ assetId: 'hit' }, { assetId: 'missing' }, { assetId: 'builtin:clear' }],
            assets: {
              music: { encoding: 'base64', data: 'AA==' },
              hit: { encoding: 'ref', ref: 'asset:hash' },
            },
          },
        },
      },
    });
    expect(refs.map((ref) => ref.status)).toEqual([
      'inline-unverified',
      'external-unresolved',
      'missing-audio-entry',
      'builtin-unavailable',
    ]);
  });
});
