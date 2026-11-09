import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, link, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv';
import { createServer } from 'vite';

const dir = await mkdtemp(join(tmpdir(), 'bcs-media-test-'));
const server = await createServer({
  cacheDir: join(dir, 'cache'),
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
});
const path = (name) => join(dir, name);
const run = (args, expected = 0) => {
  const result = spawnSync(process.execPath, ['dist-cli/bcs.js', ...args, '--json'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, expected, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
};
try {
  const { previewSchema, videoSchema, mediaWindow } = await server.ssrLoadModule(
    '/src/cli/mediaContract.ts',
  );
  const { writeNewBytes } = await server.ssrLoadModule('/src/cli/files.ts');
  const { stableHash } = await server.ssrLoadModule('/src/nativeReference/headless/stableHash.ts');
  const ajv = new Ajv({ strict: false });
  const preview = ajv.compile(previewSchema),
    video = ajv.compile(videoSchema);
  for (const value of [
    {},
    { takeId: 'x' },
    { takeId: 'x', frame: -1 },
    { takeId: 'x', frame: 0.5 },
    { takeId: 'x', frame: 0, extra: 1 },
  ])
    assert.equal(preview(value), false, JSON.stringify(value));
  assert.equal(preview({ takeId: 'x', frame: 0 }), true);
  for (const value of [
    {},
    { takeId: 'x', scope: 'range' },
    { takeId: 'x', startFrame: 0, endFrame: 1 },
    { takeId: 'x', scope: 'range', startFrame: 0, endFrame: 2, clipId: 'x' },
    { takeId: 'x', scope: 'clip' },
    { takeId: 'x', scope: 'take', clipId: 'x' },
    { takeId: 'x', scope: 'clip', clipId: 'x', startFrame: 0 },
    { takeId: 'x', unknown: true },
  ])
    assert.equal(video(value), false, JSON.stringify(value));
  for (const value of [
    { takeId: 'x' },
    { takeId: 'x', scope: 'range', startFrame: 0, endFrame: 89 },
    { takeId: 'x', scope: 'clip', clipId: 'x' },
  ])
    assert.equal(video(value), true, JSON.stringify(value));
  const take = { takeId: 'x', actions: [1] },
    clip = {
      id: 'c',
      takeId: 'x',
      source: { takeHash: stableHash(take), frameSourceHash: 'hash' },
      startFrame: 10,
      endFrame: 20,
    };
  assert.equal(
    mediaWindow({ scope: 'range', startFrame: 0, endFrame: 89 }, 100, take, 'hash').totalFrames,
    90,
  );
  assert.equal(
    mediaWindow({ scope: 'clip', takeId: 'x', clipId: 'c' }, 100, take, 'hash', [clip]).totalFrames,
    11,
  );
  assert.throws(
    () => mediaWindow({ scope: 'range', startFrame: 1, endFrame: 100 }, 100, take, 'hash'),
    /FRAME_RANGE_INVALID/,
  );
  assert.throws(
    () => mediaWindow({ scope: 'range', startFrame: 5, endFrame: 4 }, 100, take, 'hash'),
    /FRAME_RANGE_INVALID/,
  );
  assert.throws(
    () => mediaWindow({ scope: 'clip', takeId: 'other', clipId: 'c' }, 100, take, 'hash', [clip]),
    /CLIP_TAKE_MISMATCH/,
  );
  assert.throws(
    () => mediaWindow({ scope: 'clip', takeId: 'x', clipId: 'c' }, 100, take, 'changed', [clip]),
    /CLIP_SOURCE_STALE/,
  );
  assert.throws(
    () =>
      mediaWindow({ scope: 'clip', takeId: 'x', clipId: 'c' }, 100, take, 'hash', [
        { ...clip, crop: { x: 0 } },
      ]),
    /CLIP_CROP_UNSUPPORTED/,
  );
  await writeFile(path('original'), 'original');
  await link(path('original'), path('hard'));
  await symlink(path('original'), path('symbolic'));
  for (const target of ['original', 'hard', 'symbolic'])
    await assert.rejects(writeNewBytes(path(target), Buffer.from('wrong'), path('original')));
  assert.equal(await readFile(path('original'), 'utf8'), 'original');
  await assert.rejects(
    writeNewBytes(path('cancelled'), Buffer.from('wrong'), undefined, () => {
      throw new Error('cancelled');
    }),
    /cancelled/,
  );
  await assert.rejects(lstat(path('cancelled')), { code: 'ENOENT' });
  for (const game of ['block-placement', 'block-crush-drop']) {
    const discovery = run(['games', 'describe', game]);
    for (const id of ['preview render', 'video render']) {
      const operation = discovery.report.operations.find((item) => item.id === id);
      assert.equal(operation.runtime, 'node+chrome');
      assert.ok(operation.inputSchema.required.includes('options'));
      assert.equal(operation.outputType, id === 'preview render' ? 'image/png' : 'video/mp4');
    }
    run(['game', game, 'project create', '--out', path(`${game}.json`)]);
    const input = await readFile(path(`${game}.json`));
    await writeFile(
      path('invalid.json'),
      JSON.stringify({ takeId: 'demo', scope: 'range', startFrame: 0 }),
    );
    const failed = run(
      [
        'game',
        game,
        'video render',
        '--input',
        path(`${game}.json`),
        '--options-file',
        path('invalid.json'),
        '--out',
        path('invalid.mp4'),
      ],
      2,
    );
    assert.equal(failed.report.error.code, 'INVALID_ARGUMENT');
    assert.deepEqual(await readFile(path(`${game}.json`)), input);
    await assert.rejects(lstat(path('invalid.mp4')), { code: 'ENOENT' });
  }
  const bcPath = path('block-crush-drop.json');
  const bcBytes = await readFile(bcPath);
  const bc = JSON.parse(bcBytes);
  const { compileBCPlayback } = await server.ssrLoadModule('/src/games/block-crush/timeline.ts');
  const bcSource = compileBCPlayback(bc, 'demo', true).source;
  const realClip = {
    id: 'opening',
    takeId: 'demo',
    startFrame: 0,
    endFrame: 10,
    source: { takeHash: stableHash(bc.takes[0]), frameSourceHash: bcSource.frameSourceHash },
  };
  bc.direction.production.clips = [
    { ...realClip, source: { ...realClip.source, takeHash: 'stale' } },
  ];
  await writeFile(path('stale.json'), JSON.stringify(bc));
  await writeFile(
    path('clip.json'),
    JSON.stringify({ takeId: 'demo', scope: 'clip', clipId: 'opening' }),
  );
  const stale = run(
    [
      'game',
      'block-crush-drop',
      'video render',
      '--input',
      path('stale.json'),
      '--options-file',
      path('clip.json'),
      '--out',
      path('stale.mp4'),
    ],
    1,
  );
  assert.match(stale.report.error.message, /CLIP_SOURCE_STALE/);
  bc.direction.production.clips = [{ ...realClip, takeId: 'other' }];
  await writeFile(path('other.json'), JSON.stringify(bc));
  const mismatch = run(
    [
      'game',
      'block-crush-drop',
      'video render',
      '--input',
      path('other.json'),
      '--options-file',
      path('clip.json'),
      '--out',
      path('other.mp4'),
    ],
    1,
  );
  assert.match(mismatch.report.error.message, /CLIP_TAKE_MISMATCH/);
  await writeFile(
    path('out-of-range.json'),
    JSON.stringify({ takeId: 'demo', frame: bcSource.totalFrames }),
  );
  const rangeError = run(
    [
      'game',
      'block-crush-drop',
      'preview render',
      '--input',
      bcPath,
      '--options-file',
      path('out-of-range.json'),
      '--out',
      path('outside.png'),
    ],
    2,
  );
  assert.match(rangeError.report.error.message, /FRAME_RANGE_INVALID/);
  await writeFile(path('valid-preview.json'), JSON.stringify({ takeId: 'demo', frame: 0 }));
  const existing = run(
    [
      'game',
      'block-crush-drop',
      'preview render',
      '--input',
      bcPath,
      '--options-file',
      path('valid-preview.json'),
      '--out',
      path('hard'),
    ],
    1,
  );
  assert.match(existing.report.error.message, /OUTPUT_EXISTS/);
  assert.equal(await readFile(path('original'), 'utf8'), 'original');
  assert.deepEqual(await readFile(bcPath), bcBytes);
  for (const file of ['stale.mp4', 'other.mp4', 'outside.png'])
    await assert.rejects(lstat(path(file)), { code: 'ENOENT' });
  console.log(
    'CLI media schema, inclusive windows, clip identity and atomic publication checks passed',
  );
} finally {
  await server.close();
  await rm(dir, { recursive: true, force: true });
}
