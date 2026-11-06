import type { GameProjectEnvelope } from '../src/nativeReference/game-runtime/projectEnvelope';
import type { GameReplayEnvelope } from '../src/nativeReference/game-runtime/replayEnvelope';
import { syntheticMultiCalibration } from './fixtures/syntheticMultiCalibration';
import { expect, it } from 'vitest';
import { takeFromBBReplay } from '../src/games/block-placement/authoring/replayTake';
import { takeFromBlockPlacementReplay } from '../src/nativeReference/games/block-placement/migrations/blockPlacementV1';

it('projects both independently calibrated Takes without changing their replay identity or timing', () => {
  const doc = syntheticMultiCalibration();
  for (const replay of doc.takes)
    expect(
      takeFromBBReplay(
        doc.game as unknown as GameProjectEnvelope,
        replay as unknown as GameReplayEnvelope,
      ),
    ).toEqual(
      takeFromBlockPlacementReplay(
        doc.game as unknown as GameProjectEnvelope,
        replay as unknown as GameReplayEnvelope,
      ),
    );
  const broken = structuredClone(doc.takes[0]);
  broken.interactions = [];
  expect(() =>
    takeFromBBReplay(
      doc.game as unknown as GameProjectEnvelope,
      broken as unknown as GameReplayEnvelope,
    ),
  ).toThrow(/missing a committed interaction/);
});
