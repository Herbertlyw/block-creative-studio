import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const ignoredDirectories = new Set(['.git', '.core-dist', 'artifacts', 'dist', 'node_modules']);
const files = [];

function walk(path) {
  for (const entry of readdirSync(path)) {
    if (ignoredDirectories.has(entry)) continue;
    const absolute = resolve(path, entry);
    const info = statSync(absolute);
    if (info.isDirectory()) walk(absolute);
    else if (extname(absolute) === '.json') files.push(absolute);
  }
}

walk(root);
const failures = [];
for (const file of files) {
  try {
    JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    failures.push(`${file.slice(root.length + 1)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length > 0) {
  console.error('Invalid JSON files:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`✓ ${files.length} committed JSON files parse successfully`);
