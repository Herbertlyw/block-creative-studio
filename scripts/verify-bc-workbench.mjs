import { chromeOptions } from './fixtures/chrome.mjs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { syntheticPng, syntheticWav } from './fixtures/syntheticMedia.mjs';

await mkdir('outputs', { recursive: true });
const output = process.env.BC_OUTPUT_DIR
  ? resolve(process.env.BC_OUTPUT_DIR)
  : await mkdtemp(resolve('outputs/bc-browser-'));
await mkdir(output, { recursive: true });
for (const [name, color] of [
  ['background', [35, 64, 95]],
  ['material', [190, 135, 65]],
])
  await writeFile(join(output, `${name}.png`), syntheticPng(color, 64, 64));
await writeFile(join(output, 'music.wav'), syntheticWav(220, 2));
const server = await createServer({
  cacheDir: join(output, 'vite-cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ ...chromeOptions(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({
    viewport: { width: 1360, height: 1000 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/#bc`);
  const canvas = page.getByLabel('BC 视频画面');
  const ready = async () => {
    await page.waitForFunction(() => document.querySelector('canvas[data-ready="true"]'));
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await page.getByRole('alert').count(), 0);
  };
  const digest = () =>
    canvas.evaluate(async (surface) => {
      const bytes = surface.getContext('2d').getImageData(0, 0, surface.width, surface.height).data;
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    });
  const changed = async (before) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      if ((await canvas.getAttribute('data-ready')) === 'true' && (await digest()) !== before) {
        await page.evaluate(() => new Promise(requestAnimationFrame));
        return digest();
      }
      const alerts = await page.getByRole('alert').allTextContents();
      if (alerts.length) throw new Error(alerts.join('\n'));
      await page.waitForTimeout(100);
    }
    throw new Error('修改没有进入实际画面。');
  };
  const save = async (button, name) => {
    const download = page.waitForEvent('download', { timeout: 180_000 });
    await button.click();
    await (await download).saveAs(join(output, name));
  };
  const seek = async (frame) => {
    await page.getByLabel('BC 时间线').fill(String(frame));
    await page.getByLabel('BC 时间线').dispatchEvent('input');
    await page.waitForFunction(
      (value) => document.querySelector('canvas')?.dataset.frame === String(value),
      frame,
    );
    await page.evaluate(() => new Promise(requestAnimationFrame));
  };
  await page.getByRole('button', { name: '打开落消示例', exact: true }).click();
  await ready();
  await seek(38);
  await page.screenshot({ path: join(output, 'workbench.png'), fullPage: true });
  await save(page.getByRole('button', { name: /保存 JSON/ }), 'before.json');
  const original = JSON.parse(await readFile(join(output, 'before.json'), 'utf8'));
  const hashes = { initial: await digest() };
  await page.getByLabel('BC 颜色 1', { exact: true }).fill('#df8470');
  await page.getByRole('button', { name: '应用配色', exact: true }).click();
  hashes.colour = await changed(hashes.initial);
  await page.getByLabel('BC 材质', { exact: true }).selectOption('ice');
  hashes.material = await changed(hashes.colour);
  await page.getByLabel('BC 背景图片').setInputFiles(join(output, 'background.png'));
  hashes.background = await changed(hashes.material);
  await page.getByLabel('BC 牌面图片').setInputFiles(join(output, 'material.png'));
  hashes.image = await changed(hashes.background);
  await page.getByLabel('BC 背景音乐').setInputFiles(join(output, 'music.wav'));
  await page.waitForTimeout(250);
  await ready();
  await save(page.getByRole('button', { name: /保存 JSON/ }), 'variant.json');
  const variant = JSON.parse(await readFile(join(output, 'variant.json'), 'utf8'));
  const takeContent = (takes) => takes.map(({ initialStateHash, ...content }) => content);
  assert.deepEqual(
    takeContent(variant.takes),
    takeContent(original.takes),
    '外观编辑不得改动动作和交互；颜色对应的初态哈希正常重算',
  );
  assert.deepEqual(
    variant.direction.production.audio.cues,
    original.direction.production.audio.cues,
  );
  await page
    .locator('input[accept="application/json,.json"]')
    .setInputFiles(join(output, 'variant.json'));
  await ready();
  await seek(38);
  assert.equal(await digest(), hashes.image, '保存重开后的实际画面应保持一致');
  await canvas.screenshot({ path: join(output, 'variant-clear.png') });
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector('canvas')?.dataset.frame) > 43);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await save(page.getByRole('button', { name: '导出当前范围 MP4', exact: true }), 'variant.mp4');
  if (process.env.BC_REAL_PROJECT) {
    await page
      .locator('input[accept="application/json,.json"]')
      .setInputFiles(resolve(process.env.BC_REAL_PROJECT));
    await ready();
    await seek(40);
    await canvas.screenshot({ path: join(output, 'real-clear.png') });
    await save(page.getByRole('button', { name: '导出当前范围 MP4', exact: true }), 'real.mp4');
  }
  const sequenceProject = await page.evaluate(async (base) => {
    const { makeClearSequenceEffect } = await import(
      '/src/nativeReference/games/block-crush-drop/presentation/clearSequence.ts'
    );
    const { sha256Hex } = await import('/src/nativeReference/agent-assets/image.ts');
    const { stableHash } = await import('/src/nativeReference/headless/stableHash.ts');
    const { compileBCPlayback } = await import('/src/games/block-crush/timeline.ts');
    const surface = document.createElement('canvas');
    surface.width = 1080;
    surface.height = 1920;
    const context = surface.getContext('2d');
    const bytes = [],
      frames = [];
    for (const colour of ['#f39d54', '#f5c470']) {
      context.clearRect(0, 0, 1080, 1920);
      context.fillStyle = colour;
      context.beginPath();
      context.arc(540, 1350, 120, 0, Math.PI * 2);
      context.fill();
      const data = surface.toDataURL('image/png').split(',')[1];
      const payload = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      bytes.push(payload);
      frames.push({ data, sha256: await sha256Hex(payload), byteLength: payload.length });
    }
    const ordered = new Uint8Array(bytes[0].length + bytes[1].length);
    ordered.set(bytes[0]);
    ordered.set(bytes[1], bytes[0].length);
    const id = 'synthetic-clear-sequence';
    base.direction.style.agentAssets = {
      version: '1.0.0',
      bindings: {},
      entries: {
        [id]: {
          id,
          kind: 'sequence',
          sourceName: 'synthetic.png',
          mimeType: 'image/png',
          encoding: 'base64',
          width: 1080,
          height: 1920,
          fps: 4,
          frames,
          byteLength: ordered.length,
          sha256: await sha256Hex(ordered),
        },
      },
    };
    base.direction.style.clearEffectLibrary = {
      version: '1.0.0',
      effects: [makeClearSequenceEffect('synthetic-clear', { assetId: id })],
      bindings: [{ effectId: 'synthetic-clear', takeId: 'demo', actionIndex: 0 }],
    };
    const source = compileBCPlayback(base, 'demo', true).source;
    base.direction.production.clips = [
      {
        id: 'review',
        takeId: 'demo',
        startFrame: 0,
        endFrame: 59,
        source: { takeHash: stableHash(base.takes[0]), frameSourceHash: source.frameSourceHash },
      },
    ];
    base.direction.production.selectedClipId = 'review';
    return base;
  }, structuredClone(original));
  await writeFile(join(output, 'sequence.json'), JSON.stringify(sequenceProject, null, 2));
  await page
    .locator('input[accept="application/json,.json"]')
    .setInputFiles(join(output, 'before.json'));
  await ready();
  await seek(0);
  const beforeEvent = await digest();
  await page
    .locator('input[accept="application/json,.json"]')
    .setInputFiles(join(output, 'sequence.json'));
  await ready();
  await seek(0);
  assert.equal(await digest(), beforeEvent, '序列不能提前遮挡正常画面');
  await seek(38);
  assert.notEqual(await digest(), hashes.initial, '透明序列应进入实际消除画面');
  await canvas.screenshot({ path: join(output, 'sequence-clear.png') });
  await save(page.getByRole('button', { name: '导出当前范围 MP4', exact: true }), 'sequence.mp4');
  const corrupt = structuredClone(sequenceProject);
  corrupt.direction.style.agentAssets.entries['synthetic-clear-sequence'].frames[1].sha256 =
    '0'.repeat(64);
  await writeFile(join(output, 'corrupt-sequence.json'), JSON.stringify(corrupt));
  await page
    .locator('input[accept="application/json,.json"]')
    .setInputFiles(join(output, 'corrupt-sequence.json'));
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').textContent(), /SHA256|HASH/);
  assert.equal(
    await page.getByRole('button', { name: '导出当前范围 MP4', exact: true }).isDisabled(),
    true,
  );
  await page
    .locator('input[accept="application/json,.json"]')
    .setInputFiles(join(output, 'sequence.json'));
  await ready();
  for (const name of ['variant', 'sequence', ...(process.env.BC_REAL_PROJECT ? ['real'] : [])]) {
    const video = join(output, `${name}.mp4`);
    execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-f', 'null', '-'], { stdio: 'pipe' });
    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video],
        { encoding: 'utf8' },
      ),
    );
    assert.ok(probe.streams.some((s) => s.codec_name === 'h264'));
    assert.ok(probe.streams.some((s) => s.codec_name === 'aac'));
    await writeFile(join(output, `${name}-probe.json`), JSON.stringify(probe, null, 2));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, 'mobile.png'), fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    '手机视口不得横向溢出',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      {
        hashes,
        errors,
        output,
        checks: [
          'colour',
          'material',
          'background',
          'image',
          'wav',
          'save-reopen',
          'play',
          'encode',
          'independent-decode',
          'mobile',
        ],
      },
      null,
      2,
    ),
  );
  console.log(`BC 展示流程通过：${output}`);
} finally {
  await browser?.close();
  await server.close();
}
