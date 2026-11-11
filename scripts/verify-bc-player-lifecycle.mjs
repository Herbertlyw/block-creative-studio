import { chromeOptions } from './fixtures/chrome.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { syntheticPng } from './fixtures/syntheticMedia.mjs';

// Test-only module boundaries let us release encoder/audio promises out of order.
// The React hook, scenes, project compilation and normal audio mixing remain real.
const harness = `
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useBCPlayer } from '/src/games/block-crush/useBCPlayer.ts';
import { createBCDemo } from '/src/games/block-crush/demo.ts';
globalThis.bcTest = { exports: [], mixes: [] };
function Player() {
 const [project, setProject] = useState(createBCDemo);
 const player = useBCPlayer(project, 'demo', true);
 Object.assign(globalThis.bcTest, { player, project, setProject });
 return createElement('canvas', { ref: player.canvas });
}
const host = document.createElement('div'); document.body.append(host);
const root = createRoot(host); globalThis.bcTest.unmount = () => root.unmount();
root.render(createElement(Player));
`;
await mkdir('outputs', { recursive: true });
const output = process.env.BC_OUTPUT_DIR
  ? resolve(process.env.BC_OUTPUT_DIR)
  : await mkdtemp(resolve('outputs/bc-player-lifecycle-'));
await mkdir(output, { recursive: true });
const server = await createServer({
  cacheDir: join(output, 'lifecycle-vite-cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
  plugins: [
    {
      name: 'bc-player-test-boundaries',
      enforce: 'pre',
      resolveId(id, importer) {
        if (id === '/__bc_player_harness.mjs') return id;
        if (importer?.endsWith('/useBCPlayer.ts')) {
          if (id === '../../exporter/exportFrameVideo') return '\0bc-test-encoder';
          if (id === './timeline') return '\0bc-test-timeline';
        }
      },
      load(id) {
        if (id === '/__bc_player_harness.mjs') return harness;
        if (id === '\0bc-test-encoder')
          return `export function exportFrameVideo(options) {
        return new Promise((resolve, reject) => globalThis.bcTest.exports.push({ options, resolve, reject }));
      }`;
        if (id === '\0bc-test-timeline')
          return `
        export { compileBCPlayback, prepareBCScene } from '/src/games/block-crush/timeline.ts';
        import { mixBCAudio as realMix } from '/src/games/block-crush/timeline.ts';
        export async function mixBCAudio(playback) {
          if (globalThis.bcTest.holdMix) await new Promise((resolve, reject) => globalThis.bcTest.mixes.push({resolve, reject}));
          return realMix(playback);
        }`;
      },
    },
  ],
});
let browser, page;
const checks = [];
const errors = [],
  downloads = [];
try {
  await server.listen();
  const transformed = await server.transformRequest('/src/games/block-crush/useBCPlayer.ts');
  assert.match(
    transformed.code,
    /bc-test-encoder/,
    'test must intercept the encoder before running',
  );
  assert.match(
    transformed.code,
    /bc-test-timeline/,
    'test must intercept audio preparation before running',
  );
  browser = await chromium.launch({ ...chromeOptions(), headless: true });
  page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.evaluate(() => import('/__bc_player_harness.mjs'));
  await page.waitForFunction(() => globalThis.bcTest?.player.ready);
  const snapshot = () =>
    page.evaluate(() => {
      const { ready, exporting, error, exportError, progress, frame, playing } = bcTest.player;
      return { ready, exporting, error, exportError, progress, frame, playing };
    });
  const attempt = async (count) => {
    await page.evaluate(() => {
      void bcTest.player.exportVideo();
    });
    await page.waitForFunction((n) => bcTest.exports.length === n, count);
  };
  await page.evaluate(() => {
    void bcTest.player.exportVideo();
    void bcTest.player.exportVideo();
  });
  await page.waitForFunction(() => bcTest.exports.length === 1);
  await page.evaluate(() =>
    bcTest.exports[0].reject(new DOMException('synthetic encoder unavailable', 'AbortError')),
  );
  await page.waitForFunction(
    () =>
      !bcTest.player.exporting &&
      bcTest.player.exportError.includes('synthetic encoder unavailable'),
  );
  assert.equal((await snapshot()).error, '');
  assert.equal(
    (await snapshot()).progress.includes('已取消'),
    false,
    'an unrelated AbortError is not a user cancellation',
  );
  checks.push('duplicate synchronous exports produce one attempt; encoder failure permits retry');

  await attempt(2);
  await page.evaluate(() => {
    bcTest.player.cancelExport();
    bcTest.exports[1].reject(new DOMException('cancelled', 'AbortError'));
  });
  await page.waitForFunction(
    () => bcTest.player.progress.includes('已取消') && !bcTest.player.exporting,
  );
  assert.equal((await snapshot()).error, '');
  assert.equal((await snapshot()).exportError, '');
  checks.push('cancel clears only the active export and leaves the project valid');

  await attempt(3);
  await page.evaluate(() => bcTest.setProject({ ...bcTest.project, name: 'replacement project' }));
  await page.waitForFunction(() => bcTest.player.ready && !bcTest.player.exporting);
  assert.equal(await page.evaluate(() => bcTest.exports[2].options.signal.aborted), true);
  await attempt(4);
  await page.evaluate(() => {
    bcTest.exports[2].options.onProgress(99, 100);
    bcTest.exports[2].reject(new Error('stale encoder failure'));
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal((await snapshot()).exporting, true);
  assert.equal((await snapshot()).error, '');
  assert.equal((await snapshot()).exportError, '');
  assert.equal((await snapshot()).progress, '音频混音…');
  await page.evaluate(() => {
    bcTest.player.cancelExport();
    bcTest.exports[3].reject(new DOMException('cancelled', 'AbortError'));
  });
  await page.waitForFunction(() => !bcTest.player.exporting);
  checks.push(
    'replaced project aborts the old encoder; late progress/error/finally cannot touch the new attempt',
  );

  // Cancel during async audio preparation: do not even call the encoder afterward.
  await page.evaluate(() => {
    bcTest.holdMix = true;
    void bcTest.player.exportVideo();
  });
  await page.waitForFunction(() => bcTest.mixes.length === 1);
  await page.evaluate(() => {
    bcTest.player.cancelExport();
    bcTest.mixes[0].resolve();
  });
  await page.waitForFunction(() => !bcTest.player.exporting);
  assert.equal(await page.evaluate(() => bcTest.exports.length), 4);
  assert.equal((await snapshot()).error, '');
  checks.push('cancellation during preparation never starts an encoder');

  // A rejected old preview mix must not mark a replacement project as broken.
  await page.evaluate(() => {
    const NativeAudioContext = window.AudioContext;
    bcTest.contexts = [];
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        bcTest.contexts.push(this);
      }
    };
    void bcTest.player.play();
  });
  await page.waitForFunction(() => bcTest.mixes.length === 2);
  await page.evaluate(() => bcTest.setProject({ ...bcTest.project, name: 'new preview' }));
  await page.waitForFunction(() => bcTest.player.ready);
  assert.equal(
    await page.evaluate(() => bcTest.contexts[0].state),
    'closed',
    'project switch must release a still-preparing preview context',
  );
  await page.evaluate(() => bcTest.mixes[1].reject(new Error('stale preview failure')));
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal((await snapshot()).error, '');
  assert.equal((await snapshot()).playing, false);
  checks.push('old preview failure cannot poison a replacement project');

  // Closing an unused context is also asynchronous for a silent project.
  await page.evaluate(() => {
    bcTest.holdMix = false;
    bcTest.holdClose = true;
    bcTest.closes = [];
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      close() {
        const closed = super.close();
        return bcTest.holdClose
          ? closed.then(() => new Promise((resolve) => bcTest.closes.push(resolve)))
          : closed;
      }
    };
    const silent = structuredClone(bcTest.project);
    delete silent.direction.production.audio;
    bcTest.setProject(silent);
  });
  await page.waitForFunction(() => bcTest.player.ready);
  await page.evaluate(() => {
    void bcTest.player.play();
  });
  await page.waitForFunction(() => bcTest.closes.length === 1);
  await page.evaluate(async () => {
    const { createBCDemo } = await import('/src/games/block-crush/demo.ts');
    bcTest.setProject(createBCDemo());
  });
  await page.waitForFunction(() => bcTest.player.ready);
  await page.evaluate(() => {
    bcTest.holdClose = false;
    bcTest.closes[0]();
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(
    (await snapshot()).playing,
    false,
    'late silent preview completion must not start the replacement project',
  );
  checks.push('late silent-preview completion cannot start a replacement project');

  await page.evaluate(
    async (png) => {
      const { imageAsset } = await import('/src/games/block-crush/assets.ts');
      const { changeBCImage } = await import('/src/games/block-crush/editing.ts');
      const asset = await imageAsset(
        Uint8Array.from(atob(png), (ch) => ch.charCodeAt(0)),
        'bad-background',
        'synthetic.png',
      );
      asset.sha256 = '0'.repeat(64);
      bcTest.setProject(changeBCImage(bcTest.project, 'world.background', asset));
    },
    syntheticPng([20, 80, 120]).toString('base64'),
  );
  await page.waitForFunction(() => /AGENT_ASSET_RUNTIME_SHA256_MISMATCH/.test(bcTest.player.error));
  assert.equal((await snapshot()).ready, false);
  await page.evaluate(() => {
    void bcTest.player.exportVideo();
  });
  assert.equal(await page.evaluate(() => bcTest.exports.length), 4);
  checks.push('genuine image hash mismatch blocks preparation and never reaches the encoder');
  await page.evaluate(async () => {
    const { createBCDemo } = await import('/src/games/block-crush/demo.ts');
    bcTest.setProject(createBCDemo());
  });
  await page.waitForFunction(() => bcTest.player.ready);

  await page.evaluate(() => {
    bcTest.holdMix = false;
  });
  await attempt(5);
  await page.evaluate(() => {
    const attempt = bcTest.exports[4];
    try {
      attempt.options.render(attempt.options.totalFrames);
    } catch (error) {
      attempt.reject(error);
    }
  });
  await page.waitForFunction(
    () => !bcTest.player.exporting && bcTest.player.error.includes('预览帧越界'),
  );
  await page.evaluate(() => {
    void bcTest.player.exportVideo();
  });
  assert.equal(await page.evaluate(() => bcTest.exports.length), 5);
  checks.push(
    'a real renderer exception remains blocking rather than becoming a retryable encoder error',
  );
  await page.evaluate(() => bcTest.setProject({ ...bcTest.project, name: 'recovered project' }));
  await page.waitForFunction(() => bcTest.player.ready && !bcTest.player.error);
  await page.evaluate(() => {
    void bcTest.player.play();
  });
  await page.waitForFunction(() => bcTest.player.playing);
  await attempt(6);
  await page.waitForFunction(() => bcTest.contexts.at(-1).state === 'closed');
  assert.equal((await snapshot()).playing, false);
  checks.push('starting export stops and releases the active preview audio');
  await page.evaluate(() => bcTest.unmount());
  assert.equal(await page.evaluate(() => bcTest.exports[5].options.signal.aborted), true);
  await page.evaluate(() => {
    bcTest.exports[5].options.onProgress(1, 1);
    bcTest.exports[5].resolve(new Blob(['must not download']));
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.deepEqual(downloads, []);
  assert.deepEqual(errors, []);
  checks.push('unmount aborts export and discards a late successful result without downloading');
  await writeFile(
    join(output, 'lifecycle-result.json'),
    JSON.stringify({ passed: true, checks }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} catch (error) {
  console.error({
    checks,
    errors,
    snapshot: await page?.evaluate(() => {
      const t = globalThis.bcTest,
        p = t?.player;
      return {
        exports: t?.exports.length,
        mixes: t?.mixes.length,
        error: p?.error,
        exportError: p?.exportError,
        ready: p?.ready,
        exporting: p?.exporting,
      };
    }),
  });
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
