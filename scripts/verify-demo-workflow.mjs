import { chromeOptions } from './fixtures/chrome.mjs';
import { preparePortableAssetWork } from './fixtures/portableAssetWork.mjs';
import { prepareSyntheticReference } from './fixtures/syntheticReference.mjs';
// Focused demo smoke: import references, resume a variant, reopen, preview and export once.
// Reuses known synthetic input; this is not automatic video recognition or human approval.
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd(),
  outputRoot = resolve(process.env.BB_DEMO_OUTPUT ?? 'outputs/bb-demo-smoke');
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'run-'));
const server = await createServer({
  configFile: resolve('vite.config.ts'),
  cacheDir: join(output, 'vite-cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
let browser, page;
try {
  await server.listen();
  const synthetic = await prepareSyntheticReference(server, output);
  const portable = await preparePortableAssetWork(server, output);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BB_CHROME_PATH
      ? { executablePath: process.env.BB_CHROME_PATH }
      : chromeOptions()),
    args: ['--no-sandbox'],
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(20000);
  const open = async (path) => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: '导入项目', exact: true }).click(),
    ]);
    await chooser.setFiles(path);
  };
  const save = async (button, name) => {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: name.endsWith('.json') ? 30000 : 120000 }),
      button.click(),
    ]);
    const path = join(output, name);
    await download.saveAs(path);
    return JSON.parse(name.endsWith('.json') ? await readFile(path, 'utf8') : 'null');
  };
  const show = async (summary) => {
    const locator = page.locator('summary').filter({ hasText: summary }).first();
    if (!(await locator.evaluate((el) => el.parentElement.open))) await locator.click();
  };
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, {
    waitUntil: 'networkidle',
  });
  // First import intentionally lacks roots. The landing page must remain usable for recovery.
  await open(portable.projectPath);
  await page.getByRole('alert').filter({ hasText: '尚未选择' }).waitFor();
  for (const [label, path] of [
    ['工程所在目录', portable.projectRoot],
    ['CAS 素材库目录', portable.casRoot],
    ['元素库缓存目录', portable.libraryRoot],
  ])
    await page.getByLabel(`导入${label}`, { exact: true }).setInputFiles(path);
  await page.getByRole('button', { name: '重新打开 project.json', exact: true }).click();
  await page.getByRole('button', { name: '保存作品', exact: true }).waitFor();
  const imported = await save(
    page.getByRole('button', { name: '保存作品', exact: true }),
    'portable-import.json',
  );
  assert.equal(imported.format, 'bcs-bb-work');
  assert.ok(!JSON.stringify(imported).includes('"encoding":"ref"'));
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await open(synthetic.workPath);
  await show('复制分槽图片的单槽变体');
  await page
    .getByLabel('变体单槽 PNG', { exact: true })
    .setInputFiles(synthetic.imagePaths.replacement);
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await page.getByText('还有未应用的表单草稿').waitFor();
  assert.equal(await page.getByRole('button', { name: '保存后离开' }).isDisabled(), true);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByLabel('变体单槽 PNG', { exact: true }).setInputFiles([]);
  await page.getByLabel('V2 工程名称', { exact: true }).fill('本机改造：继续复刻与变体');
  await save(page.getByRole('button', { name: '保存作品名称', exact: true }), 'renamed.json');
  await show('绑定作品图片');
  await page.getByLabel('作品图片槽', { exact: true }).selectOption('tile.face');
  await page
    .getByLabel('作品图片文件', { exact: true })
    .setInputFiles(synthetic.imagePaths.replacement);
  await page.getByRole('button', { name: '核验并绑定图片', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已更新作品' }).first().waitFor();
  await show('添加或替换工程音频');
  await page.getByLabel('替换音频角色', { exact: true }).selectOption('bgm');
  await page.getByLabel('替换音频文件', { exact: true }).setInputFiles(synthetic.audioPaths.bgm);
  await page.getByRole('button', { name: '核验并添加或替换音频', exact: true }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent === '核验并添加或替换音频' && button.disabled,
    ),
  );
  await page.getByRole('status').filter({ hasText: '已更新作品' }).first().waitFor();
  await show('复刻作品的外观与消除变体');
  await page.getByLabel('复刻消除效果', { exact: true }).selectOption('spark-strip');
  await page.getByRole('status').filter({ hasText: '外观已应用到当前作品' }).waitFor();
  const variant = await save(
    page.getByRole('button', { name: '保存作品', exact: true }),
    'variant-before-resume.json',
  );
  assert.match(variant.project.direction.production.audio.bgm.assetId, /work-audio-/);
  await show('参考视频观察记录');
  await page.getByLabel('选择参考视频', { exact: true }).setInputFiles(synthetic.video);
  await page.getByLabel('观察内容', { exact: true }).fill('尚未添加的观察笔记');
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await page.getByText('还有未应用的表单草稿').waitFor();
  assert.equal(await page.getByRole('button', { name: '保存后离开' }).isDisabled(), true);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByLabel('观察内容', { exact: true }).fill('');
  const resume = page.getByRole('button', { name: '继续编辑当前复刻作品', exact: true });
  await resume.waitFor();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent === '继续编辑当前复刻作品' && !button.disabled,
    ),
  );
  await resume.click();
  await page.getByRole('status').filter({ hasText: '已恢复当前作品' }).waitFor();
  await show('结构化玩法标注（实验）');
  await show('可视几何与方块轨迹（实验）');
  await page.getByLabel('候选 1 横坐标', { exact: true }).fill('210');
  for (let i = 0; i < 3; i++) {
    await page.getByLabel('几何动作', { exact: true }).selectOption({ value: String(i) });
    const id = variant.project.takes[0].actions[i].id;
    await page.waitForFunction(
      (id) =>
        document.querySelector('input[aria-label="确认选中方块轨迹"]')?.dataset.actionId === id,
      id,
    );
    await page.getByLabel('确认选中方块轨迹', { exact: true }).check();
    await page.waitForFunction(
      (i) =>
        JSON.parse(document.querySelector('textarea[aria-label="校准几何与方块轨迹 JSON"]').value)
          .motions[i].confirmed === true,
      i,
    );
  }
  await page.getByLabel('确认棋盘候选几何', { exact: true }).check();
  const resumed = await save(
    page.getByRole('button', { name: '校验并另存校准工程', exact: true }),
    'resumed-work.json',
  );
  assert.equal(resumed.project.name, variant.project.name);
  assert.deepEqual(resumed.project.direction.production, variant.project.direction.production);
  assert.deepEqual(
    resumed.project.direction.style.agentAssets,
    variant.project.direction.style.agentAssets,
  );
  assert.deepEqual(resumed.project.takes, variant.project.takes);
  assert.equal(resumed.project.direction.style.referenceCalibration.rackCenters[0], 210);
  assert.ok(
    resumed.project.direction.style.referenceCalibration.actions.every(
      (action) => action.clearStyle === 'spark-strip',
    ),
  );
  assert.ok(resumed.pointer);
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await open(join(output, 'resumed-work.json'));
  await page.getByRole('button', { name: '使用当前校准渲染器测试', exact: true }).click();
  const exportButton = page.getByRole('button', { name: '导出校准测试视频', exact: true });
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('button')).some(
        (button) => button.textContent === '导出校准测试视频' && !button.disabled,
      ),
    {},
    { timeout: 60000 },
  );
  await page.getByRole('button', { name: '播放校准预览', exact: true }).click();
  await page.waitForFunction(
    () => Number(document.querySelector('input[aria-label="校准预览帧"]')?.value) > 5,
  );
  await page.getByRole('button', { name: '暂停校准预览', exact: true }).click();
  await page.getByLabel('校准预览帧', { exact: true }).fill('27');
  await page
    .getByLabel('V2 校准渲染画面', { exact: true })
    .screenshot({ path: join(output, 'clear.png') });
  await save(exportButton, 'resumed-work.mp4');
  const video = join(output, 'resumed-work.mp4');
  const probe = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', video], {
      encoding: 'utf8',
    }),
  );
  execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-f', 'null', '-'], { stdio: 'pipe' });
  const picture = probe.streams.find((stream) => stream.codec_type === 'video'),
    sound = probe.streams.find((stream) => stream.codec_type === 'audio');
  assert.equal(picture.codec_name, 'h264');
  assert.equal(Number(picture.nb_frames), 151);
  assert.equal(sound.codec_name, 'aac');
  assert.equal(Number(sound.channels), 2);
  assert.deepEqual(errors, []);
  // A different editor must not keep the deleted action's target/duration draft.
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await open(join(output, 'portable-import.json'));
  await page.getByLabel('V2 扩展编辑动作', { exact: true }).selectOption({ value: '1' });
  await page.getByLabel('V2 动作步骤', { exact: true }).selectOption({ value: '1' });
  const afterDelete = await save(
    page.getByRole('button', { name: '删除动作并另存', exact: true }),
    'deleted-action.json',
  );
  const remaining = afterDelete.project.takes[0],
    first = remaining.actions[0],
    interaction = remaining.interactions.find((item) => item.committedActionId === first.id);
  await page.waitForFunction(
    (expected) =>
      Number(document.querySelector('input[aria-label="V2 动作帧长"]').value) === expected,
    interaction.endFrame - interaction.startFrame,
  );
  assert.equal(
    Number(await page.getByLabel('V2 目标行', { exact: true }).inputValue()),
    first.action.anchor.row,
  );
  assert.equal(
    Number(await page.getByLabel('V2 目标列', { exact: true }).inputValue()),
    first.action.anchor.col,
  );
  assert.deepEqual(errors, []);
  const report = {
    browser: browser.version(),
    source: 'newly generated synthetic three-action reference',
    externalReferences: 'imported with selected roots and embedded',
    resume: 'name/images/mix/takes retained; candidate center changed',
    variant: 'saved spark-strip effect',
    actionEditing: 'deleted last action; target and duration forms rebased',
    preview: true,
    export: {
      video: picture.codec_name,
      frames: picture.nb_frames,
      width: picture.width,
      height: picture.height,
      fps: picture.r_frame_rate,
      audio: sound.codec_name,
      channels: sound.channels,
    },
    decode: 'complete',
    scope: 'one browser and one export; no new AAC correlation or human visual/audio approval',
    errors,
  };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, ...report }, null, 2));
} catch (error) {
  await writeFile(join(output, 'failure.txt'), String(error.stack ?? error));
  if (page) {
    await writeFile(join(output, 'failure-page.txt'), await page.locator('body').innerText());
    await page.screenshot({ path: join(output, 'failure.png'), fullPage: true });
  }
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
