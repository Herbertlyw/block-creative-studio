import { describe, expect, it } from 'vitest';
import { LOOKDEV_PRESETS } from '../src/renderer/lookDev';
import {
  BLOCK_MATERIAL_OPTICS,
  LIGHTING_VALUES,
  createBlockMaterial,
} from '../src/renderer/materialPresets';

describe('material LookDev baselines', () => {
  it('keeps static material optics below the previous glare-heavy values', () => {
    expect(BLOCK_MATERIAL_OPTICS['glossy-plastic'].clearcoat).toBeLessThan(0.4);
    expect(BLOCK_MATERIAL_OPTICS['candy-resin'].roughness).toBeGreaterThanOrEqual(0.2);
    expect(BLOCK_MATERIAL_OPTICS['crystal-glass'].clearcoat).toBeLessThan(0.5);
    expect(BLOCK_MATERIAL_OPTICS['crystal-glass'].iridescence).toBeLessThan(0.1);
  });

  it('builds an opaque transmissive material without mixing opacity and transmission', () => {
    const material = createBlockMaterial(
      'cyan',
      'crystal-glass',
      1,
      LOOKDEV_PRESETS['balanced-cinematic'].environmentIntensity,
    );
    expect(material.transparent).toBe(false);
    expect(material.opacity).toBe(1);
    expect(material.transmission).toBeGreaterThan(0.5);
    expect(material.envMapIntensity).toBeLessThan(1);
    material.dispose();
  });

  it('disables transmission for placement ghosts to avoid sorting instability', () => {
    const material = createBlockMaterial('rose', 'candy-resin', 0.72, 0.7);
    expect(material.transparent).toBe(true);
    expect(material.transmission).toBe(0);
    expect(material.opacity).toBeCloseTo(0.72);
    material.dispose();
  });

  it('provides a genuinely neutral lighting baseline', () => {
    const neutral = LIGHTING_VALUES['neutral-lookdev'];
    const neon = LIGHTING_VALUES['neon-contrast'];
    expect(neutral.rim).toBeLessThan(neon.rim * 0.25);
    expect(neutral.key).toBeLessThan(neon.key);
    expect(LOOKDEV_PRESETS['neutral-lookdev'].bloomStrength).toBe(0);
  });
});
