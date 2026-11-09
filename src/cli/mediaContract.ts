import { stableHash } from '../nativeReference/headless/stableHash';

const text = { type: 'string', minLength: 1 };
const frame = { type: 'integer', minimum: 0 };
export const previewSchema = {
  type: 'object',
  required: ['takeId', 'frame'],
  additionalProperties: false,
  properties: { takeId: text, frame },
};
export const videoSchema = {
  type: 'object',
  required: ['takeId'],
  additionalProperties: false,
  properties: {
    takeId: text,
    scope: { enum: ['take', 'range', 'clip'] },
    audio: { enum: ['project', 'silent'] },
    startFrame: frame,
    endFrame: frame,
    clipId: text,
  },
  allOf: [
    {
      if: { required: ['startFrame'] },
      then: { required: ['scope', 'endFrame'], properties: { scope: { const: 'range' } } },
    },
    {
      if: { required: ['endFrame'] },
      then: { required: ['scope', 'startFrame'], properties: { scope: { const: 'range' } } },
    },
    {
      if: { required: ['clipId'] },
      then: { required: ['scope'], properties: { scope: { const: 'clip' } } },
    },
    {
      if: { required: ['scope'], properties: { scope: { const: 'range' } } },
      then: { required: ['startFrame', 'endFrame'], not: { required: ['clipId'] } },
    },
    {
      if: { required: ['scope'], properties: { scope: { const: 'clip' } } },
      then: {
        required: ['clipId'],
        not: { anyOf: [{ required: ['startFrame'] }, { required: ['endFrame'] }] },
      },
    },
  ],
};
export function mediaOperations() {
  return [
    {
      id: 'preview render',
      kind: 'edit' as const,
      schema: previewSchema,
      requiresInput: true,
      output: true,
      description: '使用本机 Chrome 输出完整 Take 的指定绝对帧 PNG。',
    },
    {
      id: 'video render',
      kind: 'edit' as const,
      schema: videoSchema,
      requiresInput: true,
      output: true,
      description: '使用本机 Chrome 渲染 Take、帧范围或受支持片段，使用工程音频或静音。',
    },
  ];
}
export function mediaWindow(
  options: Record<string, unknown>,
  total: number,
  take: unknown,
  sourceHash: string,
  clips: readonly any[] = [],
) {
  const scope = (options.scope ?? 'take') as string;
  let start = 0,
    end = total - 1;
  if (scope === 'range') {
    start = options.startFrame as number;
    end = options.endFrame as number;
  }
  if (scope === 'clip') {
    const clip = clips.find((item) => item.id === options.clipId);
    if (!clip) throw new Error('CLIP_NOT_FOUND: 指定片段不存在。');
    if (clip.takeId !== options.takeId) throw new Error('CLIP_TAKE_MISMATCH: 片段属于其他 Take。');
    if (clip.crop) throw new Error('CLIP_CROP_UNSUPPORTED: 片段裁切尚未接入。');
    if (clip.source?.takeHash !== stableHash(take) || clip.source?.frameSourceHash !== sourceHash)
      throw new Error('CLIP_SOURCE_STALE: 片段的 Take 或帧源已变化。');
    start = clip.startFrame;
    end = clip.endFrame;
  }
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end >= total
  )
    throw new Error('FRAME_RANGE_INVALID: 帧范围超出 Take 或起点晚于终点。');
  return { scope, startFrame: start, endFrame: end, totalFrames: end - start + 1 };
}
