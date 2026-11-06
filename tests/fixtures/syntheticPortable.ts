import type { StudioProjectDocumentV2 } from '../../src/nativeReference/game-runtime/projectEnvelope';
import { createNativeWork, generateNativeMachineTake } from '../../src/contracts/nativeWorkAuthor';
import { setNativeWorkImage } from '../../src/contracts/setNativeWorkImage';
import { setNativeWorkAudio } from '../../src/contracts/setNativeWorkAudio';
import { inspectImageBytes } from '../../src/nativeReference/agent-assets/image';
import { externalizeStudioDocumentAssets } from '../../src/nativeReference/agent-assets/payloadRefs';
import { syntheticPng, syntheticWav } from '../../scripts/fixtures/syntheticMedia.mjs';

/** Portable project with generated attachment, CAS and library assets. */
export async function syntheticPortableFixture(input?: unknown) {
  let work = await generateNativeMachineTake(await createNativeWork(), 'synthetic-take', 2);
  for (const [slot, color] of [
    ['background.base', [30, 60, 90]],
    ['tile.face', [180, 120, 40]],
    ['board.atlas', [90, 140, 190]],
  ] as const) {
    const data = new Uint8Array(syntheticPng([...color])).buffer;
    work = await setNativeWorkImage(
      work,
      slot,
      new File([data], `${slot}.png`, { type: 'image/png' }),
      async (blob) => inspectImageBytes(new Uint8Array(await blob.arrayBuffer())),
    );
  }
  for (const [role, frequency] of [
    ['bgm', 220],
    ['placement', 740],
    ['clear', 1120],
  ] as const)
    work = await setNativeWorkAudio(
      work,
      role,
      new File([new Uint8Array(syntheticWav(frequency)).buffer], `${role}.wav`, {
        type: 'audio/wav',
      }),
    );
  const files: Record<'project' | 'cas' | 'library', File[]> = {
    project: [],
    cas: [],
    library: [],
  };
  let index = 0;
  const original = input ?? work.project;
  const result = await externalizeStudioDocumentAssets(
    original as StudioProjectDocumentV2,
    async (name, hash, bytes) => {
      const kind = (['project', 'cas', 'library'] as const)[index++ % 3]!;
      const path = kind === 'project' ? `assets/${name}` : `sha256/${hash.slice(0, 2)}/${hash}.bin`;
      const file = new File([new Uint8Array(bytes).buffer], path.split('/').at(-1)!);
      Object.defineProperty(file, 'webkitRelativePath', { value: `${kind}/${path}` });
      files[kind].push(file);
      return kind === 'project'
        ? `./${path}`
        : kind === 'cas'
          ? `cas:sha256-${hash}`
          : `lib://synthetic-${index}@sha256-${hash}`;
    },
  );
  return { project: result.document, original, files };
}
