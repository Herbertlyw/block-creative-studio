import { syntheticPortableFixture } from './fixtures/syntheticPortable';
import { syntheticLookProject } from './fixtures/syntheticLookProject';
import { syntheticMultiCalibration } from './fixtures/syntheticMultiCalibration';
import { describe, expect, it } from 'vitest';
import {
  assertBrowserReferenceCompatibility,
  createBrowserAssetRefReader,
  hasStudioAssetReferences,
  inlineBrowserStudioReferences,
} from '../src/contracts/browserAssetReferences';
import { resolveEmbeddedAssets } from '../src/contracts/embeddedAssets';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import { compileNativeProductionAudio } from '../src/contracts/nativeProductionAudio';
import { inspectImageBytes } from '../src/nativeReference/agent-assets/image';
import { parseAgentAssetRef } from '../src/nativeReference/agent-assets/refs';
const portable = await syntheticPortableFixture();
const fixture = () => JSON.parse(JSON.stringify(portable.project));
const files = (folder: 'project' | 'store' | 'library', rootName: string = folder): File[] => {
  const kind = folder === 'store' ? 'cas' : folder;
  return portable.files[kind].map((original) => {
    const f = new File([original], original.name);
    Object.defineProperty(f, 'webkitRelativePath', {
      value: `${rootName}/${original.webkitRelativePath.split('/').slice(1).join('/')}`,
    });
    return f;
  });
};
const sources = () => ({
  project: files('project'),
  cas: files('store'),
  library: files('library'),
});
const image = (doc: ReturnType<typeof fixture>, slot: string) =>
  doc.direction.style.agentAssets.entries[doc.direction.style.agentAssets.bindings[slot].assetId];
const music = (doc: ReturnType<typeof fixture>) =>
  doc.direction.production.audio.assets[doc.direction.production.audio.bgm.assetId];
