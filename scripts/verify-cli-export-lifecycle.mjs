import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

// Inputs are the synthetic four-track works produced by test:browser:improvements.
const source = process.argv[2];
if (!source)
  throw new Error(
    'Usage: node scripts/verify-cli-export-lifecycle.mjs GENERATED_IMPROVEMENTS_DIRECTORY (run npm run build:cli first)',
  );
await mkdir('outputs', { recursive: true });
const output = await mkdtemp(resolve('outputs/cli-export-lifecycle-'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const checks = [];
for (const [game, prefix, takeId] of [
  ['block-placement', 'bb', 'synthetic-take'],
  ['block-crush-drop', 'bc', 'demo'],
]) {
  const input = resolve(source, `${prefix}-edited.json`),
    before = await readFile(input);
  const audible = join(output, `${prefix}-audio-options.json`),
    silent = join(output, `${prefix}-silent-options.json`);
  await writeFile(audible, JSON.stringify({ takeId, scope: 'take', audio: 'project' }));
  await writeFile(silent, JSON.stringify({ takeId, scope: 'take', audio: 'silent' }));
  const args = (options, target) => [
    'dist-cli/bcs.js',
    'game',
    game,
    'video render',
    '--input',
    input,
    '--options-file',
    options,
    '--out',
    target,
    '--json',
  ];
  const run = (options, target) =>
    spawnSync(process.execPath, args(options, target), { encoding: 'utf8', maxBuffer: 4_000_000 });
  const target = join(output, `${prefix}-retry.mp4`);
  const first = run(audible, target);
  if (first.status === 1) {
    assert.match(first.stdout, /ENCODER_UNSUPPORTED.*AAC/, first.stdout + first.stderr);
    await assert.rejects(access(target));
    await writeFile(join(output, `${prefix}-aac-unavailable.json`), first.stdout);
    const retry = run(silent, target);
    assert.equal(retry.status, 0, retry.stdout + retry.stderr);
    checks.push(
      `${prefix}: actual AAC unavailable error, no partial output, same-path explicit silent retry succeeded`,
    );
  } else {
    assert.equal(first.status, 0, first.stdout + first.stderr);
    checks.push(`${prefix}: actual browser H.264/AAC output succeeded`);
  }
  const videoHash = hash(await readFile(target)),
    collision = run(silent, target);
  assert.equal(collision.status, 1);
  assert.match(collision.stdout, /OUTPUT_EXISTS/);
  assert.equal(hash(await readFile(target)), videoHash);
  const cancelTarget = join(output, `${prefix}-cancel-retry.mp4`);
  const cancelled = await new Promise((resolveAttempt, reject) => {
    const proc = spawn(process.execPath, args(silent, cancelTarget), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      sent = false;
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('CLI never reached frame progress for cancellation'));
    }, 60_000);
    proc.stdout.on('data', (data) => (stdout += data));
    proc.stderr.on('data', (data) => {
      stderr += data;
      if (!sent && /渲染和编码 \d+\//.test(stderr)) {
        sent = true;
        proc.kill('SIGINT');
      }
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolveAttempt({ code, stdout, stderr, sent });
    });
  });
  assert.equal(cancelled.code, 130, JSON.stringify(cancelled));
  assert.ok(cancelled.sent);
  await assert.rejects(access(cancelTarget));
  await writeFile(join(output, `${prefix}-cancel-result.json`), JSON.stringify(cancelled, null, 2));
  const afterCancel = run(silent, cancelTarget);
  assert.equal(afterCancel.status, 0, afterCancel.stdout + afterCancel.stderr);
  const report = JSON.parse(afterCancel.stdout).report;
  assert.match(afterCancel.stderr, /渲染和编码 1\//);
  assert.match(
    afterCancel.stderr,
    new RegExp(`渲染和编码 ${report.totalFrames}/${report.totalFrames}`),
  );
  for (const video of [target, cancelTarget]) {
    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', video],
        { encoding: 'utf8' },
      ),
    );
    const track = probe.streams.find((stream) => stream.codec_type === 'video');
    assert.equal(track.codec_name, 'h264');
    assert.equal(Number(track.nb_read_frames), report.totalFrames);
    execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-f', 'null', '-'], { stdio: 'pipe' });
  }
  assert.equal(hash(await readFile(input)), hash(before));
  checks.push(
    `${prefix}: collision protection; SIGINT at real frame progress returned 130 with no partial file; same-path retry, FFprobe/full decode and unchanged input`,
  );
}
await writeFile(join(output, 'result.json'), JSON.stringify({ checks, output }, null, 2));
console.log(JSON.stringify({ checks, output }, null, 2));
