import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { chromeOptions } from './fixtures/chrome.mjs';

const source = process.argv[2];
if (!source) throw new Error('Expected generated directory from test:browser:game-audio-endurance');
await mkdir('outputs', { recursive: true });
const output = await mkdtemp(resolve('outputs/export-navigation-'));
const server = await createServer({
  cacheDir: join(output, 'cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
let browser;
const results = [];
try {
  await server.listen();
  browser = await chromium.launch({ ...chromeOptions(), headless: true });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  for (const game of ['bb', 'bc']) {
    const page = await browser.newPage({ acceptDownloads: true });
    const workers = new Set(),
      videoDownloads = [],
      dialogs = [],
      errors = [];
    page.on('worker', (worker) => {
      workers.add(worker);
      worker.once('close', () => workers.delete(worker));
    });
    page.on('download', (item) => {
      if (item.suggestedFilename().endsWith('.mp4')) videoDownloads.push(item);
    });
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type());
      void dialog.accept();
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const url = (which) => `${base}/${which === 'bc' ? '?test=bc#bc' : ''}`;
    const importWork = async (which, preview) => {
      const file = resolve(source, `${which}-synthetic-long.json`);
      if (which === 'bb') {
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: '导入项目', exact: true }).click();
        await (await chooser).setFiles(file);
        await page.getByText('分轨混音与人声', { exact: true }).waitFor();
        if (preview)
          await page.getByRole('button', { name: '打开 2D 测试预览', exact: true }).click();
      } else {
        await page.locator('input[accept="application/json,.json"]').setInputFiles(file);
        await page.waitForFunction(() => document.querySelector('canvas[data-ready="true"]'));
      }
      return JSON.parse(await readFile(file, 'utf8'));
    };
    await page.goto(url(game));
    await importWork(game, true);
    await page
      .getByRole('button', {
        name: game === 'bb' ? '导出工程音频测试视频' : '导出当前范围 MP4',
        exact: true,
      })
      .click();
    await page
      .getByRole('status')
      .filter({ hasText: /视频编码 \d+\/|% · \d+\// })
      .waitFor({ timeout: 120_000 });
    const live = workers.size;
    const closed = [...workers].map(
      (worker) =>
        new Promise((resolveClose, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Old AAC worker survived page navigation')),
            10_000,
          );
          worker.once('close', () => {
            clearTimeout(timer);
            resolveClose();
          });
        }),
    );
    const next = game === 'bb' ? 'bc' : 'bb';
    await page.goto(url(next));
    await Promise.all(closed);
    assert.equal(workers.size, 0);
    assert.equal(videoDownloads.length, 0);
    assert.ok(dialogs.includes('beforeunload'), 'active export must warn before leaving');
    const expected = await importWork(next, false);
    const pending = page.waitForEvent('download');
    await page
      .getByRole('button', { name: next === 'bb' ? '保存作品' : /保存 JSON/, exact: next === 'bb' })
      .click();
    const savedPath = join(output, `${game}-exit-to-${next}.json`);
    await (await pending).saveAs(savedPath);
    const saved = JSON.parse(await readFile(savedPath, 'utf8'));
    const actualDoc = next === 'bb' ? saved.project : saved,
      expectedDoc = next === 'bb' ? expected.project : expected;
    assert.deepEqual(actualDoc.takes, expectedDoc.takes);
    assert.deepEqual(actualDoc.direction.production.audio, expectedDoc.direction.production.audio);
    assert.equal(videoDownloads.length, 0);
    assert.deepEqual(errors, []);
    results.push({
      exitedGame: game,
      enteredGame: next,
      beforeUnloadWarning: true,
      closedAacWorkers: live,
      partialVideoDownloads: 0,
      nextProjectTakesAndAudioPreserved: true,
    });
    await page.close();
  }
  await writeFile(join(output, 'result.json'), JSON.stringify({ results, output }, null, 2));
  console.log(JSON.stringify({ results, output }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
