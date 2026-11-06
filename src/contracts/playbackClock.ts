/** The frame visible at a given playback time. Frame zero is held until audio starts. */
export function playbackFrame(
  startFrame: number,
  lastFrame: number,
  fps: number,
  elapsedSeconds: number,
): number {
  if (
    !Number.isInteger(startFrame) ||
    !Number.isInteger(lastFrame) ||
    startFrame < 0 ||
    lastFrame < 0 ||
    !Number.isFinite(fps) ||
    fps <= 0 ||
    !Number.isFinite(elapsedSeconds)
  ) {
    throw new Error('Invalid playback clock.');
  }
  return Math.min(lastFrame, startFrame + Math.floor(Math.max(0, elapsedSeconds) * fps));
}
