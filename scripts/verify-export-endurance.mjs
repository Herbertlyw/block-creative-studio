import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { chromeOptions } from './fixtures/chrome.mjs';

// A real 120-second shared-encoder stress test with generated moving graphics.
// It is deliberately labelled silent and is not a long BB/BC project or AAC test.
await mkdir('outputs', { recursive: true });
const output = await mkdtemp(resolve('outputs/export-endurance-'));
const server = await createServer({
  cacheDir: join(output, 'vite-cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ ...chromeOptions(), headless: true });
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  const pending = page.waitForEvent('download', { timeout: 240_000 });
  void pending.catch(() => {});
  const result = await page.evaluate(
    async () => {
      const { exportFrameVideo } = await import('/src/exporter/exportFrameVideo.ts');
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 568;
      const ctx = canvas.getContext('2d');
      const render = (frame) => {
        ctx.fillStyle = '#16354a';
        ctx.fillRect(0, 0, 320, 568);
        ctx.fillStyle = '#56d8bf';
        ctx.fillRect((frame * 3) % 280, 220 + Math.sin(frame / 30) * 100, 40, 40);
        ctx.fillStyle = '#fff';
        ctx.font = '18px sans-serif';
        ctx.fillText('SYNTHETIC / SILENT', 20, 50);
        ctx.fillText(`Frame ${frame} / 3600`, 20, 80);
      };
      const options = {
        canvas,
        width: 320,
        height: 568,
        fps: 30,
        totalFrames: 3600,
        render,
        audio: null,
      };
      const cancelled = new AbortController();
      let cancelFrame = 0;
      let cancelName = '';
      try {
        await exportFrameVideo({
          ...options,
          signal: cancelled.signal,
          onProgress: (done) => {
            if (done >= 301) {
              cancelFrame = done;
              cancelled.abort();
            }
          },
        });
      } catch (reason) {
        cancelName = reason.name;
      }
      if (cancelName !== 'AbortError')
        throw new Error(`Unexpected cancellation result: ${cancelName}`);
      const phases = [],
        counts = [];
      const blob = await exportFrameVideo({
        ...options,
        onPhase: (phase) => phases.push(phase),
        onProgress: (done, total) => counts.push([done, total]),
      });
      const url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = 'synthetic-120s-silent.mp4';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return {
        cancelName,
        cancelFrame,
        phases,
        firstProgress: counts[0],
        finalProgress: counts.at(-1),
        progressUpdates: counts.length,
        bytes: blob.size,
      };
    },
    { timeout: 240_000 },
  );
  const video = join(output, 'synthetic-120s-silent.mp4');
  await (await pending).saveAs(video);
  assert.equal(result.cancelName, 'AbortError');
  assert.ok(result.cancelFrame >= 301);
  assert.deepEqual(result.finalProgress, [3600, 3600]);
  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', video],
      { encoding: 'utf8' },
    ),
  );
  const stream = probe.streams.find((item) => item.codec_type === 'video');
  assert.equal(stream.codec_name, 'h264');
  assert.equal(Number(stream.nb_read_frames), 3600);
  assert.ok(Math.abs(Number(probe.format.duration) - 120) < 0.01);
  assert.equal(
    probe.streams.some((item) => item.codec_type === 'audio'),
    false,
  );
  execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-f', 'null', '-'], { stdio: 'pipe' });
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      {
        ...result,
        seconds: 120,
        frames: 3600,
        fps: 30,
        silent: true,
        gameProject: false,
        fullDecode: true,
        video,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ ...result, seconds: 120, fullDecode: true, output }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
