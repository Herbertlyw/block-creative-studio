import { inlineBrowserStudioReferences, type BrowserAssetSources } from './browserAssetReferences';
import { prepareCalibratedRenderer } from './calibratedRenderer';
import {
  compileNativeProductionAudio,
  describeProductionMixWarnings,
} from './nativeProductionAudio';

/** Copy a procedural single-take calibration; change its theme and BGM gain. */
export async function createCalibratedVariant(
  document: unknown,
  theme: string,
  gain: number,
  sources: BrowserAssetSources = {},
) {
  const copy = structuredClone(document) as any,
    style = copy?.direction?.style,
    bgm = copy?.direction?.production?.audio?.bgm;
  if (!style?.referenceCalibration || style.workbenchCalibrationV2 !== undefined || !bgm)
    throw new Error('该变体需要单 Take 校准工程和已有 BGM；原工程保留。');
  const cal = style.referenceCalibration;
  if (cal.sprites || cal.appearance || cal.tileColors || cal.tileMaterial || cal.backdrop)
    throw new Error('带素材或自定义外观的工程不支持此程序主题变体，原工程保留。');
  if (!['grey', 'pink', 'purple'].includes(theme) || !Number.isFinite(gain) || gain < 0 || gain > 1)
    throw new Error('程序主题或 BGM 增益无效。');
  cal.theme = theme;
  bgm.gain = gain;
  const resolved = await inlineBrowserStudioReferences(copy, sources);
  const takeId = copy.takes?.[0]?.takeId;
  if (!takeId) throw new Error('工程没有可用 Take。');
  const source = prepareCalibratedRenderer(resolved.document, takeId).frameSource;
  const mix = await compileNativeProductionAudio(resolved.document, source);
  return { document: copy, warning: describeProductionMixWarnings(resolved.document, mix) };
}
