import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { chromeOptions } from './fixtures/chrome.mjs';

// Sparse synthetic game actions deliberately span >2 minutes; this is not a real user work.
const sourceDirectory = process.argv[2];
if (!sourceDirectory)
  throw new Error('Expected generated directory from npm run test:browser:improvements');
await mkdir('outputs', { recursive: true });
const output = await mkdtemp(resolve('outputs/game-audio-endurance-'));
const server = await createServer({
  cacheDir: join(output, 'vite-cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
const results = [];
let browser, activePage;
try {
  await server.listen();
  const { createBBWorkPackage } = await server.ssrLoadModule('/src/contracts/bbWorkPackage.ts');
  const { readBCProject } = await server.ssrLoadModule('/src/games/block-crush/document.ts');
  const { compileBBTimeline } = await server.ssrLoadModule('/src/contracts/compileBBTimeline.ts');
  const { compileBCPlayback } = await server.ssrLoadModule('/src/games/block-crush/timeline.ts');
  const { compileProductionAudio } = await server.ssrLoadModule(
    '/src/nativeReference/agent-director/audioMix.ts',
  );
  browser = await chromium.launch({ ...chromeOptions(), headless: true });
  for (const game of ['bb', 'bc']) {
    let work = JSON.parse(await readFile(join(sourceDirectory, `${game}-edited.json`), 'utf8'));
    const document = game === 'bb' ? work.project : work;
    if (game === 'bb') {
      document.direction.rhythm.betweenActionFrames = 900;
      document.direction.rhythm.globalSpeed = 0.5;
    } else {
      // BC uses native 30 Hz impact ticks, independently of BB rhythm parameters.
      document.takes[0].actions.forEach(
        (entry, i) => (entry.action.impactTick = [30, 1800, 3600][i]),
      );
    }
    const audio = document.direction.production.audio;
    audio.voices = [1, 55, 56, 110].map((startSeconds, i) => ({
      ...audio.voices[0],
      id: `synthetic-speech-${i + 1}`,
      startSeconds,
    }));
    work =
      game === 'bb' ? await createBBWorkPackage(document, null, null) : readBCProject(document);
    const input = join(output, `${game}-synthetic-long.json`),
      encoded = JSON.stringify(work);
    await writeFile(input, encoded);
    const takeId = document.takes[0].takeId;
    const frameSource =
      game === 'bb'
        ? compileBBTimeline(work.project, takeId).source
        : compileBCPlayback(work, takeId, true).source;
    assert.ok(frameSource.totalFrames / frameSource.fps >= 120);
    const mix = compileProductionAudio(frameSource, audio, 48_000);
    console.log(
      `${game}: generated ${frameSource.totalFrames} frames / ${frameSource.totalFrames / frameSource.fps}s synthetic game audio`,
    );
    assert.equal(mix.scheduledVoices.length, 4);
    assert.ok(mix.scheduledCues.length >= 3);
    assert.equal(mix.clippedSampleCount, 0);
    const page = await browser.newPage({ acceptDownloads: true });
    activePage = page;
    const errors = [],
      downloads = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (/AudioSample was garbage collected/.test(message.text())) errors.push(message.text());
    });
    page.on('download', (item) => downloads.push(item));
    page.on('dialog', (dialog) => dialog.accept());
    await page.addInitScript(() => {
      const Original = window.Worker;
      window.__workers = { created: 0, active: 0 };
      window.Worker = class extends Original {
        constructor(...args) {
          super(...args);
          window.__workers.created++;
          window.__workers.active++;
          this.counted = true;
        }
        terminate() {
          if (this.counted) {
            window.__workers.active--;
            this.counted = false;
          }
          return super.terminate();
        }
      };
    });
    await page.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/${game === 'bc' ? '?test=bc#bc' : ''}`,
    );
    if (game === 'bb') {
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: '导入项目', exact: true }).click();
      await (await chooser).setFiles(input);
      await page.getByRole('button', { name: '打开 2D 测试预览', exact: true }).click();
    } else {
      await page.locator('input[accept="application/json,.json"]').setInputFiles(input);
      await page.waitForFunction(() => document.querySelector('canvas[data-ready="true"]'));
    }
    const exportButton = page.getByRole('button', {
      name: game === 'bb' ? '导出工程音频测试视频' : '导出当前范围 MP4',
      exact: true,
    });
    const nativeAac = await page.evaluate(
      async () =>
        typeof AudioEncoder !== 'undefined' &&
        (
          await AudioEncoder.isConfigSupported({
            codec: 'mp4a.40.2',
            numberOfChannels: 2,
            sampleRate: 48_000,
            bitrate: 192_000,
          })
        ).supported,
    );
    const cancellations = [];
    if (!nativeAac) {
      // Worker 1 is the independent calibration; worker 2 encodes the actual full-length PCM.
      await exportButton.click();
      await page.waitForFunction(
        () => window.__workers.created >= 2 && window.__workers.active > 0,
        null,
        { timeout: 120_000 },
      );
      const started = Date.now();
      await page.getByRole('button', { name: '取消导出', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '已取消，可重新导出' }).waitFor();
      await page.waitForFunction(() => window.__workers.active === 0);
      assert.ok(Date.now() - started < 10_000, 'AAC cancellation must release its worker promptly');
      assert.equal(downloads.length, 0);
      cancellations.push({ stage: 'actual-aac-encoding', releasedInMs: Date.now() - started });
      console.log(`${game}: actual audio encode cancelled and workers released`);
    }
    await exportButton.click();
    await page
      .getByRole('status')
      .filter({ hasText: /(?:视频编码 |% · )(?:[3-9]\d\d|[1-9]\d{3})\// })
      .waitFor({ timeout: 120_000 });
    await page.getByRole('button', { name: '取消导出', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已取消，可重新导出' }).waitFor();
    await page.waitForFunction(() => window.__workers.active === 0);
    assert.equal(downloads.length, 0);
    cancellations.push({ stage: 'video-encoding-after-300-frames' });
    console.log(`${game}: actual video encode cancelled; retrying full take`);
    const pending = page.waitForEvent('download', { timeout: 300_000 });
    void pending.catch(() => {});
    await exportButton.click();
    const video = join(output, `${game}-synthetic-long-audio.mp4`);
    await (await pending).saveAs(video);
    await page.waitForFunction(() => window.__workers.active === 0);
    assert.equal(downloads.length, 1);
    const probe = JSON.parse(
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-count_frames',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        video,
      ]),
    );
    const pic = probe.streams.find((s) => s.codec_type === 'video'),
      aud = probe.streams.find((s) => s.codec_type === 'audio');
    assert.equal(pic.codec_name, 'h264');
    assert.equal(Number(pic.nb_read_frames), frameSource.totalFrames);
    assert.equal(aud.codec_name, 'aac');
    assert.equal(aud.channels, 2);
    assert.equal(aud.sample_rate, '48000');
    assert.ok(Math.abs(Number(aud.duration) - frameSource.totalFrames / frameSource.fps) < 0.001);
    execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-f', 'null', '-']);
    const decoded = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-i', video, '-map', '0:a:0', '-f', 'f32le', '-'],
      { maxBuffer: 128_000_000 },
    );
    const events = [...mix.scheduledCues, ...mix.scheduledVoices].map((cue) => {
      let offset = 0,
        best = -Infinity;
      const correlation = (shift) => {
        let xx = 0,
          yy = 0,
          xy = 0;
        const from = Math.max(0, -cue.startSample - shift),
          to = Math.min(cue.durationSamples, decoded.length / 8 - cue.startSample - shift);
        for (let i = from; i < to; i += 6) {
          const x = mix.track.data[(cue.startSample + i) * 2],
            y = decoded.readFloatLE((cue.startSample + i + shift) * 8);
          xx += x * x;
          yy += y * y;
          xy += x * y;
        }
        return xy / Math.sqrt(xx * yy);
      };
      for (let shift = -96; shift <= 96; shift++) {
        const value = correlation(shift);
        if (value > best) {
          best = value;
          offset = shift;
        }
      }
      assert.ok(
        Math.abs(offset) <= 1 && best > 0.95 && !cue.truncated,
        JSON.stringify({ cue, offset, correlation: best }),
      );
      return {
        id: cue.eventId ?? cue.id,
        seconds: cue.startSample / 48_000,
        offsetSamples: offset,
        correlation: best,
      };
    });
    let peak = 0,
      power = 0;
    for (let i = 0; i < decoded.length; i += 4) {
      const value = decoded.readFloatLE(i);
      assert.ok(Number.isFinite(value));
      peak = Math.max(peak, Math.abs(value));
      power += value * value;
    }
    assert.ok(peak > 0.01 && peak < 1);
    assert.equal(await readFile(input, 'utf8'), encoded);
    assert.deepEqual(errors, []);
    results.push({
      game,
      frames: frameSource.totalFrames,
      seconds: frameSource.totalFrames / frameSource.fps,
      width: pic.width,
      height: pic.height,
      nativeAac,
      cancellations,
      events,
      peak,
      rms: Math.sqrt(power / (decoded.length / 4)),
      activeWorkers: 0,
      fullDecode: true,
      humanListening: false,
      video,
    });
    await writeFile(join(output, `${game}-result.json`), JSON.stringify(results.at(-1), null, 2));
    await page.close();
    console.log(JSON.stringify(results.at(-1), null, 2));
  }
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify({ synthetic: true, sparseActions: true, results, output }, null, 2),
  );
  console.log(`Evidence: ${output}`);
} catch (error) {
  await writeFile(
    join(output, 'failure.json'),
    JSON.stringify(
      {
        error: error.stack,
        body: await activePage?.locator('body').innerText(),
        workers: await activePage?.evaluate(() => window.__workers),
      },
      null,
      2,
    ),
  );
  console.error(`Evidence: ${output}`);
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
