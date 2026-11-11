import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { chromeOptions } from './fixtures/chrome.mjs';

// Only the encoder and asynchronous preparation boundary are deferred. This
// checks hook ownership and disposal, not actual AVC/AAC output (separate test).
const harness = `
import { createElement, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useBBTimelinePlayer } from '/src/components/useBBTimelinePlayer.ts';
globalThis.bbTest = { exports: [], mixes: [], disposals: [], published: [] };
function Player() {
  const [revision, setRevision] = useState(0);
  const config = useMemo(() => ({
    source: { gameId: 'block-placement', takeId: 'test', fps: 30, totalFrames: 90 },
    output: { width: 512, height: 864 }, preview: { width: 256, height: 432 },
    quality: { bitrate: 8000000, scale: 1 }, audioEnabled: false,
    async audio(signal) {
      if (bbTest.holdMix) await new Promise(resolve => bbTest.mixes.push({resolve, signal}));
      return null;
    },
    async createStage(canvas, width, height, purpose) {
      canvas.width = width; canvas.height = height;
      return { draw() {}, dispose() { bbTest.disposals.push({revision, purpose}); } };
    }
  }), [revision]);
  const player = useBBTimelinePlayer(config);
  const run = () => player.exportVideo().then(result => { if(result?.isCurrent()) bbTest.published.push(revision); });
  Object.assign(bbTest, { player, setRevision, run });
  return createElement('canvas', { ref: player.canvas });
}
const host = document.createElement('div'); document.body.append(host);
const root = createRoot(host); bbTest.unmount = () => root.unmount();
root.render(createElement(Player));
`;
await mkdir('outputs', { recursive: true });
const output = await mkdtemp(resolve('outputs/bb-export-lifecycle-'));
const server = await createServer({
  cacheDir: join(output, 'vite-cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
  plugins: [
    {
      name: 'bb-export-test-boundaries',
      enforce: 'pre',
      resolveId(id, importer) {
        if (id === '/__bb_export_harness.mjs') return id;
        if (importer?.endsWith('/useBBTimelinePlayer.ts') && id === '../exporter/exportFrameVideo')
          return '\0bb-test-encoder';
      },
      load(id) {
        if (id === '/__bb_export_harness.mjs') return harness;
        if (id === '\0bb-test-encoder')
          return `export function exportFrameVideo(options) {
      return new Promise((resolve, reject) => bbTest.exports.push({options, resolve, reject}));
    }`;
      },
    },
  ],
});
let browser, page;
const checks = [],
  errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ ...chromeOptions(), headless: true });
  page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.evaluate(() => import('/__bb_export_harness.mjs'));
  await page.waitForFunction(() => bbTest.player.ready);
  await page.evaluate(() => {
    void bbTest.run();
    void bbTest.run();
  });
  await page.waitForFunction(() => bbTest.exports.length === 1);
  await page.evaluate(() =>
    bbTest.exports[0].reject(new DOMException('synthetic encoder stopped', 'AbortError')),
  );
  await page.waitForFunction(
    () => !bbTest.player.exporting && bbTest.player.status.includes('synthetic encoder stopped'),
  );
  assert.equal(await page.evaluate(() => bbTest.published.length), 0);
  checks.push(
    'duplicate synchronous exports start one encoder; unrelated AbortError reports failure and permits retry',
  );
  await page.evaluate(() => {
    void bbTest.run();
  });
  await page.waitForFunction(() => bbTest.exports.length === 2);
  await page.evaluate(() => {
    bbTest.player.cancelExport();
    bbTest.exports[1].resolve(new Blob(['partial']));
  });
  await page.waitForFunction(
    () => !bbTest.player.exporting && bbTest.player.status.includes('已取消'),
  );
  assert.equal(await page.evaluate(() => bbTest.published.length), 0);
  await page.evaluate(() => {
    void bbTest.run();
  });
  await page.waitForFunction(() => bbTest.exports.length === 3);
  await page.evaluate(() => bbTest.setRevision(1));
  await page.waitForFunction(() => bbTest.player.ready && !bbTest.player.exporting);
  assert.equal(await page.evaluate(() => bbTest.exports[2].options.signal.aborted), true);
  await page.evaluate(() => {
    void bbTest.run();
  });
  await page.waitForFunction(() => bbTest.exports.length === 4);
  await page.evaluate(() => {
    bbTest.exports[2].options.onPhase('muxing');
    bbTest.exports[2].options.onProgress(89, 90);
    bbTest.exports[2].reject(new Error('stale failure'));
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.evaluate(() => bbTest.player.exporting), true);
  assert.equal(await page.evaluate(() => bbTest.player.status.includes('stale failure')), false);
  await page.evaluate(() => bbTest.exports[3].resolve(new Blob(['complete'])));
  await page.waitForFunction(() => !bbTest.player.exporting && bbTest.published.length === 1);
  assert.equal(await page.evaluate(() => bbTest.published[0]), 1);
  checks.push(
    'cancelled partial output withheld; changed project aborts old task; stale progress/error/finally cannot touch retry',
  );
  await page.evaluate(() => {
    bbTest.holdMix = true;
    void bbTest.run();
  });
  await page.waitForFunction(() => bbTest.mixes.length === 1);
  await page.evaluate(() => {
    bbTest.player.cancelExport();
    bbTest.mixes[0].resolve();
  });
  await page.waitForFunction(() => !bbTest.player.exporting);
  assert.equal(await page.evaluate(() => bbTest.mixes[0].signal.aborted), true);
  assert.equal(await page.evaluate(() => bbTest.exports.length), 4);
  checks.push('cancellation during mixing never starts an encoder and disposes export stage');
  await page.evaluate(() => {
    bbTest.holdMix = false;
    void bbTest.run();
  });
  await page.waitForFunction(() => bbTest.exports.length === 5);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  assert.equal(await page.evaluate(() => bbTest.exports[4].options.signal.aborted), true);
  await page.evaluate(() => {
    bbTest.unmount();
    bbTest.exports[4].resolve(new Blob(['late completion']));
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.evaluate(() => bbTest.published.length), 1);
  assert.equal(
    await page.evaluate(
      () => bbTest.disposals.filter((entry) => entry.purpose === 'export').length,
    ),
    6,
  );
  checks.push(
    'page exit and unmount abort active export; late completion cannot publish; all six export stages disposed',
  );
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed: true, checks }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, output }, null, 2));
} catch (reason) {
  console.error({
    checks,
    errors,
    snapshot: await page?.evaluate(() => ({
      count: bbTest?.exports.length,
      status: bbTest?.player.status,
      exporting: bbTest?.player.exporting,
      disposals: bbTest?.disposals,
    })),
  });
  throw reason;
} finally {
  await browser?.close();
  await server.close();
}
