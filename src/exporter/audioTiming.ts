import {
  AudioBufferSource,
  BufferTarget,
  Mp4OutputFormat,
  Output,
  Quality,
  type AudioCodec,
} from 'mediabunny';

/** Measure this encoder/decoder pair with two independent broadband probes. Never assume a fixed AAC delay. */
export async function measureAudioCodecDelay(
  codec: AudioCodec,
  sampleRate: number,
  options: { numberOfChannels?: 1 | 2; bitrate?: number } = {},
): Promise<number> {
  const { numberOfChannels = 1, bitrate = 128_000 } = options;
  if (![1, 2].includes(numberOfChannels) || !Number.isInteger(bitrate) || bitrate <= 0)
    throw new Error('音频校准声道或码率无效。');
  const context = new AudioContext({ sampleRate });
  try {
    if (context.sampleRate !== sampleRate) throw new Error('音频校准采样率不受支持。');
    const buffer = context.createBuffer(numberOfChannels, sampleRate, sampleRate);
    const starts = [Math.round(sampleRate * 0.2), Math.round(sampleRate * 0.6)];
    const patterns = starts.map((_, index) => {
      const pattern = new Float32Array(1024);
      let state = (0x12345678 + index * 0x1020304) >>> 0,
        filtered = 0;
      for (let i = 0; i < pattern.length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        filtered = 0.6 * filtered + 0.4 * ((state / 0x100000000) * 2 - 1);
        pattern[i] = filtered * 0.4;
      }
      return pattern;
    });
    for (let channel = 0; channel < numberOfChannels; channel++)
      starts.forEach((start, index) => buffer.getChannelData(channel).set(patterns[index]!, start));
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    const source = new AudioBufferSource({ codec, quality: new Quality({ bitrate }) });
    output.addAudioTrack(source);
    await output.start();
    await source.add(buffer);
    source.close();
    await output.finalize();
    if (!target.buffer) throw new Error('音频编码器校准未产生数据。');
    const decoded = await context.decodeAudioData(target.buffer.slice(0));
    if (decoded.sampleRate !== sampleRate) throw new Error('音频解码校准采样率不一致。');
    if (decoded.numberOfChannels !== numberOfChannels)
      throw new Error('音频解码校准声道数不一致。');
    const maxDelay = Math.round(sampleRate * 0.2);
    const matches = Array.from({ length: numberOfChannels }, (_, channel) =>
      starts.map((start, index) => {
        const samples = decoded.getChannelData(channel),
          pattern = patterns[index]!;
        let best = -Infinity,
          bestDelay = -1;
        let energy = 0;
        for (const x of pattern) energy += x * x;
        for (
          let delay = 0;
          delay <= maxDelay && start + delay + pattern.length <= samples.length;
          delay++
        ) {
          let dot = 0,
            decodedEnergy = 0;
          for (let i = 0; i < pattern.length; i++) {
            const value = samples[start + delay + i]!;
            dot += value * pattern[i]!;
            decodedEnergy += value * value;
          }
          const score = decodedEnergy > 0 ? dot / Math.sqrt(energy * decodedEnergy) : 0;
          if (score > best) {
            best = score;
            bestDelay = delay;
          }
        }
        if (best < 0.45) throw new Error(`音频编码器校准信号无法可靠识别（${best.toFixed(2)}）。`);
        return bestDelay;
      }),
    ).flat();
    if (matches.some((match) => match !== matches[0]))
      throw new Error(`音频编码器校准结果不一致：${matches.join('、')} 采样。`);
    return matches[0]!;
  } finally {
    await context.close();
  }
}

interface Box {
  start: number;
  size: number;
  type: string;
  header: number;
}
function children(data: DataView, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  for (let pos = start; pos < end; ) {
    if (pos + 8 > end) throw new Error('MP4 box 头不完整。');
    let size = data.getUint32(pos),
      header = 8;
    const type = String.fromCharCode(...[0, 1, 2, 3].map((i) => data.getUint8(pos + 4 + i)));
    if (size === 1) {
      if (pos + 16 > end) throw new Error('MP4 扩展 box 头不完整。');
      size = Number(data.getBigUint64(pos + 8));
      header = 16;
    }
    if (size === 0) size = end - pos;
    if (!Number.isSafeInteger(size) || size < header || pos + size > end)
      throw new Error('MP4 box 长度无效。');
    boxes.push({ start: pos, size, type, header });
    pos += size;
  }
  return boxes;
}
function nested(view: DataView, box: Box): Box[] {
  return children(view, box.start + box.header, box.start + box.size);
}
function required(boxes: Box[], type: string): Box {
  const matches = boxes.filter((box) => box.type === type);
  if (matches.length !== 1)
    throw new Error(`不支持此 MP4 结构：${type} 数量为 ${matches.length}。`);
  return matches[0]!;
}
function timeInfo(
  view: DataView,
  box: Box,
): { scale: number; durationPos: number; version: number } {
  const base = box.start + box.header;
  const version = view.getUint8(base);
  if (version !== 0 && version !== 1) throw new Error('不支持的 MP4 时间版本。');
  const scalePos = base + (version === 0 ? 12 : 20);
  return { scale: view.getUint32(scalePos), durationPos: scalePos + 4, version };
}
function setDuration(view: DataView, position: number, version: number, value: number) {
  if (version === 0) {
    if (value > 0xffffffff) throw new Error('MP4 时长超出支持范围。');
    view.setUint32(position, value);
  } else view.setBigUint64(position, BigInt(value));
}
function getDuration(view: DataView, position: number, version: number): number {
  const value = version === 0 ? view.getUint32(position) : Number(view.getBigUint64(position));
  if (!Number.isSafeInteger(value)) throw new Error('MP4 时长超出支持范围。');
  return value;
}
function trackDuration(view: DataView, track: Box): number {
  const tkhd = required(nested(view, track), 'tkhd');
  const base = tkhd.start + tkhd.header,
    version = view.getUint8(base);
  if (version !== 0 && version !== 1) throw new Error('不支持的 MP4 轨道时间版本。');
  return getDuration(view, base + (version === 0 ? 20 : 28), version);
}

