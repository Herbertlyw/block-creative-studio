import { expect, it } from 'vitest';
import parameters from './fixtures/observed-annotation.json';
import {
  invalidateObservedAnnotation,
  observedDraftBlockers,
  observedFramePosition,
} from '../src/contracts/observedDraftReview';
import { buildObservedTake } from '../src/contracts/buildObservedTake';
import { bindObservedCalibration } from '../src/contracts/bindObservedCalibration';
import type { ReferenceMeasurement } from '../src/contracts/referenceMeasurement';
import { syntheticObservedPackageFixture } from './fixtures/syntheticObserved';
import { createBBWorkPackage, openBBWorkPackage } from '../src/contracts/bbWorkPackage';
import { editBBProductionAudio } from '../src/contracts/editProductionAudio';
import { parseProductionDirection } from '../src/nativeReference/agent-director/contracts';

const hash = parameters.structured.sourceSha256;
const measurement: ReferenceMeasurement = {
  version: '1.0.0',
  source: {
    sha256: hash,
    width: 512,
    height: 864,
    fps: '30',
    frameCount: 151,
    firstTimestamp: 1024,
    timeBase: '1/15360',
  },
  timing: {
    mode: 'constant',
    timestampTicks: Array.from({ length: 151 }, (_, i) => 1024 + i * 512),
  },
};
const json = (value: unknown) => JSON.stringify(value);

it('retains source evidence, pointer tracks and all other sounds when speech changes in an observed work', async () => {
  const fixture = await syntheticObservedPackageFixture();
  const work = await createBBWorkPackage(fixture.project, fixture.pointer, fixture.source);
  const audio = parseProductionDirection(fixture.project.direction.production).audio!;
  const speechAsset = Object.values(audio.assets!)[0]!;
  audio.voices = [
    {
      id: 'observed-speech',
      takeId: 'observed-take',
      assetId: speechAsset.id,
      startSeconds: 0.5,
      gain: 0.7,
    },
  ];
  const withVoice = await editBBProductionAudio(work, audio);
  const changed = structuredClone(audio);
  changed.voices![0]!.gain = 0.25;
  const reopened = await openBBWorkPackage(
    JSON.parse(JSON.stringify(await editBBProductionAudio(withVoice, changed))),
  );
  const actual = parseProductionDirection((reopened.project as any).direction.production).audio!;
  expect(actual.bgm).toEqual(audio.bgm);
  expect(actual.cues).toEqual(audio.cues);
  expect(actual.assets).toEqual(audio.assets);
  expect(actual.voices![0]!.gain).toBe(0.25);
  expect(reopened.source!.observation).toEqual(work.source!.observation);
  expect(reopened.pointer!.tracks).toEqual(work.pointer!.tracks);
  expect((reopened.project as any).takes).toEqual((work.project as any).takes);
  expect(reopened.source!.link).not.toEqual(work.source!.link);
});

it('invalidates downstream action confirmations for forms and raw JSON, retaining unrelated and unknown data', () => {
  const before = structuredClone(parameters.structured);
  const changed: any = structuredClone(before);
  changed.future = { retained: true };
  changed.actions[1].row = 6;
  const next = JSON.parse(invalidateObservedAnnotation(json(before), json(changed)));
  expect(next.actions.map((a: any) => a.confirmed)).toEqual([true, false, false]);
  expect(next.future).toEqual({ retained: true });
  const board = structuredClone(before);
  board.board.cells[0]![0] = null;
  const rebased = JSON.parse(invalidateObservedAnnotation(json(before), json(board)));
  expect(rebased.board.confirmed).toBe(false);
  expect(rebased.actions.every((a: any) => !a.confirmed)).toBe(true);
  expect(invalidateObservedAnnotation(json(before), '{broken')).toBe('{broken');
  const confirm = structuredClone(before);
  confirm.actions[0]!.confirmed = false;
  expect(invalidateObservedAnnotation(json(before), json(confirm))).toBe(json(confirm));
});

it('reports specific unknown cells, action IDs, unsafe times and stale geometry bindings before generation', () => {
  const draft: any = structuredClone(parameters.structured);
  draft.board.cells[2][5] = 'unknown';
  draft.actions[1].confirmed = false;
  draft.actions[1].releaseFrame = 999;
  draft.actions[1].path[0].x = null;
  const geometry = structuredClone(parameters.geometry);
  geometry.motions[1]!.actionId = 'stale';
  const blockers = observedDraftBlockers(json(draft), json(geometry), measurement, hash);
  expect(blockers.map((b) => b.message).join(' ')).toMatch(/第 2 行的列 5/);
  expect(
    blockers.some((b) => b.message.includes(draft.actions[1].id) && b.message.includes('源帧')),
  ).toBe(true);
  expect(blockers.some((b) => b.scope === 'calibration' && b.message.includes('ID/顺序'))).toBe(
    true,
  );
  expect(
    observedDraftBlockers(
      json(parameters.structured),
      json(parameters.geometry),
      measurement,
      hash,
    ),
  ).toEqual([]);
  expect(
    observedDraftBlockers(json(parameters.structured), '', null, '1'.repeat(64)).some((b) =>
      /SHA-256/.test(b.message),
    ),
  ).toBe(true);
});

it('matches calibration ceil quantization, honors the measured time origin and refuses unsafe FPS or source frames', async () => {
  expect(observedFramePosition(measurement, 1, 24)).toEqual({
    seconds: 1 / 30,
    outputFrame: 1,
    outputSeconds: 1 / 24,
  });
  expect(() => observedFramePosition(measurement, 999, 30)).toThrow(/超出/);
  expect(() => observedFramePosition(measurement, 1, NaN)).toThrow(/输出帧率/);
  const bound = await bindObservedCalibration(
    parameters.structured,
    measurement,
    hash,
    512,
    864,
    parameters.geometry,
  );
  for (const [index, action] of parameters.structured.actions.entries()) {
    expect(observedFramePosition(measurement, action.releaseFrame, 30).outputFrame).toBe(
      bound.timing[index]!.release.frame,
    );
  }
});

it('rejects unknown state, illegal placements and wrong sources without changing the draft; names the Take and step', async () => {
  const illegal = structuredClone(parameters.structured);
  illegal.actions[0]!.row = 99;
  const before = json(illegal);
  await expect(buildObservedTake(illegal, measurement, hash, 512, 864)).rejects.toThrow();
  expect(json(illegal)).toBe(before);
  const mismatch = structuredClone(parameters.structured);
  mismatch.actions[0]!.clearRows = [];
  await expect(buildObservedTake(mismatch, measurement, hash, 512, 864)).rejects.toThrow(
    /Take「observed-take」第 1 步/,
  );
  await expect(
    buildObservedTake(parameters.structured, measurement, '1'.repeat(64), 512, 864),
  ).rejects.toThrow(/SHA-256/);
});
