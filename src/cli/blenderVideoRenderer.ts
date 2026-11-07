import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { BlobSource, Input, Mp4InputFormat } from 'mediabunny';
import { BCS_CONTRACT_VERSION, BcsHeadlessError } from '../headless/index.js';
import { locateBlenderExecutable } from './blenderCompiler.js';

const execFileAsync = promisify(execFile);

export const BCS_BLENDER_VIDEO_REPORT_CONTRACT = 'bcs.blender-video-render-report' as const;
export const BLENDER_VIDEO_QUALITY_PROFILES = {
  draft: { constantRateFactor: 'MEDIUM', preset: 'REALTIME' },
  standard: { constantRateFactor: 'HIGH', preset: 'GOOD' },
  cinematic: { constantRateFactor: 'PERC_LOSSLESS', preset: 'GOOD' },
} as const;

export type BlenderVideoQuality = keyof typeof BLENDER_VIDEO_QUALITY_PROFILES;

export interface BlenderVideoRenderOptions {
  source: string;
  output: string;
  quality?: BlenderVideoQuality;
  frameStart?: number;
  frameEnd?: number;
  blenderExecutable?: string;
  timeoutMs?: number;
}

export interface BlenderVideoRenderReport {
  contract: typeof BCS_BLENDER_VIDEO_REPORT_CONTRACT;
  contractVersion: typeof BCS_CONTRACT_VERSION;
  status: 'passed' | 'failed';
  source: { path: string; sha256: string };
  output: { path: string; sha256: string; byteLength: number };
  blender: { version: string; engine: string };
  render: {
    width: number;
    height: number;
    fps: number;
    frameStart: number;
    frameEnd: number;
    frameCount: number;
    durationSeconds: number;
    quality: BlenderVideoQuality;
    constantRateFactor: string;
    preset: string;
  };
  metrics: { renderDurationMs: number };
  warnings: string[];
  errors: string[];
}

export interface BlenderVideoInspection {
  codec: string;
  width: number;
  height: number;
  durationSeconds: number;
  frameCount: number;
  averageFps: number;
  averageBitrate: number;
  audioTrackCount: number;
}

export interface BlenderVideoRenderResult {
  executable: string;
  reportPath: string;
  report: BlenderVideoRenderReport;
  inspection: BlenderVideoInspection;
  elapsedMs: number;
  blenderLogTail: string[];
}

function rendererScriptPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/blender/render_bcs_video.py');
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isFile() === true;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolveStream, rejectStream) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', rejectStream);
    stream.on('end', resolveStream);
  });
  return hash.digest('hex');
}

function logTail(stdout: string, stderr: string): string[] {
  return `${stdout}\n${stderr}`.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).slice(-24);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertRenderReport(value: unknown, reportPath: string): asserts value is BlenderVideoRenderReport {
  if (!isRecord(value)
    || value.contract !== BCS_BLENDER_VIDEO_REPORT_CONTRACT
    || value.contractVersion !== BCS_CONTRACT_VERSION
    || value.status !== 'passed'
    || !isRecord(value.source)
    || !isRecord(value.output)
    || !isRecord(value.render)
    || !isRecord(value.metrics)
    || !Array.isArray(value.warnings)
    || !Array.isArray(value.errors)) {
    throw new BcsHeadlessError('BLENDER_VIDEO_REPORT_INVALID', `Blender returned an invalid video report: ${reportPath}`, {
      path: reportPath,
      details: value,
    });
  }
  const render = value.render;
  const output = value.output;
  for (const key of ['width', 'height', 'fps', 'frameStart', 'frameEnd', 'frameCount', 'durationSeconds'] as const) {
    if (typeof render[key] !== 'number' || !Number.isFinite(render[key]) || render[key] <= 0) {
      throw new BcsHeadlessError('BLENDER_VIDEO_REPORT_INVALID', `render.${key} must be positive and finite.`, { path: reportPath });
    }
  }
  if (typeof render.quality !== 'string' || !(render.quality in BLENDER_VIDEO_QUALITY_PROFILES)) {
    throw new BcsHeadlessError('BLENDER_VIDEO_REPORT_INVALID', 'render.quality is unsupported.', { path: reportPath });
  }
  if (typeof output.path !== 'string' || typeof output.sha256 !== 'string' || !/^[0-9a-f]{64}$/iu.test(output.sha256)
    || typeof output.byteLength !== 'number' || output.byteLength <= 0) {
    throw new BcsHeadlessError('BLENDER_VIDEO_REPORT_INVALID', 'output metadata is invalid.', { path: reportPath });
  }
}

export async function inspectBlenderVideo(path: string): Promise<BlenderVideoInspection> {
  const bytes = await readFile(path);
  const input = new Input({ source: new BlobSource(new Blob([bytes])), formats: [new Mp4InputFormat()] });
  try {
    const videoTracks = await input.getVideoTracks();
    const audioTracks = await input.getAudioTracks();
    if (videoTracks.length !== 1) {
      throw new BcsHeadlessError('BLENDER_VIDEO_TRACK_INVALID', `Expected one video track, found ${videoTracks.length}.`, { path });
    }
    const track = videoTracks[0]!;
    const stats = await track.computePacketStats();
    return {
      codec: track.codec ?? 'unknown',
      width: track.displayWidth,
      height: track.displayHeight,
      durationSeconds: await track.computeDuration(),
      frameCount: stats.packetCount,
      averageFps: stats.averagePacketRate,
      averageBitrate: stats.averageBitrate,
      audioTrackCount: audioTracks.length,
    };
  } finally {
    input.dispose();
  }
}

