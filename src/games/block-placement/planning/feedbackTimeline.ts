export interface BBClearTrack {
  readonly actionId: string;
  readonly commitSeconds: number;
  readonly clearSeconds: number;
  readonly timeScale: number;
  readonly rows: readonly number[];
  readonly cols: readonly number[];
  /** Display color can differ from the committed rule color. */
  readonly cells: readonly {
    readonly row: number;
    readonly col: number;
    readonly color: string;
    readonly logicalColor: string;
  }[];
  readonly combo: number;
  readonly seed: number;
  /** Optional frame-relative transition progress, separate from effect age. */
  readonly progressFrames: { readonly start: number; readonly end: number } | null;
  readonly praiseLabel: string | null;
  readonly feedback: {
    readonly like: 'pink-cluster' | 'blue-badge' | undefined;
    readonly rim: boolean;
    readonly celebrate: boolean;
  } | null;
  readonly atmosphereEligible: boolean;
}
export interface BBClearSample {
  readonly index: number;
  readonly actionId: string;
  readonly age: number;
  readonly clearAge: number;
  readonly combo: number;
  readonly seed: number;
  readonly rows: number[];
  readonly cols: number[];
  readonly cells: Array<{ row: number; col: number; color: string; logicalColor: string }>;
  readonly progress: number | null;
  readonly praiseLabel: string | null;
  readonly feedback: {
    age: number;
    combo: number;
    like: 'pink-cluster' | 'blue-badge' | undefined;
    rim: boolean;
    celebrate: boolean;
  } | null;
  readonly atmosphereEligible: boolean;
}
export interface BBPlacementTrack {
  readonly actionId: string;
  readonly cells: readonly {
    readonly row: number;
    readonly col: number;
    readonly color: string;
    readonly logicalColor: string;
  }[];
  readonly placementPoints: number;
  readonly progressFrames: { readonly start: number; readonly span: number } | null;
}
export interface BBPlacementSample {
  readonly actionId: string;
  readonly cells: Array<{ row: number; col: number; color: string; logicalColor: string }>;
  readonly placementPoints: number;
  readonly progress: number | null;
}
export function evaluateBBPlacement(
  track: BBPlacementTrack | undefined,
  phase: string | undefined,
  frameIndex: number,
): BBPlacementSample | null {
  if (!track || phase !== 'placed') return null;
  const range = track.progressFrames;
  return {
    actionId: track.actionId,
    cells: track.cells.map((cell) => ({ ...cell })),
    placementPoints: track.placementPoints,
    progress: range ? Math.max(0, Math.min(1, (frameIndex - range.start) / range.span)) : null,
  };
}

/** Effects use explicit action time and do not replay or modify gameplay. */
export function evaluateBBClears(
  tracks: readonly BBClearTrack[],
  activeIndex: number,
  timeSeconds: number,
  frameIndex: number,
  previousActions: number,
): BBClearSample[] {
  const result: BBClearSample[] = [];
  for (let index = Math.max(0, activeIndex - previousActions); index <= activeIndex; index++) {
    const track = tracks[index];
    if (!track) throw new Error(`BB_CLEAR_TRACK_MISSING:${index}`);
    if (!track.cells.length) continue;
    const age = timeSeconds - track.clearSeconds,
      range = track.progressFrames;
    const progress = range
      ? Math.max(0, Math.min(1, (frameIndex - range.start) / Math.max(1, range.end - range.start)))
      : null;
    const feedback =
      track.feedback && age >= 0 && age < 1.15
        ? { age, combo: track.combo, ...track.feedback }
        : null;
    result.push({
      index,
      actionId: track.actionId,
      age,
      clearAge: age * track.timeScale,
      combo: track.combo,
      seed: track.seed,
      rows: [...track.rows],
      cols: [...track.cols],
      cells: track.cells.map((cell) => ({ ...cell })),
      progress,
      praiseLabel: track.praiseLabel,
      feedback,
      atmosphereEligible: track.atmosphereEligible,
    });
  }
  return result;
}

export function evaluateBBAtmosphere(
  tracks: readonly BBClearTrack[],
  activeIndex: number,
  time: number,
  enabled: boolean,
  end: number | null,
): number | null {
  if (!enabled || (end !== null && time >= end)) return null;
  for (let index = activeIndex; index >= 0; index--) {
    const track = tracks[index];
    if (!track) throw new Error(`BB_CLEAR_TRACK_MISSING:${index}`);
    if (!track.cells.length || time < track.clearSeconds) continue;
    return track.atmosphereEligible ? time - track.clearSeconds : null;
  }
  return null;
}
