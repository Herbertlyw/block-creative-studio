/** Sampled HUD values are transient plan data, never persisted into the work. */
export interface BBScoreTimeline {
  readonly scores: readonly number[];
  readonly pulses: readonly number[];
}

export function createBBScoreTimeline(
  scores: readonly number[],
  pulses: readonly number[],
): BBScoreTimeline {
  if (
    !scores.length ||
    scores.length !== pulses.length ||
    !scores.every(Number.isFinite) ||
    !pulses.every(Number.isFinite)
  )
    throw new Error('BB_SCORE_TIMELINE_INVALID');
  return { scores: [...scores], pulses: [...pulses] };
}

export function evaluateBBScore(
  timeline: BBScoreTimeline,
  frame: number,
): { score: number; pulse: number } {
  if (!Number.isInteger(frame) || frame < 0 || frame >= timeline.scores.length)
    throw new Error('BB_SCORE_FRAME_OUT_OF_RANGE');
  const score = timeline.scores[frame],
    pulse = timeline.pulses[frame];
  if (score === undefined || pulse === undefined) throw new Error('BB_SCORE_FRAME_OUT_OF_RANGE');
  return { score, pulse };
}
