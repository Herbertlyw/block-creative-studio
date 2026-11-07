import {
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  Mp4InputFormat,
  Mp4OutputFormat,
  Output,
  Quality,
} from 'mediabunny';

export interface FrameRenderJob<Frame> {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  evaluate(frameIndex: number): Frame;
  render(frame: Frame, canvas: HTMLCanvasElement, options?: FrameRenderOptions): void | Promise<void>;
  prepare?(canvas: HTMLCanvasElement, options?: FrameRenderOptions): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export interface FrameRenderOptions {
  /** Physical pixels per logical output pixel. The encoded canvas remains at width × height. */
  pixelScale: number;
}

export interface FrameRenderProgress {
  phase: 'preparing' | 'rendering' | 'finalizing' | 'verifying' | 'done';
  currentFrame: number;
  totalFrames: number;
  ratio: number;
  message: string;
}

export interface FixedFrameExportOptions {
  bitrate: number;
  fileName: string;
  metadata?: { title?: string; artist?: string; comment?: string };
  signal?: AbortSignal;
  onProgress?: (progress: FrameRenderProgress) => void;
  keyFrameIntervalSeconds?: number;
  /** Render above target resolution and downsample before encoding. Supported range: 1..2. */
  renderScale?: number;
  audio?: FixedFrameAudioTrack;
  visualVerification?: false | {
    frameIndexes?: number[];
    minimumPsnrDb?: number;
    maximumMeanAbsoluteError?: number;
    renderScale?: number;
  };
}

export interface FixedFrameAudioTrack {
  data: Float32Array;
  sampleRate: number;
  numberOfChannels: number;
  bitrate?: number;
}

export interface FixedFrameExportResult {
  blob: Blob;
  fileName: string;
  frameCount: number;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  renderScale: number;
  codec: 'avc';
  audioCodec?: 'aac';
  verification: FixedFrameMp4Verification;
}

export interface FixedFrameMp4Verification {
  containerReadable: true;
  videoTrackCount: number;
  audioTrackCount: number;
  width: number;
  height: number;
  frameCount: number;
  durationSeconds: number;
  averageFrameRate: number;
  averageVideoBitrate: number;
  videoCodec: string;
  audioCodec?: string;
  visual?: FixedFrameVisualVerification;
}

export interface FixedFrameVisualVerificationSample {
  frameIndex: number;
  timestampSeconds: number;
  meanAbsoluteError: number;
  rootMeanSquareError: number;
  psnrDb: number;
}

export interface FixedFrameVisualVerification {
  passed: true;
  minimumPsnrDb: number;
  maximumMeanAbsoluteError: number;
  samples: FixedFrameVisualVerificationSample[];
}

export interface FrameRenderJobValidation {
  valid: boolean;
  errors: string[];
}

export function validateFrameRenderJob<Frame>(job: FrameRenderJob<Frame>, evaluateAllFrames = true): FrameRenderJobValidation {
  const errors: string[] = [];
  if (!Number.isInteger(job.width) || !Number.isInteger(job.height) || job.width <= 0 || job.height <= 0) errors.push('输出宽高必须是正整数。');
  if (job.width % 2 !== 0 || job.height % 2 !== 0) errors.push('H.264 输出宽高必须是偶数。');
  if (!Number.isFinite(job.fps) || job.fps <= 0) errors.push('帧率必须大于 0。');
  if (!Number.isInteger(job.totalFrames) || job.totalFrames <= 0) errors.push('总帧数必须是正整数。');
  if (errors.length === 0) {
    const indexes = evaluateAllFrames
      ? Array.from({ length: job.totalFrames }, (_, index) => index)
      : [...new Set([0, Math.floor(job.totalFrames / 2), job.totalFrames - 1])];
    for (const index of indexes) {
      try {
        const frame = job.evaluate(index);
        if (frame === undefined || frame === null) errors.push(`第 ${index} 帧求值为空。`);
      } catch (error) {
        errors.push(`第 ${index} 帧求值失败：${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Render canceled', 'AbortError');
}

function report(options: FixedFrameExportOptions, progress: FrameRenderProgress): void {
  options.onProgress?.(progress);
}

function normalizeRenderScale(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isFinite(value) || value < 1 || value > 2) {
    throw new Error('固定帧渲染倍率必须在 1 到 2 之间。');
  }
  return value;
}

function createRenderCanvas(job: Pick<FrameRenderJob<unknown>, 'width' | 'height'>, renderScale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(job.width * renderScale);
  canvas.height = Math.round(job.height * renderScale);
  return canvas;
}

async function downsampleRenderCanvas(source: HTMLCanvasElement, target: HTMLCanvasElement, width: number, height: number): Promise<void> {
  if (source === target) return;
  const context = target.getContext('2d', { alpha: false });
  if (!context) throw new Error('固定帧下采样需要 Canvas 2D 环境。');
  let resized: ImageBitmap | undefined;
  if (typeof createImageBitmap === 'function') {
    resized = await createImageBitmap(source, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'high',
    });
  }
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  // A very small micro-contrast compensation preserves thin ceramic edges and
  // particle highlights that otherwise soften during the supersample reduction.
  context.filter = 'contrast(1.012) saturate(1.006)';
  context.drawImage(resized ?? source, 0, 0, width, height);
  context.filter = 'none';
  context.restore();
  resized?.close();
}

/** Render one frame through the same supersample/downsample path used by MP4 export. */
export async function renderFixedFrameToCanvas<Frame>(
  job: FrameRenderJob<Frame>,
  frame: Frame,
  outputCanvas: HTMLCanvasElement,
  requestedRenderScale = 1,
  reusableRenderCanvas?: HTMLCanvasElement,
): Promise<void> {
  const renderScale = normalizeRenderScale(requestedRenderScale);
  outputCanvas.width = job.width;
  outputCanvas.height = job.height;
  const renderCanvas = renderScale === 1 ? outputCanvas : (reusableRenderCanvas ?? createRenderCanvas(job, renderScale));
  if (renderCanvas !== outputCanvas) {
    const width = Math.round(job.width * renderScale);
    const height = Math.round(job.height * renderScale);
    if (renderCanvas.width !== width) renderCanvas.width = width;
    if (renderCanvas.height !== height) renderCanvas.height = height;
  }
  await job.prepare?.(renderCanvas, { pixelScale: renderScale });
  await job.render(frame, renderCanvas, { pixelScale: renderScale });
  await downsampleRenderCanvas(renderCanvas, outputCanvas, job.width, job.height);
}

export async function verifyFixedFrameMp4(
  blob: Blob,
  expected: { width: number; height: number; fps: number; totalFrames: number; audio: boolean },
): Promise<FixedFrameMp4Verification> {
  const input = new Input({
    source: new BlobSource(blob),
    formats: [new Mp4InputFormat()],
  });
  try {
    if (!await input.canRead()) throw new Error('生成的文件不是可读取的 MP4。');
    const videoTracks = await input.getVideoTracks();
    const audioTracks = await input.getAudioTracks();
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('生成的 MP4 缺少视频轨。');
    const [width, height, videoCodec, durationSeconds, packetStats] = await Promise.all([
      video.getDisplayWidth(),
      video.getDisplayHeight(),
      video.getCodec(),
      video.computeDuration({ metadataOnly: true }),
      video.computePacketStats(undefined, { metadataOnly: true }),
    ]);
    const audio = await input.getPrimaryAudioTrack();
    const audioCodec = audio ? await audio.getCodec() : undefined;
    const mismatches: string[] = [];
    if (width !== expected.width || height !== expected.height) {
      mismatches.push(`尺寸 ${width}×${height}，预期 ${expected.width}×${expected.height}`);
    }
    if (packetStats.packetCount !== expected.totalFrames) {
      mismatches.push(`帧数 ${packetStats.packetCount}，预期 ${expected.totalFrames}`);
    }
    if (Math.abs(packetStats.averagePacketRate - expected.fps) > 0.01) {
      mismatches.push(`帧率 ${packetStats.averagePacketRate.toFixed(4)}，预期 ${expected.fps}`);
    }
    const expectedDuration = expected.totalFrames / expected.fps;
    if (Math.abs(durationSeconds - expectedDuration) > Math.max(0.002, 0.5 / expected.fps)) {
      mismatches.push(`时长 ${durationSeconds.toFixed(4)}s，预期 ${expectedDuration.toFixed(4)}s`);
    }
    if (videoCodec !== 'avc') mismatches.push(`视频编码 ${videoCodec ?? 'unknown'}，预期 avc`);
    if (expected.audio && (audioTracks.length === 0 || audioCodec !== 'aac')) {
      mismatches.push(`音频编码 ${audioCodec ?? 'missing'}，预期 aac`);
    }
    if (mismatches.length > 0) throw new Error(`ENCODED_MP4_VERIFICATION_FAILED: ${mismatches.join('；')}`);
    return {
      containerReadable: true,
      videoTrackCount: videoTracks.length,
      audioTrackCount: audioTracks.length,
      width,
      height,
      frameCount: packetStats.packetCount,
      durationSeconds,
      averageFrameRate: packetStats.averagePacketRate,
      averageVideoBitrate: packetStats.averageBitrate,
      videoCodec: videoCodec ?? 'unknown',
      ...(audioCodec ? { audioCodec } : {}),
    };
  } finally {
    input.dispose();
  }
}

function uniqueVerificationFrames(totalFrames: number, requested?: number[]): number[] {
  const defaults = [0, Math.floor((totalFrames - 1) / 2), totalFrames - 1];
  return [...new Set(requested ?? defaults)]
    .filter((frame) => Number.isInteger(frame) && frame >= 0 && frame < totalFrames)
    .sort((left, right) => left - right);
}

export async function verifyFixedFrameVisualParity<Frame>(
  blob: Blob,
  job: FrameRenderJob<Frame>,
  options: Exclude<FixedFrameExportOptions['visualVerification'], false | undefined> = {},
): Promise<FixedFrameVisualVerification> {
  if (typeof document === 'undefined') throw new Error('视频画质回读需要浏览器 Canvas 环境。');
  const frameIndexes = uniqueVerificationFrames(job.totalFrames, options.frameIndexes);
  const minimumPsnrDb = options.minimumPsnrDb ?? 26;
  const maximumMeanAbsoluteError = options.maximumMeanAbsoluteError ?? 10;
  const renderScale = normalizeRenderScale(options.renderScale);
  const input = new Input({ source: new BlobSource(blob), formats: [new Mp4InputFormat()] });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('ENCODED_VISUAL_VERIFICATION_FAILED: MP4 缺少视频轨。');
    if (!await track.canDecode()) throw new Error('ENCODED_VISUAL_VERIFICATION_FAILED: 当前浏览器无法回读刚编码的 H.264。');
    const sink = new CanvasSink(track, { width: job.width, height: job.height, fit: 'fill', alpha: false });
    const timestamps = frameIndexes.map((frameIndex) => (frameIndex + 0.25) / job.fps);
    const decodedCanvases = sink.canvasesAtTimestamps(timestamps);
    const referenceCanvas = document.createElement('canvas');
    referenceCanvas.width = job.width;
    referenceCanvas.height = job.height;
    const referenceRenderCanvas = renderScale === 1 ? referenceCanvas : createRenderCanvas(job, renderScale);
    const decodedCopy = document.createElement('canvas');
    decodedCopy.width = job.width;
    decodedCopy.height = job.height;
    const referenceContext = referenceCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
    const decodedContext = decodedCopy.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!referenceContext || !decodedContext) throw new Error('ENCODED_VISUAL_VERIFICATION_FAILED: Canvas 2D 不可用。');
    const samples: FixedFrameVisualVerificationSample[] = [];
    let sampleIndex = 0;
    for await (const wrapped of decodedCanvases) {
      const frameIndex = frameIndexes[sampleIndex];
      if (frameIndex === undefined || !wrapped) throw new Error(`ENCODED_VISUAL_VERIFICATION_FAILED: 无法解码检查帧 ${frameIndex ?? sampleIndex}。`);
      await job.render(job.evaluate(frameIndex), referenceRenderCanvas, { pixelScale: renderScale });
      await downsampleRenderCanvas(referenceRenderCanvas, referenceCanvas, job.width, job.height);
      decodedContext.clearRect(0, 0, job.width, job.height);
      decodedContext.drawImage(wrapped.canvas, 0, 0, job.width, job.height);
      const reference = referenceContext.getImageData(0, 0, job.width, job.height).data;
      const decoded = decodedContext.getImageData(0, 0, job.width, job.height).data;
      let absoluteError = 0;
      let squaredError = 0;
      const channelCount = job.width * job.height * 3;
      for (let offset = 0; offset < reference.length; offset += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          const delta = reference[offset + channel]! - decoded[offset + channel]!;
          absoluteError += Math.abs(delta);
          squaredError += delta * delta;
        }
      }
      const meanAbsoluteError = absoluteError / channelCount;
      const meanSquaredError = squaredError / channelCount;
      const rootMeanSquareError = Math.sqrt(meanSquaredError);
      const psnrDb = meanSquaredError === 0 ? 99 : 10 * Math.log10((255 * 255) / meanSquaredError);
      samples.push({
        frameIndex,
        timestampSeconds: wrapped.timestamp,
        meanAbsoluteError,
        rootMeanSquareError,
        psnrDb,
      });
      sampleIndex += 1;
    }
    if (samples.length !== frameIndexes.length) {
      throw new Error(`ENCODED_VISUAL_VERIFICATION_FAILED: 只回读 ${samples.length}/${frameIndexes.length} 个检查帧。`);
    }
    const failures = samples.filter((sample) => sample.psnrDb < minimumPsnrDb || sample.meanAbsoluteError > maximumMeanAbsoluteError);
    if (failures.length > 0) {
      throw new Error(`ENCODED_VISUAL_VERIFICATION_FAILED: ${failures.map((sample) => `帧 ${sample.frameIndex} PSNR ${sample.psnrDb.toFixed(2)}dB / MAE ${sample.meanAbsoluteError.toFixed(2)}`).join('；')}`);
    }
    return { passed: true, minimumPsnrDb, maximumMeanAbsoluteError, samples };
  } finally {
    input.dispose();
  }
}

export async function exportFixedFrameVideo<Frame>(
  job: FrameRenderJob<Frame>,
  options: FixedFrameExportOptions,
): Promise<FixedFrameExportResult> {
  const validation = validateFrameRenderJob(job, true);
  if (!validation.valid) throw new Error(validation.errors.join('\n'));
  if (typeof document === 'undefined') throw new Error('固定帧 MP4 导出需要浏览器 Canvas 环境。');
  if (typeof VideoEncoder === 'undefined') throw new Error('当前浏览器未启用 WebCodecs VideoEncoder，无法导出 MP4。');
  throwIfAborted(options.signal);

  const renderScale = normalizeRenderScale(options.renderScale);
  const canvas = document.createElement('canvas');
  canvas.width = job.width;
  canvas.height = job.height;
  const renderCanvas = renderScale === 1 ? canvas : createRenderCanvas(job, renderScale);
  let output: Output | undefined;
  try {
    report(options, { phase: 'preparing', currentFrame: 0, totalFrames: job.totalFrames, ratio: 0, message: '正在预热资产、字体与 H.264 编码器…' });
    if ('fonts' in document) await document.fonts.ready;
    await job.prepare?.(renderCanvas, { pixelScale: renderScale });
    throwIfAborted(options.signal);

    const quality = new Quality({ bitrate: options.bitrate });
    const codec = await getFirstEncodableVideoCodec(['avc'], { width: job.width, height: job.height, quality });
    if (codec !== 'avc') throw new Error(`当前浏览器/GPU 无法以 H.264 编码 ${job.width}×${job.height} 视频。`);
    const target = new BufferTarget();
    output = new Output({ format: new Mp4OutputFormat(), target });
    const source = new CanvasSource(canvas, { codec, quality });
    output.addVideoTrack(source, { frameRate: job.fps });
    let audioSource: AudioSampleSource | undefined;
    let audioCodec: 'aac' | undefined;
    if (options.audio) {
      if (typeof AudioEncoder === 'undefined') throw new Error('当前浏览器未启用 WebCodecs AudioEncoder，无法导出带音频 MP4。');
      const { data, sampleRate, numberOfChannels } = options.audio;
      if (!(data instanceof Float32Array) || data.length === 0 || !Number.isInteger(sampleRate) || sampleRate <= 0 || !Number.isInteger(numberOfChannels) || numberOfChannels <= 0 || data.length % numberOfChannels !== 0) {
        throw new Error('固定帧导出的音频轨必须是有效的交错 Float32 PCM。');
      }
      const audioQuality = new Quality({ bitrate: options.audio.bitrate ?? 192_000 });
      const selectedAudioCodec = await getFirstEncodableAudioCodec(['aac'], { sampleRate, numberOfChannels, quality: audioQuality });
      if (selectedAudioCodec !== 'aac') throw new Error(`当前浏览器无法以 AAC 编码 ${sampleRate}Hz/${numberOfChannels}ch 音频。`);
      audioCodec = selectedAudioCodec;
      audioSource = new AudioSampleSource({ codec: audioCodec, quality: audioQuality });
      output.addAudioTrack(audioSource, { languageCode: 'und', name: 'TapTile semantic mix' });
    }
    if (options.metadata) output.setMetadataTags(options.metadata);

    await output.start();
    if (audioSource && options.audio) {
      const audioSample = new AudioSample({
        data: options.audio.data,
        format: 'f32',
        numberOfChannels: options.audio.numberOfChannels,
        sampleRate: options.audio.sampleRate,
        timestamp: 0,
      });
      try {
        await audioSource.add(audioSample);
      } finally {
        audioSample.close();
        audioSource.close();
      }
      throwIfAborted(options.signal);
    }
    const frameDuration = 1 / job.fps;
    const keyInterval = Math.max(1, Math.round((options.keyFrameIntervalSeconds ?? 2) * job.fps));
    for (let frameIndex = 0; frameIndex < job.totalFrames; frameIndex += 1) {
      throwIfAborted(options.signal);
      const frame = job.evaluate(frameIndex);
      await job.render(frame, renderCanvas, { pixelScale: renderScale });
      await downsampleRenderCanvas(renderCanvas, canvas, job.width, job.height);
      await source.add(frameIndex * frameDuration, frameDuration, { keyFrame: frameIndex % keyInterval === 0 });
      if (frameIndex % 3 === 0 || frameIndex === job.totalFrames - 1) {
        report(options, {
          phase: 'rendering',
          currentFrame: frameIndex + 1,
          totalFrames: job.totalFrames,
          ratio: (frameIndex + 1) / job.totalFrames,
          message: `逐帧渲染 ${frameIndex + 1} / ${job.totalFrames}`,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    source.close();
    report(options, { phase: 'finalizing', currentFrame: job.totalFrames, totalFrames: job.totalFrames, ratio: 1, message: '正在完成 H.264 编码与 MP4 封装…' });
    await output.finalize();
    if (!target.buffer) throw new Error('编码完成但没有得到 MP4 缓冲区。');
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    report(options, { phase: 'verifying', currentFrame: job.totalFrames, totalFrames: job.totalFrames, ratio: 1, message: '正在回读 MP4，核对分辨率、帧率、帧数、时长与音轨…' });
    let verification = await verifyFixedFrameMp4(blob, {
      width: job.width,
      height: job.height,
      fps: job.fps,
      totalFrames: job.totalFrames,
      audio: Boolean(options.audio),
    });
    if (options.visualVerification !== false) {
      report(options, { phase: 'verifying', currentFrame: job.totalFrames, totalFrames: job.totalFrames, ratio: 1, message: '正在解码代表帧，与导演源画面核对压缩损失…' });
      const visual = await verifyFixedFrameVisualParity(blob, job, {
        ...(options.visualVerification ?? {}),
        renderScale,
      });
      verification = { ...verification, visual };
    }
    report(options, { phase: 'done', currentFrame: job.totalFrames, totalFrames: job.totalFrames, ratio: 1, message: 'MP4 已生成。' });
    return {
      blob,
      fileName: options.fileName,
      frameCount: job.totalFrames,
      durationSeconds: job.totalFrames / job.fps,
      width: job.width,
      height: job.height,
      fps: job.fps,
      renderScale,
      codec,
      ...(audioCodec ? { audioCodec } : {}),
      verification,
    };
  } catch (error) {
    try { await output?.cancel(); } catch { /* Preserve the original error. */ }
    throw error;
  } finally {
    await job.dispose?.();
  }
}
