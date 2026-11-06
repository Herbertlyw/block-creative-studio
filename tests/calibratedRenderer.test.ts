import { syntheticMultiCalibration } from './fixtures/syntheticMultiCalibration';
import { expect, it } from 'vitest';
import { prepareCalibratedRenderer } from '../src/contracts/calibratedRenderer';
import { inlineBrowserStudioReferences } from '../src/contracts/browserAssetReferences';
import {
  editNativeBoardCell,
  deleteNativeAction,
  editNativeBgm,
  editNativeCueGain,
  editNativeImageBinding,
} from '../src/contracts/editNativeDocument';
import { editNativeActionTarget } from '../src/contracts/editNativeAction';
import { inspectImageBytes } from '../src/nativeReference/agent-assets/image';
const fixture = () => {
  const doc = JSON.parse(JSON.stringify(syntheticMultiCalibration()));
  doc.takes.pop();
  delete doc.direction.style.workbenchCalibrationV2;
  doc.direction.production.audio.cues[1].eventType = 'block-placement.reference-clear-body';
  return doc;
};
it('uses the supplied calibrated driver and its own timing, preserving the source', async () => {
  const source = fixture(),
    before = JSON.stringify(source),
    inlined = await inlineBrowserStudioReferences(source, {});
  const prepared = prepareCalibratedRenderer(inlined.document, 'synthetic-take');
  expect(prepared.frameSource.fps).toBe(60);
  expect(prepared.frameSource.totalFrames).toBe(301);
  expect(prepared.frameSource.evaluate(99).semanticEvents.map((e) => e.type)).toContain(
    'block-placement.placement-committed',
  );
  expect(prepared.frameSource.evaluate(107).semanticEvents.map((e) => e.type)).toContain(
    'block-placement.reference-clear-body',
  );
  expect(prepared.frameSource.evaluate(240).semanticEvents.map((e) => e.type)).toContain(
    'block-placement.placement-committed',
  );
  expect(JSON.stringify(source)).toBe(before);
});

it('does not save gameplay edits that could leave calibrated timing stale', () => {
  const text = JSON.stringify(fixture()),
    before = JSON.parse(text);
  expect(() => editNativeBoardCell(text, 0, 0, 'coral')).toThrow(/不能同步重建校准/);
  expect(() => deleteNativeAction(text, 0, 0)).toThrow(/不能同步重建校准/);
  expect(() => editNativeActionTarget(text, 0, 0, 5, 4)).toThrow(/不能同步重建校准/);
  expect(JSON.parse(text)).toEqual(before);
});

it('validates audio edits and image-slot options against calibrated consumers', async () => {
  const text = JSON.stringify(fixture()),
    music = JSON.parse(await editNativeBgm(text, 'synthetic-take', 0.8, 0.2, true, 0.25));
  expect(music.direction.production.audio.bgm).toMatchObject({ startSeconds: 0.8, gain: 0.25 });
  const cue = JSON.parse(await editNativeCueGain(text, 'synthetic-take', 1, 0.3));
  expect(cue.direction.production.audio.cues[1].gain).toBe(0.3);
  const image = JSON.parse(
    await editNativeImageBinding(
      text,
      'background.base',
      'contain',
      0.5,
      'multiply',
      0,
      async (blob) => inspectImageBytes(new Uint8Array(await blob.arrayBuffer())),
    ),
  );
  expect(image.direction.style.agentAssets.bindings['background.base']).toMatchObject({
    fit: 'contain',
    opacity: 0.5,
    blendMode: 'multiply',
  });
});
it('rejects absent assets, stale hashes, wrong take and unconsumed material extensions', async () => {
  const bad = fixture();
  bad.direction.style.agentAssets.entries['synthetic-background'].sha256 = '0'.repeat(64);
  await expect(inlineBrowserStudioReferences(bad, {})).rejects.toThrow(/SHA-256/);
  const missing = fixture();
  delete missing.direction.style.agentAssets.entries['synthetic-background'];
  await expect(inlineBrowserStudioReferences(missing, {})).rejects.toThrow();
  const inlined = await inlineBrowserStudioReferences(fixture(), {});
  expect(() => prepareCalibratedRenderer(inlined.document, 'missing')).toThrow(/Take/);
  const future = structuredClone(inlined.document) as any;
  future.direction.style.referenceCalibration.actions[0].futureTiming = { speed: 2 };
  expect(() => prepareCalibratedRenderer(future, 'synthetic-take')).toThrow(/futureTiming/);
  const futureStyle = structuredClone(inlined.document) as any;
  futureStyle.direction.style.futureRenderer = { enabled: true };
  expect(() => prepareCalibratedRenderer(futureStyle, 'synthetic-take')).toThrow(/futureRenderer/);
  const production = structuredClone(inlined.document) as any;
  production.direction.production.camera = {};
  expect(() => prepareCalibratedRenderer(production, 'synthetic-take')).toThrow(/production/);
  (inlined.document as any).direction.style.materialVariant = { version: 1 };
  expect(() => prepareCalibratedRenderer(inlined.document, 'synthetic-take')).toThrow();
});

it('preserves a multi-take document but rejects a non-first take under the supplied calibration contract', async () => {
  const doc = fixture(),
    alternate = structuredClone(doc.takes[0]);
  alternate.takeId = 'alternate-take';
  doc.takes.push(alternate);
  const before = JSON.stringify(doc),
    inlined = await inlineBrowserStudioReferences(doc, {});
  expect(prepareCalibratedRenderer(inlined.document, 'synthetic-take').frameSource.takeId).toBe(
    'synthetic-take',
  );
  expect(() => prepareCalibratedRenderer(inlined.document, 'alternate-take')).toThrow(
    /REFERENCE_CALIBRATION_TAKE_MISMATCH/,
  );
  expect(JSON.stringify(doc)).toBe(before);
});
