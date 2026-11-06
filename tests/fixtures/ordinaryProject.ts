import { createHash } from 'node:crypto';
import source from './ordinary-project.json';
import { syntheticPng, syntheticWav } from '../../scripts/fixtures/syntheticMedia.mjs';

/** Deterministic project parameters with media produced on demand rather than committed payloads. */
export function ordinaryProject() {
  const document = structuredClone(source);
  const images = document.direction.style.agentAssets.entries;
  for (const [id, asset] of Object.entries(images)) {
    const color: number[] =
      id === 'synthetic-background'
        ? [24, 38, 64]
        : id === 'generated-atlas'
          ? [130, 85, 40]
          : [220, 80, 85];
    const bytes = syntheticPng(color, asset.width, asset.height);
    Object.assign(asset, {
      data: bytes.toString('base64'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length,
    });
  }
  const audios = document.direction.production.audio.assets;
  for (const [id, asset] of Object.entries(audios)) {
    const bytes = syntheticWav(id === 'music' ? 220 : 740, id === 'music' ? 0.8 : 0.06);
    Object.assign(asset, {
      data: bytes.toString('base64'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return document;
}
