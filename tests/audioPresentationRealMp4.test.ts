import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trimMp4AudioPresentation } from '../src/exporter/audioTiming';

// Real, locally generated media; both programs are required for this integration test.
const dir = mkdtempSync(join(tmpdir(), 'aac-timing-'));
const file = (name: string) => join(dir, name);
const run = (program: string, args: string[]) => execFileSync(program, args, { stdio: 'pipe' });
const generate = (name: string, videoSeconds: number, audioSeconds: number, extra: string[] = []) =>
  run('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=black:s=64x64:r=30:d=${videoSeconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=900:sample_rate=48000:duration=${audioSeconds}`,
    '-c:v',
    'libx264',
    '-bf',
    '0',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-use_editlist',
    '0',
    ...extra,
    '-y',
    file(name),
  ]);
const input = (name: string): ArrayBuffer => {
  const data = readFileSync(file(name));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};
const probe = (
  name: string,
): {
  streams: Array<{ codec_type: string; duration: string; nb_frames: string }>;
  format: { duration: string };
} =>
  JSON.parse(
    run('ffprobe', [
      '-v',
      'error',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      file(name),
    ]).toString(),
  );
const save = (name: string, data: ArrayBuffer) => writeFileSync(file(name), Buffer.from(data));

beforeAll(() => {
  generate('short.mp4', 2, 1.5);
  generate('equal.mp4', 2, 2);
  generate('long.mp4', 2, 2.5);
  generate('front.mp4', 2, 2, ['-movflags', '+faststart']);
  generate('fragmented.mp4', 2, 2, ['-movflags', 'frag_keyframe+empty_moov']);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('real MP4 presentation integration', () => {
  it('keeps the longer video and movie duration when audio is shorter', () => {
    save('short-out.mp4', trimMp4AudioPresentation(input('short.mp4'), 0, 48000, 1.5));
    const result = probe('short-out.mp4'),
      video = result.streams.find((s) => s.codec_type === 'video')!,
      audio = result.streams.find((s) => s.codec_type === 'audio')!;
    const before = probe('short.mp4'),
      beforeVideo = before.streams.find((s) => s.codec_type === 'video')!;
    expect(Number(video.duration)).toBeCloseTo(Number(beforeVideo.duration), 3);
    expect(Number(video.nb_frames)).toBe(60);
    expect(Number(audio.duration)).toBeCloseTo(1.5, 3);
    expect(Number(result.format.duration)).toBeCloseTo(Number(beforeVideo.duration), 3);
    run('ffmpeg', ['-v', 'error', '-i', file('short-out.mp4'), '-f', 'null', '-']);
  });
  it('handles equal-length tracks without shortening video', () => {
    save('equal-out.mp4', trimMp4AudioPresentation(input('equal.mp4'), 0, 48000, 2));
    const result = probe('equal-out.mp4');
    const beforeVideo = probe('equal.mp4').streams.find((s) => s.codec_type === 'video')!,
      video = result.streams.find((s) => s.codec_type === 'video')!,
      audio = result.streams.find((s) => s.codec_type === 'audio')!;
    expect(Number(video.duration)).toBeCloseTo(Number(beforeVideo.duration), 3);
    expect(Number(result.format.duration)).toBeCloseTo(Number(video.duration), 3);
    expect(Number(audio.duration)).toBeCloseTo(2, 3);
    run('ffmpeg', ['-v', 'error', '-i', file('equal-out.mp4'), '-f', 'null', '-']);
  });
  it('extends the movie duration when the selected audio presentation is longer than video', () => {
    save('long-out.mp4', trimMp4AudioPresentation(input('long.mp4'), 0, 48000, 2.3));
    const result = probe('long-out.mp4'),
      video = result.streams.find((s) => s.codec_type === 'video')!,
      audio = result.streams.find((s) => s.codec_type === 'audio')!;
    expect(Number(video.nb_frames)).toBe(60);
    expect(Number(audio.duration)).toBeCloseTo(2.3, 3);
    expect(Number(result.format.duration)).toBeCloseTo(2.3, 3);
    run('ffmpeg', ['-v', 'error', '-i', file('long-out.mp4'), '-f', 'null', '-']);
  });
  it('rejects edits extending past actual media', () =>
    expect(() => trimMp4AudioPresentation(input('short.mp4'), 48000, 48000, 1.5)).toThrow(
      /超出媒体时长/,
    ));
  it('rejects front-loaded and fragmented layouts', () => {
    expect(() => trimMp4AudioPresentation(input('front.mp4'), 0, 48000, 1)).toThrow(/布局/);
    expect(() => trimMp4AudioPresentation(input('fragmented.mp4'), 0, 48000, 1)).toThrow(/布局/);
  });
});
