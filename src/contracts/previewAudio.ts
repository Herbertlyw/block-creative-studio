/** Schedule interleaved 48 kHz PCM against the same frame clock used by previews. */
export function startPreviewAudio(
  context: AudioContext,
  pcm: Float32Array,
  channels: 1 | 2,
  startFrame: number,
  fps: number,
) {
  if (
    context.sampleRate !== 48000 ||
    !Number.isInteger(startFrame) ||
    startFrame < 0 ||
    !Number.isFinite(fps) ||
    fps <= 0 ||
    pcm.length % channels !== 0
  )
    throw new Error('预览音频的采样率、声道或起始帧无效。');
  const samples = pcm.length / channels;
  if (startFrame / fps >= samples / 48000) throw new Error('预览音频短于起始帧。');
  const buffer = context.createBuffer(channels, samples, 48000);
  for (let channel = 0; channel < channels; channel++) {
    const output = buffer.getChannelData(channel);
    for (let i = 0; i < samples; i++) output[i] = pcm[i * channels + channel]!;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  const startTime = context.currentTime + 0.06;
  source.start(startTime, startFrame / fps);
  return { context, source, startTime, startFrame };
}
