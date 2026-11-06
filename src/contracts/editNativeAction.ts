import { inspectNativeReplay } from './inspectNativeReplay';
import { inspectNativeRuntime } from './inspectNativeRuntime';
import { isValidPlacementContract } from './validateContract';
import { parseWorkbenchView } from './reference2dView';
import { compileNativeTake } from './compileNativeTake';
import { resolveSavedWorkbenchVariant } from './workbenchVariant';

export type JsonPath = Array<string | number>;
/** Locate a JSON token without reserializing sibling fields or large numeric literals. */
function findJsonSpan(text: string, path: JsonPath): { start: number; end: number } {
  let i = text.startsWith('\ufeff') ? 1 : 0;
  const ws = () => {
    while (i < text.length && /[\t\n\r ]/.test(text[i]!)) i++;
  };
  const stringToken = () => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') {
        i += 2;
        continue;
      }
      if (text[i++] === '"') return text.slice(start, i);
    }
    throw new Error('JSON 字符串未结束。');
  };
  const skip = () => {
    if (text[i] === '"') {
      stringToken();
      return;
    }
    if (text[i] === '{' || text[i] === '[') {
      let depth = 0;
      do {
        if (text[i] === '"') {
          stringToken();
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
  let span: { start: number; end: number } | undefined;
  const visit = (level: number) => {
    ws();
    if (level === path.length) {
      const start = i;
      skip();
      span = { start, end: i };
      return;
    }
    const part = path[level];
    if (typeof part === 'string') {
      if (text[i++] !== '{') throw new Error('目标字段所在位置不是对象。');
      let found = false;
      while (true) {
        ws();
        if (text[i] === '}') {
          i++;
          break;
        }
        const key = JSON.parse(stringToken()) as string;
        ws();
        i++;
        ws();
        if (key === part) {
          if (found) throw new Error(`字段 ${key} 重复，未修改原件。`);
          found = true;
          visit(level + 1);
        } else skip();
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        i++;
        break;
      }
      if (!found) throw new Error(`找不到字段 ${part}。`);
    } else {
      if (text[i++] !== '[') throw new Error('目标字段所在位置不是数组。');
      let index = 0,
        found = false;
      while (true) {
        ws();
        if (text[i] === ']') {
          i++;
          break;
        }
        if (index === part) {
          found = true;
          visit(level + 1);
        } else skip();
        index++;
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        i++;
        break;
      }
      if (!found) throw new Error(`找不到数组第 ${part} 项。`);
    }
  };
  visit(0);
  if (!span) throw new Error('没有定位到目标字段。');
  return span as { start: number; end: number };
}

export function readJsonToken(text: string, path: JsonPath): string {
  const span = findJsonSpan(text, path);
  return text.slice(span.start, span.end);
}

export function replaceJsonToken(text: string, path: JsonPath, token: string): string {
  JSON.parse(token);
  const span = findJsonSpan(text, path);
  return text.slice(0, span.start) + token + text.slice(span.end);
}

/** Insert or replace one property without reserializing neighboring tokens. */
export function setJsonObjectProperty(
  text: string,
  path: JsonPath,
  key: string,
  value: unknown,
): string {
  const raw = readJsonToken(text, path),
    parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('目标字段不是 JSON 对象。');
  const token = JSON.stringify(value);
  if (token === undefined) throw new Error('无效 JSON 值。');
  if (Object.prototype.hasOwnProperty.call(parsed, key))
    return replaceJsonToken(text, [...path, key], token);
  const end = raw.lastIndexOf('}');
  if (end < 0) throw new Error('无法定位 JSON 对象结束位置。');
  return replaceJsonToken(
    text,
    path,
    `${raw.slice(0, end)}${Object.keys(parsed).length ? ',' : ''}\n${JSON.stringify(key)}:${token}${raw.slice(end)}`,
  );
}

function replaceNumber(text: string, path: JsonPath, value: number): string {
  if (typeof JSON.parse(readJsonToken(text, path)) !== 'number')
    throw new Error('目标字段不是 JSON 数字。');
  return replaceJsonToken(text, path, String(value));
}

/** Edit an anchor only after validating every replay; unknown text is never reserialized. */
export function editNativeActionTarget(
  text: string,
  takeIndex: number,
  actionIndex: number,
  row: number,
  col: number,
): string {
  for (const value of [takeIndex, actionIndex, row, col])
    if (!Number.isInteger(value) || value < 0) throw new Error('索引和目标坐标必须是非负整数。');
  if (row > 7 || col > 7) throw new Error('目标坐标超出参考棋盘范围。');
  const parse = (value: string): unknown =>
    JSON.parse(value.startsWith('\ufeff') ? value.slice(1) : value);
  const original = parse(text);
  assertGameplayEditSupported(original);
  if (!isValidPlacementContract(original))
    throw new Error('工程 Schema 未通过；为保留未识别内容，未应用动作编辑。');
  const prefix: JsonPath = ['takes', takeIndex, 'actions', actionIndex, 'action', 'anchor'];
  let changed = replaceNumber(text, [...prefix, 'row'], row);
  changed = replaceNumber(changed, [...prefix, 'col'], col);
  const document = parse(changed);
  if (!isValidPlacementContract(document)) throw new Error('修改后 Schema 未通过，未应用。');
  const links = inspectNativeReplay(document);
  if (links.length) throw new Error(`回放关联未通过：${links[0]}`);
  const audit = inspectNativeRuntime(document);
  if (!audit.validated) throw new Error(audit.message);
  const invalid = audit.takes.find((take) => !take.legal);
  if (invalid) throw new Error(`${invalid.takeId}：${invalid.detail} 原工程未修改。`);
  const doc = document as any;
  if (doc.direction?.style?.workbenchView2D !== undefined)
    for (const take of audit.takes) {
      const compiled = compileNativeTake(doc, take.takeId).compiled;
      parseWorkbenchView(doc.direction.style.workbenchView2D, compiled.fps, compiled.totalFrames);
    }
  if (doc.direction?.style?.workbenchVariantV1 !== undefined)
    for (const take of audit.takes) resolveSavedWorkbenchVariant(doc, take.takeId);
  return changed;
}

/** Calibrated motion, score and event tracks are tied to a specific gameplay take. */
export function assertGameplayEditSupported(document: unknown): void {
  const doc = document as {
    direction?: { style?: { referenceCalibration?: unknown; workbenchCalibrationV2?: unknown } };
  };
  if (
    doc?.direction?.style?.referenceCalibration !== undefined ||
    doc?.direction?.style?.workbenchCalibrationV2 !== undefined
  )
    throw new Error('此工程含校准动作与棋盘时序；玩法编辑尚不能同步重建校准，未修改原工程。');
}
