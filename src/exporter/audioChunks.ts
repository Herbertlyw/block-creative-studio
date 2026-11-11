import type { AudioBufferSource } from 'mediabunny';

/** Bound encoder backpressure and check cancellation between exact, contiguous PCM chunks. */
export async function addAudioBufferChunks(
  source: AudioBufferSource,
  buffer: AudioBuffer,
  signal?: AbortSignal,
) {
  const chunkFrames = Math.max(1, Math.floor(buffer.sampleRate / 4));
  for (let start = 0; start < buffer.length; start += chunkFrames) {
    signal?.throwIfAborted();
    const length = Math.min(chunkFrames, buffer.length - start);
    const chunk = new AudioBuffer({
      length,
      sampleRate: buffer.sampleRate,
      numberOfChannels: buffer.numberOfChannels,
    });
    for (let channel = 0; channel < buffer.numberOfChannels; channel++)
      chunk.copyToChannel(buffer.getChannelData(channel).subarray(start, start + length), channel);
    // Awaiting add also finishes encoder initialization. Do not terminate its worker while
    // this call is in flight: Mediabunny 1.54's pending init would otherwise never settle.
    await source.add(chunk);
    signal?.throwIfAborted();
  }
}
