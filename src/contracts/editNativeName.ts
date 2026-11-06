/** Update only the root JSON name token. All other UTF-8 text stays byte-for-byte unchanged. */
export function editNativeName(text: string, name: string): string {
  if (!name.trim() || name.length > 240) throw new Error('工程名称须为 1–240 个字符。');
  const json = text.startsWith('\ufeff') ? text.slice(1) : text;
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('工程必须是 JSON 对象。');
  let i = text.startsWith('\ufeff') ? 1 : 0;
  const whitespace = () => {
    while (/[\t\n\r ]/.test(text[i] ?? '') && i < text.length) i++;
  };
  const stringEnd = () => {
    if (text[i] !== '"') throw new Error('预期 JSON 字符串。');
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') {
        i += 2;
        continue;
      }
      if (text[i++] === '"') return { start, end: i };
    }
    throw new Error('JSON 字符串未结束。');
  };
  const valueEnd = () => {
    if (text[i] === '"') {
      stringEnd();
      return;
    }
    if (text[i] === '{' || text[i] === '[') {
      let depth = 0;
      do {
        if (text[i] === '"') {
          stringEnd();
          continue;
        }
        if (text[i] === '{' || text[i] === '[') depth++;
        else if (text[i] === '}' || text[i] === ']') depth--;
        i++;
      } while (depth > 0 && i < text.length);
      return;
    }
    while (i < text.length && !/[,}\]\t\n\r ]/.test(text[i]!)) i++;
  };
  whitespace();
  if (text[i++] !== '{') throw new Error('工程必须是 JSON 对象。');
  let match: { start: number; end: number } | undefined;
  for (;;) {
    whitespace();
    if (text[i] === '}') break;
    const key = stringEnd();
    const keyValue: unknown = JSON.parse(text.slice(key.start, key.end));
    whitespace();
    i++;
    whitespace(); // JSON.parse above already checked the colon.
    const start = i;
    valueEnd();
    if (keyValue === 'name') {
      if (match) throw new Error('根对象包含重复的 name 字段，未修改原件。');
      if (text[start] !== '"') throw new Error('根 name 字段不是字符串，未修改原件。');
      match = { start, end: i };
    }
    whitespace();
    if (text[i] === ',') {
      i++;
      continue;
    }
    break;
  }
  if (!match) throw new Error('根对象没有 name 字段，未修改原件。');
  return text.slice(0, match.start) + JSON.stringify(name) + text.slice(match.end);
}
