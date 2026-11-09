import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syntheticWav } from './fixtures/syntheticMedia.mjs';
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
try {
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
  }
  console.log('CLI audio workflows passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}
