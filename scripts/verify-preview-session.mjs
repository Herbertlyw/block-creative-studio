import { chromeOptions } from './fixtures/chrome.mjs';
// Browser regression using a generated work, not historical handoff fixtures.
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

await mkdir('outputs', { recursive: true });
const output = await mkdtemp(resolve('outputs/preview-session-'));
const server = await createServer({
  configFile: resolve('vite.config.ts'),
  cacheDir: join(output, 'vite-cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
await server.listen();
let browser;
try {
  const { createNativeWork, generateNativeMachineTake } = await server.ssrLoadModule(
    '/src/contracts/nativeWorkAuthor.ts',
  );
  const { setNativeWorkAudio } = await server.ssrLoadModule('/src/contracts/setNativeWorkAudio.ts');
  const { saveWorkbenchVariant } = await server.ssrLoadModule('/src/contracts/workbenchVariant.ts');
  const { updateBBWorkPackageProject } = await server.ssrLoadModule(
    '/src/contracts/bbWorkPackage.ts',
  );
  const { createStudioAssetCatalog } = await server.ssrLoadModule(
    '/src/nativeReference/games/block-placement/studio/studioAssetCatalog.ts',
  );
  const { registerCompositionProfile } = await server.ssrLoadModule(
    '/src/nativeReference/rendering/compositionRegistry.ts',
  );
  const { blockPlacementCompositionProfile } = await server.ssrLoadModule(
    '/src/nativeReference/games/block-placement/profiles/composition.ts',
  );
  registerCompositionProfile(blockPlacementCompositionProfile);
  let work = await generateNativeMachineTake(await createNativeWork(), 'first', 1);
  work = await generateNativeMachineTake(work, 'second', 1);
  const samples = 4800,
    bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(48000, 24);
  bytes.writeUInt32LE(96000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    bytes.writeInt16LE(Math.round(Math.sin(i * 0.13) * 6000 * (1 - i / samples)), 44 + i * 2);
  work = await setNativeWorkAudio(
    work,
    'placement',
    new File([bytes], 'cue.wav', { type: 'audio/wav' }),
  );
  const doc = structuredClone(work.project);
  const catalog = createStudioAssetCatalog({
    style: doc.direction.style,
    render: doc.production.output,
  });
  doc.production.layoutProfileRef = catalog.layoutProfileRef;
  doc.production.cameraProfileRef = catalog.cameraProfileRef;
  work = await updateBBWorkPackageProject(work, doc);
  const clean = 'builtin.reference-clean.look@1.0.0',
    garden = 'builtin.reference-garden.look@1.0.0';
  const initial = JSON.parse(
    await saveWorkbenchVariant(JSON.stringify(work.project), clean, garden),
  );
  work = await updateBBWorkPackageProject(work, initial);
  const input = join(output, 'input.json');
  await writeFile(input, JSON.stringify(work));
  browser = await chromium.launch({ ...chromeOptions(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ acceptDownloads: true });
  page.setDefaultTimeout(30000);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  const open = async (file) => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: '导入项目' }).click(),
    ]);
    await chooser.setFiles(file);
  };
  await open(input);
  await page.getByRole('button', { name: '打开 2D 测试预览' }).click();
  const look = page.getByLabel('V2 临时参考变体'),
    clear = page.getByLabel('V2 清除效果计划');
  await look.waitFor();
  assert.equal(await look.inputValue(), clean);
  assert.equal(await clear.inputValue(), garden);
  await page.locator('summary').filter({ hasText: '保存工作台 2D 外观与清除效果' }).click();
  await page.getByLabel('保存 V2 外观').selectOption(garden);
  await page.getByLabel('保存 V2 清除效果').selectOption(clean);
  const [edited] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '检查并另存 2D 效果' }).click(),
  ]);
  const editedPath = join(output, 'edited.json');
  await edited.saveAs(editedPath);
  const saved = JSON.parse(await readFile(editedPath, 'utf8'));
  assert.equal(saved.project.direction.style.workbenchVariantV1.lookKey, garden);
  assert.equal(saved.project.direction.style.workbenchVariantV1.clearFromLook, clean);
  await page.waitForFunction(
    (expected) => document.querySelector('[aria-label="V2 临时参考变体"]')?.value === expected,
    garden,
  );
  assert.equal(await clear.inputValue(), clean);
  await page.getByLabel('V2 定帧预览 Take').selectOption('second');
  assert.equal(await look.inputValue(), garden);
  assert.equal(await clear.inputValue(), clean);
  const [video] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.getByRole('button', { name: '导出工程音频测试视频' }).click(),
  ]);
  const videoPath = join(output, 'variant.mp4');
  await video.saveAs(videoPath);
  const streams = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', videoPath], {
      encoding: 'utf8',
    }),
  ).streams;
  execFileSync('ffmpeg', ['-v', 'error', '-i', videoPath, '-f', 'null', '-']);
  assert.ok(streams.some((s) => s.codec_type === 'video' && s.nb_frames > 0));
  assert.ok(streams.some((s) => s.codec_type === 'audio'));
  await look.selectOption(clean);
  await page.getByRole('button', { name: '恢复工程设置' }).click();
  assert.equal(await look.inputValue(), garden);
  await page.locator('summary').filter({ hasText: '视频质量' }).click();
  await page.getByLabel('BB 视频质量').selectOption('standard');
  await page.getByText('（有未保存修改）').waitFor();
  assert.equal(
    await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      return !window.dispatchEvent(e);
    }),
    true,
  );
  await page.getByRole('button', { name: '返回工作台' }).click();
  await page.getByRole('dialog', { name: '未保存的修改' }).waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '返回工作台' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '保存后离开' }).click(),
  ]);
  const reopenedPath = join(output, 'reopened.json');
  await download.saveAs(reopenedPath);
  await page.getByRole('button', { name: '导入项目' }).waitFor();
  await open(reopenedPath);
  await page.getByRole('button', { name: '打开 2D 测试预览' }).click();
  await look.waitFor();
  assert.equal(await look.inputValue(), garden);
  assert.equal(await clear.inputValue(), clean);
  const targetRow = page.getByLabel('V2 目标行');
  const originalRow = await targetRow.inputValue();
  await targetRow.fill(originalRow === '0' ? '1' : '0');
  await page.getByRole('button', { name: '返回工作台' }).click();
  await page.getByText('还有未应用的表单草稿').waitFor();
  assert.equal(await page.getByRole('button', { name: '保存后离开' }).isDisabled(), true);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await targetRow.fill(originalRow);
  await page.getByRole('button', { name: '返回工作台' }).click();
  await page.getByRole('button', { name: '导入项目' }).waitFor();
  await open(reopenedPath);
  await page.locator('summary').filter({ hasText: '视频质量' }).click();
  await page.getByLabel('BB 视频质量').selectOption('preview');
  await page.getByText('（有未保存修改）').waitFor();
  await page.getByRole('button', { name: '返回工作台' }).click();
  await page.getByRole('button', { name: '放弃修改' }).click();
  await page.getByRole('button', { name: '导入项目' }).waitFor();
  console.log(
    JSON.stringify(
      {
        result: 'passed',
        browser: browser.version(),
        output,
        video: streams
          .filter((s) => ['video', 'audio'].includes(s.codec_type))
          .map((s) => ({
            codec: s.codec_name,
            type: s.codec_type,
            frames: s.nb_frames,
            duration: s.duration,
          })),
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await server.close();
}