const decoder = async (blob: Blob) => inspectImageBytes(new Uint8Array(await blob.arrayBuffer()));
describe('user-selected project, CAS and element-library directories', () => {
  it('resolves project attachments, CAS and library images and WAVs without changing the stored document', async () => {
    const doc = fixture(),
      before = JSON.stringify(doc);
    expect(hasStudioAssetReferences(doc)).toBe(true);
    const result = await inlineBrowserStudioReferences(doc, sources());
    expect(result.report.resolvedAssets).toBe(6);
    expect(JSON.stringify(doc)).toBe(before);
    const assets = await resolveEmbeddedAssets(result.document, decoder);
    expect(assets.background?.mimeType).toBe('image/png');
    expect(assets.tileFace?.mimeType).toBe('image/png');
    const { frameSource } = compileNativeTake(result.document, 'synthetic-take');
    const actual = await compileNativeProductionAudio(result.document, frameSource);
    const original = portable.original;
    const expected = await compileNativeProductionAudio(
      original,
      compileNativeTake(original, 'synthetic-take').frameSource,
    );
    expect(actual.pcmHash).toBe(expected.pcmHash);
    expect(actual.scheduledCues).toEqual(expected.scheduledCues);
  });
  it('deduplicates repeated references to the same selected content during one resolution', async () => {
    const doc = fixture(),
      selected = sources(),
      digest = image(doc, 'tile.face').sha256;
    const file = selected.cas.find((f) => f.webkitRelativePath.endsWith(`${digest}.bin`))!;
    const read = file.arrayBuffer.bind(file);
    let calls = 0;
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => {
        calls++;
        return read();
      },
    });
    const result = await inlineBrowserStudioReferences(doc, selected);
    expect(result.report.resolvedAssets).toBe(6);
    expect(calls).toBe(1);
  });
  it('still resolves after moving the chosen roots without using their old names', async () => {
    const result = await inlineBrowserStudioReferences(fixture(), {
      project: files('project', 'relocated-work'),
      cas: files('store', 'relocated-cas'),
      library: files('library', 'relocated-library'),
    });
    expect(result.report.resolvedAssets).toBe(6);
    expect(result.document.takes).toEqual(fixture().takes);
  });
  it('requires exact project-relative paths, even when the basename exists elsewhere', async () => {
    const doc = fixture();
    image(doc, 'background.base').ref = './wrong/background.png';
    await expect(inlineBrowserStudioReferences(doc, sources())).rejects.toMatchObject({
      code: 'ASSET_REF_MISSING',
    });
  });
  it('rejects absent roots, missing objects, corrupted CAS bytes, wrong attachment digest and unpinned libraries', async () => {
    const doc = fixture();
    await expect(inlineBrowserStudioReferences(doc, {})).rejects.toMatchObject({
      code: 'ASSET_SOURCE_NOT_SELECTED',
    });
    const missing = sources();
    missing.cas = [];
    await expect(inlineBrowserStudioReferences(doc, missing)).rejects.toMatchObject({
      code: 'ASSET_SOURCE_NOT_SELECTED',
    });
    const cas = sources(),
      original = cas.cas[0]!;
    const wrong = new File(['wrong'], original.name);
    Object.defineProperty(wrong, 'webkitRelativePath', { value: original.webkitRelativePath });
    cas.cas[0] = wrong;
    await expect(inlineBrowserStudioReferences(doc, cas)).rejects.toMatchObject({
      code: 'ASSET_STORE_HASH_MISMATCH',
    });
    const bad = fixture();
    image(bad, 'background.base').sha256 = '0'.repeat(64);
    await expect(inlineBrowserStudioReferences(bad, sources())).rejects.toMatchObject({
      code: 'ASSET_REF_HASH_MISMATCH',
    });
    const unpinned = fixture();
    image(unpinned, 'board.atlas').ref = 'lib://untrusted';
    await expect(inlineBrowserStudioReferences(unpinned, sources())).rejects.toMatchObject({
      code: 'ASSET_REF_UNSUPPORTED',
    });
  });
  it('refuses unsafe paths and unsupported schemes instead of searching other roots or the network', async () => {
    const reader = createBrowserAssetRefReader(sources());
    await expect(reader({ kind: 'attachment', locator: '../outside.png' })).rejects.toMatchObject({
      code: 'ASSET_REF_OUTSIDE_ROOT',
    });
    expect(() => parseAgentAssetRef('https://example.com/a.png')).toThrow(/UNSUPPORTED/);
    const traversal = fixture();
    music(traversal).ref = '../outside.wav';
    await expect(inlineBrowserStudioReferences(traversal, sources())).rejects.toMatchObject({
      code: 'ASSET_REF_OUTSIDE_ROOT',
    });
    const doc = fixture();
    music(doc).ref = 'https://example.com/music.wav';
    await expect(inlineBrowserStudioReferences(doc, sources())).rejects.toMatchObject({
      code: 'ASSET_REF_UNSUPPORTED',
    });
  });
  it('rejects conflicting paths and mixed directory roots before reading asset bytes', async () => {
    const selected = sources(),
      duplicate = selected.project[0]!;
    selected.project.push(duplicate);
    await expect(inlineBrowserStudioReferences(fixture(), selected)).rejects.toMatchObject({
      code: 'ASSET_DIRECTORY_AMBIGUOUS',
    });
    const mixed = sources(),
      other = new File(['x'], 'other.png');
    Object.defineProperty(other, 'webkitRelativePath', {
      value: 'different-root/assets/other.png',
    });
    mixed.project.push(other);
    await expect(inlineBrowserStudioReferences(fixture(), mixed)).rejects.toMatchObject({
      code: 'ASSET_DIRECTORY_AMBIGUOUS',
    });
  });
});

it('rejects unsupported legacy sprite aliases instead of silently rendering a replacement', () => {
  const doc = fixture();
  doc.direction.style.referenceCalibration = {
    sprites: { background: 'asset:legacy' },
    legacySpriteAssetIds: { background: 'legacy' },
  };
  expect(() => assertBrowserReferenceCompatibility(doc)).toThrow(/旧版 referenceCalibration/);
});

it('edits shared-library image, music and cue settings without embedding or changing referenced bytes', async () => {
  const { editNativeImageBinding, editNativeBgm, editNativeCueGain } = await import(
    '../src/contracts/editNativeDocument'
  );
  const before = fixture(),
    original = JSON.stringify(before),
    selected = sources();
  await expect(
    editNativeImageBinding(original, 'background.base', 'contain', 1, 'source-over', 0, decoder),
  ).rejects.toThrow(/尚未选择/);
  const image = JSON.parse(
    await editNativeImageBinding(
      original,
      'background.base',
      'contain',
      1,
      'source-over',
      0,
      decoder,
      selected,
    ),
  );
  expect(image.direction.style.agentAssets.entries).toEqual(
    before.direction.style.agentAssets.entries,
  );
  expect(image.direction.style.agentAssets.bindings['background.base'].fit).toBe('contain');
  const take = before.takes[0].takeId;
  const music = JSON.parse(await editNativeBgm(original, take, 0.25, 0, true, 0.75, selected));
  expect(music.direction.production.audio.assets).toEqual(before.direction.production.audio.assets);
  expect(music.direction.production.audio.bgm.startSeconds).toBe(0.25);
  const cue = JSON.parse(await editNativeCueGain(original, take, 0, 0.5, selected));
  expect(cue.direction.production.audio.assets).toEqual(before.direction.production.audio.assets);
  expect(cue.direction.production.audio.cues[0].gain).toBe(0.5);
  expect(JSON.stringify(before)).toBe(original);
  const corrupted = sources(),
    file = corrupted.cas[0]!;
  const bad = new File(['bad'], file.name);
  Object.defineProperty(bad, 'webkitRelativePath', { value: file.webkitRelativePath });
  corrupted.cas[0] = bad;
  await expect(editNativeBgm(original, take, 0, 0, false, 1, corrupted)).rejects.toThrow(/哈希/);
});

