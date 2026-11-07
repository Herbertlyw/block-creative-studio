import { describe, expect, it } from 'vitest';
import { BLOCK_GARDEN_FIXED_CAMERA_DRAFT } from '../src/assets/fixedCameraProfile';
import {
  designPixelToNormalizedScreen,
  validateFixedCameraProfile,
} from '../src/assets/semanticAssetTypes';

describe('fixed camera asset contract', () => {
  it('keeps the draft board projection inside the measured design canvas', () => {
    expect(validateFixedCameraProfile(BLOCK_GARDEN_FIXED_CAMERA_DRAFT)).toEqual([]);
  });

  it('maps measured design pixels without assuming a physical lens', () => {
    const point = designPixelToNormalizedScreen(
      { x: 532, y: 894 },
      BLOCK_GARDEN_FIXED_CAMERA_DRAFT.designResolution,
    );
    expect(point.x).toBeCloseTo(0.5, 6);
    expect(point.y).toBeCloseTo(0.5, 6);
    expect(BLOCK_GARDEN_FIXED_CAMERA_DRAFT.projection.mode).toBe('calibration-pending');
  });

  it('rejects a board projection outside the fixed design canvas', () => {
    const errors = validateFixedCameraProfile({
      ...BLOCK_GARDEN_FIXED_CAMERA_DRAFT,
      boardScreenRect: { x: 900, y: 300, width: 300, height: 900 },
    });
    expect(errors).toContain('Board screen rect must remain inside the design resolution.');
  });
});
