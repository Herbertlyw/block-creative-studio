import { syntheticObservedFixture } from './fixtures/syntheticObserved';
import { expect, it } from 'vitest';
import { normalizeObservedScore } from '../src/games/block-placement/planning/observedScoreTrack';
import { referenceHudAt } from '../src/games/block-placement/calibrated/referenceFeedback';
import { evaluateBBScore } from '../src/games/block-placement/planning/scoreTimeline';
import type { ReferenceCalibration } from '../src/games/block-placement/calibrated/parseCalibration';

const fixture = await syntheticObservedFixture();
it.each([30, 60])('preserves dense measured score and overlapping pulses at %i fps', (fps) => {
  const doc = JSON.parse(JSON.stringify(fixture.document));
  const calibration = doc.direction.style.referenceCalibration as ReferenceCalibration;
  calibration.scoreTrack = Array.from(
    { length: 5000 },
    (_, index) => [index / 1000, index % 23] as [number, number],
  );
  calibration.effects = {
    ...calibration.effects,
    scoreHud: { enabled: true, interpolate: true, diamondPulse: true },
  };
  const plan = normalizeObservedScore(calibration, fps, 5 * fps);
  for (let frame = 0; frame < 5 * fps; frame++) {
    const actual = evaluateBBScore(plan, frame),
      expected = referenceHudAt(calibration, frame / fps);
    expect(actual.score).toBe(expected.score);
    expect(actual.pulse).toBe(expected.pulse);
  }
});

it('preserves empty tracks and multiple measured score changes at one timestamp', () => {
  const doc = JSON.parse(JSON.stringify(fixture.document));
  const calibration = doc.direction.style.referenceCalibration as ReferenceCalibration;
  calibration.effects = {
    ...calibration.effects,
    scoreHud: { enabled: true, interpolate: true, diamondPulse: true },
  };
  for (const track of [
    [],
    [
      [0, 0],
      [0.5, 10],
      [0.5, 20],
      [0.5, 30],
      [1, 50],
    ],
  ] as Array<Array<[number, number]>>) {
    calibration.scoreTrack = track;
    const plan = normalizeObservedScore(calibration, 30, 60);
    for (let frame = 0; frame < 60; frame++)
      expect(evaluateBBScore(plan, frame)).toEqual(referenceHudAt(calibration, frame / 30));
  }
});
