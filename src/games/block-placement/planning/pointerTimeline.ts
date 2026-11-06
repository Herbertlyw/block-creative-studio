import { sampleLinearTrack, type LinearTrackPoint } from './linearTrack';

/** Coordinates and clocks remain explicit; a ring and a piece are independent tracks. */
export interface BBPointerTrack {
  readonly actionId: string;
  readonly clock: 'frame' | 'seconds';
  readonly space: 'normalized' | 'design';
  readonly scope: 'active-action' | 'independent';
  readonly start: number;
  readonly end: number;
  readonly points: readonly LinearTrackPoint<readonly [number, number]>[];
  readonly minimumSpan: number;
  readonly radius: number | null;
  readonly settleTo?: { x: number; y: number; fromProgress: number; span: number };
  readonly showAfterCommit?: boolean;
}
export interface BBPointerSample {
  actionId: string;
  x: number;
  y: number;
  space: 'normalized' | 'design';
  radius: number | null;
  pressed: boolean;
}

/** Measured overlays are independent of the active game action; authored input is tied to its action. */
export function evaluateBBPointer(
  tracks: readonly BBPointerTrack[],
  frameIndex: number,
  timeSeconds: number,
  active: { actionId: string; phase: string; rawProgress: number | null } | null,
): BBPointerSample | null {
  for (const track of tracks) {
    const time = track.clock === 'frame' ? frameIndex : timeSeconds;
    const independent = track.scope === 'independent';
    const dragging = independent
      ? time >= track.start && time <= track.end
      : active?.actionId === track.actionId && active.phase === 'drag';
    if (dragging) {
      let [x, y] = sampleLinearTrack(track.points, time, track.minimumSpan);
      if (track.settleTo && active?.rawProgress !== null && active?.rawProgress !== undefined) {
        const t = Math.max(
          0,
          Math.min(1, (active.rawProgress - track.settleTo.fromProgress) / track.settleTo.span),
        );
        x += (track.settleTo.x - x) * t;
        y += (track.settleTo.y - y) * t;
      }
      return {
        actionId: track.actionId,
        x,
        y,
        space: track.space,
        radius: track.radius,
        pressed: true,
      };
    }
    if (
      track.showAfterCommit &&
      active?.actionId === track.actionId &&
      active.phase === 'placed' &&
      track.settleTo
    )
      return {
        actionId: track.actionId,
        x: track.settleTo.x,
        y: track.settleTo.y,
        space: track.space,
        radius: track.radius,
        pressed: false,
      };
  }
  return null;
}
