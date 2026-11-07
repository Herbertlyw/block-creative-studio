import { describe, expect, it } from 'vitest';
import {
  calibrationScore,
  compareCalibrationFrames,
  type PixelFrame,
} from '../src/reference2d/calibrationMetrics';

function image(width: number, height: number, fill: [number, number, number, number]): PixelFrame {
  const result: PixelFrame = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  for (let offset = 0; offset < result.data.length; offset += 4) {
    result.data.set(fill, offset);
  }
  return result;
}

describe('reference calibration metrics', () => {
  it('reports perfect equality for identical frames', () => {
    const reference = image(8, 8, [32, 64, 96, 255]);
    const comparison = compareCalibrationFrames(reference, reference, { sampleStep: 1 });

    expect(comparison.metrics.meanAbsoluteError).toBe(0);
    expect(comparison.metrics.rootMeanSquareError).toBe(0);
    expect(comparison.metrics.changedPixelRatio).toBe(0);
    expect(comparison.metrics.edgeMismatchRatio).toBe(0);
    expect(calibrationScore(comparison.metrics)).toBe(100);
  });

  it('detects color and alpha drift', () => {
    const reference = image(8, 8, [20, 40, 60, 255]);
    const candidate = image(8, 8, [120, 40, 60, 100]);
    const comparison = compareCalibrationFrames(reference, candidate, {
      sampleStep: 1,
      changedThreshold: 8,
    });

    expect(comparison.metrics.meanAbsoluteError).toBeGreaterThan(0.1);
    expect(comparison.metrics.changedPixelRatio).toBe(1);
    expect(comparison.metrics.alphaMismatchRatio).toBe(1);
    expect(calibrationScore(comparison.metrics)).toBeLessThan(90);
  });

  it('detects edge displacement independently from flat color error', () => {
    const reference = image(12, 12, [0, 0, 0, 255]);
    const candidate = image(12, 12, [0, 0, 0, 255]);
    for (let y = 0; y < 12; y += 1) {
      const referenceOffset = (y * 12 + 4) * 4;
      const candidateOffset = (y * 12 + 7) * 4;
      reference.data.set([255, 255, 255, 255], referenceOffset);
      candidate.data.set([255, 255, 255, 255], candidateOffset);
    }
    const comparison = compareCalibrationFrames(reference, candidate, {
      sampleStep: 1,
      edgeThreshold: 20,
    });

    expect(comparison.metrics.edgeMismatchRatio).toBeGreaterThan(0);
    expect(comparison.metrics.changedPixelRatio).toBeGreaterThan(0);
  });

  it('rejects mismatched dimensions', () => {
    expect(() => compareCalibrationFrames(
      image(4, 4, [0, 0, 0, 255]),
      image(5, 4, [0, 0, 0, 255]),
    )).toThrow(/share dimensions/i);
  });
});
