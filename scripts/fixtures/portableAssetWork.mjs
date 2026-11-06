// Generate a portable work with attachment, CAS and library references for browser checks.
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { syntheticPng, syntheticWav } from './syntheticMedia.mjs';

export async function preparePortableAssetWork(server, output) {
  const folder = await mkdtemp(join(output, 'portable-assets-'));
  const projectRoot = join(folder, 'project'),
    casRoot = join(folder, 'cas'),
    libraryRoot = join(folder, 'library');
  for (const root of [projectRoot, casRoot, libraryRoot]) await mkdir(root, { recursive: true });
  const { createNativeWork, generateNativeMachineTake } = await server.ssrLoadModule(
    '/src/contracts/nativeWorkAuthor.ts',
  );
  const { setNativeWorkImage } = await server.ssrLoadModule('/src/contracts/setNativeWorkImage.ts');
  const { setNativeWorkAudio } = await server.ssrLoadModule('/src/contracts/setNativeWorkAudio.ts');
  const { inspectImageBytes } = await server.ssrLoadModule(
    '/src/nativeReference/agent-assets/image.ts',
  );
  let work = await generateNativeMachineTake(await createNativeWork(), 'synthetic-take', 2);
  for (const [slot, color] of [
    ['background.base', [30, 60, 90]],
    ['tile.face', [180, 120, 40]],
    ['board.atlas', [90, 140, 190]],
  ]) {
    const bytes = syntheticPng(color);
    work = await setNativeWorkImage(
      work,
      slot,
      new File([bytes], `${slot}.png`, { type: 'image/png' }),
      async (blob) => inspectImageBytes(new Uint8Array(await blob.arrayBuffer())),
    );
  }
  for (const [role, frequency] of [
    ['bgm', 220],
    ['placement', 740],
    ['clear', 1120],
  ])
    work = await setNativeWorkAudio(
      work,
      role,
      new File([syntheticWav(frequency)], `${role}.wav`, { type: 'audio/wav' }),
    );
  const { externalizeStudioDocumentAssets } = await server.ssrLoadModule(
    '/src/nativeReference/agent-assets/payloadRefs.ts',
  );
  let index = 0;
  const write = async (name, hash, bytes) => {
    const kind = index++ % 3;
    let path, ref;
    if (kind === 0) {
      path = join(projectRoot, 'assets', name);
      ref = `./assets/${name}`;
    } else {
      path = join(kind === 1 ? casRoot : libraryRoot, 'sha256', hash.slice(0, 2), `${hash}.bin`);
      ref = kind === 1 ? `cas:sha256-${hash}` : `lib://synthetic-${index}@sha256-${hash}`;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return ref;
  };
  const result = await externalizeStudioDocumentAssets(work.project, write);
  if (result.report.movedAssets < 3)
    throw new Error('Portable reference fixture did not contain the expected assets.');
  const projectPath = join(projectRoot, 'project.json');
  await writeFile(projectPath, JSON.stringify(result.document, null, 2));
  return { projectPath, projectRoot, casRoot, libraryRoot };
}
