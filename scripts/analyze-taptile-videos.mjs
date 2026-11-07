#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

function readArgument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function requireArgument(name) {
  const value = readArgument(name);
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function parseRate(value) {
  const [numerator, denominator] = String(value).split('/').map(Number);
  return denominator ? numerator / denominator : numerator;
}

function parseVideoName(fileName) {
  const stem = fileName.replace(/\.mp4$/i, '');
  const swap = stem.match(/^\[无水印换牌\](.+?)__(.+?)牌面__([0-9.]+)s$/u);
  if (swap) {
    return {
      role: 'face-swap',
      source: swap[1],
      faceSet: swap[2],
      composition: null,
      declaredDuration: Number(swap[3]),
    };
  }
  const original = stem.match(/^\[无水印原版\](.+?)__(.+?)__([0-9.]+)s$/u);
  if (original) {
    return {
      role: 'original',
      source: original[1],
      faceSet: null,
      composition: original[2],
      declaredDuration: Number(original[3]),
    };
  }
  return {
    role: 'unparsed',
    source: 'unparsed',
    faceSet: null,
    composition: null,
    declaredDuration: null,
  };
}

function inspectVideo(ffprobe, filePath) {
  const raw = execFileSync(ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate,codec_name,pix_fmt',
    '-show_entries', 'format=duration,format_name',
    '-of', 'json',
    filePath,
  ], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  const parsed = JSON.parse(raw);
  const stream = parsed.streams?.[0] ?? {};
  const duration = Number(parsed.format?.duration ?? 0);
  return {
    width: Number(stream.width ?? 0),
    height: Number(stream.height ?? 0),
    fps: Number(parseRate(stream.avg_frame_rate || stream.r_frame_rate || '0/1').toFixed(6)),
    codec: stream.codec_name ?? 'unknown',
    pixelFormat: stream.pix_fmt ?? 'unknown',
    duration: Number(duration.toFixed(3)),
    container: parsed.format?.format_name ?? 'unknown',
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const inputRoot = resolve(requireArgument('--input'));
const outputRoot = resolve(readArgument('--output', 'docs/taptile/generated'));
const ffprobe = readArgument('--ffprobe', 'ffprobe');

if (!existsSync(inputRoot) || !statSync(inputRoot).isDirectory()) {
  throw new Error(`Input directory does not exist: ${inputRoot}`);
}

const fileNames = readdirSync(inputRoot)
  .filter((name) => name.toLowerCase().endsWith('.mp4'))
  .sort((left, right) => left.localeCompare(right, 'zh-CN'));

const videos = fileNames.map((fileName) => {
  const filePath = join(inputRoot, fileName);
  const naming = parseVideoName(fileName);
  const media = inspectVideo(ffprobe, filePath);
  return {
    fileName,
    bytes: statSync(filePath).size,
    ...naming,
    ...media,
    durationDelta: naming.declaredDuration === null
      ? null
      : Number((media.duration - naming.declaredDuration).toFixed(3)),
  };
});

const grouped = new Map();
for (const video of videos) {
  if (!grouped.has(video.source)) grouped.set(video.source, []);
  grouped.get(video.source).push(video);
}

const groups = [...grouped.entries()]
  .map(([source, entries]) => ({
    source,
    count: entries.length,
    originals: entries.filter((entry) => entry.role === 'original').map((entry) => entry.fileName),
    faceSets: entries.filter((entry) => entry.role === 'face-swap').map((entry) => entry.faceSet).sort(),
    durations: [...new Set(entries.map((entry) => entry.duration))].sort((left, right) => left - right),
  }))
  .sort((left, right) => left.source.localeCompare(right.source));

const formatSignatures = [...new Set(videos.map((video) => (
  `${video.width}x${video.height}@${video.fps}:${video.codec}:${video.pixelFormat}`
)))].sort();

const index = {
  schemaVersion: 1,
  sourceRoot: inputRoot,
  summary: {
    videos: videos.length,
    sourceGroups: groups.filter((group) => group.source !== 'unparsed').length,
    originals: videos.filter((video) => video.role === 'original').length,
    faceSwaps: videos.filter((video) => video.role === 'face-swap').length,
    unparsed: videos.filter((video) => video.role === 'unparsed').length,
    formatSignatures,
  },
  groups,
  videos,
};

mkdirSync(outputRoot, { recursive: true });
writeFileSync(join(outputRoot, 'video-index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');

const csvColumns = [
  'fileName', 'role', 'source', 'faceSet', 'composition', 'declaredDuration', 'duration',
  'durationDelta', 'width', 'height', 'fps', 'codec', 'pixelFormat', 'bytes',
];
const csv = [
  csvColumns.join(','),
  ...videos.map((video) => csvColumns.map((column) => csvCell(video[column])).join(',')),
].join('\n');
writeFileSync(join(outputRoot, 'video-index.csv'), `${csv}\n`, 'utf8');

process.stdout.write(`${JSON.stringify(index.summary, null, 2)}\n`);

