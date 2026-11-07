#!/usr/bin/env node
/**
 * Canonical sha256 for example asset manifests (omit contentHash, stable stringify).
 * Look-pack slot hashes are rewritten to the hashed children, then the look pack
 * and copper demo recipe are hashed.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = normalize(value[key]);
    }
    return result;
  }
  return value;
}

function omitContentHash(value) {
  const copy = { ...value };
  delete copy.contentHash;
  return copy;
}

function canonicalSha256(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(normalize(omitContentHash(value)))).digest('hex')}`;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const materialFiles = [
  'examples/headless/materials/material.stainless-steel.json',
  'examples/headless/materials/material.oak-wood.json',
  'examples/headless/materials/material.aurora-shell.json',
];

const assetDir = resolve(root, 'examples/headless/assets');
const assetFiles = readdirSync(assetDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => resolve(assetDir, name));

const hashedById = new Map();

for (const rel of materialFiles) {
  const path = resolve(root, rel);
  const pack = JSON.parse(readFileSync(path, 'utf8'));
  pack.contentHash = canonicalSha256(pack);
  writeJson(path, pack);
  hashedById.set(pack.id, pack.contentHash);
  console.log(`${rel} ${pack.contentHash}`);
}

const lookPacks = [];
for (const path of assetFiles) {
  const pack = JSON.parse(readFileSync(path, 'utf8'));
  if (pack.kind === 'look-pack') {
    lookPacks.push({ path, pack });
    continue;
  }
  pack.contentHash = canonicalSha256(pack);
  writeJson(path, pack);
  hashedById.set(pack.id, pack.contentHash);
  console.log(`${path.slice(root.length + 1)} ${pack.contentHash}`);
}

for (const { path, pack } of lookPacks) {
  for (const slot of Object.values(pack.slots ?? {})) {
    const next = hashedById.get(slot.id);
    if (next) slot.contentHash = next;
  }
  pack.contentHash = canonicalSha256(pack);
  writeJson(path, pack);
  hashedById.set(pack.id, pack.contentHash);
  console.log(`${path.slice(root.length + 1)} ${pack.contentHash}`);
}

const recipePath = resolve(root, 'examples/headless/variant.copper.demo.json');
const recipe = JSON.parse(readFileSync(recipePath, 'utf8'));
const lookHash = hashedById.get(recipe.lookPackRef?.id);
if (lookHash) recipe.lookPackRef.contentHash = lookHash;
writeJson(recipePath, recipe);
console.log(`examples/headless/variant.copper.demo.json lookPackRef ${recipe.lookPackRef.contentHash}`);

const masterPath = resolve(root, 'examples/headless/master.demo.json');
const master = JSON.parse(readFileSync(masterPath, 'utf8'));
const layoutHash = hashedById.get(master.layoutProfileRef?.id);
const cameraHash = hashedById.get(master.cameraProfileRef?.id);
if (layoutHash) master.layoutProfileRef.contentHash = layoutHash;
if (cameraHash) master.cameraProfileRef.contentHash = cameraHash;
writeJson(masterPath, master);
console.log(`examples/headless/master.demo.json layout ${master.layoutProfileRef.contentHash} camera ${master.cameraProfileRef.contentHash}`);

const universalJson = JSON.parse(readFileSync(resolve(root, 'examples/headless/assets/effect.universal-clear.json'), 'utf8'));
const tsPath = resolve(root, 'src/headless/universalClearEffect.ts');
let tsSource = readFileSync(tsPath, 'utf8');
tsSource = tsSource.replace(
  /contentHash: `sha256:\$\{'9'\.repeat\(64\)\}`/,
  `contentHash: '${universalJson.contentHash}'`,
);
tsSource = tsSource.replace(
  /contentHash: 'sha256:[0-9a-f]{64}'/,
  `contentHash: '${universalJson.contentHash}'`,
);
writeFileSync(tsPath, tsSource);

const reports = spawnSync(process.execPath, [resolve(root, 'scripts/write-material-runtime-reports.mjs')], {
  stdio: 'inherit',
});
if (reports.status) process.exit(reports.status);

console.log(`src/headless/universalClearEffect.ts ${universalJson.contentHash}`);
