import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { chromeOptions } from './fixtures/chrome.mjs';

await mkdir('outputs', { recursive: true });
const output = await mkdtemp(resolve('outputs/aac-fallback-'));
const server = await createServer({
  cacheDir: join(output, 'cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ ...chromeOptions(), headless: true });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto(base);
  const prepare = () =>
    page.evaluate(async () => {
      const { prepareAacEncoder } = await import('/src/exporter/aacEncoder.ts');
      try {
        return { mode: await prepareAacEncoder({ channels: 2, bitrate: 192_000 }) };
      } catch (error) {
        return { code: error.code, message: error.message };
      }
    });
  const native = await page.evaluate(
    async () =>
      typeof AudioEncoder !== 'undefined' &&
      (
        await AudioEncoder.isConfigSupported({
          codec: 'mp4a.40.2',
          sampleRate: 48_000,
          numberOfChannels: 2,
          bitrate: 192_000,
        })
      ).supported,
  );
  const checks = [];
  if (!native) {
    let blocked = 0;
    await page.route('**/*aac-encoder*', (route) => {
      blocked++;
      return route.abort();
    });
    const failure = await prepare();
    assert.equal(failure.code, 'AAC_ENCODER_LOAD_FAILED');
    assert.equal(blocked, 1);
    await page.unroute('**/*aac-encoder*');
    assert.equal((await prepare()).mode, 'software');
    checks.push(
      'real software module request failed; same-page unchanged retry loaded successfully',
    );

    const loadingPage = await browser.newPage();
    await loadingPage.goto(base);
    let release;
    const request = new Promise((resolveRequest) => {
      release = resolveRequest;
    });
    await loadingPage.route('**/*aac-encoder*', (route) => release(route));
    await loadingPage.evaluate(async () => {
      const { prepareAacEncoder } = await import('/src/exporter/aacEncoder.ts');
      window.__abort = new AbortController();
      window.__preparation = prepareAacEncoder({
        channels: 2,
        bitrate: 192_000,
        signal: window.__abort.signal,
      }).then(
        () => 'unexpected success',
        (error) => error.name,
      );
    });
    const route = await request;
    assert.equal(
      await loadingPage.evaluate(async () => {
        window.__abort.abort();
        return window.__preparation;
      }),
      'AbortError',
    );
    await route.continue();
    assert.equal(
      await loadingPage.evaluate(async () => {
        const { prepareAacEncoder } = await import('/src/exporter/aacEncoder.ts');
        return prepareAacEncoder({ channels: 2, bitrate: 192_000 });
      }),
      'software',
    );
    await loadingPage.close();
    checks.push(
      'cancel during held module load returned immediately; shared preparation remained reusable',
    );
  } else {
    assert.equal((await prepare()).mode, 'browser');
    checks.push(
      'native AAC retained; software-only fault scenarios skipped because fallback was not required',
    );
  }
  const pending = page.waitForEvent('download', { timeout: 120_000 });
  void pending.catch(() => {});
  const phases = await page.evaluate(async () => {
    const { exportFrameVideo } = await import('/src/exporter/exportFrameVideo.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 568;
    const ctx = canvas.getContext('2d'),
      pcm = new Float32Array(96_000 * 2),
      phases = [];
    for (let i = 0; i < 96_000; i++)
      pcm[i * 2] = pcm[i * 2 + 1] =
        Math.sin((i * 2 * Math.PI * 440) / 48_000) * 0.1 * (1 - i / 96_000);
    const blob = await exportFrameVideo({
      canvas,
      width: 320,
      height: 568,
      fps: 30,
      totalFrames: 60,
      audio: { pcm, channels: 2 },
      onPhase: (phase) => phases.push(phase),
      render: (frame) => {
        ctx.fillStyle = '#234';
        ctx.fillRect(0, 0, 320, 568);
        ctx.fillStyle = '#fff';
        ctx.fillRect(frame * 4, 250, 40, 40);
      },
    });
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = 'synthetic-aac-retry.mp4';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return phases;
  });
  const video = join(output, 'synthetic-aac-retry.mp4');
  await (await pending).saveAs(video);
  const probe = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', video]),
  );
  assert.ok(probe.streams.some((stream) => stream.codec_name === 'aac' && stream.channels === 2));
  execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-f', 'null', '-']);
  checks.push('actual H.264/stereo AAC export after failure/retry independently decoded');
  const result = { nativeAac: native, checks, phases, humanListening: false, output };
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
