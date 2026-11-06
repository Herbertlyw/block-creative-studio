import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  Quality,
} from 'mediabunny';
import { alignAacPriming } from '../nativeReference/exporter/aacPriming';
import { measureAudioCodecDelay, trimMp4AudioPresentation } from './audioTiming';

/** Shared frame encoder: callers provide the exact already-warmed drawing surface. */
export async function exportBBVideo({
  canvas,
  width,
  height,
  fps,
  totalFrames,
  render,
  audio,
  onProgress,
  signal,
  bitrate = 8_000_000,
}: {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  render: (frame: number) => void;
  audio: { pcm: Float32Array; channels: 1 | 2 } | null;
  onProgress?: (frame: number, total: number) => void;
  signal?: AbortSignal;
  bitrate?: number;
}): Promise<Blob> {
  const checkCancelled = () => {
    if (signal?.aborted)
      throw new DOMException('作品或预览设置已更改，已取消旧导出。', 'AbortError');
  };
  checkCancelled();
  if (
    ![width, height, fps, totalFrames].every(Number.isInteger) ||
    width < 2 ||
    height < 2 ||
    width % 2 ||
    height % 2 ||
    width > 1920 ||
    height > 1920 ||
    fps < 1 ||
    totalFrames < 1 ||
    totalFrames > 18000
  )
    throw new Error('视频尺寸、帧率或帧数不支持。');
  if (canvas.width !== width || canvas.height !== height)
    throw new Error('绘制画布尺寸与输出不一致。');
  if (audio && (audio.pcm.length % audio.channels || audio.pcm.length === 0))
    throw new Error('音频采样帧无效。');
  if (![8_000_000, 14_000_000, 24_000_000].includes(bitrate))
    throw new Error('视频码率选项不支持。');
  let mux: Output | null = null;
  try {
    const quality = new Quality({ bitrate }),
      codec = await getFirstEncodableVideoCodec(['avc'], { width, height, quality });
    if (codec !== 'avc') throw new Error('浏览器不能编码 AVC。');
    checkCancelled();
    let track: AudioBufferSource | null = null,
      buffer: AudioBuffer | null = null,
      delay = 0;
    if (audio) {
      const sampleRate = 48_000,
        bitrate = audio.channels === 2 ? 192_000 : 128_000,
        audioCodec = await getFirstEncodableAudioCodec(['aac'], {
          numberOfChannels: audio.channels,
          sampleRate,
        });
      if (audioCodec !== 'aac') throw new Error('浏览器不能编码 AAC。');
      track = new AudioBufferSource({ codec: audioCodec, quality: new Quality({ bitrate }) });
      const context = new AudioContext({ sampleRate });
      try {
        buffer = context.createBuffer(
          audio.channels,
          audio.pcm.length / audio.channels,
          sampleRate,
        );
        for (let c = 0; c < audio.channels; c++) {
          const data = buffer.getChannelData(c);
          for (let i = 0; i < data.length; i++) data[i] = audio.pcm[i * audio.channels + c]!;
        }
      } finally {
        await context.close();
      }
      if (audio.channels === 1)
        delay = await measureAudioCodecDelay(audioCodec, sampleRate, {
          numberOfChannels: 1,
          bitrate,
        });
    }
    checkCancelled();
    const target = new BufferTarget();
    mux = new Output({
      format: new Mp4OutputFormat(audio ? { fastStart: false } : undefined),
      target,
    });
    const video = new CanvasSource(canvas, { codec, quality });
    mux.addVideoTrack(video, { frameRate: fps });
    if (track) mux.addAudioTrack(track);
    await mux.start();
    if (track && buffer) await track.add(buffer);
    for (let frame = 0; frame < totalFrames; frame++) {
      checkCancelled();
      render(frame);
      await video.add(frame / fps, 1 / fps, { keyFrame: frame % (fps * 2) === 0 });
      if (frame % 12 === 0) {
        onProgress?.(frame + 1, totalFrames);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    checkCancelled();
    video.close();
    track?.close();
    await mux.finalize();
    if (!target.buffer) throw new Error('视频输出为空。');
    const duration = totalFrames / fps;
    if (audio?.channels === 2) {
      const result = await alignAacPriming(
        new Blob([target.buffer], { type: 'video/mp4' }),
        { data: audio.pcm, sampleRate: 48_000, numberOfChannels: 2 },
        duration,
      );
      checkCancelled();
      return result.blob;
    }
    checkCancelled();
    return new Blob(
      [audio ? trimMp4AudioPresentation(target.buffer, delay, 48_000, duration) : target.buffer],
      { type: 'video/mp4' },
    );
  } catch (error) {
    if (mux)
      try {
        await mux.cancel();
      } catch {
        /* retain the original error */
      }
    throw error;
  }
}
