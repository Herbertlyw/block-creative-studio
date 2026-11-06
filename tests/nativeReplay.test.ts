import { expect, it } from 'vitest';
import { inspectNativeReplay } from '../src/contracts/inspectNativeReplay';

it('identifies broken V2 replay references without changing the project', () => {
  const project = {
    game: { game: { id: 'block-placement', moduleVersion: '1' }, initialState: { stateHash: 'h' } },
    takes: [
      {
        gameId: 'block-placement',
        moduleVersion: '1',
        initialStateHash: 'bad',
        actions: [{ id: 'a' }, { id: 'b' }],
        interactions: [
          {
            committedActionId: 'a',
            startFrame: 10,
            endFrame: 12,
            samples: [{ frameOffset: 2 }, { frameOffset: 1 }, { frameOffset: 3 }],
          },
          { committedActionId: 'unknown', startFrame: 0, endFrame: 0 },
        ],
      },
    ],
  };
  const before = JSON.stringify(project),
    issues = inspectNativeReplay(project);
  expect(issues.some((s) => s.includes('initialStateHash'))).toBe(true);
  expect(issues.some((s) => s.includes('actions[1]') && s.includes('缺少'))).toBe(true);
  expect(issues.some((s) => s.includes('samples[1]'))).toBe(true);
  expect(issues.some((s) => s.includes('samples[2]'))).toBe(true);
  expect(issues.some((s) => s.includes('committedActionId'))).toBe(true);
  expect(JSON.stringify(project)).toBe(before);
});

it('reports no cross-reference issues for a linked interaction, without claiming playback validity', () => {
  expect(
    inspectNativeReplay({
      game: {
        game: { id: 'block-placement', moduleVersion: '1' },
        initialState: { stateHash: 'h' },
      },
      takes: [
        {
          gameId: 'block-placement',
          moduleVersion: '1',
          initialStateHash: 'h',
          actions: [{ id: 'a' }],
          interactions: [
            {
              committedActionId: 'a',
              startFrame: 1,
              endFrame: 4,
              samples: [{ frameOffset: 0 }, { frameOffset: 3 }],
            },
          ],
        },
      ],
    }),
  ).toEqual([]);
});

it('does not imply an empty project has a verified replay', () => {
  expect(inspectNativeReplay({ takes: [] })[0]).toContain('没有 Take');
});
