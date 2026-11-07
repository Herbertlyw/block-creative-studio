import { describe, expect, it } from 'vitest';
import { perspectiveDistanceToFitFrame } from '../src/renderer/cameraFraming';

function visibleFrameAtDistance(distance: number, verticalFovDegrees: number, aspect: number) {
  const halfHeight = distance * Math.tan((verticalFovDegrees * Math.PI) / 360);
  return {
    width: halfHeight * 2 * aspect,
    height: halfHeight * 2,
  };
}

describe('perspectiveDistanceToFitFrame', () => {
  it('fits the experimental board inside a 9:16 portrait viewport', () => {
    const distance = perspectiveDistanceToFitFrame({
      verticalFovDegrees: 42,
      aspect: 9 / 16,
      contentWidth: 9.05,
      contentHeight: 13.8,
      widthFill: 0.89,
      heightFill: 0.9,
      minimumDistance: 17.6,
    });
    const visible = visibleFrameAtDistance(distance, 42, 9 / 16);

    expect(distance).toBeGreaterThan(23);
    expect(9.05 / visible.width).toBeLessThanOrEqual(0.890001);
    expect(13.8 / visible.height).toBeLessThanOrEqual(0.900001);
  });

  it('requires less distance as the viewport becomes wider', () => {
    const portrait = perspectiveDistanceToFitFrame({
      verticalFovDegrees: 42,
      aspect: 9 / 16,
      contentWidth: 9.05,
      contentHeight: 13.8,
      widthFill: 0.89,
      heightFill: 0.9,
    });
    const square = perspectiveDistanceToFitFrame({
      verticalFovDegrees: 42,
      aspect: 1,
      contentWidth: 9.05,
      contentHeight: 13.8,
      widthFill: 0.89,
      heightFill: 0.9,
    });

    expect(portrait).toBeGreaterThan(square);
  });

  it('respects the preset minimum distance on very wide canvases', () => {
    expect(perspectiveDistanceToFitFrame({
      verticalFovDegrees: 60,
      aspect: 3,
      contentWidth: 4,
      contentHeight: 4,
      minimumDistance: 12,
    })).toBe(12);
  });
});
