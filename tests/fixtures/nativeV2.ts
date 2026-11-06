import { parseBlockPlacementState } from '../../src/nativeReference/games/block-placement/schemas';
import { hashBlockPlacementState } from '../../src/nativeReference/games/block-placement/legacyRuntime';
import { RHYTHM_PRESETS } from '../../src/nativeReference/director/rhythmPresets';
import { DEFAULT_STYLE } from '../../src/renderer/stylePresets';
import { splitPointerPlacement } from '../../src/nativeReference/game-runtime/replayEnvelope';

/** Turn the existing structure-only fixture into a synthetic, semantically checkable replay. */
export function makeNativeV2Fixture(structure: any) {
  const project = structuredClone(structure);
  project.id = 'synthetic-v2-semantic';
  project.name = '合成 V2 语义回放检查';
  const initial = parseBlockPlacementState(project.game.initialState.data);
  const hash = hashBlockPlacementState(initial);
  project.game.initialState.stateHash = hash;
  const actions = [
    {
      id: 'synthetic-first',
      actor: 'human' as const,
      pieceId: initial.pieces[0]!.id,
      anchor: { row: 5, col: 4 },
      durationFrames: 15,
      pointerPath: [
        { frameOffset: 0, x: 0.2, y: 0.8 },
        { frameOffset: 15, x: 0.5, y: 0.6 },
      ],
    },
    {
      id: 'synthetic-second',
      actor: 'human' as const,
      pieceId: initial.pieces[1]!.id,
      anchor: { row: 7, col: 3 },
      durationFrames: 16,
      pointerPath: [
        { frameOffset: 0, x: 0.5, y: 0.8 },
        { frameOffset: 16, x: 0.4, y: 0.7 },
      ],
    },
  ].map((action) =>
    splitPointerPlacement({
      ...action,
      actionSchemaId: 'bcs.runtime.block-placement.semantic-action',
    }),
  );
  project.direction = {
    rhythm: structuredClone(RHYTHM_PRESETS['human-natural']),
    style: structuredClone(DEFAULT_STYLE),
  };
  project.takes = [
    {
      contract: 'bcs.game-replay',
      contractVersion: '1.0.0',
      gameId: 'block-placement',
      moduleVersion: '1.0.0',
      takeId: 'synthetic-take',
      initialStateHash: hash,
      seed: initial.seed,
      actions: actions.map((x) => x.semantic),
      interactions: actions.map((x) => x.interaction),
    },
  ];
  return project;
}
