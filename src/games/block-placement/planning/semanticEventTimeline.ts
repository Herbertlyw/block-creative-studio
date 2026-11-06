import type { SemanticGameEvent } from '../../../nativeReference/game-runtime/presentationPacket';

/** A half-open interval of output frames on which one event is present. */
export interface BBSemanticEventSpan {
  startFrame: number;
  endFrame: number;
  event: SemanticGameEvent;
}
export interface BBSemanticEventTimeline {
  totalFrames: number;
  spans: readonly BBSemanticEventSpan[];
  readonly byFrame: readonly (readonly SemanticGameEvent[])[];
}

export function createBBSemanticEventTimeline(
  totalFrames: number,
  spans: readonly BBSemanticEventSpan[],
): BBSemanticEventTimeline {
  if (!Number.isInteger(totalFrames) || totalFrames < 1)
    throw new Error('BB_EVENT_TIMELINE_LENGTH_INVALID');
  for (const span of spans) {
    if (
      !Number.isInteger(span.startFrame) ||
      !Number.isInteger(span.endFrame) ||
      span.startFrame < 0 ||
      span.endFrame <= span.startFrame ||
      span.endFrame > totalFrames ||
      !span.event.id ||
      !span.event.type
    )
      throw new Error(`BB_EVENT_TIMELINE_SPAN_INVALID:${span.event.id}`);
  }
  const copy = structuredClone(spans);
  const byFrame = Array.from({ length: totalFrames }, () => [] as SemanticGameEvent[]);
  for (const span of copy)
    for (let frame = span.startFrame; frame < span.endFrame; frame++) {
      const bucket = byFrame[frame];
      if (!bucket) throw new Error('BB_EVENT_FRAME_OUT_OF_RANGE');
      bucket.push(span.event);
    }
  return { totalFrames, spans: copy, byFrame };
}

export function evaluateBBSemanticEvents(
  timeline: BBSemanticEventTimeline,
  frame: number,
): SemanticGameEvent[] {
  if (!Number.isInteger(frame) || frame < 0 || frame >= timeline.totalFrames)
    throw new Error('BB_EVENT_FRAME_OUT_OF_RANGE');
  const events = timeline.byFrame[frame];
  if (!events) throw new Error('BB_EVENT_FRAME_OUT_OF_RANGE');
  return [...structuredClone(events)];
}
