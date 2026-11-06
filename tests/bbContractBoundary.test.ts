import { expect, it } from 'vitest';
import { explainContractDocument } from '../src/contracts/validateContract';
import { identifyCreativeDocument } from '../src/domain/projectIdentity';
import { importBBWorkDocument } from '../src/contracts/bbWorkPackage';
import valid from './fixtures/synthetic-v2-structure.json';
import unknown from './fixtures/synthetic-v2-unknown.json';

it('rejects the old V1 work without altering the input', async () => {
  const old = {
    format: 'block-creative-studio-project',
    version: '1.0.0',
    project: { name: 'old' },
  };
  const before = JSON.stringify(old);
  expect(identifyCreativeDocument(old).loadable).toBe(false);
  expect(explainContractDocument(old)).toMatch(/不支持旧格式/);
  await expect(importBBWorkDocument(old)).rejects.toThrow();
  expect(JSON.stringify(old)).toBe(before);
});

it('distinguishes valid structure from unsupported fields without claiming playback', () => {
  expect(identifyCreativeDocument(valid).kind).toBe('placement-v2');
  expect(explainContractDocument(valid)).toMatch(/Schema 校验通过/);
  expect(explainContractDocument(valid)).toMatch(/不代表.*播放/);
  expect(explainContractDocument(unknown)).toMatch(/Schema 未通过/);
  expect(explainContractDocument(unknown)).toMatch(/原件可保存/);
  expect(unknown.unknownExtension.values).toEqual([1, 2, 3]);
});
