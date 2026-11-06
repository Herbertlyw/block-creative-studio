import { describe, expect, it } from 'vitest';
import { editNativeName } from '../src/contracts/editNativeName';

describe('lossless native project name edit', () => {
  it('preserves BOM, whitespace, large numeric literals, escaped fields, nested names and unknown extensions', () => {
    const original =
      '\ufeff{\r\n "x": 900719925474099312345, "nested":{"name":"留", "str":"} \\\" x"}, "na\\u006de" : "old", "future":[1,{"a":2}]\r\n}';
    const edited = editNativeName(original, '新名称 "A"');
    expect(edited).toBe(original.replace('"old"', '"新名称 \\"A\\""'));
    expect(JSON.parse(edited.slice(1)).name).toBe('新名称 "A"');
  });
  it('rejects duplicate name, missing name, invalid JSON, non-string and empty names', () => {
    for (const input of ['{"name":"x","na\\u006de":"y"}', '{}', '{', '{"name":1}'])
      expect(() => editNativeName(input, 'ok')).toThrow();
    expect(() => editNativeName('{"name":"x"}', ' ')).toThrow();
  });
});
