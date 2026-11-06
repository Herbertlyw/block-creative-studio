import { prepareSyntheticReference } from './fixtures/syntheticReference.mjs';
// Enter known synthetic observations through the browser form. This is scripted
// UI input, not automatic video recognition or human visual approval.
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
await mkdir('outputs', { recursive: true });
const output = await mkdtemp(resolve('outputs/bb-blank-observation-'));
const server = await createServer({
  configFile: resolve('vite.config.ts'),
  cacheDir: join(output, 'vite-cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
let browser;
try {
  await server.listen();
  const synthetic = await prepareSyntheticReference(server, output);
  const fixture = synthetic.observation,
    known = JSON.parse(fixture.structured),
    knownGeometry = JSON.parse(fixture.geometry);
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BB_CHROME_PATH
      ? { executablePath: process.env.BB_CHROME_PATH }
      : { channel: 'chrome' }),
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({
      viewport: { width: 1200, height: 1000 },
      acceptDownloads: true,
    }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const save = async (button, name) => {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 180000 }),
      button.click(),
    ]);
    await download.saveAs(join(output, name));
  };
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByText('参考视频观察记录', { exact: true }).click();
  await page.getByLabel('选择参考视频').setInputFiles(synthetic.video);
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="导入帧测量"]');
    return input && !input.disabled;
  });
  await page.getByLabel('导入帧测量').setInputFiles(synthetic.measurementPath);
  await page.getByText('结构化玩法标注（实验）', { exact: true }).click();
  await page.getByRole('button', { name: '创建空白标注表' }).click();
  await page.getByLabel('标注种子').fill(String(known.seed));
  await page.getByLabel('棋盘标注画笔').selectOption('blue');
  for (let c = 0; c < 7; c++)
    await page.getByRole('button', { name: `初盘 0 行 ${c} 列 unknown` }).click();
  await page.getByLabel('棋盘标注画笔').selectOption('empty');
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (r !== 0 || c >= 7)
        await page.getByRole('button', { name: `初盘 ${r} 行 ${c} 列 unknown` }).click();
  await page.getByLabel('作者确认整个初盘').check();
  for (let slot = 0; slot < 3; slot++) {
    await page.getByLabel(`供给 0 ${slot} 形状`).fill(known.supply.rounds[0][slot].shapeId);
    await page.getByLabel(`供给 0 ${slot} 颜色`).selectOption(known.supply.rounds[0][slot].color);
  }
  await page.getByLabel('作者确认全部供给').check();
  for (let i = 0; i < 3; i++)
    await page.getByRole('button', { name: '添加动作', exact: true }).click();
  for (let i = 0; i < 3; i++) {
    const action = known.actions[i],
      group = page.locator('fieldset').nth(i);
    for (const field of ['slot', 'row', 'col', 'pickupFrame', 'releaseFrame', 'clearFrame'])
      await page.getByLabel(`动作 ${i + 1} ${field}`, { exact: true }).fill(String(action[field]));
    await page.getByLabel(`动作 ${i + 1} clearRows`).fill(action.clearRows.join(','));
    await page.getByLabel(`动作 ${i + 1} clearCols`).fill(action.clearCols.join(','));
    for (let j = 0; j < action.path.length; j++) {
      await group.getByRole('button', { name: '添加路径点' }).click();
      for (const field of ['frame', 'x', 'y'])
        await page
          .getByLabel(`动作 ${i + 1} 路径 ${j + 1} ${field}`)
          .fill(String(action.path[j][field]));
    }
    await group.getByLabel('作者确认此步').check();
  }
  await page.getByText('可视几何与方块轨迹（实验）', { exact: true }).click();
  await page.getByRole('button', { name: '创建待确认的源画面映射' }).click();
  await page.getByLabel('源画面缩放').selectOption('stretch');
  await page.getByLabel('确认源画面映射').check();
  await page.getByRole('button', { name: '建立未确认的几何模板' }).click();
  const annotation = JSON.parse(await page.getByLabel('结构化玩法标注 JSON').inputValue());
  const geometry = structuredClone(knownGeometry);
  geometry.confirmed = false;
  geometry.motions.forEach((motion, index) => {
    motion.actionId = annotation.actions[index].id;
    motion.confirmed = false;
  });
  await page.getByLabel('校准几何与方块轨迹 JSON').fill(JSON.stringify(geometry, null, 2));
  const overlay = page.getByLabel('校准几何覆盖层');
  await overlay.scrollIntoViewIfNeeded();
  const rect = await overlay.boundingBox();
  assert.ok(rect);
  const movePoint = async (x1, y1, x2, y2) => {
    await page.mouse.move(rect.x + (x1 * rect.width) / 1080, rect.y + (y1 * rect.height) / 1920);
    await page.mouse.down();
    await page.mouse.move(rect.x + (x2 * rect.width) / 1080, rect.y + (y2 * rect.height) / 1920, {
      steps: 5,
    });
    await page.mouse.up();
  };
  await movePoint(200, 1400, 205, 1395);
  await movePoint(205, 1395, 200, 1400);
  for (let i = 0; i < 3; i++) {
    await page.getByLabel('几何动作').selectOption(String(i));
    await page.getByLabel('确认选中方块轨迹').check();
  }
  await page.getByLabel('确认棋盘候选几何').check();
  await page.getByLabel('确认圆环指针轨迹').check();
  await page.getByLabel('校准背景 PNG').setInputFiles(synthetic.imagePaths.background);
  await page.getByLabel('方块图片模式').selectOption('grouped');
  for (const role of ['white', 'coral', 'cyan'])
    await page.getByLabel(`校准 ${role} PNG`).setInputFiles(synthetic.imagePaths[role]);
  for (const [label, role] of [
    ['校准 BGM WAV', 'bgm'],
    ['校准落子 WAV', 'placement'],
    ['校准消除 WAV', 'clear'],
  ])
    await page.getByLabel(label).setInputFiles(synthetic.audioPaths[role]);
  await page.getByLabel('校准 BGM 循环').check();
  await save(page.getByRole('button', { name: '校验并另存校准工程' }), 'work.json');
  const work = JSON.parse(await readFile(join(output, 'work.json'), 'utf8'));
  assert.equal(work.source.link.source.sha256, fixture.source.sha256);
  assert.equal(work.project.takes[0].actions.length, 3);
  assert.ok(work.pointer);
  await page.getByRole('button', { name: '打开刚生成的观察作品' }).click();
  await page.getByText('作品包已核验', { exact: false }).waitFor();
  await page.getByRole('button', { name: '保存作品', exact: true }).click();
  await page.getByRole('button', { name: '返回工作台' }).click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: '导入项目', exact: true }).click(),
  ]);
  await chooser.setFiles(join(output, 'work.json'));
  await page.getByText('作品包已核验', { exact: false }).waitFor();
  await page.getByRole('button', { name: '使用当前校准渲染器测试' }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent?.includes('导出校准测试视频') && !button.disabled,
    ),
  );
  await page.getByRole('button', { name: '播放校准预览' }).click();
  await page.getByRole('button', { name: '暂停校准预览' }).waitFor();
  await page.waitForTimeout(700);
  const frame = Number(await page.getByLabel('校准预览帧').inputValue());
  assert.ok(frame > 0);
  await page.getByRole('button', { name: '暂停校准预览' }).click();
  await page.getByLabel('校准预览帧').fill('27');
  await page.getByLabel('V2 校准渲染画面').screenshot({ path: join(output, 'clear.png') });
  await save(page.getByRole('button', { name: '导出校准测试视频' }), 'video.mp4');
  const takeId = work.project.takes[0].takeId,
    audio = JSON.parse(
      execFileSync(
        process.execPath,
        [
          'scripts/verify-native-work-audio.mjs',
          join(output, 'work.json'),
          join(output, 'video.mp4'),
          takeId,
        ],
        { encoding: 'utf8', maxBuffer: 4_000_000 },
      ),
    );
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, 'evidence.json'),
    JSON.stringify(
      {
        source: fixture.source.sha256,
        takeId,
        actions: 3,
        entry: 'scripted UI input from known synthetic observations',
        frame,
        audio,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        output,
        browser: browser.version(),
        source: fixture.source.sha256,
        takeId,
        actions: 3,
        entry: 'scripted UI input from known synthetic observations',
        previewFrame: frame,
        audio,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await server.close();
}
