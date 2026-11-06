import { expect, it } from 'vitest';
import {
  createBBProject,
  appendBBReplay,
} from '../src/games/block-placement/authoring/createProject';
import { blockPlacementAgentAdapter } from '../src/nativeReference/games/block-placement/agent';

it('creates the same native projects and replay envelopes as the frozen authoring operations', async () => {
  const create = blockPlacementAgentAdapter.operations.find(
    (item) => item.id === 'project create',
  )!;
  for (const options of [
    { projectId: 'bb-41782', name: '新 BB 作品', seed: 41782, width: 512, height: 864, fps: 30 },
    {
      projectId: 'observed-video',
      name: '作者标注工程',
      seed: 42,
      width: 512,
      height: 864,
      fps: 30,
      initialUsedSlots: [2],
      board: { rows: 8, cols: 8, cells: Array.from({ length: 8 }, () => Array(8).fill(null)) },
      fixedSupply: [
        [
          { shapeId: 'single', color: 'blue' },
          { shapeId: 'single', color: 'coral' },
          { shapeId: 'single', color: 'lime' },
        ],
      ],
    },
  ]) {
    const frozen = await create.execute({ options });
    expect(frozen.ok).toBe(true);
    const actual = createBBProject(options);
    expect(actual).toEqual(frozen.document);
    const piece = (actual.game.initialState.data as any).pieces[0];
    const actions = [
      {
        id: 'move-1',
        actor: 'human' as const,
        pieceId: piece.id,
        anchor: { row: 0, col: 0 },
        durationFrames: 15,
        pointerPath: [
          { frameOffset: 0, x: 0.2, y: 0.8 },
          { frameOffset: 15, x: 0.2, y: 0.2 },
        ],
      },
    ];
    const original = await blockPlacementAgentAdapter.operations
      .find((item) => item.id === 'take import')!
      .execute({ project: actual, options: { takeId: 't', actions } });
    expect(original.ok).toBe(true);
    expect(appendBBReplay(actual, 't', actions)).toEqual(original.document);
  }
});
