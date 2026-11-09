import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dir = await mkdtemp(join(tmpdir(), 'bcs-takes-'));
const path = (n) => join(dir, n);
const run = (args, status = 0) => {
  const p = spawnSync(process.execPath, ['dist-cli/bcs.js', ...args, '--json'], {
    encoding: 'utf8',
  });
  assert.equal(p.status, status, p.stdout + p.stderr);
  const r = JSON.parse(p.stdout);
  assert.equal(r.ok, status === 0);
  return r;
};
const option = async (name, obj) => {
  await writeFile(path(name), JSON.stringify(obj));
  return path(name);
};
const edit = (game, id, input, options, out, status = 0) =>
  run(
    ['game', game, id, '--input', path(input), '--options-file', path(options), '--out', path(out)],
    status,
  );
try {
  for (const [game, prefix] of [
    ['block-placement', 'bb'],
    ['block-crush-drop', 'bc'],
  ]) {
    run(['game', game, 'project create', '--out', path(`${prefix}.json`)]);
    await option('generate.json', { takeId: 'new', count: 1 });
    edit(game, 'take generate', `${prefix}.json`, 'generate.json', `${prefix}-new.json`);
    const made = JSON.parse(await readFile(path(`${prefix}-new.json`), 'utf8'));
    const project = game === 'block-placement' ? made.project : made;
    const generated = project.takes.find((t) => t.takeId === 'new');
    assert.ok(generated.actions.length);
    if (game === 'block-placement') {
      await option('move.json', { takeId: 'new', index: 0, row: 0, column: 0 });
      edit(game, 'action edit', `${prefix}-new.json`, 'move.json', `${prefix}-move.json`);
      const moved = JSON.parse(await readFile(path(`${prefix}-move.json`), 'utf8'));
      assert.equal(moved.project.takes[0].actions[0].action.anchor.col, 0);
    }
    await option('query.json', { takeId: 'new' });
    const inspected = run([
      'game',
      game,
      'take inspect',
      '--input',
      path(`${prefix}-new.json`),
      '--options-file',
      path('query.json'),
    ]);
    assert.equal(inspected.report.takeId, 'new');
    run([
      'game',
      game,
      'take validate',
      '--input',
      path(`${prefix}-new.json`),
      '--options-file',
      path('query.json'),
    ]);
    await option('clone.json', { takeId: 'new', newTakeId: 'copy' });
    edit(game, 'take clone', `${prefix}-new.json`, 'clone.json', `${prefix}-clone.json`);
    const cloned = JSON.parse(await readFile(path(`${prefix}-clone.json`), 'utf8'));
    const clone = (game === 'block-placement' ? cloned.project : cloned).takes.find(
      (t) => t.takeId === 'copy',
    );
    assert.deepEqual(clone.actions, generated.actions);
    await writeFile(path('replay.json'), JSON.stringify(clone));
    await option('import.json', { file: 'replay.json' });
    edit(game, 'take import', `${prefix}-new.json`, 'import.json', `${prefix}-import.json`);
    edit(game, 'take delete', `${prefix}-clone.json`, 'query.json', `${prefix}-delete.json`);
    const remain = JSON.parse(await readFile(path(`${prefix}-delete.json`), 'utf8'));
    assert.ok(
      (game === 'block-placement' ? remain.project : remain).takes.some((t) => t.takeId === 'copy'),
    );
    edit(game, 'take clone', `${prefix}-clone.json`, 'clone.json', `${prefix}-conflict.json`, 1);
    await assert.rejects(access(path(`${prefix}-conflict.json`)), { code: 'ENOENT' });
    await option('range.json', { takeId: 'other', count: 999 });
    edit(game, 'take generate', `${prefix}.json`, 'range.json', `${prefix}-bad.json`, 2);
  }
  console.log('CLI Take workflows passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}
