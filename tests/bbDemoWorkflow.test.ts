import { syntheticMultiCalibration } from './fixtures/syntheticMultiCalibration';
import { syntheticObservedPackageFixture } from './fixtures/syntheticObserved';
import { syntheticPortableFixture } from './fixtures/syntheticPortable';
import { syntheticPng, syntheticWav } from '../scripts/fixtures/syntheticMedia.mjs';
import { expect, it, vi } from 'vitest';
import {
  createBBWorkPackage,
  openBBWorkPackage,
  updateBBWorkPackageProject,
  importBBWorkDocument,
} from '../src/contracts/bbWorkPackage';
import { restoreObservedWork } from '../src/contracts/restoreObservedWork';
import { mergeObservedEdit } from '../src/contracts/mergeObservedEdit';
import { bindObservedCalibration } from '../src/contracts/bindObservedCalibration';
import { createObservedSourceLink, projectContentHash } from '../src/contracts/observedSourceLink';
import { setNativeWorkAudio } from '../src/contracts/setNativeWorkAudio';
import { setNativeWorkImage } from '../src/contracts/setNativeWorkImage';
import { pruneSupersededAssets } from '../src/contracts/pruneSupersededAssets';
import { setObservedWorkVisual } from '../src/contracts/setObservedWorkVisual';
import { inspectImageBytes } from '../src/nativeReference/agent-assets/image';
import { createNativeWork, generateNativeMachineTake } from '../src/contracts/nativeWorkAuthor';
import { prepareCalibratedRenderer } from '../src/contracts/calibratedRenderer';
import { readBBFrame } from '../src/games/block-placement/planning/timelineFrameSource';
import { parseCalibrationRackCenters } from '../src/contracts/calibrationRack';
import * as audioMix from '../src/nativeReference/agent-director/audioMix';
const sourceFixture = await syntheticObservedPackageFixture();
const sourceWork = () => ({
  format: 'bcs-bb-work',
  version: '1.0.0',
  project: structuredClone(sourceFixture.project),
  pointer: structuredClone(sourceFixture.pointer),
  source: structuredClone(sourceFixture.source),
});
const wav = (id: string) =>
  new File(
    [new Uint8Array(syntheticWav(id === 'music' ? 220 : id === 'placement' ? 740 : 1120)).buffer],
    `${id}.wav`,
    { type: 'audio/wav' },
  );
const decoder = async (blob: Blob) => inspectImageBytes(new Uint8Array(await blob.arrayBuffer()));
const png = () =>
  new File([new Uint8Array(syntheticPng([50, 100, 150])).buffer], 'replacement.png', {
    type: 'image/png',
  });

it('resumes a renamed, rebound observation without resetting media, mixes, effects or identity', async () => {
  const original = await openBBWorkPackage(sourceWork()),
    before = JSON.stringify(original);
  const doc = structuredClone(original.project) as any;
  doc.name = '复刻变体';
  doc.id = 'retained-work-id';
  doc.direction.production.audio.cues[0].offsetSeconds = 0.012;
  let work = await updateBBWorkPackageProject(original, doc);
  work = await setNativeWorkAudio(work, 'bgm', wav('placement'));
  work = await setNativeWorkImage(work, 'tile.face', png(), decoder);
  work = await setObservedWorkVisual(work, 'all', { clearStyle: 'spark-strip' });
  const restored = await restoreObservedWork(JSON.parse(JSON.stringify(work)));
  expect(restored.images.tile?.name).toBe('replacement.png');
  expect(restored.sounds.bgm?.name).toBe('placement.wav');
  const observation = structuredClone(work.source!.observation) as any,
    g = JSON.parse(restored.geometry);
  g.rackCenters = [210, 550, 890];
  g.motions[0].points[0].x += 8;
  observation.geometry = JSON.stringify(g);
  const m = observation.measurement,
    s = m.source;
  const measured = await bindObservedCalibration(
    JSON.parse(observation.structured),
    m,
    s.sha256,
    s.width,
    s.height,
    g,
  );
  const merged = mergeObservedEdit(restored.template, measured.document) as any;
  const expected = work.project as any;
  expect(merged.name).toBe(expected.name);
  expect(merged.id).toBe(expected.id);
  expect(merged.direction.production).toEqual(expected.direction.production);
  expect(merged.direction.style.agentAssets).toEqual(expected.direction.style.agentAssets);
  expect(merged.direction.style.referenceCalibration.actions[0].clearStyle).toBe('spark-strip');
  expect(merged.takes).toEqual(expected.takes);
  const pointer = work.pointer
    ? { ...work.pointer, projectSha256: await projectContentHash(merged) }
    : null;
  const link = await createObservedSourceLink(merged, observation, s.sha256, s.width, s.height);
  const reopened = await createBBWorkPackage(merged, pointer, { link, observation });
  expect((await openBBWorkPackage(JSON.parse(JSON.stringify(reopened)))).project).toEqual(merged);
  expect(JSON.stringify(original)).toBe(before);
});

