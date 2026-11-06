import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const scanRoots = ['src', 'tests', 'scripts'];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const ignoredDirectories = new Set(['.git', '.core-dist', 'dist', 'node_modules']);
const patterns = [
  /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function walk(path) {
  const entries = readdirSync(path);
  const files = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry)) continue;
    const absolute = resolve(path, entry);
    const info = statSync(absolute);
    if (info.isDirectory()) files.push(...walk(absolute));
    else if (sourceExtensions.has(extname(absolute))) files.push(absolute);
  }
  return files;
}

function candidates(importer, specifier) {
  const base = resolve(dirname(importer), specifier);
  const direct = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
    resolve(base, 'index.js'),
    resolve(base, 'index.mjs'),
  ];
  if (specifier.endsWith('.js')) {
    direct.push(base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx');
  }
  return direct;
}

const problems = [];
for (const scanRoot of scanRoots) {
  const absoluteRoot = resolve(root, scanRoot);
  for (const file of walk(absoluteRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1];
        if (!specifier?.startsWith('.')) continue;
        if (
          !candidates(file, specifier).some((candidate) => {
            try {
              return statSync(candidate).isFile();
            } catch {
              return false;
            }
          })
        ) {
          problems.push(`${file.slice(root.length + 1)} -> ${specifier}`);
        }
      }
    }
  }
}

if (problems.length > 0) {
  console.error('Unresolved local imports:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log('✓ all relative imports resolve to committed source files');
