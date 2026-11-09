import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syntheticJpeg, syntheticPng } from './fixtures/syntheticMedia.mjs';
const dir = await mkdtemp(join(tmpdir(), 'bcs-assets-'));
const path = (n) => join(dir, n);
const run = (args, status = 0) => {
  const p = spawnSync(process.execPath, ['dist-cli/bcs.js', ...args, '--json'], {
    encoding: 'utf8',
    timeout: 90000,
  });
  assert.equal(p.status, status, p.stdout + p.stderr);
  return JSON.parse(p.stdout);
};
const option = async (n, v) => {
  await writeFile(path(n), JSON.stringify(v));
};
const edit = (g, id, input, opt, out, status = 0) =>
  run(
    ['game', g, id, '--input', path(input), '--options-file', path(opt), '--out', path(out)],
    status,
  );
try {
  await writeFile(path('image.png'), syntheticPng([100, 80, 40], 32, 32));
  await writeFile(path('different.png'), syntheticPng([30, 100, 70], 32, 32));
  await writeFile(path('image.jpg'), syntheticJpeg([100, 80, 40], 32, 32));
  await writeFile(path('broken.png'), Buffer.from('not an image'));
  for (const [game, prefix, slot] of [
    ['block-placement', 'bb', 'tile.face'],
    ['block-crush-drop', 'bc', 'world.background'],
  ]) {
    run(['game', game, 'project create', '--out', path(`${prefix}.json`)]);
    await option('import.json', { id: 'image', file: 'image.png' });
    edit(game, 'asset import', `${prefix}.json`, 'import.json', `${prefix}-asset.json`);
    await option('bind.json', { assetId: 'image', slotId: slot });
    edit(game, 'asset bind', `${prefix}-asset.json`, 'bind.json', `${prefix}-bound.json`);
    await option('inspect.json', { assetId: 'image' });
    const inspect = run([
      'game',
      game,
      'asset inspect',
      '--input',
      path(`${prefix}-bound.json`),
      '--options-file',
      path('inspect.json'),
    ]);
    assert.equal(inspect.report.asset.slots[0], slot);
    assert.equal(inspect.report.canDelete, false);
    assert.equal(JSON.stringify(inspect).includes('iVBOR'), false);
    await option('unbind.json', { slotId: slot });
    edit(game, 'asset unbind', `${prefix}-bound.json`, 'unbind.json', `${prefix}-unbound.json`);
    await option('empty.json', {});
    const pruned = edit(
      game,
      'asset prune',
      `${prefix}-unbound.json`,
      'empty.json',
      `${prefix}-pruned.json`,
    );
    assert.ok(pruned.report.removedAssetIds.includes('image'));
    await option('conflict.json', { id: 'image', file: 'different.png' });
    const failed = edit(
      game,
      'asset import',
      `${prefix}-asset.json`,
      'conflict.json',
      `${prefix}-conflict.json`,
      1,
    );
    assert.match(failed.report.error.message, /CONFLICT/);
    await assert.rejects(access(path(`${prefix}-conflict.json`)), { code: 'ENOENT' });
  }
  await option('broken.json', { id: 'bad', file: 'broken.png' });
  edit('block-crush-drop', 'asset import', 'bc.json', 'broken.json', 'bc-broken.json', 1);
  await assert.rejects(access(path('bc-broken.json')), { code: 'ENOENT' });
  await option('jpeg.json', { id: 'jpeg', file: 'image.jpg' });
  edit('block-crush-drop', 'asset import', 'bc.json', 'jpeg.json', 'bc-jpeg.json');
  await option('palette.json', { assetId: 'jpeg', slotId: 'tile.palette' });
  edit('block-crush-drop', 'asset bind', 'bc-jpeg.json', 'palette.json', 'bc-palette.json');
  const palette = JSON.parse(await readFile(path('bc-palette.json'), 'utf8'));
  const paletteId = palette.direction.style.agentAssets.bindings['tile.palette'].assetId;
  assert.equal(palette.direction.style.agentAssets.entries[paletteId].mimeType, 'image/png');
  assert.equal(palette.direction.style.agentAssets.entries[paletteId].provenance.sourceRef, 'jpeg');
  await option('empty.json', {});
  const retained = edit(
    'block-crush-drop',
    'asset prune',
    'bc-palette.json',
    'empty.json',
    'bc-palette-pruned.json',
  );
  assert.equal(retained.report.removedAssetIds.includes('jpeg'), false);
  const uncertain = JSON.parse(await readFile(path('bc-asset.json'), 'utf8'));
  uncertain.direction.style.unknownExtension = { mysteryRef: 'opaque-reference' };
  await writeFile(path('bc-uncertain.json'), JSON.stringify(uncertain));
  const conservative = edit(
    'block-crush-drop',
    'asset prune',
    'bc-uncertain.json',
    'empty.json',
    'bc-uncertain-pruned.json',
  );
  assert.deepEqual(conservative.report.removedAssetIds, []);
  assert.ok(
    conservative.report.unknownReferences.includes(
      'project.direction.style.unknownExtension.mysteryRef',
    ),
  );
  console.log('CLI image workflows passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}
