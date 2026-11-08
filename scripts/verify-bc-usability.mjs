import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { syntheticWav } from './fixtures/syntheticMedia.mjs';

await mkdir('outputs', { recursive: true });
const output = process.env.BC_OUTPUT_DIR
  ? resolve(process.env.BC_OUTPUT_DIR)
  : await mkdtemp(resolve('outputs/bc-usability-'));
await mkdir(output, { recursive: true });
const server = await createServer({
  cacheDir: join(output, 'vite-cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
let browser;
const result = { checks: [] };
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({
    acceptDownloads: true,
    viewport: { width: 1360, height: 1000 },
  });
  const errors = [];
  let videoDownloads = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  page.on('download', (download) => {
    if (download.suggestedFilename().endsWith('.mp4')) videoDownloads++;
  });
  const baseURL = `http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(`${baseURL}/#bc`);
  const ready = () =>
    page.waitForFunction(() => document.querySelector('canvas[data-ready="true"]'));
  const exportButton = page.getByRole('button', { name: '导出当前范围 MP4' });
  const saveButton = page.getByRole('button', { name: /保存 JSON/ });
  const form = page.locator('.bc-actions form').first();
  const input = (name) => form.locator(`input[name="${name}"]`);
  const save = async (name) => {
    const pending = page.waitForEvent('download');
    await saveButton.click();
    await (await pending).saveAs(join(output, name));
    return JSON.parse(await readFile(join(output, name), 'utf8'));
  };
  const open = async (project) => {
    await page.locator('input[accept="application/json,.json"]').setInputFiles({
      name: 'test-project.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await ready();
  };
  await page.getByRole('button', { name: '打开落消示例' }).click();
  await ready();
  const original = await save('original.json');
  for (const [field, label] of [
    ['column', '列号'],
    ['seconds', '落位秒数'],
  ]) {
    await input(field).fill('');
    await form.getByRole('button', { name: '应用' }).click();
    await page
      .getByRole('alert')
      .filter({ hasText: `${label}不能为空` })
      .waitFor();
    assert.equal(await input(field).inputValue(), '', 'rejected draft remains visible');
    assert.equal(
      await saveButton.textContent(),
      '保存 JSON',
      'rejection must not dirty the saved document',
    );
    assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).isDisabled(), true);
    assert.deepEqual(await save(`rejected-${field}.json`), original);
    result.checks.push(`empty ${field}: rejected, draft retained, saved document unchanged`);
  }
  await input('column').fill('0');
  await input('seconds').fill('0');
  await form.getByRole('button', { name: '应用' }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.bc-toolbar button') &&
      [...document.querySelectorAll('button')].some((b) => b.textContent === '保存 JSON ·'),
  );
  await ready();
  const zero = await save('zero.json');
  assert.equal(zero.takes[0].actions[0].action.release.x, 0);
  assert.equal(zero.takes[0].actions[0].action.impactTick, 0);
  assert.equal(await page.getByRole('alert').count(), 0);
  await input('column').fill('4');
  await input('seconds').fill('1.01');
  await form.getByRole('button', { name: '应用' }).click();
  await ready();
  const corrected = await save('corrected.json');
  assert.equal(corrected.takes[0].actions[0].action.release.x, 4);
  assert.equal(corrected.takes[0].actions[0].action.impactTick, 30);
  result.checks.push('explicit zero accepted; corrected decimal uses existing 30 Hz rounding');

  // A bound project must also remain byte-for-byte unchanged on empty drafts.
  const bound = await page.evaluate(async (base) => {
    const { makeClearEffect } = await import(
      '/src/nativeReference/games/block-crush-drop/presentation/clearEffectLibrary.ts'
    );
    base.direction.style.clearEffectLibrary = {
      version: '1.0.0',
      effects: [makeClearEffect('first-clear', {})],
      bindings: [{ effectId: 'first-clear', takeId: 'demo', actionIndex: 0, cycleIndex: 0 }],
    };
    return base;
  }, original);
  await open(bound);
  await input('column').fill('');
  await form.getByRole('button', { name: '应用' }).click();
  await page.getByRole('alert').filter({ hasText: '列号不能为空' }).waitFor();
  assert.deepEqual(await save('bound-rejected.json'), bound);
  result.checks.push('empty edit preserves clear effect bindings');

  // Use only a three-second synthetic project for the actual encoder roundtrip.
  const short = await page.evaluate(
    async ({ base, wav }) => {
      const { compileBCPlayback } = await import('/src/games/block-crush/timeline.ts');
      const { stableHash } = await import('/src/nativeReference/headless/stableHash.ts');
      const { sha256Hex } = await import('/src/nativeReference/agent-assets/image.ts');
      const data = Uint8Array.from(atob(wav), (ch) => ch.charCodeAt(0));
      base.direction.production.audio.assets = {
        music: {
          id: 'music',
          kind: 'audio',
          encoding: 'base64',
          mimeType: 'audio/wav',
          data: wav,
          sha256: await sha256Hex(data),
        },
      };
      base.direction.production.audio.bgm = { assetId: 'music', gain: 0.3, loop: true };
      const source = compileBCPlayback(base, 'demo', true).source;
      base.direction.production.clips = [
        {
          id: 'short',
          takeId: 'demo',
          startFrame: 0,
          endFrame: 89,
          source: { takeHash: stableHash(base.takes[0]), frameSourceHash: source.frameSourceHash },
        },
      ];
      base.direction.production.selectedClipId = 'short';
      return base;
    },
    { base: original, wav: syntheticWav(220, 3).toString('base64') },
  );
  await open(short);
  const before = await save('before-export.json');
  await page.getByLabel('BC 时间线').fill('17');
  await page.waitForFunction(() => document.querySelector('canvas')?.dataset.frame === '17');
  await exportButton.click();
  await page
    .getByRole('status')
    .filter({ hasText: /\d+\/90 帧/ })
    .waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: '取消导出' }).click();
  await page
    .getByRole('status')
    .filter({ hasText: '已取消，可重新导出' })
    .waitFor({ timeout: 60_000 });
  assert.equal(await exportButton.isEnabled(), true);
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(await page.getByLabel('BC 时间线').inputValue(), '17');
  assert.equal(videoDownloads, 0, 'cancelled attempt must not download partial media');
  await page.screenshot({ path: join(output, 'cancelled-ready.png'), fullPage: true });
  const video = page.waitForEvent('download', { timeout: 180_000 });
  await exportButton.click();
  const videoPath = join(output, 'retry-success.mp4');
  await (await video).saveAs(videoPath);
  await page.waitForFunction(
    () => ![...document.querySelectorAll('button')].some((b) => b.textContent === '取消导出'),
  );
  assert.equal(await page.getByLabel('BC 时间线').inputValue(), '17');
  assert.deepEqual(await save('after-export.json'), before);
  assert.equal(videoDownloads, 1);
  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', videoPath],
      { encoding: 'utf8' },
    ),
  );
  assert.equal(
    probe.streams.some((s) => s.codec_name === 'h264'),
    true,
  );
  assert.equal(
    probe.streams.some((s) => s.codec_name === 'aac' && s.channels === 2),
    true,
  );
  assert.ok(Math.abs(Number(probe.format.duration) - 3) < 0.1);
  execFileSync('ffmpeg', ['-v', 'error', '-i', videoPath, '-f', 'null', '-'], { stdio: 'pipe' });
  await writeFile(join(output, 'ffprobe.json'), JSON.stringify(probe, null, 2));
  result.checks.push(
    'real encode cancellation -> unchanged project retry -> 3s H.264/stereo AAC, full decode passed',
  );

  // Valid structure with genuinely corrupted audio bytes, not a mocked validation error.
  const corrupt = structuredClone(short);
  corrupt.direction.production.audio.assets.music.sha256 = '0'.repeat(64);
  await open(corrupt);
  await exportButton.click();
  await page.getByRole('alert').filter({ hasText: 'AUDIO_ASSET_HASH_MISMATCH' }).waitFor();
  assert.equal(await exportButton.isDisabled(), true);
  assert.equal(videoDownloads, 1);
  result.checks.push('genuine audio hash mismatch remains a blocking project error');
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify({ ...result, passed: true, videoPath }, null, 2),
  );
  console.log(JSON.stringify({ ...result, passed: true, output }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
