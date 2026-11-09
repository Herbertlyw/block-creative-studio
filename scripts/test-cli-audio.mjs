import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syntheticWav } from './fixtures/syntheticMedia.mjs';
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
const dir = await mkdtemp(join(tmpdir(), 'bcs-audio-'));
const path = (n) => join(dir, n);
const run = (args, status = 0) => {
  const p = spawnSync(process.execPath, ['dist-cli/bcs.js', ...args, '--json'], {
    encoding: 'utf8',
  });
  assert.equal(p.status, status, p.stdout + p.stderr);
  return JSON.parse(p.stdout);
};
const option = async (n, v) => {
  await writeFile(path(n), JSON.stringify(v));
  return path(n);
};
const edit = (g, id, input, opt, out, status = 0) =>
  run(
    ['game', g, id, '--input', path(input), '--options-file', path(opt), '--out', path(out)],
    status,
  );
const server = await createServer({
  cacheDir: path('vite-cache'),
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
});
try {
  const { compileProductionAudio } = await server.ssrLoadModule(
    '/src/nativeReference/agent-director/audioMix.ts',
  );
  const { compileBBTimeline } = await server.ssrLoadModule('/src/contracts/compileBBTimeline.ts');
  const { compileBCPlayback } = await server.ssrLoadModule('/src/games/block-crush/timeline.ts');
  await writeFile(path('music.wav'), syntheticWav(220));
  for (const [game, prefix] of [
    ['block-placement', 'bb'],
    ['block-crush-drop', 'bc'],
  ]) {
    run(['game', game, 'project create', '--out', path(`${prefix}.json`)]);
    await option('import.json', { id: 'music', file: 'music.wav' });
    edit(game, 'audio import', `${prefix}.json`, 'import.json', `${prefix}-audio.json`);
    await option('bgm.json', {
      assetId: 'music',
      startSeconds: 1,
      sourceOffsetSeconds: 0.2,
      loop: true,
      gain: 0,
    });
    edit(game, 'audio bgm edit', `${prefix}-audio.json`, 'bgm.json', `${prefix}-bgm.json`);
    await option('gain.json', { gain: 0.5 });
    edit(game, 'audio bgm edit', `${prefix}-bgm.json`, 'gain.json', `${prefix}-gain.json`);
    const before = JSON.parse(await readFile(path(`${prefix}-bgm.json`), 'utf8'));
    const after = JSON.parse(await readFile(path(`${prefix}-gain.json`), 'utf8'));
    const a = (game === 'block-placement' ? before.project : before).direction.production.audio,
      b = (game === 'block-placement' ? after.project : after).direction.production.audio;
    const oldProject = game === 'block-placement' ? before.project : before;
    const newProject = game === 'block-placement' ? after.project : after;
    assert.deepEqual(newProject.game, oldProject.game);
    assert.deepEqual(newProject.takes, oldProject.takes);
    assert.deepEqual(newProject.direction.style, oldProject.direction.style);
    assert.equal(b.bgm.startSeconds, 1);
    assert.equal(b.bgm.sourceOffsetSeconds, 0.2);
    assert.equal(b.bgm.loop, true);
    assert.equal(b.bgm.gain, 0.5);
    assert.deepEqual(b.cues, a.cues);
    await option('cue.json', { index: 0, gain: 0 });
    edit(game, 'audio sfx edit', `${prefix}-gain.json`, 'cue.json', `${prefix}-cue.json`);
    await option('master.json', { masterGain: 0, sfxEnabled: false });
    edit(game, 'audio edit', `${prefix}-cue.json`, 'master.json', `${prefix}-final.json`);
    run(['game', game, 'project validate', '--input', path(`${prefix}-final.json`)]);
    const inspected = run(['game', game, 'audio inspect', '--input', path(`${prefix}-final.json`)]);
    assert.equal(inspected.report.effective.masterGain, 0);
    await option('bad.json', { assetId: 'missing' });
    const fail = edit(
      game,
      'audio bgm edit',
      `${prefix}-final.json`,
      'bad.json',
      `${prefix}-bad.json`,
      1,
    );
    assert.match(fail.report.error.message, /AUDIO_ASSET_UNKNOWN/);

    // The example BC document has audio; remove it to exercise a genuinely silent source.
    let silent = JSON.parse(await readFile(path(`${prefix}.json`), 'utf8'));
    if (game === 'block-placement') {
      await option('make-take.json', { takeId: 'sound-test', count: 1 });
      edit(game, 'take generate', `${prefix}.json`, 'make-take.json', `${prefix}-take.json`);
      silent = JSON.parse(await readFile(path(`${prefix}-take.json`), 'utf8'));
    }
    const projectOf = (value) => (game === 'block-placement' ? value.project : value);
    const silentProject = projectOf(silent);
    if (silentProject.direction?.production) delete silentProject.direction.production.audio;
    await writeFile(path(`${prefix}-silent.json`), JSON.stringify(silent));
    const originalBytes = await readFile(path(`${prefix}-silent.json`));
    const source =
      game === 'block-placement'
        ? compileBBTimeline(silentProject, 'sound-test').source
        : compileBCPlayback(silentProject, 'demo', true).source;
    const mix = (value) =>
      compileProductionAudio(source, projectOf(value).direction.production.audio, 8000);
    await option('silent-import.json', { id: 'unused-music', file: 'music.wav' });
    const importedResult = edit(
      game,
      'audio import',
      `${prefix}-silent.json`,
      'silent-import.json',
      `${prefix}-silent-imported.json`,
    );
    assert.deepEqual(importedResult.report.invalidated, []);
    const imported = JSON.parse(await readFile(path(`${prefix}-silent-imported.json`), 'utf8'));
    const importedProject = projectOf(imported),
      importedAudio = importedProject.direction.production.audio;
    assert.equal(importedAudio.sfxEnabled, false);
    assert.equal(importedAudio.bgm, undefined);
    assert.equal(importedAudio.cues, undefined);
    const wav = await readFile(path('music.wav'));
    assert.equal(
      importedAudio.assets['unused-music'].sha256,
      createHash('sha256').update(wav).digest('hex'),
    );
    assert.deepEqual(Buffer.from(importedAudio.assets['unused-music'].data, 'base64'), wav);
    assert.deepEqual(importedProject.game, silentProject.game);
    assert.deepEqual(importedProject.takes, silentProject.takes);
    assert.deepEqual(importedProject.direction.style, silentProject.direction.style);
    assert.deepEqual(await readFile(path(`${prefix}-silent.json`)), originalBytes);
    const muted = mix(imported);
    assert.equal(muted.scheduledCues.length, 0);
    assert.ok(muted.track.data.every((value) => value === 0));
    await option('only-bgm.json', { assetId: 'unused-music', gain: 0.5, loop: true });
    edit(
      game,
      'audio bgm edit',
      `${prefix}-silent-imported.json`,
      'only-bgm.json',
      `${prefix}-only-bgm.json`,
    );
    const musicOnly = mix(JSON.parse(await readFile(path(`${prefix}-only-bgm.json`), 'utf8')));
    assert.equal(musicOnly.scheduledCues.length, 0);
    assert.ok(musicOnly.track.data.some((value) => value !== 0));
    await option('enable.json', { sfxEnabled: true });
    edit(
      game,
      'audio edit',
      `${prefix}-silent-imported.json`,
      'enable.json',
      `${prefix}-enabled.json`,
    );
    const enabled = mix(JSON.parse(await readFile(path(`${prefix}-enabled.json`), 'utf8')));
    assert.ok(enabled.scheduledCues.length > 0);
    assert.ok(enabled.track.data.some((value) => value !== 0));
    const existing = structuredClone(silent);
    projectOf(existing).direction.production ??= { version: '1.0.0' };
    projectOf(existing).direction.production.audio = {
      masterGain: 0.65,
      sfxGain: 0.4,
      sfxEnabled: true,
    };
    await writeFile(path(`${prefix}-existing.json`), JSON.stringify(existing));
    edit(
      game,
      'audio import',
      `${prefix}-existing.json`,
      'silent-import.json',
      `${prefix}-existing-imported.json`,
    );
    const existingAfter = JSON.parse(
      await readFile(path(`${prefix}-existing-imported.json`), 'utf8'),
    );
    const { assets: _assets, ...settings } = projectOf(existingAfter).direction.production.audio;
    assert.deepEqual(settings, projectOf(existing).direction.production.audio);
    assert.ok(mix(existing).scheduledCues.length > 0);
    assert.deepEqual(mix(existingAfter).scheduledCues, mix(existing).scheduledCues);
    assert.equal(mix(existingAfter).pcmHash, mix(existing).pcmHash);
    const zero = structuredClone(silent);
    projectOf(zero).direction.production ??= { version: '1.0.0' };
    projectOf(zero).direction.production.audio = { masterGain: 0, sfxGain: 0, sfxEnabled: false };
    await writeFile(path(`${prefix}-zero.json`), JSON.stringify(zero));
    edit(
      game,
      'audio import',
      `${prefix}-zero.json`,
      'silent-import.json',
      `${prefix}-zero-imported.json`,
    );
    const zeroAfter = projectOf(
      JSON.parse(await readFile(path(`${prefix}-zero-imported.json`), 'utf8')),
    ).direction.production.audio;
    assert.equal(zeroAfter.masterGain, 0);
    assert.equal(zeroAfter.sfxGain, 0);
    assert.equal(zeroAfter.sfxEnabled, false);
    const explicit = structuredClone(silent);
    projectOf(explicit).direction.production ??= { version: '1.0.0' };
    const explicitAudio = {
      masterGain: 0.4,
      sfxGain: 0,
      sfxEnabled: false,
      mastering: 'preserve-level',
      bgm: {
        assetId: 'builtin:bgm-calm',
        gain: 0,
        startSeconds: 1,
        sourceOffsetSeconds: 0.2,
        loop: false,
      },
      cues: [
        { eventType: '*.piece-committed', assetId: 'builtin:soft-hit', gain: 0, offsetSeconds: 0 },
      ],
    };
    projectOf(explicit).direction.production.audio = explicitAudio;
    await writeFile(path(`${prefix}-explicit.json`), JSON.stringify(explicit));
    edit(
      game,
      'audio import',
      `${prefix}-explicit.json`,
      'silent-import.json',
      `${prefix}-explicit-imported.json`,
    );
    const { assets: _explicitAssets, ...explicitAfter } = projectOf(
      JSON.parse(await readFile(path(`${prefix}-explicit-imported.json`), 'utf8')),
    ).direction.production.audio;
    assert.deepEqual(explicitAfter, explicitAudio);
    await option('direct-bgm.json', { assetId: 'builtin:bgm-calm', gain: 0.5 });
    edit(
      game,
      'audio bgm edit',
      `${prefix}-silent.json`,
      'direct-bgm.json',
      `${prefix}-direct-bgm.json`,
    );
    const direct = JSON.parse(await readFile(path(`${prefix}-direct-bgm.json`), 'utf8'));
    assert.equal(projectOf(direct).direction.production.audio.sfxEnabled, false);
    assert.equal(mix(direct).scheduledCues.length, 0);
    assert.ok(mix(direct).track.data.some((value) => value !== 0));
  }
  console.log('CLI audio workflows passed');
} finally {
  await server.close();
  await rm(dir, { recursive: true, force: true });
}
