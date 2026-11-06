import parameters from './observed-annotation.json';
import { bindObservedCalibration } from '../../src/contracts/bindObservedCalibration';
import { attachObservedAudio } from '../../src/contracts/attachObservedAudio';
import { syntheticWav } from '../../scripts/fixtures/syntheticMedia.mjs';
import { syntheticPng } from '../../scripts/fixtures/syntheticMedia.mjs';
import { attachObservedGroupedImages } from '../../src/contracts/attachObservedImages';
import { inspectImageBytes, sha256Hex } from '../../src/nativeReference/agent-assets/image';
import { buildObservedPointer } from '../../src/contracts/observedPointer';
import { createObservedSourceLink } from '../../src/contracts/observedSourceLink';
import type { SourceDesignMap } from '../../src/contracts/sourceDesignMap';
import type { ReferenceCalibration } from '../../src/games/block-placement/calibrated/parseCalibration';

/** Known synthetic frame clock and annotation, without video or encoded assets. */
export async function syntheticObservedFixture() {
  const sourceHash = '0'.repeat(64);
  const measurement = {
    version: '1.0.0',
    source: {
      sha256: sourceHash,
      width: 512,
      height: 864,
      fps: '30',
      frameCount: 151,
      firstTimestamp: 0,
      timeBase: '1/15360',
    },
    timing: {
      mode: 'constant',
      timestampTicks: Array.from({ length: 151 }, (_, frame) => frame * 512),
    },
  };
  const annotation = { ...structuredClone(parameters.structured), sourceSha256: sourceHash };
  let document = (
    await bindObservedCalibration(
      annotation,
      measurement,
      sourceHash,
      512,
      864,
      parameters.geometry,
    )
  ).document;
  const sound = (name: string, frequency: number) =>
    new File([new Uint8Array(syntheticWav(frequency)).buffer], `${name}.wav`, {
      type: 'audio/wav',
    });
  document = (
    await attachObservedAudio(document, {
      bgm: sound('music', 220),
      placement: sound('placement', 740),
      clear: sound('clear', 1120),
      bgmStart: 0,
      bgmOffset: 0,
      bgmGain: 0.2,
      bgmLoop: true,
      cueGain: 0.5,
    })
  ).document;
  const pointer = await buildObservedPointer(
    document,
    annotation,
    measurement,
    sourceHash,
    512,
    864,
    parameters.mapping as SourceDesignMap,
    20,
  );
  return {
    document: document as typeof document & {
      direction: { style: { referenceCalibration: ReferenceCalibration } };
    },
    pointer,
    measurement,
    annotation,
    sourceHash,
  };
}

/** Self-contained observation package built from readable parameters and generated PNG/WAV. */
export async function syntheticObservedPackageFixture(options: { legacyClearCue?: boolean } = {}) {
  const {
    document: original,
    measurement,
    annotation,
    sourceHash,
  } = await syntheticObservedFixture();
  const colors = {
    background: [20, 38, 60],
    white: [220, 220, 220],
    coral: [220, 70, 70],
    cyan: [40, 170, 200],
  } as const;
  const files = Object.fromEntries(
    Object.entries(colors).map(([name, color]) => [
      name,
      new File([new Uint8Array(syntheticPng([...color])).buffer], `${name}.png`, {
        type: 'image/png',
      }),
    ]),
  ) as Record<keyof typeof colors, File>;
  const document = (
    await attachObservedGroupedImages(original, files, async (bytes) => inspectImageBytes(bytes))
  ).document;
  if (options.legacyClearCue) {
    document.direction.production.audio.cues = document.direction.production.audio.cues.filter(
      (cue: { eventType: string }) => cue.eventType !== 'block-placement.reference-clear-heavy',
    );
  }
  const pointer = await buildObservedPointer(
    document,
    annotation,
    measurement,
    sourceHash,
    512,
    864,
    parameters.mapping as SourceDesignMap,
    20,
  );
  const imageSettings = await Promise.all(
    Object.entries(files).map(async ([role, file]) => ({
      role,
      name: file.name,
      sha256: await sha256Hex(new Uint8Array(await file.arrayBuffer())),
    })),
  );
  const audioSettings = {
    ...parameters.audioSettings,
    assets: await Promise.all(
      (['bgm', 'placement', 'clear'] as const).map(async (role) => {
        const frequency = { bgm: 220, placement: 740, clear: 1120 }[role];
        const name = role === 'bgm' ? 'music' : role;
        return {
          role,
          name: `${name}.wav`,
          sha256: await sha256Hex(new Uint8Array(syntheticWav(frequency))),
        };
      }),
    ),
  };
  const observation = {
    version: '1.0.0',
    source: {
      name: 'synthetic-reference.mp4',
      sha256: sourceHash,
      metadata: 'synthetic CFR reference',
    },
    frameRate: 'measured-cfr',
    measurement,
    observations: parameters.observations,
    structured: JSON.stringify(annotation, null, 2),
    geometry: JSON.stringify(parameters.geometry, null, 2),
    mapping: parameters.mapping,
    imageSettings,
    audioSettings,
  };
  const link = await createObservedSourceLink(document, observation, sourceHash, 512, 864);
  return { project: document, pointer, source: { link, observation } };
}
