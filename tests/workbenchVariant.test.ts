import { syntheticLookProject } from './fixtures/syntheticLookProject';
import { expect, it } from 'vitest';
import {
  saveWorkbenchVariant,
  resolveSavedWorkbenchVariant,
} from '../src/contracts/workbenchVariant';
import { compileNativeV2PlanLook } from '../src/contracts/nativeVariants';
import { editNativeOutputSize } from '../src/contracts/editNativeDocument';
const src = () => JSON.stringify(syntheticLookProject(true));
it('saves explicit 2D effect refs, validates every take, and preserves all unrelated data', async () => {
  const text = src(),
    before = JSON.parse(text),
    edited = await saveWorkbenchVariant(
      text,
      'builtin.reference-clean.look@1.0.0',
      'builtin.reference-garden.look@1.0.0',
    ),
    after = JSON.parse(edited);
  expect(after.direction.style.workbenchVariantV1.clearRef.contentHash).toBeTruthy();
  const saved = resolveSavedWorkbenchVariant(after, 'synthetic-alternate');
  expect(saved?.referenceEffect).toMatchObject({ preset: 'sweep-score-spark', consumed: true });
  const expected = compileNativeV2PlanLook(
    before,
    'synthetic-alternate',
    'builtin.reference-clean.look@1.0.0',
    'builtin.reference-garden.look@1.0.0',
  );
  expect(saved?.planHash).toBe(expected.planHash);
  expect(() => editNativeOutputSize(edited, 320, 560)).toThrow(/引用无法解析/);
  delete after.direction.style.workbenchVariantV1;
  expect(after).toEqual(before);
  expect(JSON.parse(text)).toEqual(before);
});
it('rejects mismatched hashes, unknown extensions, unsupported looks and bad assets without fallback', async () => {
  const text = src(),
    edited = await saveWorkbenchVariant(
      text,
      'builtin.reference-clean.look@1.0.0',
      'builtin.reference-garden.look@1.0.0',
    );
  let doc = JSON.parse(edited);
  doc.direction.style.workbenchVariantV1.clearRef.contentHash = 'fnv1a32:00000000';
  expect(() => resolveSavedWorkbenchVariant(doc, 'synthetic-take')).toThrow(/哈希不匹配/);
  await expect(
    saveWorkbenchVariant(
      JSON.stringify(doc),
      'builtin.reference-clean.look@1.0.0',
      'builtin.reference-garden.look@1.0.0',
    ),
  ).rejects.toThrow(/哈希不匹配/);
  doc = JSON.parse(edited);
  doc.direction.style.workbenchVariantV1.future = {};
  expect(() => resolveSavedWorkbenchVariant(doc, 'synthetic-take')).toThrow(/合同无效/);
  doc = JSON.parse(text);
  doc.direction.style.agentAssets.entries['synthetic-background'].sha256 = '0'.repeat(64);
  await expect(
    saveWorkbenchVariant(
      JSON.stringify(doc),
      'builtin.reference-clean.look@1.0.0',
      'builtin.reference-garden.look@1.0.0',
    ),
  ).rejects.toThrow(/哈希/);
  await expect(
    saveWorkbenchVariant(text, 'unknown', 'builtin.reference-clean.look@1.0.0'),
  ).rejects.toThrow();
});
