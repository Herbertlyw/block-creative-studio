import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const checker = fileURLToPath(new URL('./check-repository-cleanliness.mjs', import.meta.url));

function inspect(files, untracked = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bb-repository-policy-'));
  const put = (entries) => {
    for (const [path, content] of Object.entries(entries)) {
      mkdirSync(dirname(resolve(root, path)), { recursive: true });
      writeFileSync(resolve(root, path), content);
    }
  };
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    put(files);
    execFileSync('git', ['add', '.'], { cwd: root });
    put(untracked);
    return spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('accepts source assets and tracked documentation with encoded paths and directories', () => {
  const result = inspect({
    'README.md': '[guide](<docs/quick start.md>) [assets](src/assets/) [anchor](#usage)',
    'docs/quick start.md': '[home](../README.md#usage) [root](../)',
    'src/assets/tile.webp': Buffer.from([1, 2, 3]),
    'public/icon.png': Buffer.from([1, 2, 3]),
  });
  assert.equal(result.status, 0, result.stderr);
});

test('rejects generated media and archives even when explicitly staged', () => {
  const result = inspect({
    'videos/demo.MP4': 'video',
    'audio/music.mp3': 'audio',
    'handoff.zip': 'archive',
    'screenshots/preview.webp': 'image',
  });
  assert.equal(result.status, 1);
  for (const name of ['demo.MP4', 'music.mp3', 'handoff.zip', 'preview.webp'])
    assert.ok(result.stderr.includes(name), result.stderr);
});

test('rejects retired handoff snapshots and cache files', () => {
  const result = inspect({
    'contracts/bb/supplement-old/source.ts': 'export {};',
    'reference-materials/old.md': 'retired snapshot',
    '__pycache__/task.pyc': 'cache',
    'README.md.orig': 'backup',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /4 finding/);
});

test('rejects large inline projects without inspecting or logging their payload', () => {
  const result = inspect({ 'examples/large.json': 'x'.repeat(1024 * 1024 + 1) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exceeds 1 MiB/);
  assert.ok(result.stderr.length < 500);
});

test('detects source dependencies on retired generated fixtures', () => {
  const retired = ['examples', 'generated', 'old.json'].join('/');
  const result = inspect({ 'src/fixture.ts': `export const source = '${retired}';` });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /dependency: src\/fixture.ts/);
});

test('rejects missing links and links to files present only on the author machine', () => {
  const result = inspect(
    { 'README.md': '[missing](missing.md) [private](notes/private.md)' },
    { 'notes/private.md': 'not part of the repository' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /2 finding/);
});

test('ignores fenced examples, remote URLs and current-document fragments', () => {
  const result = inspect({
    'README.md': [
      '```md',
      '[illustrative](not-a-real-file.md)',
      '```',
      '[online](https://example.com) [section](#usage)',
    ].join('\n'),
  });
  assert.equal(result.status, 0, result.stderr);
});

test('reports malformed URL encoding without throwing an unhandled error', () => {
  const result = inspect({ 'README.md': '[bad](%zz)' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid URL encoding/);
});
