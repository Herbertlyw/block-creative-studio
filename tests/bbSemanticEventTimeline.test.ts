import { expect, it } from 'vitest';
import {
  createBBSemanticEventTimeline,
  evaluateBBSemanticEvents,
} from '../src/games/block-placement/planning/semanticEventTimeline';

it('samples ordered half-open event spans without exposing the plan to mutation', () => {
  const timeline = createBBSemanticEventTimeline(4, [
    {
      startFrame: 1,
      endFrame: 3,
      event: {
        id: 'placement',
        type: 'block-placement.placement-committed',
        category: 'commit',
        tags: ['placement'],
        entityIds: ['0:0'],
      },
    },
    {
      startFrame: 2,
      endFrame: 3,
      event: {
        id: 'clear',
        type: 'block-placement.line-cleared',
        category: 'resolve',
        tags: ['clear'],
        entityIds: ['row:0'],
      },
    },
  ]);
  expect(evaluateBBSemanticEvents(timeline, 0)).toEqual([]);
  expect(evaluateBBSemanticEvents(timeline, 1).map((event) => event.id)).toEqual(['placement']);
  const events = evaluateBBSemanticEvents(timeline, 2);
  expect(events.map((event) => event.id)).toEqual(['placement', 'clear']);
  events[0]!.entityIds.length = 0;
  expect(evaluateBBSemanticEvents(timeline, 2)[0]!.entityIds).toEqual(['0:0']);
  expect(evaluateBBSemanticEvents(timeline, 3)).toEqual([]);
  expect(() => evaluateBBSemanticEvents(timeline, 4)).toThrow(/OUT_OF_RANGE/);
});

it('rejects invalid event intervals', () => {
  const event = {
    id: 'bad',
    type: 'block-placement.drag',
    category: 'interaction' as const,
    tags: [],
    entityIds: [],
  };
  expect(() => createBBSemanticEventTimeline(3, [{ startFrame: 2, endFrame: 2, event }])).toThrow(
    /SPAN_INVALID/,
  );
  expect(() => createBBSemanticEventTimeline(3, [{ startFrame: 0, endFrame: 4, event }])).toThrow(
    /SPAN_INVALID/,
  );
});
