import { hasReferenceCalibration } from './hasReferenceCalibration';
import { validateCalibratedRequest } from './validateObservedRequest';
import { compileNativeTake } from './compileNativeTake';
import { createBBTimelineSource } from '../games/block-placement/planning/timelineFrameSource';
import { prepareObservedTake } from '../games/block-placement/calibrated/prepareObservedTake';
import type { StudioProjectDocumentV2 } from '../nativeReference/game-runtime/projectEnvelope';

/** Input selection only; both adapters return the same actual rule/event timeline. */
export function compileBBTimeline(
  document: unknown,
  takeId: string,
  options?: { allowClipMetadata?: boolean },
) {
  // Input-specific validation produces the common rule, motion and event
  // plan; both paths use createBBTimelineSource for actual frame evaluation.
  if (hasReferenceCalibration(document)) {
    const prepared = prepareObservedTake(
      document as StudioProjectDocumentV2,
      validateCalibratedRequest(document, takeId, null, options),
    );
    return {
      plan: prepared.plan,
      source: createBBTimelineSource(prepared.plan, prepared.frameSourceHash),
    };
  }
  const compiled = compileNativeTake(document, takeId);
  return { plan: compiled.timelinePlan, source: compiled.frameSource };
}
