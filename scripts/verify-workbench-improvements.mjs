import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { createServer, preview } from 'vite';
import { chromeOptions } from './fixtures/chrome.mjs';
import { syntheticWav } from './fixtures/syntheticMedia.mjs';
import { prepareSyntheticReference } from './fixtures/syntheticReference.mjs';

await mkdir('outputs', { recursive: true });
const output = await mkdtemp(resolve('outputs/workbench-improvements-'));
const server = await createServer({
  cacheDir: join(output, 'vite-cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
const checks = [],
  media = [],
  errors = [];
let browser, page, productionServer;
const voicePath = join(output, 'synthetic-voice.wav');
// Generated speech, never a user recording or copyrighted soundtrack.
execFileSync('ffmpeg', [
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'flite=text=This is a synthetic voice test:voice=slt',
  '-ar',
  '48000',
  '-ac',
  '1',
  '-c:a',
  'pcm_s16le',
  voicePath,
]);
try {
  await server.listen();
  const { ordinaryProject } = await server.ssrLoadModule('/tests/fixtures/ordinaryProject.ts');
  const { createBBWorkPackage } = await server.ssrLoadModule('/src/contracts/bbWorkPackage.ts');
  const { createBCDemo } = await server.ssrLoadModule('/src/games/block-crush/demo.ts');
  const { createWavAsset } = await server.ssrLoadModule('/src/contracts/audioAsset.ts');
  const { editBBProductionAudio, editBCProductionAudio } = await server.ssrLoadModule(
    '/src/contracts/editProductionAudio.ts',
  );
  const assets = {};
  for (const [id, bytes] of Object.entries({
    music: syntheticWav(220, 3),
    voice: await readFile(voicePath),
    placement: syntheticWav(740, 0.15),
    clear: syntheticWav(1120, 0.3),
  }))
    assets[id] = await createWavAsset(bytes, id, `synthetic-${id}.wav`);
  const importedBytes = syntheticWav(660, 0.25);
  const importedAsset = await createWavAsset(importedBytes, 'pending', 'imported-tone.wav');
  importedAsset.id = `audio-${importedAsset.sha256}`;
  const makeAudio = (game, takeId) => ({
    assets,
    masterGain: 1,
    mastering: 'preserve-level',
    sfxGain: 1,
    sfxEnabled: true,
    bgm: {
      assetId: 'music',
      gain: 0.2,
      loop: true,
      startSeconds: 0,
      sourceOffsetSeconds: 0.1,
      fadeInSeconds: 0.1,
      fadeOutSeconds: 0.2,
    },
    cues: (game === 'bb'
      ? [
          ['block-placement.placement-committed', 'placement'],
          ['block-placement.cross-cleared', 'clear'],
        ]
      : [
          ['block-crush-drop.piece-committed', 'placement'],
          ['block-crush-drop.blocks-eliminated', 'clear'],
        ]
    ).map(([eventType, assetId]) => ({ eventType, assetId, gain: 0.4, offsetSeconds: 0 })),
    voices: [
      {
        id: 'synthetic-speech',
        takeId,
        assetId: 'voice',
        startSeconds: 0.5,
        gain: 0.5,
        sourceOffsetSeconds: 0,
        fadeInSeconds: 0.02,
        fadeOutSeconds: 0.05,
      },
    ],
    ducking: {
      enabled: true,
      bgmGain: 0.35,
      sfxGain: 0.6,
      attackSeconds: 0.08,
      releaseSeconds: 0.25,
      eventTypes: [
        game === 'bb' ? 'block-placement.placement-committed' : 'block-crush-drop.piece-committed',
      ],
    },
  });
  const bb = await editBBProductionAudio(
    await createBBWorkPackage(ordinaryProject(), null, null),
    makeAudio('bb', 'synthetic-take'),
  );
  const bc = await editBCProductionAudio(createBCDemo(), makeAudio('bc', 'demo'));
  for (const [game, work] of [
    ['bb', bb],
    ['bc', bc],
  ])
    await writeFile(join(output, `${game}-four-tracks.json`), JSON.stringify(work));
  browser = await chromium.launch({ ...chromeOptions(), headless: true });
  page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(30_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  if (process.env.BCS_TEST_PRODUCTION)
    productionServer = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  const baseURL = `http://127.0.0.1:${(productionServer ?? server).httpServer.address().port}`;
  const download = async (button, name) => {
    const pending = page.waitForEvent('download', { timeout: 120_000 });
    void pending.catch(() => {});
    await button.click();
    const item = await pending,
      path = join(output, name);
    await item.saveAs(path);
    return path;
  };
  const openBB = async (file) => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入项目', exact: true }).click();
    await (await chooser).setFiles(file);
    await page.getByText('分轨混音与人声', { exact: true }).waitFor();
  };
  const saveBB = () => page.getByRole('button', { name: '保存作品', exact: true });
  await page.goto(baseURL);
  const capabilities = await page.evaluate(async () => ({
    avc: (
      await VideoEncoder.isConfigSupported({
        codec: 'avc1.42001f',
        width: 512,
        height: 864,
        bitrate: 8_000_000,
        framerate: 30,
      })
    ).supported,
    nativeAac: (
      await AudioEncoder.isConfigSupported({
        codec: 'mp4a.40.2',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 192000,
      })
    ).supported,
  }));
  await writeFile(join(output, 'codec-capabilities.json'), JSON.stringify(capabilities, null, 2));
  await openBB(join(output, 'bb-four-tracks.json'));
  await page.getByText('分轨混音与人声', { exact: true }).click();
  await page
    .getByLabel('混音导入 WAV', { exact: true })
    .setInputFiles({ name: 'imported-tone.wav', mimeType: 'audio/wav', buffer: importedBytes });
  await page.waitForFunction(
    (id) =>
      [...document.querySelector('[aria-label="混音 BGM 素材"]').options].some(
        (option) => option.value === id,
      ),
    importedAsset.id,
  );
  await page
    .getByLabel('混音导入 WAV', { exact: true })
    .setInputFiles({ name: 'renamed-identical.wav', mimeType: 'audio/wav', buffer: importedBytes });
  await page.getByLabel('混音 BGM 增益', { exact: true }).fill('.12');
  await page.getByLabel('人声 1 增益', { exact: true }).fill('.55');
  await page.getByLabel('音效 1 偏移秒', { exact: true }).fill('.04');
  await page.getByLabel('音效 2 增益', { exact: true }).fill('.33');
  await page.getByRole('button', { name: '核验并应用混音', exact: true }).click();
  await page.getByText('当前混音已应用；工程保存会发起下载。', { exact: true }).waitFor();
  const bbSavedPath = await download(saveBB(), 'bb-edited.json');
  const bbSaved = JSON.parse(await readFile(bbSavedPath, 'utf8'));
  assert.deepEqual(bbSaved.project.takes, bb.project.takes);
  assert.deepEqual(bbSaved.project.direction.style, bb.project.direction.style);
  const bbAudio = bbSaved.project.direction.production.audio;
  assert.equal(bbAudio.bgm.gain, 0.12);
  assert.equal(bbAudio.voices[0].gain, 0.55);
  assert.equal(bbAudio.cues[0].offsetSeconds, 0.04);
  assert.equal(bbAudio.cues[1].gain, 0.33);
  assert.deepEqual(bbAudio.assets, { ...assets, [importedAsset.id]: importedAsset });
  checks.push(
    'real WAV imported twice without rebinding any role; same bytes retained the original asset metadata',
  );
  await page.reload();
  await openBB(bbSavedPath);
  await page.getByText('分轨混音与人声', { exact: true }).click();
  assert.equal(await page.getByLabel('混音 BGM 增益', { exact: true }).inputValue(), '0.12');
  assert.equal(await page.getByLabel('人声 1 增益', { exact: true }).inputValue(), '0.55');
  await page.getByRole('button', { name: '打开 2D 测试预览', exact: true }).click();
  await page.getByRole('button', { name: '播放 V2 预览', exact: true }).click();
  await page.getByRole('button', { name: '暂停 V2 预览', exact: true }).waitFor();
  await page.getByRole('button', { name: '暂停 V2 预览', exact: true }).click();
  checks.push(
    'BB four independent tracks edited, save/reopen identical, actual WebAudio preview started (no human listening)',
  );
  await page.screenshot({ path: join(output, 'bb-audio-editor.png'), fullPage: true });

  // Require actual audible output, including the software fallback on hosts without native AAC.
  inspect(
    await download(
      page.getByRole('button', { name: '导出工程音频测试视频', exact: true }),
      'bb-audio.mp4',
    ),
    true,
  );
  // Explicit silent export must still work without activating any audio.
  await page.getByLabel('使用工程 production.audio（WAV）', { exact: true }).uncheck();
  const bbSilent = await download(
    page.getByRole('button', { name: '导出无声测试视频', exact: true }),
    'bb-silent.mp4',
  );
  inspect(bbSilent, false);

  await page.goto(`${baseURL}/?test=bc#bc`);
  await page
    .locator('input[accept="application/json,.json"]')
    .setInputFiles(join(output, 'bc-four-tracks.json'));
  const readyBC = () =>
    page.waitForFunction(() => document.querySelector('canvas[data-ready="true"]'));
  await readyBC();
  await page.getByText('分轨混音与人声', { exact: true }).click();
  await page.getByLabel('混音 BGM 增益', { exact: true }).fill('.11');
  await page.getByLabel('人声 1 开始秒', { exact: true }).fill('.6');
  await page.getByLabel('音效 1 增益', { exact: true }).fill('.27');
  await page.getByLabel('音效 2 偏移秒', { exact: true }).fill('.03');
  await page.getByRole('button', { name: '核验并应用混音', exact: true }).click();
  await page.getByText('当前混音已应用；工程保存会发起下载。', { exact: true }).waitFor();
  await readyBC();
  const bcSavedPath = await download(
    page.getByRole('button', { name: /保存 JSON/ }),
    'bc-edited.json',
  );
  const bcSaved = JSON.parse(await readFile(bcSavedPath, 'utf8'));
  assert.deepEqual(bcSaved.takes, bc.takes);
  assert.deepEqual(bcSaved.game, bc.game);
  assert.equal(bcSaved.direction.production.audio.bgm.gain, 0.11);
  assert.equal(bcSaved.direction.production.audio.voices[0].startSeconds, 0.6);
  assert.equal(bcSaved.direction.production.audio.cues[0].gain, 0.27);
  assert.equal(bcSaved.direction.production.audio.cues[1].offsetSeconds, 0.03);
  await page.reload();
  await page.locator('input[accept="application/json,.json"]').setInputFiles(bcSavedPath);
  await readyBC();
  await page.getByText('分轨混音与人声', { exact: true }).click();
  assert.equal(await page.getByLabel('人声 1 开始秒', { exact: true }).inputValue(), '0.6');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  checks.push(
    'BC native project four-track editing, independent gameplay contract, save/reopen and actual WebAudio preview',
  );
  inspect(
    await download(page.getByRole('button', { name: '导出当前范围 MP4' }), 'bc-audio.mp4'),
    true,
  );
  const silentBC = structuredClone(bcSaved);
  delete silentBC.direction.production.audio;
  const silentBCPath = join(output, 'bc-silent.json');
  await writeFile(silentBCPath, JSON.stringify(silentBC));
  await page.locator('input[accept="application/json,.json"]').setInputFiles(silentBCPath);
  await readyBC();
  const exportBC = page.getByRole('button', { name: '导出当前范围 MP4' });
  await exportBC.click();
  await page.getByRole('button', { name: '取消导出', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已取消，可重新导出' }).waitFor();
  inspect(await download(exportBC, 'bc-silent-retry.mp4'), false);
  checks.push('BC actual silent encode cancel/retry, FFprobe and full FFmpeg decode');

  const synthetic = await prepareSyntheticReference(server, output);
  await page.goto(baseURL);
  await page.getByText('参考视频观察记录', { exact: true }).click();
  await page.getByLabel('选择参考视频', { exact: true }).setInputFiles(synthetic.video);
  await page.waitForFunction(() => !document.querySelector('[aria-label="导入帧测量"]').disabled);
  await page.getByLabel('导入帧测量', { exact: true }).setInputFiles(synthetic.measurementPath);
  await page.getByText('结构化玩法标注（实验）', { exact: true }).click();
  await page
    .getByLabel('结构化玩法标注 JSON', { exact: true })
    .fill(synthetic.observation.structured);
  await page
    .getByLabel('校准几何与方块轨迹 JSON', { exact: true })
    .fill(synthetic.observation.geometry);
  // Raw geometry edits intentionally revoke all confirmations.
  await page.getByText('可视几何与方块轨迹（实验）', { exact: true }).click();
  await page.getByLabel('参考源帧', { exact: true }).fill('20');
  await page.getByRole('button', { name: '定位帧时间', exact: true }).click();
  await page.getByLabel('几何动作', { exact: true }).selectOption('0');
  await page.getByLabel('方块轨迹 x', { exact: true }).fill('240');
  assert.match(await page.getByLabel('轨迹点绑定信息').innerText(), /源帧.*输出帧/);
  assert.match(await page.getByLabel('观察生成检查').innerText(), /待确认/);
  await page.getByLabel('重新核验源视频', { exact: true }).setInputFiles({
    name: 'wrong.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('wrong source'),
  });
  await page.getByRole('alert').filter({ hasText: 'SHA-256 不匹配' }).waitFor();
  assert.equal(
    JSON.parse(await page.getByLabel('校准几何与方块轨迹 JSON', { exact: true }).inputValue())
      .motions[0].points[0].x,
    240,
  );
  const draftPath = await download(
    page.getByRole('button', { name: '保存观察记录 JSON', exact: true }),
    'observation-draft.json',
  );
  const savedDraft = JSON.parse(await readFile(draftPath, 'utf8'));
  await page.reload();
  await page.getByText('参考视频观察记录', { exact: true }).click();
  await page.getByLabel('选择参考视频', { exact: true }).setInputFiles(synthetic.video);
  await page.waitForFunction(() => !document.querySelector('[aria-label="重开观察记录"]').disabled);
  await page.getByLabel('重开观察记录', { exact: true }).setInputFiles(draftPath);
  await page.getByLabel('结构化玩法标注 JSON', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('校准几何与方块轨迹 JSON', { exact: true }).inputValue(),
    savedDraft.geometry,
  );
  checks.push(
    'independent synthetic reference video, measured time relation, trajectory edit, wrong-source rejection and draft save/reopen',
  );
  await page.getByLabel('动作 1 col', { exact: true }).fill('0');
  const confirmations = page.getByLabel('作者确认此步', { exact: true });
  for (let i = 0; i < (await confirmations.count()); i++) await confirmations.nth(i).check();
  await page.getByRole('button', { name: '检查并生成玩法草稿', exact: true }).click();
  await page
    .getByRole('status')
    .filter({ hasText: /Take「observed-take」第 1 步.*不合法/ })
    .waitFor();
  assert.equal(
    JSON.parse(await page.getByLabel('结构化玩法标注 JSON', { exact: true }).inputValue())
      .actions[0].col,
    0,
  );
  await page
    .getByLabel('结构化玩法标注 JSON', { exact: true })
    .fill(synthetic.observation.structured);
  for (let i = 0; i < (await confirmations.count()); i++) await confirmations.nth(i).check();
  await page
    .getByLabel('校准几何与方块轨迹 JSON', { exact: true })
    .fill(synthetic.observation.geometry);
  await page.getByText('可视几何与方块轨迹（实验）', { exact: true }).click();
  const count = JSON.parse(synthetic.observation.structured).actions.length;
  for (let i = 0; i < count; i++) {
    await page.getByLabel('几何动作', { exact: true }).selectOption({ value: String(i) });
    await page.waitForFunction(
      (id) => document.querySelector('[aria-label="确认选中方块轨迹"]')?.dataset.actionId === id,
      JSON.parse(synthetic.observation.structured).actions[i].id,
    );
    await page.getByLabel('确认选中方块轨迹', { exact: true }).check();
    await page.waitForFunction(
      (index) =>
        JSON.parse(document.querySelector('[aria-label="校准几何与方块轨迹 JSON"]').value).motions[
          index
        ].confirmed === true,
      i,
    );
  }
  await page.getByLabel('确认棋盘候选几何', { exact: true }).check();
  const observedWork = await download(
    page.getByRole('button', { name: '校验并另存校准工程', exact: true }),
    'observed-generated.json',
  );
  const observed = JSON.parse(await readFile(observedWork, 'utf8'));
  assert.equal(observed.source.link.source.sha256, synthetic.observation.source.sha256);
  await page.getByRole('button', { name: '打开刚生成的观察作品', exact: true }).click();
  await page.getByRole('button', { name: '使用当前校准渲染器测试', exact: true }).click();
  await page.getByRole('button', { name: '播放校准预览', exact: true }).click();
  await page.getByRole('button', { name: '暂停校准预览', exact: true }).click();
  inspect(
    await download(
      page.getByRole('button', { name: '导出校准测试视频', exact: true }),
      'observed-silent.mp4',
    ),
    false,
  );
  checks.push(
    'UI illegal placement named Take/step and retained draft; reconfirmed geometry generated a source-bound work, previewed and exported actual silent MP4',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      {
        checks,
        media,
        capabilities,
        productionBuild: !!productionServer,
        humanListening: false,
        longVideoVerified: false,
        output,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, media, capabilities, output }, null, 2));
} catch (reason) {
  if (page) {
    await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(
      join(output, 'failure.txt'),
      `${reason.stack}\n${await page
        .locator('body')
        .innerText()
        .catch(() => '')}\nPage errors: ${errors.join('\n')}`,
    );
  }
  console.error(`Evidence: ${output}`);
  throw reason;
} finally {
  await browser?.close();
  await productionServer?.close();
  await server.close();
}

function inspect(path, audio) {
  const probe = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], {
      encoding: 'utf8',
    }),
  );
  assert.ok(probe.streams.some((stream) => stream.codec_name === 'h264'));
  assert.equal(
    probe.streams.some((stream) => stream.codec_name === 'aac'),
    audio,
  );
  execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-'], { stdio: 'pipe' });
  media.push(`${path}: H.264${audio ? '/AAC' : ' silent'}, FFprobe and full FFmpeg decode passed`);
}