it('keeps per-event sounds in the template and does not flatten them to a single recovered file', async () => {
  const work = await openBBWorkPackage(sourceWork()),
    doc = structuredClone(work.project) as any;
  const cues = doc.direction.production.audio.cues,
    first = cues.find((cue: any) => cue.eventType === 'block-placement.placement-committed');
  cues.push({
    ...first,
    eventId: 'custom-placement-event',
    assetId: 'clear',
    gain: 0.12,
    offsetSeconds: 0.05,
  });
  const changed = await updateBBWorkPackageProject(work, doc),
    restored = await restoreObservedWork(changed);
  expect(restored.sounds.placement).toBeUndefined();
  expect((restored.template.project as any).direction.production.audio).toEqual(
    doc.direction.production.audio,
  );
});

it('adds missing WAV roles in any order, then prunes only unreferenced superseded payloads', async () => {
  let work = await generateNativeMachineTake(await createNativeWork(), 'machine', 2);
  work = await setNativeWorkAudio(work, 'placement', wav('placement'));
  const first = (work.project as any).direction.production.audio;
  expect(first.cues.map((cue: any) => cue.eventType)).toEqual([
    'block-placement.placement-committed',
  ]);
  work = await setNativeWorkAudio(work, 'bgm', wav('music'));
  work = await setNativeWorkAudio(work, 'clear', wav('clear'));
  const configured = (work.project as any).direction.production.audio,
    oldBgm = configured.bgm.assetId;
  expect(configured.cues.map((cue: any) => cue.eventType)).toEqual([
    'block-placement.placement-committed',
    'block-placement.line-cleared',
    'block-placement.cross-cleared',
  ]);
  const changed = await setNativeWorkAudio(work, 'bgm', wav('placement')),
    next = (changed.project as any).direction.production.audio;
  expect(next.assets[oldBgm]).toBeUndefined();
  expect(next.cues).toEqual(configured.cues);
  expect({ ...next.bgm, assetId: oldBgm }).toEqual(configured.bgm);
  await expect(
    setNativeWorkAudio(changed, 'clear', new File(['invalid'], 'broken.wav')),
  ).rejects.toThrow();
  const reverse = await setNativeWorkAudio(await createNativeWork(), 'bgm', wav('music'));
  expect((await setNativeWorkAudio(reverse, 'clear', wav('clear'))).project).toBeTruthy();
});

it('does not garbage collect a shared, indirectly referenced or intentionally saved asset', () => {
  const doc = {
    direction: {
      style: {
        agentAssets: {
          entries: {
            old: { id: 'old', data: 'pixels' },
            shared: { id: 'shared' },
            kept: { id: 'kept', data: { ref: 'asset:old' } },
            unused: { id: 'unused' },
          },
          bindings: { board: { assetId: 'shared' } },
        },
      },
      production: { audio: { assets: { music: { id: 'music' } }, bgm: { assetId: 'music' } } },
    },
  };
  expect(pruneSupersededAssets(doc, ['old', 'shared', 'unused', 'music'])).toEqual(['unused']);
  expect(doc.direction.style.agentAssets.entries.old).toBeTruthy();
});

