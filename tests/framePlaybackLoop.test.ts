import { expect, it } from 'vitest';
import { startFramePlayback } from '../src/contracts/framePlaybackLoop';

it('advances silent playback and stops requesting frames at the end', () => {
  let next: (time: number) => void = () => {};
  let ended = 0;
  const frames: number[] = [];
  startFramePlayback({
    initial: 2,
    last: 5,
    fps: 10,
    readAudio: () => null,
    onFrame: (f) => frames.push(f),
    onEnd: () => ended++,
    request: (cb) => {
      next = cb;
      return 1;
    },
    cancel: () => {},
  });
  next(1000);
  next(1100);
  next(1300);
  expect(frames).toEqual([2, 3, 5]);
  expect(ended).toBe(1);
  next(1500);
  expect(frames).toEqual([2, 3, 5]);
});
it('follows the audio clock and ignores callbacks after cancellation', () => {
  let next: (time: number) => void = () => {},
    cancelled = 0,
    currentTime = 9.95;
  const frames: number[] = [];
  const stop = startFramePlayback({
    initial: 0,
    last: 100,
    fps: 30,
    readAudio: () => ({ currentTime, startTime: 10, startFrame: 12 }),
    onFrame: (f) => frames.push(f),
    onEnd: () => {},
    request: (cb) => {
      next = cb;
      return 4;
    },
    cancel: (id) => {
      cancelled = id;
    },
  });
  next(1000);
  currentTime = 10.1;
  next(1100);
  stop();
  next(1200);
  expect(frames).toEqual([12, 14]);
  expect(cancelled).toBe(4);
});