export async function renderBlenderVideo(options: BlenderVideoRenderOptions): Promise<BlenderVideoRenderResult> {
  const source = resolve(options.source);
  const output = resolve(options.output);
  const reportPath = `${output}.render-report.json`;
  const quality = options.quality ?? 'standard';
  if (extname(output).toLowerCase() !== '.mp4') {
    throw new BcsHeadlessError('BLENDER_VIDEO_OUTPUT_INVALID', '--output must end in .mp4.', { path: output });
  }
  if (!await isFile(source) || extname(source).toLowerCase() !== '.blend') {
    throw new BcsHeadlessError('BLENDER_VIDEO_SOURCE_INVALID', `A compiled .blend source is required: ${source}`, { path: source });
  }
  if (!(quality in BLENDER_VIDEO_QUALITY_PROFILES)) {
    throw new BcsHeadlessError('BLENDER_VIDEO_QUALITY_INVALID', `Unsupported Blender video quality: ${String(quality)}`, { path: '--quality' });
  }
  for (const candidate of [output, reportPath]) {
    if (await stat(candidate).catch(() => null)) {
      throw new BcsHeadlessError('BLENDER_VIDEO_OUTPUT_EXISTS', `Refusing to overwrite existing output: ${candidate}`, { path: candidate });
    }
  }
  for (const [key, value] of [['frameStart', options.frameStart], ['frameEnd', options.frameEnd]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      throw new BcsHeadlessError('BLENDER_VIDEO_FRAME_INVALID', `${key} must be a positive integer.`, { path: key });
    }
  }
  if (options.frameStart !== undefined && options.frameEnd !== undefined && options.frameEnd < options.frameStart) {
    throw new BcsHeadlessError('BLENDER_VIDEO_FRAME_RANGE_INVALID', 'frameEnd must not precede frameStart.', { path: '--frame-end' });
  }
  await mkdir(dirname(output), { recursive: true });
  const executable = await locateBlenderExecutable(options.blenderExecutable);
  const script = rendererScriptPath();
  if (!await isFile(script)) {
    throw new BcsHeadlessError('BLENDER_VIDEO_SCRIPT_MISSING', `Blender video script not found: ${script}`, { path: script });
  }
  const args = ['--background', source, '--python', script, '--', '--output', output, '--report', reportPath, '--quality', quality];
  if (options.frameStart !== undefined) args.push('--frame-start', String(options.frameStart));
  if (options.frameEnd !== undefined) args.push('--frame-end', String(options.frameEnd));
  const timeoutMs = Math.max(10_000, Math.min(6 * 60 * 60_000, options.timeoutMs ?? 2 * 60 * 60_000));
  const started = performance.now();
  let stdout = '';
  let stderr = '';
  try {
    const result = await execFileAsync(executable, args, {
      encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string; code?: unknown; signal?: unknown };
    stdout = failure.stdout ?? '';
    stderr = failure.stderr ?? '';
    const report = await readFile(reportPath, 'utf8').then((text) => JSON.parse(text) as unknown).catch(() => null);
    throw new BcsHeadlessError('BLENDER_VIDEO_RENDER_FAILED', 'Blender video rendering failed.', {
      path: source,
      details: { message: failure.message, code: failure.code, signal: failure.signal, report, logTail: logTail(stdout, stderr) },
      recoverable: true,
    });
  }
  const report = await readFile(reportPath, 'utf8')
    .then((text) => JSON.parse(text) as unknown)
    .catch((error) => {
      throw new BcsHeadlessError('BLENDER_VIDEO_REPORT_MISSING', `Blender exited without a readable video report: ${reportPath}`, {
        path: reportPath,
        details: { error: error instanceof Error ? error.message : error, logTail: logTail(stdout, stderr) },
      });
    });
  assertRenderReport(report, reportPath);
  const [actualSourceHash, actualOutputHash, outputInfo] = await Promise.all([
    sha256File(source), sha256File(output), stat(output),
  ]);
  if (report.source.sha256 !== actualSourceHash || report.output.sha256 !== actualOutputHash || report.output.byteLength !== outputInfo.size) {
    throw new BcsHeadlessError('BLENDER_VIDEO_HASH_MISMATCH', 'Rendered movie or source changed after Blender reported it.', { path: output });
  }
  const inspection = await inspectBlenderVideo(output);
  const expectedDuration = report.render.frameCount / report.render.fps;
  if (inspection.codec !== 'avc'
    || inspection.width !== report.render.width
    || inspection.height !== report.render.height
    || inspection.frameCount !== report.render.frameCount
    || Math.abs(inspection.averageFps - report.render.fps) > 0.05
    || Math.abs(inspection.durationSeconds - expectedDuration) > Math.max(1 / report.render.fps, 0.05)
    || inspection.audioTrackCount !== 0) {
    throw new BcsHeadlessError('BLENDER_VIDEO_VERIFICATION_FAILED', 'Encoded Blender movie does not match its render report.', {
      path: output,
      details: { report: report.render, inspection },
    });
  }
  return {
    executable,
    reportPath,
    report,
    inspection,
    elapsedMs: Math.round(performance.now() - started),
    blenderLogTail: logTail(stdout, stderr),
  };
}
