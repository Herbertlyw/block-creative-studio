export interface BBScorePopupTrack {
  readonly actionIndex: number;
  readonly clearSeconds: number;
  readonly delaySeconds: number;
  readonly durationSeconds: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly risePx: number;
  readonly minY: number;
  readonly fontSize: number;
  readonly style: 'white' | 'gold';
}
export interface BBScorePopup {
  text: string;
  x: number;
  y: number;
  alpha: number;
  scale: number;
  fontSize: number;
  style: 'white' | 'gold';
}
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Fully resolved position and wording; time sampling is seek independent. */
export function evaluateBBScorePopups(
  tracks: readonly BBScorePopupTrack[],
  activeIndex: number,
  time: number,
): BBScorePopup[] {
  return tracks.flatMap((track) => {
    if (track.actionIndex > activeIndex) return [];
    const age = time - track.clearSeconds - track.delaySeconds,
      duration = track.durationSeconds;
    if (age < 0 || age >= duration) return [];
    const progress = age / duration;
    return [
      {
        text: track.text,
        x: track.x,
        y: Math.max(track.minY, track.y - track.risePx * progress),
        alpha: clamp(age / 0.06) * clamp((1 - progress) / 0.22),
        scale: 0.88 + 0.12 * clamp(age / 0.09),
        fontSize: track.fontSize,
        style: track.style,
      },
    ];
  });
}
