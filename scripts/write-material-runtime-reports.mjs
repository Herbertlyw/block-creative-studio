#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'outputs/review/reports');
mkdirSync(outDir, { recursive: true });

function colorSpaceForSlot(slot) {
  return slot === 'baseColor' || slot === 'emission' ? 'srgb' : 'linear';
}

function defaultChannelsForSlot(slot) {
  if (slot === 'baseColor' || slot === 'normal' || slot === 'emission' || slot === 'orm') return 'rgb';
  return 'r';
}

function defaultCombineForMaps(maps) {
  return maps.some((map) => ['baseColor', 'orm', 'roughness', 'metallic'].includes(map.slot))
    ? 'replace'
    : 'multiply-factor';
}

function runtimeFromPack(pack) {
  const maps = [];
  for (const [slot, ref] of Object.entries(pack.appearance.textureRefs ?? {})) {
    if (!ref) continue;
    const binding = {
      slot,
      uri: ref.uri,
      contentHash: ref.contentHash,
      colorSpace: ref.colorSpace ?? colorSpaceForSlot(slot),
      channels: ref.channels ?? defaultChannelsForSlot(slot),
    };
    if (slot === 'normal' && ref.normalY) binding.normalY = ref.normalY;
    maps.push(binding);
  }
  const runtime = {
    contract: 'bcs.material-runtime',
    contractVersion: '1.0.0',
    id: pack.id,
    version: pack.version,
    contentHash: pack.contentHash,
    materialClass: pack.behavior.materialClass,
    baseColor: pack.appearance.baseColor,
    roughness: pack.appearance.roughness,
    metalness: pack.appearance.metalness,
    maps,
    uv: { repeat: [1, 1], offset: [0, 0], rotationRadians: 0 },
    combine: defaultCombineForMaps(maps),
    capabilities: {
      heightDisplacement: 'unsupported',
      anisotropy: 'unsupported',
      subsurface: 'unsupported',
      complexTransmission: pack.appearance.transmission && pack.appearance.transmission > 0
        ? 'pending'
        : 'unsupported',
      materialAwareFracture: 'pending',
    },
    unsupportedFields: [],
    behaviorPending: true,
  };
  if (pack.appearance.clearcoat !== undefined) runtime.clearcoat = pack.appearance.clearcoat;
  if (pack.appearance.normalStrength !== undefined) runtime.normalStrength = pack.appearance.normalStrength;
  if (pack.appearance.emission !== undefined) runtime.emission = pack.appearance.emission;
  if (pack.appearance.specular !== undefined) runtime.specular = pack.appearance.specular;
  return runtime;
}

const files = [
  'material.stainless-steel.json',
  'material.oak-wood.json',
  'material.aurora-shell.json',
];

for (const file of files) {
  const pack = JSON.parse(readFileSync(resolve(root, 'examples/headless/materials', file), 'utf8'));
  const runtime = runtimeFromPack(pack);
  const dest = resolve(outDir, file.replace('.json', '.runtime.json'));
  writeFileSync(dest, `${JSON.stringify(runtime, null, 2)}\n`);
  console.log(dest, runtime.contentHash, runtime.combine);
}
