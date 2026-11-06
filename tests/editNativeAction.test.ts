import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { editNativeActionTarget } from '../src/contracts/editNativeAction';
import { makeNativeV2Fixture } from './fixtures/nativeV2';
const structure = JSON.parse(
  readFileSync(new URL('./fixtures/synthetic-v2-structure.json', import.meta.url), 'utf8'),
);
const source = () => JSON.stringify(makeNativeV2Fixture(structure), null, 2) + '\n';
it('edits only the selected target tokens and preserves the remainder of the V2 document', () => {
  const text = source(),
    edited = editNativeActionTarget(text, 0, 1, 1, 1);
  const original = JSON.parse(text),
    result = JSON.parse(edited);
  expect(result.takes[0].actions[1].action.anchor).toEqual({ row: 1, col: 1 });
  result.takes[0].actions[1].action.anchor = original.takes[0].actions[1].action.anchor;
  expect(result).toEqual(original);
  expect(
    edited.replace('"row": 1,\n              "col": 1', '"row": 7,\n              "col": 3'),
  ).toBe(text);
});
it('rejects a first-step change that invalidates the second step, without changing input', () => {
  const text = source();
  expect(() => editNativeActionTarget(text, 0, 0, 0, 1)).toThrow(/第 2 步/);
  expect(JSON.parse(text).takes[0].actions[0].action.anchor).toEqual({ row: 5, col: 4 });
});
it('refuses invalid schemas and duplicate matching keys', () => {
  const unknown = JSON.parse(source());
  unknown.futureExtension = { x: true };
  expect(() => editNativeActionTarget(JSON.stringify(unknown), 0, 0, 5, 4)).toThrow(/Schema/);
  const dup = source().replace('"anchor": {', '"anchor": {"row":5,');
  expect(() => editNativeActionTarget(dup, 0, 0, 5, 4)).toThrow(/重复/);
});
