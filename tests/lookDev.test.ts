import { describe, expect, it } from 'vitest';
import {
  LOOKDEV_PRESETS,
  copyLookDevPreset,
  resolveLookDevBloom,
} from '../src/renderer/lookDev';

describe('3D LookDev controls', () => {
  it('keeps neutral material inspection free from bloom', () => {
    const value = resolveLookDevBloom(
      LOOKDEV_PRESETS['neutral-lookdev'],
      'cinematic',
      0.5,
      'energy-burst',
    );
    expect(value.strength).toBe(0);
    expect(value.threshold).toBeGreaterThan(1);
  });

  it('adds bloom only around the clear peak in the balanced profile', () => {
    const profile = LOOKDEV_PRESETS['balanced-cinematic'];
    const idle = resolveLookDevBloom(profile, 'interactive', 0, 'crystal-shatter');
    const peak = resolveLookDevBloom(profile, 'interactive', 0.5, 'crystal-shatter');
    const end = resolveLookDevBloom(profile, 'interactive', 1, 'crystal-shatter');

    expect(peak.strength).toBeGreaterThan(idle.strength);
    expect(end.strength).toBeCloseTo(idle.strength);
    expect(idle.strength).toBeLessThan(0.2);
  });

  it('returns an editable copy rather than mutating the preset table', () => {
    const copy = copyLookDevPreset('balanced-cinematic');
    copy.exposure = 0.7;
    expect(LOOKDEV_PRESETS['balanced-cinematic'].exposure).toBe(0.96);
  });
});
