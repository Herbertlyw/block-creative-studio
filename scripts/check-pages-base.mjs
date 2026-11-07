#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, process.argv[2] ?? 'dist-pages-smoke');
const expectedBase = process.env.PAGES_BASE_PATH ?? '/block-creative-studio/';
const normalizedBase = expectedBase.endsWith('/') ? expectedBase : `${expectedBase}/`;
const expected = [
  'materials/maps/steel-basecolor.png',
  'materials/maps/wood-basecolor.png',
  'index.html',
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!existsSync(dist)) {
  fail(`Pages base smoke failed: missing dist ${dist}`);
}

const missing = expected.filter((rel) => !existsSync(resolve(dist, rel)));
if (missing.length) {
  console.error(`Pages base smoke failed under ${dist}:`);
  for (const rel of missing) console.error(`- missing ${rel}`);
  process.exit(1);
}

const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
if (normalizedBase !== '/' && !html.includes(normalizedBase)) {
  fail(`index.html does not reference Pages base ${normalizedBase}`);
}

function collectJs(directory, acc = []) {
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) collectJs(path, acc);
    else if (name.endsWith('.js')) acc.push(path);
  }
  return acc;
}

const js = collectJs(dist).map((path) => readFileSync(path, 'utf8')).join('\n');
const mapsBase = `${normalizedBase}materials/maps`.replace(/\/{2,}/g, '/').replace(':/', '://');
if (normalizedBase !== '/' && !js.includes(normalizedBase) && !js.includes(mapsBase)) {
  fail(`built JS does not contain Pages BASE_URL ${normalizedBase} or material map base ${mapsBase}`);
}
if (!js.includes('materials/maps')) {
  fail('built JS does not contain the public materials/maps rewrite path');
}

console.log(`✓ production base ${normalizedBase} and PBR maps present in ${dist}`);
