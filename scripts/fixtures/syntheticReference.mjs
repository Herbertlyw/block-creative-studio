// Generate a reference and media locally; no historical media or embedded payloads are needed.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { syntheticPng, syntheticWav } from './syntheticMedia.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function prepareSyntheticReference(server, output) {
  const folder = await mkdtemp(join(output, 'synthetic-source-'));
  const video = join(folder, 'synthetic-reference.mp4');
  execFileSync('python3', ['scripts/generate-independent-bb-reference.py', video], {
    stdio: 'pipe',
  });
  const hash = sha(await readFile(video));
  const measurementDir = join(folder, 'measurement');
  execFileSync(
    'python3',
    ['scripts/inspect-reference-video.py', video, '--output-dir', measurementDir],
    { stdio: 'pipe' },
  );
  const measurementPath = join(measurementDir, 'measurement.json');
  const measurement = JSON.parse(await readFile(measurementPath, 'utf8'));
  const parameters = JSON.parse(
    await readFile(resolve('tests/fixtures/observed-annotation.json'), 'utf8'),
  );
  const structured = structuredClone(parameters.structured);
  structured.sourceSha256 = hash;
  const { bindObservedCalibration } = await server.ssrLoadModule(
    '/src/contracts/bindObservedCalibration.ts',
  );
  let project = (
    await bindObservedCalibration(structured, measurement, hash, 512, 864, parameters.geometry)
  ).document;
  const imageDefs = {
    background: [20, 38, 60],
    white: [220, 220, 220],
    coral: [220, 70, 70],
    cyan: [40, 170, 200],
    replacement: [80, 190, 90],
  };
  const imageFiles = {},
    imagePaths = {},
    imageHashes = {};
  for (const [role, color] of Object.entries(imageDefs)) {
    const bytes = syntheticPng(color),
      name = `${role}.png`;
    imagePaths[role] = join(folder, name);
    await writeFile(imagePaths[role], bytes);
    imageFiles[role] = new File([bytes], name, { type: 'image/png' });
    imageHashes[role] = sha(bytes);
  }
  const { attachObservedGroupedImages } = await server.ssrLoadModule(
    '/src/contracts/attachObservedImages.ts',
  );
  const { inspectImageBytes } = await server.ssrLoadModule(
    '/src/nativeReference/agent-assets/image.ts',
  );
  project = (
    await attachObservedGroupedImages(
      project,
      {
        background: imageFiles.background,
        white: imageFiles.white,
        coral: imageFiles.coral,
        cyan: imageFiles.cyan,
      },
      async (bytes) => inspectImageBytes(bytes),
    )
  ).document;
  const audioFiles = {},
    audioPaths = {},
    audioHashes = {};
  for (const [role, frequency] of Object.entries({ bgm: 220, placement: 740, clear: 1120 })) {
    const bytes = syntheticWav(frequency),
      name = `${role}.wav`;
    audioPaths[role] = join(folder, name);
    await writeFile(audioPaths[role], bytes);
    audioFiles[role] = new File([bytes], name, { type: 'audio/wav' });
    audioHashes[role] = sha(bytes);
  }
  const { attachObservedAudio } = await server.ssrLoadModule(
    '/src/contracts/attachObservedAudio.ts',
  );
  project = (await attachObservedAudio(project, { ...audioFiles, ...parameters.audioSettings }))
    .document;
  const observation = {
    version: '1.0.0',
    source: { name: 'synthetic-reference.mp4', sha256: hash, metadata: 'synthetic CFR reference' },
    frameRate: 'measured-cfr',
    measurement,
    observations: parameters.observations,
    structured: JSON.stringify(structured, null, 2),
    geometry: JSON.stringify(parameters.geometry, null, 2),
    mapping: parameters.mapping,
    imageSettings: ['background', 'white', 'coral', 'cyan'].map((role) => ({
      role,
      name: imageFiles[role].name,
      sha256: imageHashes[role],
    })),
    audioSettings: {
      ...parameters.audioSettings,
      assets: ['bgm', 'placement', 'clear'].map((role) => ({
        role,
        name: audioFiles[role].name,
        sha256: audioHashes[role],
      })),
    },
  };
  const { buildObservedPointer } = await server.ssrLoadModule('/src/contracts/observedPointer.ts');
  const pointer = await buildObservedPointer(
    project,
    structured,
    measurement,
    hash,
    512,
    864,
    parameters.mapping,
    20,
  );
  const { createObservedSourceLink } = await server.ssrLoadModule(
    '/src/contracts/observedSourceLink.ts',
  );
  const link = await createObservedSourceLink(project, observation, hash, 512, 864);
  const { createBBWorkPackage } = await server.ssrLoadModule('/src/contracts/bbWorkPackage.ts');
  const work = await createBBWorkPackage(project, pointer, { link, observation });
  const workPath = join(folder, 'observed-work.json');
  await writeFile(workPath, JSON.stringify(work, null, 2));
  return { video, hash, measurementPath, workPath, observation, imagePaths, audioPaths };
}
