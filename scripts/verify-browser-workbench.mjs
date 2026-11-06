import { syntheticPng, syntheticWav } from './fixtures/syntheticMedia.mjs';
import { prepareSyntheticReference } from './fixtures/syntheticReference.mjs';
// Browser smoke test for real pointer input, persistence, common frame
// evaluation and actual shared scene calls. The legacy workbench remains separate.
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
await mkdir('outputs', { recursive: true });
const output = await mkdtemp(resolve('outputs/bb-browser-evidence-'));
for (const [id, color] of [
  ['synthetic-background', [30, 60, 90]],
  ['generated-tile', [180, 120, 40]],
  ['generated-atlas', [90, 140, 190]],
])
  await writeFile(join(output, `${id}.png`), syntheticPng(color, 64, 64));
for (const [id, frequency] of [
  ['music', 220],
  ['placement', 740],
  ['clear', 1120],
])
  await writeFile(join(output, `${id}.wav`), syntheticWav(frequency));
await writeFile(
  join(output, 'unsupported-v1.json'),
  JSON.stringify({ format: 'block-creative-studio-project', version: '1.0.0' }),
);
// Concurrent Vite checks must not rewrite the browser test's optimized deps.
// Test-only instrumentation observes the production evaluator and the actual
// scene methods. It does not supply state, alter rendering, or claim a single scene.
const probePlugin = {
  name: 'bb-browser-runtime-probe',
  enforce: 'pre',
  transform(code, id) {
    if (id.endsWith('/src/games/block-placement/planning/bbTimelinePlan.ts')) {
      const marker = '  return {\n    takeId: plan.takeId,\n    frameIndex,';
      assert.ok(code.includes(marker), 'BB evaluator probe marker missing');
      return code.replace(
        marker,
        "  (globalThis as any).__bbProbe?.record({kind:'frame',takeId:plan.takeId,frame:frameIndex,actionId:activeAction?.actionId??null,stateHash:rules.logicalStateHash,board:board.map(row=>row.join(',')).join('/'),drag:!!drag,dragPose:drag?.pose??null,clear:clearEffects.some(e=>e.age>=0)});\n" +
          marker,
      );
    }
    if (id.endsWith('/src/games/block-placement/rendering/BBScene2D.ts')) {
      const marker = '  renderAt(frame: BBTimelineFrame, style?: StyleSpec): void {';
      assert.ok(code.includes(marker), 'shared scene probe marker missing');
      return code.replace(
        marker,
        marker +
          "\n    (globalThis as any).__bbProbe?.record({kind:'bb-scene',appearance:this.observed?'observed':'authored',takeId:frame.takeId,frame:frame.frameIndex,canvasWidth:this.canvas.width,canvasHeight:this.canvas.height,actionId:frame.activeAction?.actionId??null,drag:!!frame.drag,dragPose:frame.drag?.pose??null,clear:frame.activeAction?.phase==='clearing'||frame.clearEffects.some((e:any)=>e.age>=0)});",
      );
    }
    if (id.endsWith('/src/renderer/BBThreeScene.ts')) {
      const marker = '  renderAt(frame: BBTimelineFrame, style: StyleSpec): void {';
      assert.ok(code.includes(marker), '3D scene probe marker missing');
      return code.replace(
        marker,
        marker +
          "(globalThis as any).__bbProbe?.record({kind:'bb-three',takeId:frame.takeId,frame:frame.frameIndex,canvasWidth:this.canvas.width,canvasHeight:this.canvas.height,stateHash:frame.rules.logicalStateHash,actionId:frame.activeAction?.actionId??null});",
      );
    }
    if (id.endsWith('/src/exporter/exportBBVideo.ts')) {
      const marker = '  const checkCancelled = () =>';
      assert.ok(code.includes(marker), 'video export probe marker missing');
      return code.replace(
        marker,
        " (globalThis as any).__bbProbe?.record({kind:'video-encoder',bitrate,width,height,fps,totalFrames});\n" +
          marker,
      );
    }
    if (id.endsWith('/src/state/useStudioModel.ts')) {
      const marker = 'export function useStudioModel() {';
      assert.ok(code.includes(marker), 'legacy workbench probe marker missing');
      return code.replace(
        marker,
        marker + "\n  (globalThis as any).__bbProbe?.record({kind:'legacy-workbench-render'});",
      );
    }
  },
};
const server = await createServer({
  configFile: resolve('vite.config.ts'),
  plugins: [probePlugin],
  cacheDir: join(output, 'vite-cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
let browser;
try {
  await server.listen();
  const synthetic = await prepareSyntheticReference(server, output);
  const { syntheticMultiCalibration } = await server.ssrLoadModule(
    '/tests/fixtures/syntheticMultiCalibration.ts',
  );
  await writeFile(
    join(output, 'multi-calibration.json'),
    JSON.stringify(syntheticMultiCalibration()),
  );
  const port = server.httpServer.address().port,
    url = `http://127.0.0.1:${port}/`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BB_CHROME_PATH
      ? { executablePath: process.env.BB_CHROME_PATH }
      : { channel: 'chrome' }),
    args: ['--no-sandbox'],
  });
  const width = Number(process.env.BB_TEST_VIEWPORT_WIDTH ?? 1200),
    deviceScaleFactor = Number(process.env.BB_TEST_DPR ?? 1);
  assert.ok(
    Number.isInteger(width) &&
      width >= 320 &&
      width <= 3840 &&
      Number.isFinite(deviceScaleFactor) &&
      deviceScaleFactor >= 1 &&
      deviceScaleFactor <= 3,
    'invalid browser test viewport or DPR',
  );
  const page = await browser.newPage({
      viewport: { width, height: 1000 },
      deviceScaleFactor,
      acceptDownloads: true,
    }),
    errors = [];
  await page.addInitScript(() => {
    globalThis.__bbProbe = {
      phase: 'setup',
      events: [],
      record(value) {
        this.events.push({ ...value, phase: this.phase });
      },
    };
  });
  const phase = (name) =>
    page.evaluate((value) => {
      globalThis.__bbProbe.phase = value;
    }, name);
  page.on('pageerror', (error) => errors.push(error.message));
  const save = async (button, name) => {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 180000 }),
      button.click(),
    ]);
    await download.saveAs(join(output, name));
  };
  const boardDigest = () =>
    page.getByLabel('V2 参考 2D 测试画面').evaluate(async (canvas) => {
      const pixels = canvas.getContext('2d').getImageData(0, 140, canvas.width, 450).data;
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
    });
  const backgroundDigest = () =>
    page.getByLabel('V2 参考 2D 测试画面').evaluate(async (canvas) => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, 100, 100).data;
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
    });
  const openWork = async (file) => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: '导入项目', exact: true }).click(),
    ]);
    await chooser.setFiles(file);
    await page.getByText('作品包已核验', { exact: false }).waitFor();
  };
  const readyCalibrated = async () =>
    page.waitForFunction(() =>
      Array.from(document.querySelectorAll('button')).some(
        (button) => button.textContent?.includes('导出校准测试视频') && !button.disabled,
      ),
    );
  await page.goto(url, { waitUntil: 'networkidle' });
  const [oldChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: '导入项目', exact: true }).click(),
  ]);
  await oldChooser.setFiles(join(output, 'unsupported-v1.json'));
  await page.getByRole('alert').filter({ hasText: '此展示版本不支持旧格式' }).waitFor();
  await page.getByRole('button', { name: '新建 BB 作品' }).click();
  await page.getByText('BB 创作与试玩').waitFor();
  const legacyBefore = await page.evaluate(
    () =>
      globalThis.__bbProbe.events.filter((item) => item.kind === 'legacy-workbench-render').length,
  );
  assert.equal(legacyBefore, 0, 'the legacy workbench must not run on the landing page');
  await page.getByText('编辑初始棋盘', { exact: true }).click();
  await page.getByRole('button', { name: '横纵双消', exact: true }).click();
  await page.waitForFunction(() => {
    const cell = document.querySelector('button[aria-label="初始棋盘 5 0"]');
    return cell && !cell.disabled && cell.style.background !== 'rgb(36, 44, 66)';
  });
  await save(page.getByRole('button', { name: '保存作品', exact: true }), 'preset-board.json');
  assert.notEqual(
    JSON.parse(await readFile(join(output, 'preset-board.json'), 'utf8')).project.game.initialState
      .data.board.cells[5][0],
    null,
  );
  await page.getByRole('button', { name: '空棋盘', exact: true }).click();
  await page.waitForFunction(() => {
    const cell = document.querySelector('button[aria-label="初始棋盘 5 0"]');
    return cell && !cell.disabled && cell.style.background === 'rgb(36, 44, 66)';
  });
  for (let col = 0; col < 7; col++)
    await page.getByRole('gridcell', { name: `初始棋盘 0 ${col}` }).click();
  await page.getByRole('gridcell', { name: '初始棋盘 7 7' }).click();
  await page.getByText('固定供给轮次', { exact: true }).click();
  await page.getByLabel('第 1 轮候选 2 形状').selectOption('tri-h');
  await page.getByText('候选 2 逐格颜色', { exact: true }).click();
  for (const [cell, color] of [
    [1, 'cyan'],
    [2, 'rose'],
    [3, 'amber'],
  ])
    await page.getByLabel(`第 1 轮候选 2 第 ${cell} 格颜色`).selectOption(color);
  await page.getByRole('button', { name: '核验并应用固定供给' }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent === '核验并应用固定供给' && !button.disabled,
    ),
  );
  await save(page.getByRole('button', { name: '保存作品', exact: true }), 'supply-colors.json');
  const colorWork = JSON.parse(await readFile(join(output, 'supply-colors.json'), 'utf8'));
  assert.deepEqual(colorWork.project.game.initialState.data.fixedPieceSupply[0][1].cellColors, [
    'cyan',
    'rose',
    'amber',
  ]);
  await page.getByRole('button', { name: '轮换初盘和供给颜色' }).click();
  await page.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (item) => item.textContent === '轮换初盘和供给颜色',
    );
    return button && !button.disabled;
  });
  await save(page.getByRole('button', { name: '保存作品', exact: true }), 'rotated-colors.json');
  const rotated = JSON.parse(await readFile(join(output, 'rotated-colors.json'), 'utf8'));
  assert.deepEqual(rotated.project.game.initialState.data.fixedPieceSupply[0][1].cellColors, [
    'blue',
    'coral',
    'lime',
  ]);
  assert.equal(rotated.project.game.initialState.data.board.cells[0][0], 'amber');
  await page.getByRole('button', { name: '核验并恢复种子供给' }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent === '核验并恢复种子供给' && !button.disabled,
    ),
  );
  await save(page.getByRole('button', { name: '保存作品', exact: true }), 'seeded-supply.json');
  const seededWork = JSON.parse(await readFile(join(output, 'seeded-supply.json'), 'utf8'));
  assert.equal(seededWork.project.game.initialState.data.fixedPieceSupply, undefined);
  assert.equal(seededWork.project.game.initialState.data.seed, 41782);
  await page.getByLabel('作品种子').fill('99');
  await page.getByRole('button', { name: '核验并应用种子' }).click();
  await page.getByText('当前种子：99。', { exact: false }).waitFor();
  await save(page.getByRole('button', { name: '保存作品', exact: true }), 'changed-seed.json');
  const changedSeed = JSON.parse(await readFile(join(output, 'changed-seed.json'), 'utf8'));
  assert.equal(changedSeed.project.game.initialState.data.seed, 99);
  assert.notDeepEqual(
    changedSeed.project.game.initialState.data.pieces,
    seededWork.project.game.initialState.data.pieces,
  );
  await page.getByLabel('作品种子').fill('41782');
  await page.getByRole('button', { name: '核验并应用种子' }).click();
  await page.getByText('当前种子：41782。', { exact: false }).waitFor();
  for (let slot = 1; slot <= 3; slot++)
    await page.getByLabel(`第 1 轮候选 ${slot} 形状`).selectOption('single');
  await page.getByRole('button', { name: '核验并应用固定供给' }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent === '核验并应用固定供给' && !button.disabled,
    ),
  );
  await page.getByLabel('新 Take 名称').fill('human-drag');
  await page.getByRole('button', { name: '创建真人 Take' }).click();
  const piece = page.getByRole('button', { name: /1 · single/ }),
    target = page.getByRole('gridcell', { name: '棋盘 0 7', exact: true });
  await piece.scrollIntoViewIfNeeded();
  const a = await piece.boundingBox(),
    b = await target.boundingBox();
  assert.ok(a && b);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(
      a.x + a.width / 2 + ((b.x + b.width / 2 - a.x - a.width / 2) * i) / 12,
      a.y + a.height / 2 + ((b.y + b.height / 2 - a.y - a.height / 2) * i) / 12,
    );
    await page.waitForTimeout(90);
  }
  await page.mouse.up();
  await page.getByText('回合 1', { exact: false }).first().waitFor({ timeout: 15000 });
  await page.getByLabel('新 Take 名称').fill('machine');
  await page.getByRole('button', { name: '生成机器 Take' }).click();
  await page.getByRole('option', { name: /machine ·/ }).waitFor({ state: 'attached' });
  await page.getByLabel('新 Take 名称').fill('scratch');
  await page.getByRole('button', { name: '创建真人 Take' }).click();
  await page.getByRole('button', { name: /1 · single/ }).click();
  await page.getByRole('gridcell', { name: '棋盘 0 7', exact: true }).click();
  await page.getByText('回合 1', { exact: false }).first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '撤销所选 Take 最后一步' }).click();
  await page.getByText('回合 0', { exact: false }).first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '删除所选 Take' }).click();
  await page.getByRole('option', { name: /scratch ·/ }).waitFor({ state: 'detached' });
  await page.getByText('绑定工程 WAV 音频', { exact: true }).click();
  for (const [label, file] of [
    ['作品背景 WAV', 'music'],
    ['作品落子 WAV', 'placement'],
    ['作品消除 WAV', 'clear'],
  ])
    await page.getByLabel(label).setInputFiles(join(output, `${file}.wav`));
  await page.getByRole('button', { name: '核验并绑定 WAV' }).click();
  await page.getByText('音频已绑定，请保存作品。', { exact: false }).waitFor();
  await page.getByText('合成测试音乐与音效', { exact: true }).click();
  await page.getByLabel('测试音音乐增益').fill('0.1');
  await page.getByLabel('测试音音乐源内偏移').fill('0.12');
  await page.getByLabel('测试音落位偏移').fill('0.02');
  await page.getByRole('button', { name: '核验并保存测试音设置' }).click();
  await page.getByText('测试音设置已更新；请保存作品。').waitFor();
  await save(page.getByRole('button', { name: '保存作品', exact: true }), 'three-work.json');
  const testAudioWork = JSON.parse(await readFile(join(output, 'three-work.json'), 'utf8'));
  assert.equal(
    testAudioWork.project.direction.style.workbenchSyntheticAudioV1.bgmSourceOffsetSeconds,
    0.12,
  );
  assert.equal(
    testAudioWork.project.direction.style.workbenchSyntheticAudioV1.cueOverrides[0].offsetSeconds,
    0.02,
  );
  // Before adding 2D image bindings, verify that the 3D backend projects the
  // very same selected Take and frame clock, and actually encodes a video.
  await page.getByRole('button', { name: '打开 2D 测试预览' }).click();
  await page.getByLabel('V2 定帧预览 Take').selectOption('human-drag');
  await page.getByLabel('使用工程 production.audio（WAV）').uncheck();
  await page.getByLabel('合成测试提示音（不是工程音频）').check();
  await phase('synthetic-export');
  await save(page.getByRole('button', { name: '导出合成音效测试视频' }), 'synthetic-test.mp4');
  await page.getByLabel('合成测试提示音（不是工程音频）').uncheck();
  await page.getByLabel('使用工程 production.audio（WAV）').check();
  await page.getByLabel('V2 定帧预览 Take').selectOption('machine');
  assert.equal(await page.getByLabel('创作 Take').inputValue(), 'machine');
  assert.equal(await page.getByLabel('V2 动作 Take').inputValue(), '1');
  assert.equal(await page.getByLabel('V2 扩展编辑 Take').inputValue(), '1');
  await phase('effect-before');
  await page.getByLabel('V2 预览帧').fill('55');
  await page.waitForFunction(
    () =>
      globalThis.__bbProbe.events.some(
        (item) => item.phase === 'effect-before' && item.kind === 'bb-scene' && item.frame === 55,
      ),
    null,
    { timeout: 30000 },
  );
  const baselineBoard = await boardDigest();
  await page.getByText('2D 牌面与效果', { exact: true }).click();
  const baselineBackground = await backgroundDigest();
  await page.getByLabel('2D 背景颜色').fill('#123456');
  await phase('solid-background');
  await page.getByRole('button', { name: '核验并应用 2D 背景' }).click();
  await page.waitForFunction(
    () =>
      globalThis.__bbProbe.events.some(
        (item) =>
          item.phase === 'solid-background' && item.kind === 'bb-scene' && item.frame === 55,
      ),
    null,
    { timeout: 30000 },
  );
  assert.notEqual(
    await backgroundDigest(),
    baselineBackground,
    'solid background must change its actual canvas region',
  );
  await save(page.getByRole('button', { name: '保存作品', exact: true }), 'solid-background.json');
  assert.equal(
    JSON.parse(await readFile(join(output, 'solid-background.json'), 'utf8')).project.direction
      .style.workbenchBackground2DV1.color,
    '#123456',
  );
  await phase('background-restored');
  await page.getByRole('button', { name: '恢复 2D 默认背景' }).click();
  await page.waitForFunction(
    () =>
      globalThis.__bbProbe.events.some(
        (item) =>
          item.phase === 'background-restored' && item.kind === 'bb-scene' && item.frame === 55,
      ),
    null,
    { timeout: 30000 },
  );
  assert.equal(
    await backgroundDigest(),
    baselineBackground,
    'restoring the background must restore its region',
  );
  await phase('effect-after');
  await page.getByLabel('2D 清除效果').selectOption('laser-slice');
  await page.waitForFunction(() => {
    const select = document.querySelector('select[aria-label="2D 清除效果"]');
    return select?.value === 'laser-slice' && !select.disabled;
  });
  await page.waitForFunction(
    () =>
      globalThis.__bbProbe.events.some(
        (item) => item.phase === 'effect-after' && item.kind === 'bb-scene' && item.frame === 55,
      ),
    null,
    { timeout: 30000 },
  );
  assert.notEqual(
    await boardDigest(),
    baselineBoard,
    'clear effect selection must change the actual board region',
  );
  await phase('effect-restored');
  await page.getByLabel('2D 清除效果').selectOption('sweep-score-spark');
  await page.waitForFunction(() => {
    const select = document.querySelector('select[aria-label="2D 清除效果"]');
    return select?.value === 'sweep-score-spark' && !select.disabled;
  });
  await page.waitForFunction(
    () =>
      globalThis.__bbProbe.events.some(
        (item) => item.phase === 'effect-restored' && item.kind === 'bb-scene' && item.frame === 55,
      ),
    null,
    { timeout: 30000 },
  );
  assert.equal(
    await boardDigest(),
    baselineBoard,
    'restoring the clear effect must restore the board region',
  );
  const initialBest = await page.getByLabel('2D 历史最高分').inputValue(),
    initialPointer = await page.getByLabel('显示操作指针').isChecked();
  await page.getByLabel('2D 历史最高分').fill('1234');
  await page.getByRole('button', { name: '核验并应用最高分' }).click();
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="2D 历史最高分"]');
    return input && !input.disabled;
  });
  await page.getByLabel('显示操作指针').click();
  await page.waitForFunction((value) => {
    const input = document.querySelector('input[aria-label="显示操作指针"]');
    return input && !input.disabled && input.checked === value;
  }, !initialPointer);
  await save(page.getByRole('button', { name: '保存作品', exact: true }), 'display-edited.json');
  const display = JSON.parse(await readFile(join(output, 'display-edited.json'), 'utf8')).project
    .direction.style;
  assert.equal(display.reference2d.bestScore, 1234);
  assert.equal(display.showPointer, !initialPointer);
  await page.getByLabel('2D 历史最高分').fill(initialBest);
  await page.getByRole('button', { name: '核验并应用最高分' }).click();
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="2D 历史最高分"]');
    return input && !input.disabled;
  });
  await page.getByLabel('显示操作指针').click();
  await page.waitForFunction((value) => {
    const input = document.querySelector('input[aria-label="显示操作指针"]');
    return input && !input.disabled && input.checked === value;
  }, initialPointer);
  await page.getByText('动作节奏', { exact: true }).click();
  await page.getByLabel('节奏 动作间隔').fill('20');
  await page.getByRole('button', { name: '核验并应用 动作间隔' }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent === '核验并应用 动作间隔' && !button.disabled,
    ),
  );
  await save(page.getByRole('button', { name: '保存作品', exact: true }), 'rhythm-edited.json');
  assert.equal(
    JSON.parse(await readFile(join(output, 'rhythm-edited.json'), 'utf8')).project.direction.rhythm
      .betweenActionFrames,
    20,
  );
  await page.getByLabel('节奏 动作间隔').fill('14');
  await page.getByRole('button', { name: '核验并应用 动作间隔' }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent === '核验并应用 动作间隔' && !button.disabled,
    ),
  );
  await save(page.getByRole('button', { name: '保存作品', exact: true }), 'rhythm-restored.json');
  assert.deepEqual(
    JSON.parse(await readFile(join(output, 'rhythm-restored.json'), 'utf8')),
    JSON.parse(await readFile(join(output, 'three-work.json'), 'utf8')),
  );
  await page.getByLabel('BB 节奏模板').selectOption('tight-fast');
  await page.waitForFunction(() => {
    const select = document.querySelector('select[aria-label="BB 节奏模板"]');
    return select?.value === 'tight-fast' && !select.disabled;
  });
  await save(page.getByRole('button', { name: '保存作品', exact: true }), 'rhythm-preset.json');
  assert.equal(
    JSON.parse(await readFile(join(output, 'rhythm-preset.json'), 'utf8')).project.direction.rhythm
      .id,
    'tight-fast',
  );
  await page.getByLabel('BB 节奏模板').selectOption('human-natural');
  await page.waitForFunction(() => {
    const select = document.querySelector('select[aria-label="BB 节奏模板"]');
    return select?.value === 'human-natural' && !select.disabled;
  });
  await save(
    page.getByRole('button', { name: '保存作品', exact: true }),
    'rhythm-preset-restored.json',
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(output, 'rhythm-preset-restored.json'), 'utf8')),
    JSON.parse(await readFile(join(output, 'three-work.json'), 'utf8')),
  );
  await phase('three-preview');
  await page.getByLabel('BB 画面表现').selectOption('3d');
  await page.waitForFunction(
    () =>
      globalThis.__bbProbe.events.some(
        (item) =>
          item.phase === 'three-preview' && item.kind === 'bb-three' && item.takeId === 'machine',
      ),
    null,
    { timeout: 60000 },
  );
  await page.getByLabel('V2 预览帧').fill('20');
  await page.waitForFunction(
    () =>
      globalThis.__bbProbe.events.some(
        (item) => item.phase === 'three-preview' && item.kind === 'bb-three' && item.frame === 20,
      ),
    null,
    { timeout: 30000 },
  );
  await page.getByLabel('使用工程 production.audio（WAV）').check();
  await phase('three-export');
  await save(page.getByRole('button', { name: '导出工程音频测试视频' }), 'three-machine.mp4');
  await page.getByText('3D 材质与镜头', { exact: true }).click();
  await page.getByLabel('3D 材质').selectOption('crystal-glass');
  await page.waitForFunction(() => {
    const select = document.querySelector('select[aria-label="3D 材质"]');
    return select?.value === 'crystal-glass' && !select.disabled;
  });
  await save(
    page.getByRole('button', { name: '保存作品', exact: true }),
    'three-variant-work.json',
  );
  const threeOriginal = JSON.parse(await readFile(join(output, 'three-work.json'), 'utf8')),
    threeVariant = JSON.parse(await readFile(join(output, 'three-variant-work.json'), 'utf8'));
  assert.equal(threeVariant.project.direction.style.material, 'crystal-glass');
  delete threeOriginal.project.direction.style.material;
  delete threeVariant.project.direction.style.material;
  assert.deepEqual(
    threeVariant,
    threeOriginal,
    'a 3D material edit must preserve gameplay, audio and other project fields',
  );
  await phase('three-variant-export');
  await save(page.getByRole('button', { name: '导出工程音频测试视频' }), 'three-variant.mp4');
  await page.getByText('视频质量', { exact: true }).click();
  await page.getByLabel('BB 视频质量').selectOption('standard');
  await page.waitForFunction(() => {
    const select = document.querySelector('select[aria-label="BB 视频质量"]');
    return select?.value === 'standard' && !select.disabled;
  });
  await save(page.getByRole('button', { name: '保存作品', exact: true }), 'standard-quality.json');
  assert.equal(
    JSON.parse(await readFile(join(output, 'standard-quality.json'), 'utf8')).project.direction
      .style.workbenchExportQualityV1.preset,
    'standard',
  );
  await phase('three-standard-export');
  await save(page.getByRole('button', { name: '导出工程音频测试视频' }), 'three-standard.mp4');
  await page.getByLabel('BB 视频质量').selectOption('preview');
  await page.waitForFunction(() => {
    const select = document.querySelector('select[aria-label="BB 视频质量"]');
    return select?.value === 'preview' && !select.disabled;
  });
  const originalDepth = await page.getByLabel('3D 厚度').inputValue();
  await page.getByLabel('3D 厚度').fill('0.6');
  await page.getByRole('button', { name: '核验并应用 3D 厚度' }).click();
  await page.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (item) => item.textContent === '核验并应用 3D 厚度',
    );
    return button && !button.disabled;
  });
  await save(page.getByRole('button', { name: '保存作品', exact: true }), 'geometry-edited.json');
  assert.equal(
    JSON.parse(await readFile(join(output, 'geometry-edited.json'), 'utf8')).project.direction.style
      .geometry.depth,
    0.6,
  );
  await page.getByLabel('3D 厚度').fill(originalDepth);
  await page.getByRole('button', { name: '核验并应用 3D 厚度' }).click();
  await page.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (item) => item.textContent === '核验并应用 3D 厚度',
    );
    return button && !button.disabled;
  });
  await page.getByLabel('BB 画面表现').selectOption('2d');
  await page.getByText('绑定作品图片', { exact: true }).click();
  for (const [slot, file] of [
    ['background.base', 'synthetic-background'],
    ['tile.face', 'generated-tile'],
    ['board.atlas', 'generated-atlas'],
  ]) {
    await page.getByLabel('作品图片槽').selectOption(slot);
    await page.getByLabel('作品图片文件').setInputFiles(join(output, `${file}.png`));
    await page.getByRole('button', { name: '核验并绑定图片' }).click();
    await page.waitForFunction(
      (value) =>
        Array.from(document.querySelectorAll('p')).some(
          (item) =>
            item.textContent?.includes('已通过 SHA-256') && item.textContent.includes(value),
        ),
      slot,
      { timeout: 15000 },
    );
  }
  await page.getByLabel('BB 画面表现').selectOption('3d');
  await page
    .getByText('3D 尚不消费工程图片绑定；为避免忽略素材，已阻止 3D 预览与导出。', { exact: true })
    .waitFor();
  await page.getByLabel('BB 画面表现').selectOption('2d');
  // An editor commit must update the current package, not just a downloaded
  // copy; a rejected subsequent action must leave that current package intact.
  await page.getByLabel('V2 音乐增益').fill('0.17');
  await save(page.getByRole('button', { name: '检查并另存音乐' }), 'music-edited.json');
  await page.getByText('校验通过，已更新当前作品并另存。', { exact: true }).waitFor();
  await page.getByLabel('V2 目标行').fill('0');
  await page.getByLabel('V2 目标列').fill('0');
  await page.getByRole('button', { name: '检查并另存 V2 动作' }).click();
  await page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '修改 V2 动作目标' }) })
    .getByRole('alert')
    .waitFor();
  await save(page.getByRole('button', { name: '保存作品', exact: true }), 'author.json');
  const authored = JSON.parse(await readFile(join(output, 'author.json'), 'utf8'));
  const musicEdited = JSON.parse(await readFile(join(output, 'music-edited.json'), 'utf8'));
  assert.deepEqual(authored, musicEdited);
  assert.equal(authored.project.direction.production.audio.bgm.gain, 0.17);
  const human = authored.project.takes.find((take) => take.takeId === 'human-drag');
  assert.ok(human.interactions[0].endFrame > 15);
  assert.equal(human.actions[0].action.anchor.col, 7);
  const recorded = human.interactions[0].samples,
    firstPoint = recorded[0],
    lastPoint = recorded.at(-1);
  assert.ok(
    Math.abs(firstPoint.x - 238 / 1064) < 0.006 && Math.abs(firstPoint.y - 1470 / 1788) < 0.006,
    'recorded pickup must use the design-canvas coordinates',
  );
  assert.ok(
    Math.abs(lastPoint.x - (91 + 7.5 * 112 - 1) / 1064) < 0.006 &&
      Math.abs(lastPoint.y - (321 + 0.5 * 112 - 1) / 1788) < 0.006,
    'recorded release must use the target cell in design-canvas coordinates',
  );
  assert.equal(
    await page.evaluate(
      () =>
        globalThis.__bbProbe.events.filter((item) => item.kind === 'legacy-workbench-render')
          .length,
    ),
    legacyBefore,
    'the legacy workbench must not rerender while the BB work session is open',
  );
  await page.getByRole('button', { name: '返回工作台' }).click();
  await page.getByRole('button', { name: '放弃修改' }).click();
  await openWork(join(output, 'author.json'));
  await page.getByRole('button', { name: '打开 2D 测试预览' }).click();
  await page.getByRole('button', { name: '播放 V2 预览' }).click();
  await page.getByRole('button', { name: '暂停 V2 预览' }).waitFor();
  await page.getByLabel('V2 音乐增益').fill('0.12');
  await save(page.getByRole('button', { name: '检查并另存音乐' }), 'music-live.json');
  // Changing the work while audio is playing must stop the old clock and mix.
  await page.getByRole('button', { name: '播放 V2 预览' }).waitFor();
  const staleDownloads = [];
  const observeDownload = (download) => {
    if (download.suggestedFilename().endsWith('.mp4'))
      staleDownloads.push(download.suggestedFilename());
  };
  page.on('download', observeDownload);
  await page.getByRole('button', { name: '导出工程音频测试视频' }).click();
  await page.getByLabel('V2 音乐增益').fill('0.13');
  await save(page.getByRole('button', { name: '检查并另存音乐' }), 'music-during-export.json');
  await page.getByText('作品或预览设置已更改，已取消旧导出。', { exact: true }).waitFor();
  assert.deepEqual(staleDownloads, []);
  page.off('download', observeDownload);
  await page.getByLabel('V2 音效事件').selectOption('0');
  assert.ok(
    (await page.getByLabel('V2 音效事件').locator('option:checked').textContent()).includes(
      'block-placement.placement-committed',
    ),
  );
  await page.getByLabel('V2 音效偏移').fill('0.02');
  await save(page.getByRole('button', { name: '检查并另存音效偏移' }), 'cue-offset.json');
  assert.equal(
    JSON.parse(await readFile(join(output, 'cue-offset.json'), 'utf8')).project.direction.production
      .audio.cues[0].offsetSeconds,
    0.02,
  );
  await save(page.getByRole('button', { name: '保存作品', exact: true }), 'author-current.json');
  const current = JSON.parse(await readFile(join(output, 'author-current.json'), 'utf8'));
  assert.equal(current.project.direction.production.audio.bgm.gain, 0.13);
  const advances = [];
  for (const take of ['human-drag', 'machine']) {
    await phase(`${take}-preview`);
    await page.getByLabel('V2 定帧预览 Take').selectOption(take);
    await page.getByRole('button', { name: '播放 V2 预览' }).click();
    assert.equal(await page.getByLabel('创作 Take').inputValue(), take);
    await page.getByRole('button', { name: '暂停 V2 预览' }).waitFor();
    await page.waitForTimeout(1000);
    const frame = Number(await page.getByLabel('V2 预览帧').inputValue());
    assert.ok(frame > 0);
    advances.push({ take, frame });
    await page.getByRole('button', { name: '暂停 V2 预览' }).click();
    await phase(`${take}-export`);
    await save(page.getByRole('button', { name: '导出工程音频测试视频' }), `${take}.mp4`);
  }
  await page.getByRole('button', { name: '返回工作台' }).click();
  await openWork(synthetic.workPath);
  await page.getByRole('button', { name: '使用当前校准渲染器测试' }).click();
  await readyCalibrated();
  const canvas = page.locator('canvas[aria-label="V2 校准渲染画面"]');
  await canvas.screenshot({ path: join(output, 'observed-before.png') });
  await page.getByText('绑定作品图片', { exact: true }).click();
  for (const [slot, file] of [
    ['tile.face', 'generated-tile'],
    ['board.atlas', 'generated-atlas'],
  ]) {
    const identity = page.getByText('素材字节和规范化工程身份已核验：', { exact: false }),
      previous = await identity.textContent();
    await page.getByLabel('作品图片槽').selectOption(slot);
    await page.getByLabel('作品图片文件').setInputFiles(join(output, `${file}.png`));
    await page.getByRole('button', { name: '核验并绑定图片' }).click();
    await page.waitForFunction(
      (old) =>
        Array.from(document.querySelectorAll('p')).some(
          (p) =>
            p.textContent?.includes('素材字节和规范化工程身份已核验：') && p.textContent !== old,
        ),
      previous,
    );
    await readyCalibrated();
    await canvas.screenshot({
      path: join(output, slot === 'tile.face' ? 'observed-face.png' : 'observed-atlas.png'),
    });
  }
  await save(page.getByRole('button', { name: '保存作品', exact: true }), 'observed.json');
  const original = JSON.parse(await readFile(synthetic.workPath, 'utf8')),
    observed = JSON.parse(await readFile(join(output, 'observed.json'), 'utf8'));
  assert.deepEqual(observed.project.takes, original.project.takes);
  assert.deepEqual(observed.pointer.tracks, original.pointer.tracks);
  assert.deepEqual(
    observed.project.direction.production.audio,
    original.project.direction.production.audio,
  );
  assert.deepEqual(observed.source.observation, original.source.observation);
  await page.getByRole('button', { name: '返回工作台' }).click();
  await openWork(join(output, 'observed.json'));
  await page.getByRole('button', { name: '使用当前校准渲染器测试' }).click();
  await readyCalibrated();
  await phase('observed-preview');
  await page.getByRole('button', { name: '播放校准预览' }).click();
  await page.getByRole('button', { name: '暂停校准预览' }).waitFor();
  await page.waitForTimeout(1000);
  const observedFrame = Number(await page.getByLabel('校准预览帧').inputValue());
  assert.ok(observedFrame > 0);
  await page.getByRole('button', { name: '暂停校准预览' }).click();
  const observedStale = [];
  const watchObserved = (download) => {
    if (download.suggestedFilename().endsWith('.mp4'))
      observedStale.push(download.suggestedFilename());
  };
  page.on('download', watchObserved);
  await phase('observed-aborted-export');
  await page.getByRole('button', { name: '导出校准测试视频' }).click();
  await page.getByRole('button', { name: '返回工作台' }).click();
  await page.waitForTimeout(1500);
  assert.deepEqual(observedStale, [], 'closing the work must cancel an observed export');
  page.off('download', watchObserved);
  await openWork(join(output, 'observed.json'));
  await page.getByRole('button', { name: '使用当前校准渲染器测试' }).click();
  await readyCalibrated();
  await phase('observed-export');
  await save(page.getByRole('button', { name: '导出校准测试视频' }), 'observed.mp4');
  await page.getByText('视频质量', { exact: true }).click();
  await page.getByLabel('BB 视频质量').selectOption('standard');
  await page.waitForFunction(() => {
    const select = document.querySelector('select[aria-label="BB 视频质量"]');
    return select?.value === 'standard' && !select.disabled;
  });
  await readyCalibrated();
  await phase('observed-standard-export');
  await save(page.getByRole('button', { name: '导出校准测试视频' }), 'observed-standard.mp4');
  await page.getByLabel('BB 视频质量').selectOption('preview');
  await page.waitForFunction(() => {
    const select = document.querySelector('select[aria-label="BB 视频质量"]');
    return select?.value === 'preview' && !select.disabled;
  });
  await save(
    page.getByRole('button', { name: '保存作品', exact: true }),
    'observed-after-quality.json',
  );
  const afterQuality = JSON.parse(
    await readFile(join(output, 'observed-after-quality.json'), 'utf8'),
  );
  assert.deepEqual(afterQuality.project, observed.project);
  assert.deepEqual(afterQuality.pointer.tracks, observed.pointer.tracks);
  // Restore an existing synthetic observation inside the active BB session,
  // rebuild it, and explicitly save the current work before opening the result.
  // This is a saved-observation round trip, not a blank manual annotation.
  await page.getByText('参考视频观察记录', { exact: true }).click();
  await page.getByLabel('选择参考视频').setInputFiles(synthetic.video);
  await page.getByLabel('重开观察记录').waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="重开观察记录"]');
    return input && !input.disabled;
  });
  await page.getByLabel('重开观察记录').setInputFiles(synthetic.workPath);
  await page.getByText('已恢复当前作品', { exact: false }).waitFor({ timeout: 30000 });
  await save(
    page.getByRole('button', { name: '校验并另存校准工程' }),
    'observation-generated.json',
  );
  await page.getByRole('button', { name: '打开刚生成的观察作品', exact: true }).click();
  await page.getByText('bb-observed-work.json', { exact: true }).waitFor();
  const generated = JSON.parse(await readFile(join(output, 'observation-generated.json'), 'utf8'));
  assert.equal(generated.source.link.source.sha256, synthetic.hash);
  assert.ok(
    generated.pointer && generated.project.takes.length > 0,
    'observation rebuild must preserve its pointer and takes',
  );
  await page.getByRole('button', { name: '返回工作台' }).click();
  await writeFile(join(output, 'raw-bb.json'), JSON.stringify(current.project));
  await openWork(join(output, 'raw-bb.json'));
  await page.getByText('BB 创作与试玩').waitFor();
  await save(page.getByRole('button', { name: '保存作品', exact: true }), 'wrapped-bb.json');
  const wrapped = JSON.parse(await readFile(join(output, 'wrapped-bb.json'), 'utf8'));
  assert.equal(wrapped.format, 'bcs-bb-work');
  assert.deepEqual(
    wrapped.project,
    current.project,
    'raw BB project must enter the same work session without losing fields',
  );
  await page.getByRole('button', { name: '返回工作台' }).click();
  await openWork(join(output, 'multi-calibration.json'));
  await page.getByRole('button', { name: '使用当前校准渲染器测试' }).click();
  await readyCalibrated();
  for (const [take, name] of [
    ['synthetic-take', 'first'],
    ['synthetic-alternate', 'alternate'],
  ]) {
    await page.getByLabel('V2 校准 Take').selectOption(take);
    await readyCalibrated();
    assert.equal(await page.getByLabel('创作 Take').inputValue(), take);
    await page.getByLabel('校准预览帧').fill('250');
    await phase(`multi-${name}`);
    await save(page.getByRole('button', { name: '导出校准测试视频' }), `multi-${name}.mp4`);
  }
  await save(
    page.getByRole('button', { name: '保存作品', exact: true }),
    'multi-observed-work.json',
  );
  assert.deepEqual(errors, []);
  const probe = await page.evaluate(() => globalThis.__bbProbe.events);
  const multiFirst = probe.find(
    (item) =>
      item.phase === 'multi-first' &&
      item.kind === 'frame' &&
      item.takeId === 'synthetic-take' &&
      item.frame === 250,
  );
  const multiAlternate = probe.find(
    (item) =>
      item.phase === 'multi-alternate' &&
      item.kind === 'frame' &&
      item.takeId === 'synthetic-alternate' &&
      item.frame === 250,
  );
  assert.ok(
    multiFirst && multiAlternate && multiFirst.stateHash !== multiAlternate.stateHash,
    'each observed Take must render its own state',
  );
  for (const [phaseName, take] of [
    ['multi-first', 'synthetic-take'],
    ['multi-alternate', 'synthetic-alternate'],
  ]) {
    assert.ok(
      probe.some(
        (item) =>
          item.phase === phaseName && item.kind === 'bb-scene' && item.takeId === take && item.drag,
      ),
      `${take} must use the common scene`,
    );
  }
  for (const [phaseName, sceneKind] of [
    ['three-standard-export', 'bb-three'],
    ['observed-standard-export', 'bb-scene'],
  ]) {
    const encoder = probe.find((item) => item.phase === phaseName && item.kind === 'video-encoder');
    assert.equal(
      encoder?.bitrate,
      14000000,
      `${phaseName} must pass the selected bitrate to the encoder`,
    );
    const scaled = probe.filter(
      (item) =>
        item.phase === phaseName &&
        item.kind === sceneKind &&
        Math.abs(item.canvasWidth / encoder.width - 1.35) < 0.01 &&
        Math.abs(item.canvasHeight / encoder.height - 1.35) < 0.01,
    );
    assert.equal(
      new Set(scaled.map((item) => item.frame)).size,
      encoder.totalFrames,
      `${phaseName} must draw every frame at the selected sampling scale`,
    );
  }
  const threeDraws = probe.filter(
    (item) => item.phase === 'three-export' && item.kind === 'bb-three',
  );
  const threeFrames = probe.filter(
    (item) => item.phase === 'three-export' && item.kind === 'frame' && item.takeId === 'machine',
  );
  assert.ok(
    new Set(threeDraws.map((item) => item.frame)).size === 198,
    '3D export must draw each selected Take frame',
  );
  for (const draw of threeDraws) {
    const sampled = threeFrames.find((item) => item.frame === draw.frame);
    assert.ok(
      sampled && sampled.stateHash === draw.stateHash && sampled.actionId === draw.actionId,
      '3D must project the common frame identity and state',
    );
  }
  const probeSummary = [];
  for (const [label, take, appearance] of [
    ['human-drag-preview', 'human-drag', 'authored'],
    ['human-drag-export', 'human-drag', 'authored'],
    ['machine-preview', 'machine', 'authored'],
    ['machine-export', 'machine', 'authored'],
    ['observed-preview', 'observed-take', 'observed'],
    ['observed-export', 'observed-take', 'observed'],
  ]) {
    const entries = probe.filter((item) => item.phase === label),
      frames = entries.filter((item) => item.kind === 'frame' && item.takeId === take),
      draws = entries.filter((item) => item.kind === 'bb-scene' && item.appearance === appearance);
    assert.ok(
      frames.length > 0 && draws.length > 0,
      `missing runtime evaluator or scene calls for ${label}`,
    );
    assert.ok(
      frames.every((item) => typeof item.stateHash === 'string' && typeof item.board === 'string'),
    );
    if (label.endsWith('-export')) {
      assert.ok(
        frames.some((item) => item.drag),
        `missing drag frames for ${label}`,
      );
      assert.ok(
        draws.some((item) => item.clear),
        `missing clear rendering for ${label}`,
      );
    }
    probeSummary.push({
      phase: label,
      take,
      evaluations: frames.length,
      scene: 'BBScene2D',
      appearance,
      draws: draws.length,
      drag: frames.some((item) => item.drag),
      clearDrawn: draws.some((item) => item.clear),
    });
  }
  const humanDraw = probe.find(
    (item) => item.phase === 'human-drag-export' && item.kind === 'bb-scene' && item.dragPose,
  );
  assert.ok(humanDraw, 'missing human drag geometry in the actual renderer');
  const sampled = probe.find(
    (item) =>
      item.phase === 'human-drag-export' &&
      item.kind === 'frame' &&
      item.frame === humanDraw.frame &&
      item.takeId === 'human-drag',
  );
  assert.deepEqual(
    humanDraw.dragPose,
    sampled?.dragPose,
    'renderer must consume the evaluated drag pose',
  );
  assert.ok(
    Math.abs(humanDraw.dragPose.x - firstPoint.x * 1064) < 0.1 &&
      Math.abs(humanDraw.dragPose.y - firstPoint.y * 1788) < 0.1,
    'first rendered drag pose must match the recorded design-canvas pickup',
  );
  const verify = (script, work, video, take) =>
    JSON.parse(
      execFileSync(process.execPath, [script, join(output, work), join(output, video), take], {
        encoding: 'utf8',
        maxBuffer: 4_000_000,
      }),
    );
  const audioChecks = {
    human: verify(
      'scripts/verify-native-work-audio.mjs',
      'author-current.json',
      'human-drag.mp4',
      'human-drag',
    ),
    machine: verify(
      'scripts/verify-native-work-audio.mjs',
      'author-current.json',
      'machine.mp4',
      'machine',
    ),
    observedFirst: verify(
      'scripts/verify-native-work-audio.mjs',
      'multi-observed-work.json',
      'multi-first.mp4',
      'synthetic-take',
    ),
    observedAlternate: verify(
      'scripts/verify-native-work-audio.mjs',
      'multi-observed-work.json',
      'multi-alternate.mp4',
      'synthetic-alternate',
    ),
    synthetic: verify(
      'scripts/verify-bb-synthetic-audio.mjs',
      'three-work.json',
      'synthetic-test.mp4',
      'human-drag',
    ),
  };
  for (const name of ['human', 'machine', 'observedFirst', 'observedAlternate'])
    assert.ok(
      audioChecks[name].events.some(
        (event) => event.id.includes('placement') || event.id.includes('commit'),
      ) &&
        audioChecks[name].events.some(
          (event) =>
            event.id.includes('clear') || event.id.includes('line') || event.id.includes('cross'),
        ),
      `${name} must contain independently verified placement and clear cues`,
    );
  console.log(
    JSON.stringify(
      {
        browser: browser.version(),
        viewportWidth: width,
        deviceScaleFactor,
        output,
        humanFrames: human.interactions[0].endFrame - human.interactions[0].startFrame,
        humanSamples: human.interactions[0].samples.length,
        advances,
        observedFrame,
        threeExportFrames: new Set(threeDraws.map((item) => item.frame)).size,
        multiTake: { firstHash: multiFirst.stateHash, alternateHash: multiAlternate.stateHash },
        legacyWorkbenchRenders: legacyBefore,
        probe: probeSummary,
        audioChecks,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await server.close();
}
