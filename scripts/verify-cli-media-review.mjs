// Explicit local Chrome/FFmpeg regression; CI keeps the lightweight Node tests.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';

const dir = await mkdtemp(join(tmpdir(), 'bcs-media-review-'));
const path = (name) => join(dir, name);
const server = await createServer({
  cacheDir: path('cache'),
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
});
function run(bin, args, status = 0, binary = false) {
  const result = spawnSync(bin, args, {
    encoding: binary ? null : 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, status, `${result.stderr}\n${result.stdout}`);
  return binary ? result.stdout : result.stdout.trim();
}
const cli = (...args) => JSON.parse(run(process.execPath, ['dist-cli/bcs.js', ...args, '--json']));
async function options(name, value) {
  await writeFile(path(name), JSON.stringify(value));
  return path(name);
}
function args(game, input, option, output) {
  return [
    'game',
    game,
    'video render',
    '--input',
    path(input),
    '--options-file',
    path(option),
    '--out',
    path(output),
  ];
}
function checkShortAudio(reference, file) {
  const streams = JSON.parse(
    run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path(file)]),
  ).streams;
  assert.equal(streams.find((s) => s.codec_type === 'video')?.nb_frames, '1');
  assert.equal(streams.find((s) => s.codec_type === 'audio')?.codec_name, 'aac');
  run('ffmpeg', ['-v', 'error', '-i', path(file), '-f', 'null', '-']);
  const raw = run(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      path(file),
      '-map',
      '0:a:0',
      '-f',
      'f32le',
      '-acodec',
      'pcm_f32le',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-',
    ],
    0,
    true,
  );
  let best = { correlation: -1, lag: 0 };
  const samples = Math.min(reference.length / 2, raw.length / 8);
  for (let lag = -192; lag <= 192; lag++) {
    let xy = 0,
      xx = 0,
      yy = 0;
    for (let i = 0; i < samples; i++) {
      const j = i + lag;
      if (j < 0 || j >= raw.length / 8) continue;
      const a = (reference[i * 2] + reference[i * 2 + 1]) / 2;
      const b = (raw.readFloatLE(j * 8) + raw.readFloatLE(j * 8 + 4)) / 2;
      xy += a * b;
      xx += a * a;
      yy += b * b;
    }
    const correlation = xy / Math.sqrt(xx * yy);
    if (correlation > best.correlation) best = { correlation, lag };
  }
  assert.ok(best.correlation > 0.8, `AAC content correlation ${best.correlation}`);
  assert.ok(Math.abs(best.lag) <= 48, `AAC alignment ${best.lag} samples`);
  return best;
}
try {
  const { ordinaryProject } = await server.ssrLoadModule('/tests/fixtures/ordinaryProject.ts');
  const { createBCDemo } = await server.ssrLoadModule('/src/games/block-crush/demo.ts');
  const { compileBBTimeline } = await server.ssrLoadModule('/src/contracts/compileBBTimeline.ts');
  const { compileBCPlayback } = await server.ssrLoadModule('/src/games/block-crush/timeline.ts');
  const { compileProductionAudio } = await server.ssrLoadModule(
    '/src/nativeReference/agent-director/audioMix.ts',
  );
  const bb = ordinaryProject(),
    bc = createBCDemo();
  const cases = [
    {
      game: 'block-placement',
      prefix: 'bb',
      project: bb,
      takeId: 'synthetic-take',
      frame: 50,
      source: compileBBTimeline(bb, 'synthetic-take').source,
    },
    {
      game: 'block-crush-drop',
      prefix: 'bc',
      project: bc,
      takeId: 'demo',
      frame: 32,
      source: compileBCPlayback(bc, 'demo', true).source,
    },
  ];
  const results = {};
  for (const item of cases) {
    await writeFile(path(`${item.prefix}.json`), JSON.stringify(item.project));
    await options(`${item.prefix}-one.json`, {
      takeId: item.takeId,
      scope: 'range',
      startFrame: item.frame,
      endFrame: item.frame,
      audio: 'project',
    });
    const result = cli(
      ...args(
        item.game,
        `${item.prefix}.json`,
        `${item.prefix}-one.json`,
        `${item.prefix}-one.mp4`,
      ),
    );
    assert.equal(result.ok, true);
    assert.match(result.report.warning, /AAC/);
    const mix = compileProductionAudio(
      item.source,
      item.project.direction.production.audio,
      48_000,
      { startFrame: item.frame, endFrame: item.frame },
    );
    results[item.prefix] = checkShortAudio(mix.track.data, `${item.prefix}-one.mp4`);
  }
  const { syntheticObservedFixture } = await server.ssrLoadModule(
    '/tests/fixtures/syntheticObserved.ts',
  );
  const { document, pointer } = await syntheticObservedFixture();
  const { createBBWorkPackage, updateBBWorkPackageProject } = await server.ssrLoadModule(
    '/src/contracts/bbWorkPackage.ts',
  );
  const { prepareCalibratedRenderer } = await server.ssrLoadModule(
    '/src/contracts/calibratedRenderer.ts',
  );
  const { verifyObservedPointer } = await server.ssrLoadModule('/src/contracts/observedPointer.ts');
  const { stableHash } = await server.ssrLoadModule('/src/nativeReference/headless/stableHash.ts');
  const take = document.takes[0],
    verified = await verifyObservedPointer(document, pointer);
  const source = prepareCalibratedRenderer(document, take.takeId, verified).frameSource;
  const initial = await createBBWorkPackage(document, pointer, null),
    project = structuredClone(document);
  project.direction.production.clips = [
    {
      id: 'opening',
      takeId: take.takeId,
      source: { takeHash: stableHash(take), frameSourceHash: source.frameSourceHash },
      startFrame: 15,
      endFrame: 20,
    },
  ];
  project.direction.production.selectedClipId = 'opening';
  const observed = await updateBBWorkPackageProject(initial, project);
  await writeFile(path('observed.json'), JSON.stringify(observed));
  await options('clip.json', {
    takeId: take.takeId,
    scope: 'clip',
    clipId: 'opening',
    audio: 'silent',
  });
  const clip = cli(...args('block-placement', 'observed.json', 'clip.json', 'clip.mp4'));
  assert.equal(clip.report.totalFrames, 6);
  assert.equal(clip.report.startFrame, 15);
  run('ffmpeg', ['-v', 'error', '-i', path('clip.mp4'), '-f', 'null', '-']);
  const altered = structuredClone(observed.project);
  altered.direction.production.audio.bgm.gain = 0.11;
  const stale = await updateBBWorkPackageProject(observed, altered);
  await writeFile(path('stale.json'), JSON.stringify(stale));
  const rejection = JSON.parse(
    run(
      process.execPath,
      [
        'dist-cli/bcs.js',
        ...args('block-placement', 'stale.json', 'clip.json', 'stale.mp4'),
        '--json',
      ],
      1,
    ),
  );
  assert.equal(rejection.report.error.code, 'CLIP_SOURCE_STALE');
  await assert.rejects(lstat(path('stale.mp4')), { code: 'ENOENT' });
  await options('bc-full.json', { takeId: 'demo', audio: 'project' });
  const cancelArgs = [
    'dist-cli/bcs.js',
    ...args('block-crush-drop', 'bc.json', 'bc-full.json', 'retry.mp4'),
    '--json',
  ];
  const child = spawn(process.execPath, cancelArgs);
  let stdout = '',
    stderr = '',
    sent = false;
  child.stdout.on('data', (value) => (stdout += value));
  child.stderr.on('data', (value) => {
    stderr += value;
    if (!sent && stderr.includes('渲染和编码')) {
      sent = true;
      child.kill('SIGINT');
    }
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
  } finally {
    clearTimeout(timer);
  }
  assert.equal(sent, true);
  assert.equal(code, 130);
  assert.equal(JSON.parse(stdout).report.error.code, 'CANCELLED');
  await assert.rejects(lstat(path('retry.mp4')), { code: 'ENOENT' });
  assert.equal(JSON.parse(run(process.execPath, cancelArgs)).ok, true);
  console.log(
    JSON.stringify({
      result: 'passed',
      shortAudio: results,
      observedClipFrames: clip.report.totalFrames,
      staleRejected: true,
      cancelAndRetry: true,
    }),
  );
} finally {
  await server.close();
  await rm(dir, { recursive: true, force: true });
}
