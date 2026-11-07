import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractBlenderSceneBundle } from '../src/cli/blenderSceneBundle';
import { encodeStoredZip } from '../src/taptile/production/projectBundle';

const encoder = new TextEncoder();
const temporaryDirectories: string[] = [];

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function validBundle(): Uint8Array {
  const scene = encoder.encode('{"contract":"fixture"}\n');
  const manifest = encoder.encode(`${JSON.stringify({
    format: 'bcs-blender-scene-bundle',
    version: '1.0.0',
    packageId: 'fixture-package',
    scenePath: 'scene-exchange.json',
    assetCount: 0,
    sceneSha256: sha256(scene),
  })}\n`);
  const readme = encoder.encode('fixture\n');
  const payload = {
    'README.txt': readme,
    'manifests/blender-bundle.json': manifest,
    'scene-exchange.json': scene,
  };
  const checksums = Object.fromEntries(Object.entries(payload).map(([path, bytes]) => [path, sha256(bytes)]));
  return encodeStoredZip({ ...payload, 'checksums.json': encoder.encode(`${JSON.stringify(checksums)}\n`) });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Blender scene bundle CLI bridge', () => {
  it('verifies and safely extracts a browser-exported deterministic bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bcs-bundle-test-'));
    temporaryDirectories.push(root);
    const bundlePath = join(root, 'fixture.bcs-blender.zip');
    await writeFile(bundlePath, validBundle());
    const extracted = await extractBlenderSceneBundle(bundlePath);
    expect(extracted).toMatchObject({ packageId: 'fixture-package', assetCount: 0 });
    expect(await readFile(extracted.scenePath, 'utf8')).toBe('{"contract":"fixture"}\n');
    const extractedDirectory = extracted.directory;
    await extracted.cleanup();
    await expect(access(extractedDirectory)).rejects.toThrow();
  });

  it('rejects traversal paths before anything is written', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bcs-bundle-test-'));
    temporaryDirectories.push(root);
    const bundlePath = join(root, 'unsafe.zip');
    await writeFile(bundlePath, encodeStoredZip({ '../escape.txt': encoder.encode('blocked') }));
    await expect(extractBlenderSceneBundle(bundlePath)).rejects.toThrow('Unsafe bundle path');
  });

  it('rejects a payload whose checksum set was altered', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bcs-bundle-test-'));
    temporaryDirectories.push(root);
    const bundlePath = join(root, 'tampered.zip');
    const scene = encoder.encode('{}\n');
    await writeFile(bundlePath, encodeStoredZip({
      'scene-exchange.json': scene,
      'checksums.json': encoder.encode('{}\n'),
    }));
    await expect(extractBlenderSceneBundle(bundlePath)).rejects.toThrow('checksums do not cover exactly every payload file');
  });
});
