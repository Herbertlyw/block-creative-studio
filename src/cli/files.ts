import { readFile, realpath, open, link, unlink } from 'node:fs/promises';
import { basename, dirname, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function readJSON(path: string) {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
}

/** Atomically publish a new file without following or overwriting an existing target. */
export async function writeNew(path: string, value: unknown, input?: string) {
  return writeNewBytes(path, Buffer.from(JSON.stringify(value, null, 2) + '\n'), input);
}

/** Publish binary or text bytes with the same no-overwrite guarantee. */
export async function writeNewBytes(
  path: string,
  bytes: Uint8Array,
  input?: string,
  beforePublish?: () => void,
) {
  const dest = resolve(path),
    parent = await realpath(dirname(dest));
  const actual = join(parent, basename(dest));
  if (input && actual === (await realpath(input))) throw new Error('输出路径不能与输入相同。');
  const temp = join(parent, `.bcs-${randomUUID()}.tmp`);
  let created = false;
  try {
    const file = await open(temp, 'wx', 0o600);
    created = true;
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    beforePublish?.();
    await link(temp, actual);
  } finally {
    if (created) await unlink(temp).catch(() => {});
  }
}
