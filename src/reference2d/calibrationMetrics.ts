export interface PixelFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface CalibrationMetrics {
  width: number;
  height: number;
  sampledPixels: number;
  meanAbsoluteError: number;
  rootMeanSquareError: number;
  changedPixelRatio: number;
  edgeMismatchRatio: number;
  alphaMismatchRatio: number;
}

export interface CalibrationComparison {
  metrics: CalibrationMetrics;
  difference: PixelFrame;
}

export interface CalibrationComparisonOptions {
  changedThreshold?: number;
  edgeThreshold?: number;
  sampleStep?: number;
  differenceGain?: number;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function luminance(data: Uint8ClampedArray, offset: number): number {
  return data[offset]! * 0.2126 + data[offset + 1]! * 0.7152 + data[offset + 2]! * 0.0722;
}

function assertComparable(reference: PixelFrame, candidate: PixelFrame): void {
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    throw new Error(
      `Calibration frames must share dimensions; received ${reference.width}×${reference.height} and ${candidate.width}×${candidate.height}.`,
    );
  }
  if (reference.data.length !== candidate.data.length) {
    throw new Error('Calibration frame buffers have different lengths.');
  }
}

/**
 * Compares two deterministic reference-sized frames.
 *
 * Layout and timing review should still use semantic masks and Golden Scene
 * metadata. This pixel comparison is deliberately a diagnostic signal rather
 * than a single pass/fail definition for stochastic particles.
 */
export function compareCalibrationFrames(
  reference: PixelFrame,
  candidate: PixelFrame,
  options: CalibrationComparisonOptions = {},
): CalibrationComparison {
  assertComparable(reference, candidate);
  const changedThreshold = Math.max(0, Math.min(255, options.changedThreshold ?? 14));
  const edgeThreshold = Math.max(0, Math.min(255, options.edgeThreshold ?? 26));
  const sampleStep = Math.max(1, Math.min(8, Math.trunc(options.sampleStep ?? 2)));
  const differenceGain = Math.max(0.5, Math.min(12, options.differenceGain ?? 4));
  const { width, height } = reference;
  const output: PixelFrame = {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };

  let absoluteTotal = 0;
  let squaredTotal = 0;
  let sampledChannels = 0;
  let sampledPixels = 0;
  let changedPixels = 0;
  let alphaMismatches = 0;
  let edgeSamples = 0;
  let edgeMismatches = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const redDifference = Math.abs(reference.data[offset]! - candidate.data[offset]!);
      const greenDifference = Math.abs(reference.data[offset + 1]! - candidate.data[offset + 1]!);
      const blueDifference = Math.abs(reference.data[offset + 2]! - candidate.data[offset + 2]!);
      const alphaDifference = Math.abs(reference.data[offset + 3]! - candidate.data[offset + 3]!);
      const maximumDifference = Math.max(redDifference, greenDifference, blueDifference, alphaDifference);
      const heat = clampByte(maximumDifference * differenceGain);

      output.data[offset] = heat;
      output.data[offset + 1] = clampByte(Math.max(0, heat - 96) * 0.42);
      output.data[offset + 2] = clampByte(Math.max(0, 80 - heat) * 0.25);
      output.data[offset + 3] = clampByte(maximumDifference <= 2 ? 0 : Math.max(48, heat));

      if (x % sampleStep !== 0 || y % sampleStep !== 0) continue;
      sampledPixels += 1;
      const differences = [redDifference, greenDifference, blueDifference];
      for (const difference of differences) {
        absoluteTotal += difference;
        squaredTotal += difference * difference;
        sampledChannels += 1;
      }
      if (maximumDifference >= changedThreshold) changedPixels += 1;
      if (alphaDifference >= changedThreshold) alphaMismatches += 1;

      if (x >= sampleStep && y >= sampleStep) {
        const leftOffset = (y * width + (x - sampleStep)) * 4;
        const upOffset = ((y - sampleStep) * width + x) * 4;
        const referenceGradient =
          Math.abs(luminance(reference.data, offset) - luminance(reference.data, leftOffset))
          + Math.abs(luminance(reference.data, offset) - luminance(reference.data, upOffset));
        const candidateGradient =
          Math.abs(luminance(candidate.data, offset) - luminance(candidate.data, leftOffset))
          + Math.abs(luminance(candidate.data, offset) - luminance(candidate.data, upOffset));
        const referenceEdge = referenceGradient >= edgeThreshold;
        const candidateEdge = candidateGradient >= edgeThreshold;
        if (referenceEdge !== candidateEdge) edgeMismatches += 1;
        edgeSamples += 1;
      }
    }
  }

  return {
    metrics: {
      width,
      height,
      sampledPixels,
      meanAbsoluteError: sampledChannels === 0 ? 0 : absoluteTotal / sampledChannels / 255,
      rootMeanSquareError: sampledChannels === 0
        ? 0
        : Math.sqrt(squaredTotal / sampledChannels) / 255,
      changedPixelRatio: sampledPixels === 0 ? 0 : changedPixels / sampledPixels,
      edgeMismatchRatio: edgeSamples === 0 ? 0 : edgeMismatches / edgeSamples,
      alphaMismatchRatio: sampledPixels === 0 ? 0 : alphaMismatches / sampledPixels,
    },
    difference: output,
  };
}

export function calibrationScore(metrics: CalibrationMetrics): number {
  const weightedError =
    metrics.meanAbsoluteError * 0.36
    + metrics.rootMeanSquareError * 0.24
    + metrics.changedPixelRatio * 0.2
    + metrics.edgeMismatchRatio * 0.18
    + metrics.alphaMismatchRatio * 0.02;
  return Math.max(0, Math.min(100, (1 - weightedError) * 100));
}
