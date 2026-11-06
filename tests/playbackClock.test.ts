import { expect, it } from 'vitest';
import { playbackFrame } from '../src/contracts/playbackClock';

it('uses the same frame clock for silent and audio-backed playback', () => {
  expect(playbackFrame(5, 99, 30, -0.06)).toBe(5);
  expect(playbackFrame(5, 99, 30, 0)).toBe(5);
  expect(playbackFrame(5, 99, 30, 1 / 60)).toBe(5);
  expect(playbackFrame(5, 99, 30, 1)).toBe(35);
  expect(playbackFrame(5, 99, 30, 5)).toBe(99);
  expect(playbackFrame(100, 99, 30, 0)).toBe(99);
  expect(playbackFrame(5, 99, 24, 1)).toBe(29);
  expect(() => playbackFrame(0, 1, 0, 0)).toThrow(/clock/);
});