it('replaces a unified image repeatedly without accumulating unreachable copies', async () => {
  const original = await createNativeWork();
  const a = await setNativeWorkImage(original, 'tile.face', png(), decoder);
  const replacement = new File([new Uint8Array(syntheticPng([220, 70, 60])).buffer], 'other.png', {
    type: 'image/png',
  });
  const b = await setNativeWorkImage(a, 'tile.face', replacement, decoder);
  expect(Object.keys((b.project as any).direction.style.agentAssets.entries)).toHaveLength(1);
  expect(Object.keys((a.project as any).direction.style.agentAssets.entries)).toHaveLength(1);
});

it('checks broken cue references when opening without allocating a full PCM mix', async () => {
  const spy = vi.spyOn(audioMix, 'compileProductionAudio');
  try {
    const work = await openBBWorkPackage(sourceWork());
    expect(spy).not.toHaveBeenCalled();
    const doc = structuredClone(work.project) as any;
    doc.direction.production.audio.cues[0].assetId = 'missing';
    await expect(createBBWorkPackage(doc, null, null)).rejects.toThrow(/AUDIO_ASSET_UNKNOWN/);
  } finally {
    spy.mockRestore();
  }
});

it('selected directories turn an external-reference project into a portable reopenable copy', async () => {
  const { project: input, files } = await syntheticPortableFixture(),
    text = JSON.stringify(input);
  await expect(importBBWorkDocument(input)).rejects.toThrow(/尚未选择/);
  const work = await importBBWorkDocument(input, {
    project: files.project,
    cas: files.cas,
    library: files.library,
  });
  expect((work.project as any).takes).toEqual(input.takes);
  expect(JSON.stringify(input)).toBe(text);
  expect(await openBBWorkPackage(JSON.parse(JSON.stringify(work)))).toEqual(work);
  expect(JSON.stringify(work)).not.toContain('"encoding":"ref"');
});

it('uses optional candidate centers in resting frames and preserves the old default when absent', async () => {
  const work = sourceWork(),
    observation = work.source.observation,
    g = JSON.parse(observation.geometry),
    m = observation.measurement,
    s = m.source;
  const old = prepareCalibratedRenderer(work.project, 'observed-take');
  g.rackCenters = [160, 520, 910];
  const result = await bindObservedCalibration(
    JSON.parse(observation.structured),
    m,
    s.sha256,
    s.width,
    s.height,
    g,
  );
  const frame = readBBFrame(
    prepareCalibratedRenderer(result.document, 'observed-take').frameSource.evaluate(0),
  );
  const previous = readBBFrame(old.frameSource.evaluate(0));
  expect(frame.rackDrawables.map((piece) => piece.x + (piece.cols * piece.pitch) / 2)).toEqual(
    g.rackCenters,
  );
  expect(previous.rackDrawables.map((piece) => piece.x + (piece.cols * piece.pitch) / 2)).toEqual([
    236, 540, 844,
  ]);
  for (const centers of [
    [300, 200, 600],
    [300, 300, 600],
    [-1, 300, 600],
    [100, 400, 1081],
    [100, 200],
  ])
    expect(() => parseCalibrationRackCenters(centers)).toThrow();
});

it('applies a visual variant to one selected calibration without altering other Takes or media', async () => {
  const original = await createBBWorkPackage(syntheticMultiCalibration(), null, null),
    before = original.project as any;
  const changed = await setObservedWorkVisual(original, 'synthetic-alternate', {
      clearStyle: 'spark-strip',
    }),
    after = changed.project as any;
  expect(after.direction.style.workbenchCalibrationV2.tracks[0]).toEqual(
    before.direction.style.workbenchCalibrationV2.tracks[0],
  );
  expect(
    after.direction.style.workbenchCalibrationV2.tracks[1].calibration.actions.every(
      (action: any) => action.clearStyle === 'spark-strip',
    ),
  ).toBe(true);
  expect(after.takes).toEqual(before.takes);
  expect(after.direction.production).toEqual(before.direction.production);
  expect(after.direction.style.agentAssets).toEqual(before.direction.style.agentAssets);
  for (const take of after.takes)
    expect(prepareCalibratedRenderer(after, take.takeId).frameSource.totalFrames).toBe(
      prepareCalibratedRenderer(before, take.takeId).frameSource.totalFrames,
    );
});
