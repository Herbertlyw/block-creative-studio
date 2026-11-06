import { GameSchemaError } from '../../../nativeReference/game-runtime/errors';
import type { GameProjectEnvelope } from '../../../nativeReference/game-runtime/projectEnvelope';
import type { GameReplayEnvelope } from '../../../nativeReference/game-runtime/replayEnvelope';
import type { Take } from '../../../nativeReference/domain/types';
import {
  parseBlockPlacementSemanticAction,
  parseBlockPlacementState,
} from '../../../nativeReference/games/block-placement/schemas';

/** Project a native replay into the common timing compiler's input, without importing a V1 file. */
export function takeFromBBReplay(project: GameProjectEnvelope, replay: GameReplayEnvelope): Take {
  const initial = parseBlockPlacementState(project.initialState.data, '$.game.initialState.data');
  return {
    id: replay.takeId,
    name: replay.takeId,
    createdAt: '1970-01-01T00:00:00.000Z',
    initial,
    actions: replay.actions.map((item) => {
      const semantic = parseBlockPlacementSemanticAction(
        item.action,
        `$.actions.${item.id}.action`,
      );
      const interaction = replay.interactions.find((entry) => entry.committedActionId === item.id);
      if (!interaction)
        throw new GameSchemaError(
          'MISSING_FIELD',
          `Replay ${replay.takeId} action ${item.id} is missing a committed interaction.`,
          { path: `$.takes.actions.${item.id}` },
        );
      const durationFrames = interaction.endFrame - interaction.startFrame;
      if (durationFrames < 1)
        throw new GameSchemaError(
          'INVALID_VALUE',
          `Replay ${replay.takeId} action ${item.id} interaction duration must be at least 1 frame.`,
          { path: `$.takes.interactions.${interaction.id}` },
        );
      return {
        id: item.id,
        actor: item.actor,
        pieceId: semantic.pieceId,
        anchor: { ...semantic.anchor },
        durationFrames,
        pointerPath: interaction.samples?.map((sample) => ({ ...sample })) ?? [],
      };
    }),
  };
}