/** Add a presentation edit, leaving encoded packets intact. Requires a trailing moov so mdat offsets stay valid. */
export function trimMp4AudioPresentation(
  input: ArrayBuffer,
  delaySamples: number,
  sampleRate: number,
  durationSeconds: number,
): ArrayBuffer {
  if (
    !Number.isSafeInteger(delaySamples) ||
    delaySamples < 0 ||
    !Number.isSafeInteger(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  )
    throw new Error('音频裁切时钟无效。');
  const view = new DataView(input),
    top = children(view, 0, view.byteLength);
  const moov = required(top, 'moov'),
    mdat = required(top, 'mdat');
  if (
    moov.start < mdat.start + mdat.size ||
    moov.header !== 8 ||
    top.some((box) => box.type === 'moof')
  )
    throw new Error('不支持的 MP4 布局，无法安全裁切音轨。');
  const moovChildren = nested(view, moov),
    mvhd = required(moovChildren, 'mvhd');
  const movie = timeInfo(view, mvhd);
  const tracks = moovChildren.filter((box) => box.type === 'trak');
  const audioTracks = tracks.filter((track) => {
    const mdia = required(nested(view, track), 'mdia');
    const hdlr = required(nested(view, mdia), 'hdlr');
    return (
      String.fromCharCode(
        ...[0, 1, 2, 3].map((i) => view.getUint8(hdlr.start + hdlr.header + 8 + i)),
      ) === 'soun'
    );
  });
  if (audioTracks.length !== 1 || movie.scale === 0)
    throw new Error('MP4 音轨数量或电影时钟不受支持。');
  const audio = audioTracks[0]!,
    trackBoxes = nested(view, audio);
  if (audio.header !== 8 || trackBoxes.some((box) => box.type === 'edts'))
    throw new Error('已有音轨编辑列表，不能安全覆盖。');
  const tkhd = required(trackBoxes, 'tkhd'),
    mdia = required(trackBoxes, 'mdia'),
    media = timeInfo(view, required(nested(view, mdia), 'mdhd'));
  if (media.scale !== sampleRate) throw new Error('MP4 音轨时钟与校准采样率不一致。');
  const duration = Math.round(durationSeconds * movie.scale);
  if (!Number.isSafeInteger(duration) || duration <= 0) throw new Error('MP4 编辑时长无效。');
  const mediaDuration = getDuration(view, media.durationPos, media.version);
  if (
    BigInt(delaySamples) * BigInt(movie.scale) + BigInt(duration) * BigInt(media.scale) >
    BigInt(mediaDuration) * BigInt(movie.scale)
  )
    throw new Error('音频编辑范围超出媒体时长。');
  const movieDuration = Math.max(
    duration,
    ...tracks.filter((track) => track !== audio).map((track) => trackDuration(view, track)),
  );
  const edit = new ArrayBuffer(44),
    e = new DataView(edit);
  e.setUint32(0, 44);
  e.setUint32(4, 0x65647473); // edts
  e.setUint32(8, 36);
  e.setUint32(12, 0x656c7374); // elst
  e.setUint32(16, 0x01000000);
  e.setUint32(20, 1); // version 1, one edit
  e.setBigUint64(24, BigInt(duration));
  e.setBigInt64(32, BigInt(delaySamples));
  e.setUint32(40, 0x00010000);
  const insertion = mdia.start;
  const output = new Uint8Array(input.byteLength + edit.byteLength),
    old = new Uint8Array(input);
  output.set(old.subarray(0, insertion));
  output.set(new Uint8Array(edit), insertion);
  output.set(old.subarray(insertion), insertion + edit.byteLength);
  const out = new DataView(output.buffer);
  out.setUint32(moov.start, moov.size + edit.byteLength);
  out.setUint32(audio.start, audio.size + edit.byteLength);
  const tkhdBase = tkhd.start + tkhd.header + (tkhd.start >= insertion ? edit.byteLength : 0);
  const tkhdVersion = out.getUint8(tkhdBase);
  if (tkhdVersion !== 0 && tkhdVersion !== 1) throw new Error('不支持的 MP4 轨道时间版本。');
  setDuration(out, tkhdBase + (tkhdVersion === 0 ? 20 : 28), tkhdVersion, duration);
  setDuration(
    out,
    movie.durationPos + (movie.durationPos >= insertion ? edit.byteLength : 0),
    movie.version,
    movieDuration,
  );
  return output.buffer;
}
