import { syntheticObservedFixture } from './fixtures/syntheticObserved';
import { syntheticPng } from '../scripts/fixtures/syntheticMedia.mjs';
import { expect, it } from 'vitest';
import {
  attachObservedImages,
  copyObservedImageVariant,
} from '../src/contracts/attachObservedImages';
import { inlineBrowserStudioReferences } from '../src/contracts/browserAssetReferences';
import { inspectImageBytes } from '../src/nativeReference/agent-assets/image';
import { prepareCalibratedRenderer } from '../src/contracts/calibratedRenderer';
const base = (await syntheticObservedFixture()).document;
const project = () => structuredClone(base);
const image = (id: string) =>
  new File(
    [
      new Uint8Array(syntheticPng(id === 'synthetic-background' ? [20, 38, 60] : [200, 40, 60]))
        .buffer,
    ],
    id + '.png',
    { type: 'image/png' },
  );
const decode = async (bytes: Uint8Array) => inspectImageBytes(bytes);
it('binds verified PNG attachments to the calibrated renderer and preserves the input', async () => {
  const original = project(),
    before = JSON.stringify(original);
  const result = await attachObservedImages(
    original,
    { background: image('synthetic-background'), tile: image('generated-tile') },
    decode,
  );
  expect(JSON.stringify(original)).toBe(before);
  const cal = result.document.direction.style.referenceCalibration;
  expect(cal.sprites.background).toBe('asset:observed-background');
  for (const key of ['tilePink', 'tilePurple', 'tileBlue', 'tileWhite', 'tileCoral', 'tileCyan'])
    expect(cal.sprites[key]).toBe('asset:observed-tile');
  const saved = JSON.parse(JSON.stringify(result.document));
  const resolved = await inlineBrowserStudioReferences(saved, {});
  expect(
    prepareCalibratedRenderer(resolved.document, 'observed-take').frameSource.totalFrames,
  ).toBe(151);
  saved.direction.style.agentAssets.entries['observed-tile'].sha256 = '0'.repeat(64);
  await expect(inlineBrowserStudioReferences(saved, {})).rejects.toThrow();
  await expect(
    attachObservedImages(result.document, { tile: image('generated-tile') }, decode),
  ).rejects.toThrow(/原工程保留/);
});
it('rejects corrupt, unsupported, and incorrectly decoded images', async () => {
  await expect(
    attachObservedImages(project(), { background: new File(['bad'], 'bad.png') }, decode),
  ).rejects.toThrow(/损坏或格式不支持/);
  await expect(
    attachObservedImages(project(), { tile: image('generated-tile') }, async () => ({
      width: 1,
      height: 1,
    })),
  ).rejects.toThrow(/解码尺寸/);
  await expect(attachObservedImages(project(), {}, decode)).rejects.toThrow(/至少选择/);
});

it('copies the exact image layout without changing gameplay, clocks or audio', async () => {
  const source = await attachObservedImages(
    project(),
    { background: image('synthetic-background'), tile: image('generated-tile') },
    decode,
  );
  const before = JSON.stringify(source.document);
  const variant = await copyObservedImageVariant(
    source.document,
    { background: image('generated-tile'), tile: image('synthetic-background') },
    decode,
  );
  expect(JSON.stringify(source.document)).toBe(before);
  expect(variant.document.takes).toEqual(source.document.takes);
  expect(variant.document.game).toEqual(source.document.game);
  expect(variant.document.direction.production).toEqual(source.document.direction.production);
  const stale = structuredClone(source.document);
  stale.direction.style.agentAssets.entries['observed-tile'].sha256 = '0'.repeat(64);
  await expect(
    copyObservedImageVariant(
      stale,
      { background: image('generated-tile'), tile: image('synthetic-background') },
      decode,
    ),
  ).rejects.toThrow();
});
it('uses the real grey renderer slots and replaces one without touching the others', async () => {
  const { attachObservedGroupedImages, copyObservedGroupedVariant } = await import(
    '../src/contracts/attachObservedImages'
  );
  const source = project();
  const white = image('generated-tile'),
    coral = image('synthetic-background'),
    cyan = image('generated-tile');
  const result = await attachObservedGroupedImages(
    source,
    { background: image('synthetic-background'), white, coral, cyan },
    decode,
  );
  const cal = result.document.direction.style.referenceCalibration;
  expect(cal.sprites).toEqual({
    background: 'asset:observed-background',
    tileWhite: 'asset:observed-white',
    tileCoral: 'asset:observed-coral',
    tileCyan: 'asset:observed-cyan',
  });
  const variant = await copyObservedGroupedVariant(result.document, 'coral', white, decode);
  expect(variant.document.takes).toEqual(result.document.takes);
  expect(variant.document.direction.production).toEqual(result.document.direction.production);
  expect(variant.document.direction.style.agentAssets.entries['observed-white']).toEqual(
    result.document.direction.style.agentAssets.entries['observed-white'],
  );
  expect(variant.document.direction.style.agentAssets.entries['observed-cyan']).toEqual(
    result.document.direction.style.agentAssets.entries['observed-cyan'],
  );
  const bad = structuredClone(result.document);
  bad.direction.style.referenceCalibration.theme = 'pink';
  const resolved = await inlineBrowserStudioReferences(bad, {});
  expect(() => prepareCalibratedRenderer(resolved.document, 'observed-take')).toThrow(/分槽/);
  await expect(
    attachObservedGroupedImages(source, { white, coral, cyan: undefined as any }, decode),
  ).rejects.toThrow(/必须提供/);
});
