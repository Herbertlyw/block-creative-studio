import { syntheticMultiCalibration } from './fixtures/syntheticMultiCalibration';
import { expect, it } from 'vitest';
import { prepareCalibratedRenderer } from '../src/contracts/calibratedRenderer';
import {
  selectWorkbenchCalibration,
  saveWorkbenchCalibrationTracks,
} from '../src/contracts/workbenchCalibration';
import { inlineBrowserStudioReferences } from '../src/contracts/browserAssetReferences';
import { editNativeActionTarget } from '../src/contracts/editNativeAction';
import { readBBFrame } from '../src/games/block-placement/planning/timelineFrameSource';
const source = () => JSON.parse(JSON.stringify(syntheticMultiCalibration()));
const cue = (d: unknown, take: string, frame: number) =>
  prepareCalibratedRenderer(d, take)
    .frameSource.evaluate(frame)
    .semanticEvents.map((e) => e.type);
it('binds distinct, authored tracks to the selected legal take while preserving v1 calibration', async () => {
  const doc = source(),
    before = JSON.stringify(doc),
    resolved = await inlineBrowserStudioReferences(doc, {});
  expect(cue(resolved.document, 'synthetic-take', 99)).toContain(
    'block-placement.placement-committed',
  );
  expect(cue(resolved.document, 'synthetic-alternate', 78)).toContain(
    'block-placement.placement-committed',
  );
  expect(cue(resolved.document, 'synthetic-alternate', 99)).not.toContain(
    'block-placement.placement-committed',
  );
  const a = prepareCalibratedRenderer(resolved.document, 'synthetic-take'),
    b = prepareCalibratedRenderer(resolved.document, 'synthetic-alternate');
  // The renderer receives the original two-Take document, not a reordered or
  // projected one-Take copy that happens to put the selected take first.
  expect((b as any).document).toBe(resolved.document);
  expect((b as any).document.takes.map((take: any) => take.takeId)).toEqual([
    'synthetic-take',
    'synthetic-alternate',
  ]);
  expect(a.frameSource.frameSourceHash).not.toBe(b.frameSource.frameSourceHash);
  expect(a.frameSource.evaluate(250).identity.stateHash).not.toBe(
    b.frameSource.evaluate(250).identity.stateHash,
  );
  expect(readBBFrame(a.frameSource.evaluate(250)).rules.gameState).not.toEqual(
    readBBFrame(b.frameSource.evaluate(250)).rules.gameState,
  );
  expect(JSON.stringify(doc)).toBe(before);
  const old = structuredClone(doc);
  delete old.direction.style.workbenchCalibrationV2;
  expect(prepareCalibratedRenderer(old, 'synthetic-take').frameSource.frameSourceHash).toBe(
    a.frameSource.frameSourceHash,
  );
  expect(() => prepareCalibratedRenderer(old, 'synthetic-alternate')).toThrow(
    /REFERENCE_CALIBRATION_TAKE_MISMATCH/,
  );
});
it('refuses missing, duplicate, stale, mismatched and unknown track data without changing the document', () => {
  const doc = source(),
    before = JSON.stringify(doc);
  let v = structuredClone(doc);
  v.direction.style.workbenchCalibrationV2.tracks.pop();
  expect(() => selectWorkbenchCalibration(v, 'synthetic-alternate')).toThrow(/缺少独立校准轨道/);
  v = structuredClone(doc);
  v.direction.style.workbenchCalibrationV2.tracks.push(
    structuredClone(v.direction.style.workbenchCalibrationV2.tracks[0]),
  );
  expect(() => selectWorkbenchCalibration(v, 'synthetic-take')).toThrow(/轨道重复/);
  v = structuredClone(doc);
  v.takes[1].actions[1].action.anchor.row = 2;
  expect(() => selectWorkbenchCalibration(v, 'synthetic-alternate')).toThrow(/轨道过期/);
  v = structuredClone(doc);
  v.direction.style.workbenchCalibrationV2.tracks[1].fps = 30;
  expect(() => selectWorkbenchCalibration(v, 'synthetic-alternate')).toThrow(/帧率/);
  v = structuredClone(doc);
  v.direction.style.workbenchCalibrationV2.tracks[1].calibration.actions[0].actionId = 'wrong';
  expect(() => prepareCalibratedRenderer(v, 'synthetic-alternate')).toThrow(/TIMING_INVALID/);
  v = structuredClone(doc);
  v.direction.style.workbenchCalibrationV2.tracks[1].future = {};
  expect(() => selectWorkbenchCalibration(v, 'synthetic-alternate')).toThrow(/合同无效/);
  expect(() => editNativeActionTarget(before, 1, 1, 2, 2)).toThrow(/不能同步重建校准/);
  expect(JSON.stringify(doc)).toBe(before);
});
it('requires explicitly supplied tracks, validates sprites, and preserves the original v1 JSON token', async () => {
  const doc = source();
  delete doc.direction.style.workbenchCalibrationV2;
  const text = JSON.stringify(doc, null, 2),
    old = JSON.stringify(doc.direction.style.referenceCalibration);
  const first = doc.direction.style.referenceCalibration,
    second = structuredClone(first);
  second.actions[0].release = 1.3;
  second.actions[0].start = 0.65;
  second.actions[0].clear = 1.45;
  await expect(saveWorkbenchCalibrationTracks(text, { 'synthetic-take': first })).rejects.toThrow(
    /缺少用户提供/,
  );
  const edited = await saveWorkbenchCalibrationTracks(text, {
    'synthetic-take': first,
    'synthetic-alternate': second,
  });
  expect(JSON.stringify(JSON.parse(edited).direction.style.referenceCalibration)).toBe(old);
  const bad = source();
  bad.direction.style.workbenchCalibrationV2.tracks[1].calibration.sprites.background =
    'asset:missing';
  expect(() => prepareCalibratedRenderer(bad, 'synthetic-alternate')).toThrow();
  const mismatch = source();
  mismatch.direction.style.agentAssets.entries['synthetic-background'].sha256 = '0'.repeat(64);
  await expect(inlineBrowserStudioReferences(mismatch, {})).rejects.toThrow(/SHA-256/);
  await expect(
    saveWorkbenchCalibrationTracks(JSON.stringify(mismatch), {
      'synthetic-take': first,
      'synthetic-alternate': second,
    }),
  ).rejects.toThrow(/SHA-256/);
  const future = source();
  future.direction.style.workbenchCalibrationV2.unknown = { enabled: true };
  await expect(
    saveWorkbenchCalibrationTracks(JSON.stringify(future), {
      'synthetic-take': first,
      'synthetic-alternate': second,
    }),
  ).rejects.toThrow(/未知或无效字段/);
  const stale = source();
  stale.takes[1].actions[1].action.anchor.row = 2;
  const staleText = JSON.stringify(stale);
  await expect(
    saveWorkbenchCalibrationTracks(staleText, {
      'synthetic-take': first,
      'synthetic-alternate': second,
    }),
  ).rejects.toThrow(/轨道过期/);
  expect(JSON.stringify(stale)).toBe(staleText);
  expect(JSON.parse(text)).toEqual(doc);
});
