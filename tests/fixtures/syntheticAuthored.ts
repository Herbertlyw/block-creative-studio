import {
  appendNativeMove,
  createNativeTake,
  createNativeWork,
  generateNativeMachineTake,
  nativeTakeState,
  setNativeFixedSupply,
  setNativeWorkBoardCell,
} from '../../src/contracts/nativeWorkAuthor';
import { setNativeWorkAudio } from '../../src/contracts/setNativeWorkAudio';
import { syntheticWav } from '../../scripts/fixtures/syntheticMedia.mjs';
import type { StyleSpec, RhythmProfile } from '../../src/nativeReference/domain/types';

/** A deterministic board with one human row clear and a separate machine Take. */
export async function syntheticAuthoredFixture() {
  let work = await createNativeWork();
  for (let col = 0; col < 7; col++) work = await setNativeWorkBoardCell(work, 0, col, 'coral');
  work = await setNativeWorkBoardCell(work, 7, 7, 'coral');
  work = await setNativeFixedSupply(work, [
    [
      { shapeId: 'single', color: 'blue' },
      { shapeId: 'single', color: 'rose' },
      { shapeId: 'single', color: 'rose' },
    ],
  ]);
  work = await createNativeTake(work, 'human-drag');
  const piece = nativeTakeState(work, 'human-drag').pieces[0];
  if (!piece) throw new Error('Synthetic first candidate missing');
  work = await appendNativeMove(
    work,
    'human-drag',
    piece.id,
    0,
    7,
    'human',
    [
      { frameOffset: 0, x: 0.15, y: 0.92 },
      { frameOffset: 35, x: 0.83, y: 0.13 },
    ],
    35,
  );
  work = await generateNativeMachineTake(work, 'machine', 3);
  for (const [role, frequency] of [
    ['bgm', 220],
    ['placement', 740],
    ['clear', 1120],
  ] as const) {
    const bytes = new Uint8Array(syntheticWav(frequency)).buffer;
    work = await setNativeWorkAudio(
      work,
      role,
      new File([bytes], `${role}.wav`, { type: 'audio/wav' }),
    );
  }
  return work as typeof work & {
    project: { direction: { style: StyleSpec; rhythm: RhythmProfile } };
  };
}
