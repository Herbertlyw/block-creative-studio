import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, link, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv';
const dir = await mkdtemp(join(tmpdir(), 'bcs-smoke-'));
const file = (name) => join(dir, name);
const run = (args, status = 0) => {
  const result = spawnSync(process.execPath, ['dist-cli/bcs.js', ...args, '--json'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, status, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
};
try {
  const ajv = new Ajv({ strict: false });
  for (const [game, edit] of [
    ['block-placement', 'board edit'],
    ['block-crush-drop', 'action edit'],
  ]) {
    const desc = run(['games', 'describe', game]).report.operations.find((op) => op.id === edit);
    assert.equal(ajv.compile(desc.inputSchema)({ project: {} }), false);
    for (const op of run(['games', 'describe', game]).report.operations) {
      if (!ajv.compile(op.schema)({}))
        assert.equal(ajv.compile(op.inputSchema)({ project: {} }), false, op.id);
    }
    run(['game', game, 'project create', '--out', file(`${game}.json`)]);
    run(
      ['game', game, edit, '--input', file(`${game}.json`), '--out', file(`${game}-bad.json`)],
      2,
    );
  }
  await writeFile(
    file('options.json'),
    JSON.stringify({ takeId: 'demo', index: 0, column: 5, seconds: 1 }),
  );
  run([
    'game',
    'block-crush-drop',
    'action edit',
    '--input',
    file('block-crush-drop.json'),
    '--options-file',
    file('options.json'),
    '--out',
    file('edited.json'),
  ]);
  run(['game', 'block-crush-drop', 'project validate', '--input', file('edited.json')]);
  const originalBytes = await readFile(file('block-crush-drop.json'));
  await link(file('block-crush-drop.json'), file('hard.json'));
  await symlink(file('block-crush-drop.json'), file('symbolic.json'));
  for (const name of ['hard.json', 'symbolic.json']) {
    run(
      [
        'game',
        'block-crush-drop',
        'action edit',
        '--input',
        file('block-crush-drop.json'),
        '--options-file',
        file('options.json'),
        '--out',
        file(name),
      ],
      1,
    );
    assert.deepEqual(await readFile(file('block-crush-drop.json')), originalBytes);
  }
  const original = JSON.parse(await readFile(file('block-crush-drop.json'), 'utf8'));
  for (const [field, value, error] of [
    ['bgm', { assetId: 'not-present' }, 'AUDIO_ASSET_UNKNOWN: not-present'],
    ['selectedPackId', 'not-a-real-pack', 'AUDIO_PACK_UNSUPPORTED: not-a-real-pack'],
    ['selectedPackId', 'toString', 'AUDIO_PACK_UNSUPPORTED: toString'],
    ['cues', [{ eventType: 'x', assetId: 'missing-cue' }], 'AUDIO_ASSET_UNKNOWN: missing-cue'],
  ]) {
    const broken = structuredClone(original);
    broken.direction.production.audio[field] = value;
    await writeFile(file('broken.json'), JSON.stringify(broken));
    const result = run(
      ['game', 'block-crush-drop', 'project validate', '--input', file('broken.json')],
      1,
    );
    assert.match(result.report.error.message, new RegExp(error));
  }
  console.log('CLI Node smoke passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}
