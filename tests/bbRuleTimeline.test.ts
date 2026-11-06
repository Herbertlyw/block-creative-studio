import { syntheticObservedFixture } from './fixtures/syntheticObserved';
import { expect, it } from 'vitest';
import {
  createBBRuleTimeline,
  evaluateBBRuleTimeline,
} from '../src/games/block-placement/planning/ruleTimeline';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import { prepareCalibratedRenderer } from '../src/contracts/calibratedRenderer';
import { inlineBrowserStudioReferences } from '../src/contracts/browserAssetReferences';
import { stableHash } from '../src/nativeReference/headless/stableHash';
import { authoredPacketFrame } from '../src/games/block-placement/presentation/evaluateAuthoredFrame';
import { readBBFrame } from '../src/games/block-placement/planning/timelineFrameSource';

const fixture = await syntheticObservedFixture();
const document = () => JSON.parse(JSON.stringify(fixture.document));

it('normalizes ordinary commit after the last drag frame and uses logical rather than animated state hash', () => {
  const doc = document(),
    { compiled, frameSource } = compileNativeTake(doc, 'observed-take');
  const first = compiled.actions[0]!,
    before = frameSource.evaluate(first.releaseFrame),
    commit = frameSource.evaluate(first.releaseFrame + 1);
  expect(before.semanticEvents.some((e) => e.type === 'block-placement.placement-committed')).toBe(
    false,
  );
  expect(commit.semanticEvents.some((e) => e.type === 'block-placement.placement-committed')).toBe(
    true,
  );
  expect(before.identity.stateHash).toBe(stableHash(first.transition.before));
  expect(commit.identity.stateHash).toBe(stableHash(first.transition.after));
  expect(
    stableHash(
      authoredPacketFrame(readBBFrame(commit), commit.identity.fps, commit.identity.totalFrames)
        .snapshot,
    ),
  ).not.toBe(commit.identity.stateHash);
});

it('uses the same rule timeline for observed commit seconds and preserves the pending visual clear', async () => {
  const doc = document(),
    source = prepareCalibratedRenderer(
      (await inlineBrowserStudioReferences(doc, {})).document,
      'observed-take',
    ).frameSource;
  const before = source.evaluate(20),
    commit = source.evaluate(21),
    frame = readBBFrame(commit);
  expect(before.semanticEvents.some((e) => e.type === 'block-placement.placement-committed')).toBe(
    false,
  );
  expect(commit.semanticEvents.some((e) => e.type === 'block-placement.placement-committed')).toBe(
    true,
  );
  expect(frame.rules.gameState.turn).toBe(1);
  expect(commit.identity.stateHash).toBe(stableHash(frame.rules.gameState));
  expect(frame.rules.gameState.board.cells[0]!.every((cell) => cell === null)).toBe(true);
  expect(frame.board[0]).toEqual(Array(8).fill('blue'));
});

it('evaluates seek order independently and rejects invalid or duplicate commits', () => {
  const { compiled } = compileNativeTake(document(), 'observed-take');
  const actions = compiled.actions.map((action) => ({
    actionId: action.action.id,
    startSeconds: action.startFrame / compiled.fps,
    commitSeconds: (action.releaseFrame + 1) / compiled.fps,
    after: action.transition.after,
  }));
  const plan = createBBRuleTimeline(compiled.initial, actions);
  const a = evaluateBBRuleTimeline(plan, 2),
    b = evaluateBBRuleTimeline(plan, 0.1),
    c = evaluateBBRuleTimeline(plan, 2);
  expect(a).toEqual(c);
  expect(b.gameState.turn).toBe(0);
  a.gameState.board.cells[0]![0] = null;
  expect(evaluateBBRuleTimeline(plan, 2)).toEqual(c);
  expect(() =>
    createBBRuleTimeline(compiled.initial, [
      actions[0]!,
      { ...actions[1]!, actionId: actions[0]!.actionId },
    ]),
  ).toThrow(/TIMELINE_INVALID/);
  expect(() =>
    createBBRuleTimeline(compiled.initial, [actions[0]!, { ...actions[1]!, commitSeconds: 0 }]),
  ).toThrow(/TIMELINE_INVALID/);
});
