import type { ReferenceCalibration } from '../calibrated/parseCalibration';
import { createBBScoreTimeline } from './scoreTimeline';

/** Compile measured HUD samples without scanning the full source track for each frame. */
export function normalizeObservedScore(
  calibration: ReferenceCalibration,
  fps: number,
  totalFrames: number,
) {
  const track = calibration.scoreTrack;
  const first = track[0];
  if (!first)
    return createBBScoreTimeline(
      Array<number>(totalFrames).fill(0),
      Array<number>(totalFrames).fill(0),
    );
  const effects = calibration.effects?.scoreHud;
  const pulseTimes: number[] = [];
  if (effects?.enabled && effects.diamondPulse)
    for (let index = 1; index < track.length; index++) {
      const previous = track[index - 1],
        next = track[index];
      if (!previous || !next || next[0] < previous[0])
        throw new Error('BB_OBSERVED_SCORE_TRACK_INVALID');
      if (next[1] !== previous[1]) pulseTimes.push(next[0]);
    }
  const scores: number[] = [],
    pulses: number[] = [];
  let current = first,
    index = 1;
  for (let frame = 0; frame < totalFrames; frame++) {
    const time = frame / fps;
    let next = track[index];
    while (next && time >= next[0]) {
      current = next;
      index++;
      next = track[index];
    }
    let score = current[1];
    if (next && effects?.enabled && effects.interpolate && next[0] - current[0] <= 0.35) {
      const amount = Math.max(0, Math.min(1, (time - current[0]) / (next[0] - current[0])));
      score = Math.round(current[1] + (next[1] - current[1]) * amount);
    }
    scores.push(score);
    let lo = 0,
      hi = pulseTimes.length;
    const center = time - 0.16;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2),
        candidate = pulseTimes[mid];
      if (candidate === undefined) throw new Error('BB_OBSERVED_SCORE_TRACK_INVALID');
      if (candidate < center) lo = mid + 1;
      else hi = mid;
    }
    let pulse = 0;
    for (const candidate of [pulseTimes[lo - 1], pulseTimes[lo]])
      if (candidate !== undefined) {
        const age = time - candidate;
        if (age >= 0 && age < 0.32) pulse = Math.max(pulse, Math.sin((Math.PI * age) / 0.32));
      }
    pulses.push(pulse);
  }
  return createBBScoreTimeline(scores, pulses);
}
