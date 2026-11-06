import Ajv from 'ajv/dist/2020';
import schema from '../../contracts/bb/workbench-extensions/reference2d-variant-v1.schema.json';
import { compileNativeV2PlanLook } from './nativeVariants';
import { setJsonObjectProperty } from './editNativeAction';
import { inspectNativeRuntime } from './inspectNativeRuntime';
import { inlineBrowserStudioReferences, type BrowserAssetSources } from './browserAssetReferences';
import { isValidPlacementContract } from './validateContract';
import { hasReferenceCalibration } from './hasReferenceCalibration';
import { stableStringify } from '../nativeReference/headless/stableHash';
const check = new Ajv({ allErrors: true, strict: false }).compile(schema);
type Binding = {
  contract: string;
  version: string;
  lookKey: string;
  clearFromLook: string;
  lookRef: unknown;
  clearRef: unknown;
};
const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);
/** Resolve saved binding without fallback; hashes and versions must match the actual catalog. */
export function resolveSavedWorkbenchVariant(document: unknown, takeId: string) {
  const saved = (document as any)?.direction?.style?.workbenchVariantV1;
  if (saved === undefined) return null;
  if (!check(saved))
    throw new Error(
      `已保存的 2D 变体合同无效：${check.errors?.map((e) => `${e.instancePath || '/'} ${e.message}`).join('；')}`,
    );
  const binding = saved as Binding;
  let result: ReturnType<typeof compileNativeV2PlanLook>;
  try {
    result = compileNativeV2PlanLook(document, takeId, binding.lookKey, binding.clearFromLook);
  } catch (error) {
    throw new Error(
      `已保存的变体或布局／镜头引用无法解析：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!same(binding.lookRef, result.lookRef) || !same(binding.clearRef, result.clearRef))
    throw new Error('已保存的外观或清除效果引用、版本或哈希不匹配；未替换素材。');
  if (!result.referenceEffect.consumed) throw new Error('已保存的清除效果没有实际消费者。');
  return result;
}
/** Save an explicit, versioned local catalog binding without editing unrelated JSON tokens. */
export async function saveWorkbenchVariant(
  text: string,
  lookKey: string,
  clearFromLook: string,
  sources: BrowserAssetSources = {},
): Promise<string> {
  const doc = JSON.parse(text.startsWith('\ufeff') ? text.slice(1) : text);
  if (!isValidPlacementContract(doc) || hasReferenceCalibration(doc))
    throw new Error('此工程不能安全保存普通 2D 变体。');
  const audit = inspectNativeRuntime(doc);
  if (!audit.validated) throw new Error(audit.message);
  const invalid = audit.takes.find((t) => !t.legal);
  if (invalid) throw new Error(`${invalid.takeId}：${invalid.detail}`);
  if (!audit.takes.length) throw new Error('工程没有 Take。');
  const resolved = await inlineBrowserStudioReferences(doc, sources);
  if (doc.direction?.style?.workbenchVariantV1 !== undefined)
    for (const take of audit.takes) resolveSavedWorkbenchVariant(resolved.document, take.takeId);
  const plans = audit.takes.map((t) =>
    compileNativeV2PlanLook(resolved.document, t.takeId, lookKey, clearFromLook),
  );
  const first = plans[0]!;
  if (
    !first.lookRef ||
    !first.clearRef ||
    plans.some((p) => !same(first.lookRef, p.lookRef) || !same(first.clearRef, p.clearRef))
  )
    throw new Error('各 Take 的效果或外观引用不一致。');
  const binding = {
    contract: 'bcs.workbench.reference2d-variant',
    version: '1.0.0',
    lookKey,
    clearFromLook,
    lookRef: first.lookRef,
    clearRef: first.clearRef,
  };
  if (!check(binding)) throw new Error('此外观或清除效果不在已支持的保存合同内。');
  const edited = setJsonObjectProperty(text, ['direction', 'style'], 'workbenchVariantV1', binding),
    out = JSON.parse(edited);
  const checked = await inlineBrowserStudioReferences(out, sources);
  for (const take of audit.takes) resolveSavedWorkbenchVariant(checked.document, take.takeId);
  return edited;
}
