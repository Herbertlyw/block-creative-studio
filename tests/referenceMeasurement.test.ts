import { expect, it } from 'vitest';
import {
  measuredFrameSeconds,
  validateReferenceMeasurement,
} from '../src/contracts/referenceMeasurement';
const measurement = () => ({
  version: '1.0.0',
  source: {
    sha256: 'source',
    width: 512,
    height: 864,
    fps: '30',
    frameCount: 3,
    firstTimestamp: 900,
    timeBase: '1/90000',
  },
  timing: { mode: 'constant', timestampTicks: [900, 3900, 6900] },
});
it('binds exact source timestamps and rejects mismatch, missing frames and VFR', () => {
  const m = validateReferenceMeasurement(measurement(), 'source', 512, 864);
  expect(measuredFrameSeconds(m, 2)).toBeCloseTo(2 / 30);
  expect(() => validateReferenceMeasurement(measurement(), 'different', 512, 864)).toThrow(
    /SHA-256/,
  );
  const v = measurement();
  v.timing.timestampTicks[2] = 9900;
  expect(() => validateReferenceMeasurement(v, 'source', 512, 864)).toThrow(/变帧率/);
  const duplicate = measurement();
  duplicate.timing.timestampTicks[1] = 900;
  expect(() => validateReferenceMeasurement(duplicate, 'source', 512, 864)).toThrow(/时间戳/);
  expect(() => measuredFrameSeconds(m, 3)).toThrow(/超出/);
});
