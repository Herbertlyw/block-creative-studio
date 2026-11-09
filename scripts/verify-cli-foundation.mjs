import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { syntheticPng, syntheticWav } from './fixtures/syntheticMedia.mjs';

await mkdir('outputs', { recursive: true });
const output = await mkdtemp(resolve('outputs/cli-foundation-test-'));
const path = (name) => join(output, name);
const server = await createServer({
  cacheDir: path('vite-cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
let browser;
const checks = [];
const cli = (args, status = 0) => {
  const p = spawnSync(process.execPath, ['dist-cli/bcs.js', ...args, '--json'], {
    encoding: 'utf8',
  });
  assert.equal(p.status, status, `CLI exit for ${args.join(' ')}: ${p.stderr} ${p.stdout}`);
  assert.equal(p.stderr, '');
  const result = JSON.parse(p.stdout);
  assert.equal(result.ok, status === 0);
  return result;
};
const save = (name, value) => writeFile(path(name), JSON.stringify(value));
const read = async (name) => JSON.parse(await readFile(path(name), 'utf8'));
const digest = async (name) =>
  createHash('sha256')
    .update(await readFile(path(name)))
    .digest('hex');
const missing = async (name) => assert.rejects(access(path(name)), { code: 'ENOENT' });
try {
  await server.listen();
  const describe = cli(['games', 'describe', 'block-placement']);
  assert.ok(describe.report.operations.some((op) => op.id === 'board edit'));
  assert.ok(describe.report.unavailable.some((op) => op.id === 'quality route'));
  assert.equal(cli(['games', 'list']).report.games.length, 2);
  cli(['games', 'describe', 'constructor'], 2);
  for (const [game, prefix] of [
    ['block-placement', 'bb'],
    ['block-crush-drop', 'bc'],
  ]) {
    cli(['game', game, 'project create', '--out', path(`${prefix}.json`)]);
    cli(['game', game, 'project validate', '--input', path(`${prefix}.json`)]);
    cli(['game', game, 'project inspect', '--input', path(`${prefix}.json`)]);
  }
  const beforeBB = await digest('bb.json'),
    beforeBC = await digest('bc.json');
  await save('bb-options.json', { row: 0, column: 0, color: 'coral' });
  await save('bc-options.json', { takeId: 'demo', index: 0, column: 5, seconds: 1 });
  cli([
    'game',
    'block-placement',
    'board edit',
    '--input',
    path('bb.json'),
    '--options-file',
    path('bb-options.json'),
    '--out',
    path('bb-edit.json'),
  ]);
  cli([
    'game',
    'block-crush-drop',
    'action edit',
    '--input',
    path('bc.json'),
    '--options-file',
    path('bc-options.json'),
    '--out',
    path('bc-edit.json'),
  ]);
  assert.equal(
    (await read('bb-edit.json')).project.game.initialState.data.board.cells[0][0],
    'coral',
  );
  assert.equal((await read('bc-edit.json')).takes[0].actions[0].action.release.x, 5);
  assert.equal(await digest('bb.json'), beforeBB);
  assert.equal(await digest('bc.json'), beforeBC);
  for (const [game, prefix] of [
    ['block-placement', 'bb'],
    ['block-crush-drop', 'bc'],
  ])
    cli(['game', game, 'project validate', '--input', path(`${prefix}-edit.json`)]);
  checks.push('BB and BC create, safe edit, validate and separate output preserve originals');
  cli(
    [
      'game',
      'block-placement',
      'board edit',
      '--input',
      path('bb.json'),
      '--options-file',
      path('bb-options.json'),
      '--out',
      path('bb.json'),
    ],
    1,
  );
  const beforeExisting = await digest('bb-edit.json');
  cli(
    [
      'game',
      'block-placement',
      'board edit',
      '--input',
      path('bb.json'),
      '--options-file',
      path('bb-options.json'),
      '--out',
      path('bb-edit.json'),
    ],
    1,
  );
  assert.equal(await digest('bb-edit.json'), beforeExisting);
  await save('bad-options.json', { takeId: 'demo', index: 0, column: '', seconds: 0 });
  const badNumber = cli(
    [
      'game',
      'block-crush-drop',
      'action edit',
      '--input',
      path('bc.json'),
      '--options-file',
      path('bad-options.json'),
      '--out',
      path('bad.json'),
    ],
    2,
  );
  assert.equal(badNumber.report.error.issues[0].field, '/column');
  await missing('bad.json');
  checks.push('existing targets, input overwrite and invalid numbers rejected without output');
  const { syntheticObservedPackageFixture } = await server.ssrLoadModule(
    '/tests/fixtures/syntheticObserved.ts',
  );
  const { createBBWorkPackage } = await server.ssrLoadModule('/src/contracts/bbWorkPackage.ts');
  const observed = await syntheticObservedPackageFixture();
  await save(
    'observed.json',
    await createBBWorkPackage(observed.project, observed.pointer, observed.source),
  );
  const observedHash = await digest('observed.json');
  const rejected = cli(
    [
      'game',
      'block-placement',
      'board edit',
      '--input',
      path('observed.json'),
      '--options-file',
      path('bb-options.json'),
      '--out',
      path('observed-edit.json'),
    ],
    1,
  );
  assert.match(rejected.report.error.message, /来源|指针|校准/);
  assert.equal(await digest('observed.json'), observedHash);
  await missing('observed-edit.json');
  const { makeClearEffect } = await server.ssrLoadModule(
    '/src/nativeReference/games/block-crush-drop/presentation/clearEffectLibrary.ts',
  );
  const bound = await read('bc.json');
  bound.direction.style.clearEffectLibrary = {
    version: '1.0.0',
    effects: [makeClearEffect('first-clear', {})],
    bindings: [{ effectId: 'first-clear', takeId: 'demo', actionIndex: 0, cycleIndex: 0 }],
  };
  await save('bound.json', bound);
  const boundHash = await digest('bound.json');
  const invalid = cli(
    [
      'game',
      'block-crush-drop',
      'action edit',
      '--input',
      path('bound.json'),
      '--options-file',
      path('bc-options.json'),
      '--out',
      path('bound-edit.json'),
    ],
    1,
  );
  assert.match(invalid.report.error.message, /first-clear.*CLEAR_EFFECT_TARGET_HAS_NO_CLEAR/);
  assert.equal(await digest('bound.json'), boundHash);
  await missing('bound-edit.json');
  await save('delete-bound-options.json', { takeId: 'demo' });
  const deleteBound = cli(
    [
      'game',
      'block-crush-drop',
      'take delete',
      '--input',
      path('bound.json'),
      '--options-file',
      path('delete-bound-options.json'),
      '--out',
      path('bound-deleted.json'),
    ],
    1,
  );
  assert.match(deleteBound.report.error.message, /demo.*first-clear/);
  assert.equal(await digest('bound.json'), boundHash);
  await missing('bound-deleted.json');
  const clipped = await read('bc.json');
  clipped.direction.production.clips = [
    {
      id: 'clip',
      takeId: 'demo',
      startFrame: 0,
      endFrame: 10,
      source: { takeHash: 'old', frameSourceHash: 'old' },
    },
  ];
  await save('clipped.json', clipped);
  const clippedHash = await digest('clipped.json');
  const clipReject = cli(
    [
      'game',
      'block-crush-drop',
      'action edit',
      '--input',
      path('clipped.json'),
      '--options-file',
      path('bc-options.json'),
      '--out',
      path('clipped-edit.json'),
    ],
    1,
  );
  assert.match(clipReject.report.error.message, /片段/);
  assert.equal(await digest('clipped.json'), clippedHash);
  await missing('clipped-edit.json');
  const badAudio = await read('bc.json');
  badAudio.direction.production.audio.assets = {
    music: {
      id: 'music',
      kind: 'audio',
      encoding: 'base64',
      mimeType: 'audio/wav',
      data: syntheticWav(220).toString('base64'),
      sha256: '0'.repeat(64),
    },
  };
  badAudio.direction.production.audio.bgm = { assetId: 'music' };
  await save('bad-audio.json', badAudio);
  const audioError = cli(
    ['game', 'block-crush-drop', 'project validate', '--input', path('bad-audio.json')],
    1,
  );
  assert.match(audioError.report.error.message, /AUDIO_ASSET_HASH_MISMATCH/);
  checks.push('source and pointer protection and BC bound clear rejection retain the originals');
  await writeFile(path('picture.png'), syntheticPng([35, 80, 120], 32, 32));
  await writeFile(path('music.wav'), syntheticWav(220));
  let observedCurrent = 'observed.json';
  for (const [operation, options, next] of [
    ['asset import', { id: 'new-image', file: 'picture.png' }, 'observed-image.json'],
    ['asset bind', { assetId: 'new-image', slotId: 'background.base' }, 'observed-bound.json'],
    ['audio import', { id: 'new-audio', file: 'music.wav' }, 'observed-audio.json'],
    ['audio bgm edit', { assetId: 'new-audio', gain: 0.25 }, 'observed-final.json'],
  ]) {
    await save('observed-options.json', options);
    cli([
      'game',
      'block-placement',
      operation,
      '--input',
      path(observedCurrent),
      '--options-file',
      path('observed-options.json'),
      '--out',
      path(next),
    ]);
    observedCurrent = next;
  }
  const originalObserved = await read('observed.json');
  const editedObserved = await read('observed-final.json');
  assert.deepEqual(editedObserved.pointer.tracks, originalObserved.pointer.tracks);
  assert.deepEqual(editedObserved.source.observation, originalObserved.source.observation);
  cli(['game', 'block-placement', 'project validate', '--input', path('observed-final.json')]);
  checks.push('BB source and pointer remain valid after image and audio edits');
  for (const [game, prefix, slot] of [
    ['block-placement', 'bb', 'background.base'],
    ['block-crush-drop', 'bc', 'world.background'],
  ]) {
    let current = `${prefix}-edit.json`;
    const step = async (operation, options, name) => {
      await save(`${prefix}-step.json`, options);
      const next = `${prefix}-${name}.json`;
      cli([
        'game',
        game,
        operation,
        '--input',
        path(current),
        '--options-file',
        path(`${prefix}-step.json`),
        '--out',
        path(next),
      ]);
      current = next;
    };
    await step('take generate', { takeId: 'new', count: 1 }, 'take');
    await save(`${prefix}-import-seed-options.json`, { takeId: 'new', newTakeId: 'imported' });
    cli([
      'game',
      game,
      'take clone',
      '--input',
      path(current),
      '--options-file',
      path(`${prefix}-import-seed-options.json`),
      '--out',
      path(`${prefix}-import-seed.json`),
    ]);
    const seedWork = await read(`${prefix}-import-seed.json`);
    const seedProject = game === 'block-placement' ? seedWork.project : seedWork;
    await save(
      `${prefix}-replay.json`,
      seedProject.takes.find((take) => take.takeId === 'imported'),
    );
    await step('take clone', { takeId: 'new', newTakeId: 'copy' }, 'clone');
    await step('take import', { file: `${prefix}-replay.json` }, 'imported');
    await step('asset import', { id: 'picture', file: 'picture.png' }, 'picture');
    await step('asset bind', { assetId: 'picture', slotId: slot }, 'bound-image');
    await step('audio import', { id: 'music', file: 'music.wav' }, 'audio');
    await step('audio bgm edit', { assetId: 'music', gain: 0.25, loop: true }, 'bgm');
    await step('audio sfx edit', { index: 0, gain: 0.4 }, 'final');
    cli(['game', game, 'project validate', '--input', path(current)]);
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(base);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入项目', exact: true }).click();
  await (await chooser).setFiles(path('bb-final.json'));
  await page.getByRole('button', { name: '保存作品', exact: true }).waitFor();
  await page.getByLabel('创作 Take').selectOption('new');
  await page.getByRole('button', { name: '打开 2D 测试预览' }).click();
  await page.getByLabel('V2 参考 2D 测试画面').waitFor();
  await page.getByLabel('V2 参考 2D 测试画面').screenshot({ path: path('bb-preview.png') });
  assert.equal(await page.getByLabel('使用工程 production.audio（WAV）').isChecked(), true);
  await page.getByRole('button', { name: '播放 V2 预览' }).click();
  await page.getByRole('button', { name: '暂停 V2 预览' }).waitFor();
  await page.waitForFunction(
    () => Number(document.querySelector('input[aria-label="V2 预览帧"]')?.value) > 0,
  );
  await page.getByRole('button', { name: '暂停 V2 预览' }).click();
  const dlBB = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存作品', exact: true }).click();
  await (await dlBB).saveAs(path('bb-browser.json'));
  assert.deepEqual((await read('bb-browser.json')).project, (await read('bb-final.json')).project);
  await page.goto(`${base}/?bb-reopen=1`);
  const reopen = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入项目', exact: true }).click();
  await (await reopen).setFiles(path('bb-browser.json'));
  await page.getByRole('button', { name: '保存作品', exact: true }).waitFor();
  await page.goto(`${base}/?cli-bc=1#bc`);
  await page.locator('input[accept="application/json,.json"]').setInputFiles(path('bc-final.json'));
  await page.waitForFunction(() => document.querySelector('canvas[data-ready="true"]'));
  await page.getByLabel('BC Take').selectOption('new');
  await page.waitForFunction(() => document.querySelector('canvas[data-ready="true"]'));
  await page.getByLabel('BC 视频画面').screenshot({ path: path('bc-preview.png') });
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await page.waitForFunction(
    () => Number(document.querySelector('canvas[data-ready="true"]')?.dataset.frame) > 0,
  );
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const dlBC = page.waitForEvent('download');
  await page.getByRole('button', { name: /保存 JSON/ }).click();
  await (await dlBC).saveAs(path('bc-browser.json'));
  assert.deepEqual(await read('bc-browser.json'), await read('bc-final.json'));
  await page.goto(`${base}/?bc-reopen=1#bc`);
  await page
    .locator('input[accept="application/json,.json"]')
    .setInputFiles(path('bc-browser.json'));
  await page.waitForFunction(() => document.querySelector('canvas[data-ready="true"]'));
  await page.getByLabel('BC Take').selectOption('copy');
  assert.deepEqual(errors, []);
  checks.push('actual BB and BC workbenches reopen and save CLI output unchanged');
  await save('result.json', { passed: true, checks });
  console.log(JSON.stringify({ output, checks }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
