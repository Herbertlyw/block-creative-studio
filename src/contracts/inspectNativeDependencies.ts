/** A read-only inventory; it never substitutes an asset or claims an unresolved reference is missing. */
export interface NativeDependency {
  path: string;
  id: string;
  status:
    | 'unresolved-profile'
    | 'inline-unverified'
    | 'external-unresolved'
    | 'missing-audio-entry'
    | 'builtin-unavailable';
  detail: string;
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function inspectNativeDependencies(value: unknown): NativeDependency[] {
  const root = record(value);
  const production = record(root?.production);
  const result: NativeDependency[] = [];
  for (const key of ['layoutProfileRef', 'cameraProfileRef', 'lookPackRef']) {
    const ref = record(production?.[key]);
    if (typeof ref?.id === 'string')
      result.push({
        path: `production.${key}`,
        id: ref.id,
        status: 'unresolved-profile',
        detail: '未连接原生素材库，不能确认引用是否存在或可用。',
      });
  }
  const direction = record(root?.direction);
  const productionDirection = record(direction?.production);
  const audio = record(productionDirection?.audio);
  const assets = record(audio?.assets);
  const refs: Array<{ path: string; id: string }> = [];
  const bgm = record(audio?.bgm);
  if (typeof bgm?.assetId === 'string')
    refs.push({ path: 'direction.production.audio.bgm.assetId', id: bgm.assetId });
  if (Array.isArray(audio?.cues))
    audio.cues.forEach((value, index) => {
      const cue = record(value);
      if (typeof cue?.assetId === 'string')
        refs.push({ path: `direction.production.audio.cues[${index}].assetId`, id: cue.assetId });
    });
  for (const ref of refs) {
    const asset = record(assets?.[ref.id]);
    if (ref.id.startsWith('builtin:'))
      result.push({
        ...ref,
        status: 'builtin-unavailable',
        detail: '原生内置声音尚未接入；不会自动替换。',
      });
    else if (!asset)
      result.push({
        ...ref,
        status: 'missing-audio-entry',
        detail: '音频资产表中没有此 ID；原文及引用均保留。',
      });
    else if (asset.encoding === 'base64' && typeof asset.data === 'string')
      result.push({
        ...ref,
        status: 'inline-unverified',
        detail: '此依赖清单未验证音频；选择工程音频导出时会校验哈希并解码。',
      });
    else
      result.push({
        ...ref,
        status: 'external-unresolved',
        detail: '外部音频引用尚未解析或校验。',
      });
  }
  return result;
}