it('saves view and effect for a project with selected external assets without rewriting references', async () => {
  const { saveWorkbenchVariant } = await import('../src/contracts/workbenchVariant');
  const { saveWorkbenchView } = await import('../src/contracts/reference2dView');
  const before = fixture(),
    plan = syntheticLookProject(false, before);
  before.production.layoutProfileRef = plan.production.layoutProfileRef;
  before.production.cameraProfileRef = plan.production.cameraProfileRef;
  const text = JSON.stringify(before),
    selected = sources();
  const view = {
    contract: 'bcs.workbench.reference2d-view',
    version: '1.0.0',
    design: { width: 1064, height: 1788 },
    fps: before.production.output.fps,
    layout: { scale: 1, x: 0, y: 0 },
    camera: { mode: 'fixed', keyframes: [{ frame: 0, scale: 1, x: 0, y: 0 }] },
  };
  await expect(saveWorkbenchView(text, view)).rejects.toThrow(/尚未选择/);
  const withView = JSON.parse(await saveWorkbenchView(text, view, selected));
  expect(withView.direction.style.agentAssets.entries).toEqual(
    before.direction.style.agentAssets.entries,
  );
  expect(withView.direction.production.audio.assets).toEqual(
    before.direction.production.audio.assets,
  );
  const variantSource = JSON.parse(JSON.stringify(syntheticLookProject()));
  variantSource.direction.production.audio = before.direction.production.audio;
  const variant = JSON.parse(
    await saveWorkbenchVariant(
      JSON.stringify(variantSource),
      'builtin.reference-clean.look@1.0.0',
      'builtin.reference-garden.look@1.0.0',
      selected,
    ),
  );
  expect(variant.direction.style.agentAssets.entries).toEqual(
    variantSource.direction.style.agentAssets.entries,
  );
  expect(variant.direction.production.audio.assets).toEqual(
    variantSource.direction.production.audio.assets,
  );
  expect(variant.direction.style.workbenchVariantV1).toBeDefined();
});

it('validates and saves multi-take calibration using a selected external asset without embedding it', async () => {
  const { saveWorkbenchCalibrationTracks } = await import('../src/contracts/workbenchCalibration');
  const doc = JSON.parse(JSON.stringify(syntheticMultiCalibration()));
  const asset = doc.direction.style.agentAssets.entries['synthetic-background'];
  const bytes = Buffer.from(asset.data, 'base64');
  asset.encoding = 'ref';
  asset.ref = './assets/background.png';
  delete asset.data;
  const file = new File([bytes], 'background.png');
  Object.defineProperty(file, 'webkitRelativePath', { value: 'chosen/assets/background.png' });
  const tracks = Object.fromEntries(
    doc.direction.style.workbenchCalibrationV2.tracks.map(
      (track: { takeId: string; calibration: unknown }) => [track.takeId, track.calibration],
    ),
  );
  const text = JSON.stringify(doc);
  await expect(saveWorkbenchCalibrationTracks(text, tracks)).rejects.toThrow(/尚未选择/);
  const saved = JSON.parse(await saveWorkbenchCalibrationTracks(text, tracks, { project: [file] }));
  expect(saved.direction.style.agentAssets.entries['synthetic-background']).toEqual(asset);
  expect(saved.takes).toEqual(doc.takes);
  const bad = new File(['wrong'], 'background.png');
  Object.defineProperty(bad, 'webkitRelativePath', { value: 'chosen/assets/background.png' });
  await expect(saveWorkbenchCalibrationTracks(text, tracks, { project: [bad] })).rejects.toThrow(
    /SHA-256/,
  );
});
