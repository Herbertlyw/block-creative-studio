import { syntheticObservedPackageFixture } from './fixtures/syntheticObserved';
import { expect, it } from 'vitest';
import { createBBWorkPackage, openBBWorkPackage } from '../src/contracts/bbWorkPackage';
it('opens a self-contained project with verified pointer and source without altering the inputs', async () => {
  const f = await syntheticObservedPackageFixture(),
    before = JSON.stringify(f),
    work = await createBBWorkPackage(f.project, f.pointer, f.source);
  expect(JSON.stringify(f)).toBe(before);
  expect(await openBBWorkPackage(JSON.parse(JSON.stringify(work)))).toEqual(work);
});
it('rejects unknown fields, wrong pointer, changed observations, invalid media and stale gameplay', async () => {
  const f = await syntheticObservedPackageFixture(),
    work = await createBBWorkPackage(f.project, f.pointer, f.source);
  await expect(openBBWorkPackage({ ...work, unknown: true })).rejects.toThrow(/未知字段/);
  const a = structuredClone(work);
  a.pointer!.tracks[0]!.actionId = 'wrong';
  await expect(openBBWorkPackage(a)).rejects.toThrow(/动作 ID/);
  const b = structuredClone(work);
  (b.source!.observation as any).geometry += ' ';
  await expect(openBBWorkPackage(b)).rejects.toThrow(/观察记录/);
  const c = structuredClone(work);
  (c.project as any).direction.style.agentAssets.entries['observed-coral'].sha256 = '0'.repeat(64);
  await expect(openBBWorkPackage(c)).rejects.toThrow();
  const d = structuredClone(work);
  (d.project as any).takes[0].actions[0].id = 'wrong';
  await expect(openBBWorkPackage(d)).rejects.toThrow();
  await expect(
    openBBWorkPackage({ format: 'block-creative-studio-project', version: '1.0.0' }),
  ).rejects.toThrow(/格式/);
});
it('recovers media by consumer role while rejecting a tampered source identity', async () => {
  const f = await syntheticObservedPackageFixture(),
    work = await createBBWorkPackage(f.project, f.pointer, f.source);
  const { restoreObservedWork } = await import('../src/contracts/restoreObservedWork');
  const { inspectImageBytes } = await import('../src/nativeReference/agent-assets/image');
  const restored = await restoreObservedWork(work, async (bytes) => inspectImageBytes(bytes));
  expect(Object.keys(restored.images).sort()).toEqual(['background', 'coral', 'cyan', 'white']);
  expect(Object.keys(restored.sounds).sort()).toEqual(['bgm', 'clear', 'placement']);
  expect(restored.legacyClearCue).toBe(false);
  const legacy = await syntheticObservedPackageFixture({ legacyClearCue: true });
  const legacyWork = await createBBWorkPackage(legacy.project, legacy.pointer, legacy.source);
  expect(
    (await restoreObservedWork(legacyWork, async (bytes) => inspectImageBytes(bytes)))
      .legacyClearCue,
  ).toBe(true);
  expect(restored.pointer).toEqual(f.pointer);
  const modified = structuredClone(work);
  (modified.project as any).name = 'different';
  await expect(
    restoreObservedWork(modified, async (bytes) => inspectImageBytes(bytes)),
  ).rejects.toThrow(/工程身份|旁车不一致/);
});
it('safely rebinds a renamed project and refuses an edit that invalidates the source', async () => {
  const f = await syntheticObservedPackageFixture(),
    work = await createBBWorkPackage(f.project, f.pointer, f.source);
  const { updateBBWorkPackageProject } = await import('../src/contracts/bbWorkPackage');
  const renamed = structuredClone(f.project);
  renamed.name = 'new name';
  const next = await updateBBWorkPackageProject(work, renamed);
  expect((next.project as any).name).toBe('new name');
  expect(next.pointer!.tracks).toEqual(work.pointer!.tracks);
  expect((work.project as any).name).not.toBe('new name');
  const moved = structuredClone(f.project);
  moved.direction.style.referenceCalibration.board[0] += 1;
  await expect(updateBBWorkPackageProject(work, moved)).rejects.toThrow(/不能保留/);
});
it('rejects corrupt image or WAV bytes even when their declared hashes are recomputed', async () => {
  const f = await syntheticObservedPackageFixture(),
    work = await createBBWorkPackage(f.project, f.pointer, f.source);
  const { sha256Hex } = await import('../src/nativeReference/agent-assets/image');
  const bytes = new TextEncoder().encode('not valid media'),
    data = btoa(String.fromCharCode(...bytes)),
    sha256 = await sha256Hex(bytes);
  const brokenImage = structuredClone(work),
    image = (brokenImage.project as any).direction.style.agentAssets.entries['observed-coral'];
  image.data = data;
  image.sha256 = sha256;
  image.byteLength = bytes.length;
  await expect(openBBWorkPackage(brokenImage)).rejects.toThrow(/图片|素材/);
  const brokenAudio = structuredClone(work),
    audio = (brokenAudio.project as any).direction.production.audio.assets.placement;
  audio.data = data;
  audio.sha256 = sha256;
  await expect(openBBWorkPackage(brokenAudio)).rejects.toThrow();
});
it('marks a changed source-bound work as derived and retains the declared parent identity', async () => {
  const f = await syntheticObservedPackageFixture(),
    work = await createBBWorkPackage(f.project, f.pointer, f.source);
  const { updateBBWorkPackageProject } = await import('../src/contracts/bbWorkPackage');
  const { projectContentHash } = await import('../src/contracts/observedSourceLink');
  const changed = structuredClone(f.project);
  changed.name = 'derived';
  const variant = await updateBBWorkPackageProject(work, changed);
  expect(variant.source?.provenance).toEqual({
    relation: 'derived',
    parentProjectSha256: await projectContentHash(work.project),
  });
  expect((await openBBWorkPackage(JSON.parse(JSON.stringify(variant)))).source?.provenance).toEqual(
    variant.source?.provenance,
  );
});
