import { chromeOptions } from './fixtures/chrome.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { preparePortableAssetWork } from './fixtures/portableAssetWork.mjs';

// Real browser/UI and filesystem-backed test assets; one deliberately injected
// new-work failure checks that an unsuccessful asynchronous switch keeps drafts.
await mkdir('outputs', { recursive: true });
const output = await mkdtemp(resolve('outputs/landing-draft-'));
const video = join(output, 'source.mp4');
execFileSync('ffmpeg', [
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'color=c=black:s=64x64:r=10',
  '-t',
  '1',
  '-pix_fmt',
  'yuv420p',
  '-c:v',
  'libx264',
  '-movflags',
  '+faststart',
  video,
]);
const injectFailure = {
  name: 'landing-create-failure-injection',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/src/state/useBBWorkSession.ts')) return;
    const marker = '    createNativeWork: async () => {';
    assert.ok(code.includes(marker), 'create-work failure probe marker changed');
    return code.replace(
      marker,
      `${marker}\n      if ((globalThis as any).__bbTestFailCreate) throw new Error('TEST_CREATE_FAILURE');`,
    );
  },
};
const server = await createServer({
  configFile: resolve('vite.config.ts'),
  plugins: [injectFailure],
  cacheDir: join(output, 'vite-cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
let browser;
try {
  await server.listen();
  const portable = await preparePortableAssetWork(server, output);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BB_CHROME_PATH
      ? { executablePath: process.env.BB_CHROME_PATH }
      : chromeOptions()),
    args: ['--no-sandbox'],
  });
  const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
  let page = await browser.newPage({
    acceptDownloads: true,
    viewport: { width: 1280, height: 1000 },
  });
  page.setDefaultTimeout(20000);
  const start = async () => {
    await page.close();
    page = await browser.newPage({
      acceptDownloads: true,
      viewport: { width: 1280, height: 1000 },
    });
    page.setDefaultTimeout(20000);
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.locator('summary').filter({ hasText: '参考视频观察记录' }).click();
    await page.getByLabel('选择参考视频').setInputFiles(video);
    await page.waitForFunction(() => {
      const node = document.querySelector('video');
      return node && node.videoWidth > 0 && Number.isFinite(node.duration);
    });
  };
  const setDraft = async () => {
    await page.getByLabel('观察内容').fill('尚未保存的观察文本');
    await page.waitForFunction(() => {
      const event = new Event('beforeunload', { cancelable: true });
      return !window.dispatchEvent(event);
    });
  };
  const isProtected = () =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      return !window.dispatchEvent(event);
    });
  const dialog = () => page.getByRole('dialog', { name: '未保存的观察草稿' });
  const importFile = async (file) => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: '导入项目', exact: true }).click(),
    ]);
    await chooser.setFiles(file);
  };
  const verifyDraft = async () => {
    assert.equal(await page.getByLabel('观察内容').inputValue(), '尚未保存的观察文本');
    assert.equal(await isProtected(), true);
  };

  // Fresh work must not show a warning when no observation has been entered.
  await page.goto(baseUrl);
  await page.getByRole('button', { name: '新建 BB 作品' }).click();
  await page.getByText('BB 创作与试玩').waitFor();
  assert.equal(await dialog().count(), 0);

  // Cancel, return-to-save, and an injected create failure all retain the draft.
  await start();
  await setDraft();
  const refreshPrompt = page.waitForEvent('dialog', { timeout: 10000 });
  await page.evaluate(() => {
    setTimeout(() => window.location.reload(), 0);
  });
  const refreshDialog = await refreshPrompt;
  assert.equal(refreshDialog.type(), 'beforeunload');
  await refreshDialog.dismiss();
  await verifyDraft();
  await page.getByRole('button', { name: '新建 BB 作品' }).click();
  await dialog().waitFor();
  await dialog().getByRole('button', { name: '取消', exact: true }).click();
  await verifyDraft();
  await page.getByRole('button', { name: '新建 BB 作品' }).click();
  await dialog().getByRole('button', { name: '返回保存', exact: true }).click();
  await page.getByLabel('观察内容').waitFor();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === '观察内容',
  );
  await verifyDraft();
  await page.evaluate(() => {
    globalThis.__bbTestFailCreate = true;
  });
  await page.getByRole('button', { name: '新建 BB 作品' }).click();
  await dialog().getByRole('button', { name: '放弃草稿并继续' }).click();
  await page.getByRole('alert').filter({ hasText: 'TEST_CREATE_FAILURE' }).waitFor();
  await verifyDraft();
  await page.evaluate(() => {
    globalThis.__bbTestFailCreate = false;
  });
  await page.getByRole('button', { name: '新建 BB 作品' }).click();
  await dialog().getByRole('button', { name: '放弃草稿并继续' }).click();
  await page.getByText('BB 创作与试玩').waitFor();

  // A genuine missing-directory import must fail in place. Retry remains
  // guarded even after the user selects all matching external asset roots.
  await start();
  await setDraft();
  await importFile(portable.projectPath);
  await dialog().getByRole('button', { name: '放弃草稿并继续' }).click();
  await page.getByRole('alert').filter({ hasText: '尚未选择' }).waitFor();
  await verifyDraft();
  for (const [label, directory] of [
    ['工程所在目录', portable.projectRoot],
    ['CAS 素材库目录', portable.casRoot],
    ['元素库缓存目录', portable.libraryRoot],
  ])
    await page.getByLabel(`导入${label}`).setInputFiles(directory);
  const retry = page.getByRole('button', { name: '重新打开 project.json' });
  await retry.click();
  await dialog().getByRole('button', { name: '取消', exact: true }).click();
  await verifyDraft();
  await retry.click();
  await dialog().getByRole('button', { name: '放弃草稿并继续' }).click();
  await page.getByText('作品包已核验', { exact: false }).waitFor();

  // Without a draft, import and a retry with newly selected roots proceed without warnings.
  await start();
  await importFile(portable.projectPath);
  await page.getByRole('alert').filter({ hasText: '尚未选择' }).waitFor();
  assert.equal(await dialog().count(), 0);
  for (const [label, directory] of [
    ['工程所在目录', portable.projectRoot],
    ['CAS 素材库目录', portable.casRoot],
    ['元素库缓存目录', portable.libraryRoot],
  ])
    await page.getByLabel(`导入${label}`).setInputFiles(directory);
  await page.getByRole('button', { name: '重新打开 project.json' }).click();
  await page.getByText('作品包已核验', { exact: false }).waitFor();
  assert.equal(await dialog().count(), 0);

  // Saving a recorded observation clears the warning; a fresh new work opens directly.
  await start();
  await setDraft();
  await page.getByRole('button', { name: '记录当前时间' }).click();
  await page.getByText('尚未保存的观察文本', { exact: false }).waitFor();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '保存观察记录 JSON' }).click(),
  ]);
  const saved = await download.createReadStream();
  let text = '';
  for await (const chunk of saved) text += chunk.toString();
  assert.equal(JSON.parse(text).observations[0].note, '尚未保存的观察文本');
  await page.waitForFunction(() => {
    const event = new Event('beforeunload', { cancelable: true });
    return window.dispatchEvent(event);
  });
  await page.getByRole('button', { name: '新建 BB 作品' }).click();
  await page.getByText('BB 创作与试玩').waitFor();
  assert.equal(await dialog().count(), 0);
  console.log(
    JSON.stringify(
      {
        result: 'passed',
        browser: browser.version(),
        createFailure: 'injected',
        importFailure: 'missing selected directories',
        output,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await server.close();
}
