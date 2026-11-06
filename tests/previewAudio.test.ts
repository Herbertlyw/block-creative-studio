import { expect, it, vi } from 'vitest';
import { startPreviewAudio } from '../src/contracts/previewAudio';

it('deinterleaves stereo PCM and schedules from the selected frame', () => {
  const left = new Float32Array(48000),
    right = new Float32Array(48000),
    start = vi.fn(),
    connect = vi.fn();
  const source = { buffer: null, connect, start };
  const context = {
    sampleRate: 48000,
    currentTime: 4,
    destination: {},
    createBuffer: vi.fn(() => ({
      getChannelData: (channel: number) => (channel === 0 ? left : right),
    })),
    createBufferSource: () => source,
  } as unknown as AudioContext;
  const pcm = new Float32Array(96000);
  pcm[0] = 0.25;
  pcm[1] = -0.5;
  pcm[2] = 0.75;
  pcm[3] = 1;
  const result = startPreviewAudio(context, pcm, 2, 15, 30);
  expect(Array.from(left.slice(0, 2))).toEqual([0.25, 0.75]);
  expect(Array.from(right.slice(0, 2))).toEqual([-0.5, 1]);
  expect(start).toHaveBeenCalledWith(4.06, 0.5);
  expect(result.startFrame).toBe(15);
});
it('rejects malformed audio and offsets beyond the available samples', () => {
  const context = { sampleRate: 48000 } as AudioContext;
  expect(() => startPreviewAudio(context, new Float32Array(3), 2, 0, 30)).toThrow(/无效/);
  expect(() => startPreviewAudio(context, new Float32Array(10), 1, 1, 30)).toThrow(/短于/);
});
