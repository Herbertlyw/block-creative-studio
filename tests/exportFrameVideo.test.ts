import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  codec: 'avc',
  failMux: false,
  cancelled: 0,
  closed: 0,
  frames: [] as number[],
}));
vi.mock('mediabunny', () => ({
  Quality: class {},
  Mp4OutputFormat: class {},
  AudioBufferSource: class {},
  getFirstEncodableVideoCodec: async () => state.codec,
  getFirstEncodableAudioCodec: async () => 'aac',
  BufferTarget: class {
    buffer = new ArrayBuffer(1);
  },
  Output: class {
    addVideoTrack() {}
    async start() {}
    async cancel() {
      state.cancelled++;
    }
    async finalize() {
      if (state.failMux) throw new Error('synthetic mux failure');
    }
  },
  CanvasSource: class {
    async add(time: number) {
      state.frames.push(time);
    }
    close() {
      state.closed++;
    }
  },
}));
import { exportFrameVideo } from '../src/exporter/exportFrameVideo';
import { describeExportFailure } from '../src/exporter/exportStatus';

const input = () => ({
  canvas: { width: 512, height: 864 } as HTMLCanvasElement,
  width: 512,
  height: 864,
  fps: 30,
  totalFrames: 45,
  render: () => {},
  audio: null,
});
beforeEach(() =>
  Object.assign(state, { codec: 'avc', failMux: false, cancelled: 0, closed: 0, frames: [] }),
);

it('reports real encoder stages and the final frame count; surfaces a codec failure and allows an unchanged retry', async () => {
  state.codec = 'none';
  await expect(exportFrameVideo(input())).rejects.toMatchObject({
    code: 'ENCODER_UNSUPPORTED',
    phase: 'codec',
  });
  state.codec = 'avc';
  const phases: string[] = [],
    counts: number[] = [];
  const blob = await exportFrameVideo({
    ...input(),
    onPhase: (phase) => phases.push(phase),
    onProgress: (done) => counts.push(done),
  });
  expect(blob.size).toBe(1);
  expect(phases).toEqual(['codec', 'video-encoding', 'muxing']);
  expect(counts.at(-1)).toBe(45);
});
it('never returns cancelled media, cancels the mux and closes resources, then permits retry', async () => {
  const controller = new AbortController();
  await expect(
    exportFrameVideo({
      ...input(),
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(state.cancelled).toBeGreaterThan(0);
  expect(state.closed).toBeGreaterThan(0);
  state.frames = [];
  expect((await exportFrameVideo(input())).size).toBe(1);
  expect(state.frames).toHaveLength(45);
});
it('keeps mux and drawing errors scoped to the attempt, with specific diagnostics and cleanup', async () => {
  state.failMux = true;
  await expect(exportFrameVideo(input())).rejects.toMatchObject({
    phase: 'muxing',
    code: 'MUX_FAILED',
  });
  expect(state.cancelled).toBe(1);
  state.failMux = false;
  await expect(
    exportFrameVideo({
      ...input(),
      render: () => {
        throw new Error('synthetic drawing failure');
      },
    }),
  ).rejects.toMatchObject({ phase: 'video-encoding' });
  expect(describeExportFailure(new Error('write denied'), 'download')).toContain('DOWNLOAD_FAILED');
  expect(
    describeExportFailure(
      new DOMException('encoder stopped unexpectedly', 'AbortError'),
      'video-encoding',
    ),
  ).toContain('encoder stopped unexpectedly');
  expect((await exportFrameVideo(input())).size).toBe(1);
});
