import { afterEach, expect, it, vi } from 'vitest';
import type { AudioBufferSource } from 'mediabunny';
import { addAudioBufferChunks } from '../src/exporter/audioChunks';

class BufferFixture {
  readonly planes: Float32Array[];
  constructor(readonly options: { length: number; sampleRate: number; numberOfChannels: number }) {
    this.planes = Array.from(
      { length: options.numberOfChannels },
      () => new Float32Array(options.length),
    );
  }
  get length() {
    return this.options.length;
  }
  get sampleRate() {
    return this.options.sampleRate;
  }
  get numberOfChannels() {
    return this.options.numberOfChannels;
  }
  getChannelData(channel: number) {
    return this.planes[channel]!;
  }
  copyToChannel(data: Float32Array, channel: number) {
    this.planes[channel]!.set(data);
  }
}
afterEach(() => vi.unstubAllGlobals());

it('submits exact contiguous stereo PCM including a partial final chunk, without changing the original', async () => {
  vi.stubGlobal('AudioBuffer', BufferFixture);
  const buffer = new BufferFixture({ length: 7, sampleRate: 8, numberOfChannels: 2 });
  buffer.copyToChannel(new Float32Array([0, 1, 2, 3, 4, 5, 6]), 0);
  buffer.copyToChannel(new Float32Array([9, 8, 7, 6, 5, 4, 3]), 1);
  const chunks: BufferFixture[] = [];
  await addAudioBufferChunks(
    {
      add: async (chunk: BufferFixture) => {
        chunks.push(chunk);
      },
    } as unknown as AudioBufferSource,
    buffer as unknown as AudioBuffer,
  );
  expect(chunks.map((chunk) => chunk.length)).toEqual([2, 2, 2, 1]);
  for (let channel = 0; channel < 2; channel++)
    expect(chunks.flatMap((chunk) => Array.from(chunk.getChannelData(channel)))).toEqual(
      Array.from(buffer.getChannelData(channel)),
    );
});

it('finishes an in-flight initialization before rejecting cancellation, then permits an unchanged retry', async () => {
  vi.stubGlobal('AudioBuffer', BufferFixture);
  const buffer = new BufferFixture({ length: 7, sampleRate: 8, numberOfChannels: 1 }),
    controller = new AbortController();
  let release!: () => void;
  const add = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const result = addAudioBufferChunks(
    { add } as unknown as AudioBufferSource,
    buffer as unknown as AudioBuffer,
    controller.signal,
  );
  const cancelled = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  release();
  await cancelled;
  expect(add).toHaveBeenCalledTimes(1);
  const retry = vi.fn(async () => {});
  await addAudioBufferChunks(
    { add: retry } as unknown as AudioBufferSource,
    buffer as unknown as AudioBuffer,
  );
  expect(retry).toHaveBeenCalledTimes(4);
});
