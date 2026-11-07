import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, resolve, dirname, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = ['src', 'tests'];

function walk(path) {
  const entries = readdirSync(path, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const next = resolve(path, entry.name);
    return entry.isDirectory() ? walk(next) : [next];
  });
}

const sourceFiles = sourceRoots
  .flatMap((directory) => walk(resolve(root, directory)))
  .filter((path) => ['.ts', '.tsx'].includes(extname(path)));
sourceFiles.push(resolve(root, 'vite.config.ts'));
const tsc = resolve(root, 'node_modules', 'typescript', 'bin', 'tsc');

const syntax = spawnSync(
  process.execPath,
  [
    tsc,
    '--noEmit',
    '--noCheck',
    '--jsx',
    'react-jsx',
    '--module',
    'ESNext',
    '--target',
    'ES2022',
    '--moduleResolution',
    'Bundler',
    '--skipLibCheck',
    ...sourceFiles,
  ],
  { cwd: root, encoding: 'utf8' },
);
if (syntax.status !== 0) {
  process.stderr.write(syntax.stdout ?? '');
  process.stderr.write(syntax.stderr ?? '');
  throw new Error('TypeScript syntax check failed.');
}

const importPattern = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/gu;
const missing = [];
for (const file of sourceFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (!specifier?.startsWith('.')) continue;
    const rawTarget = resolve(dirname(file), specifier);
    const candidates = extname(rawTarget)
      ? [rawTarget, rawTarget.replace(/\.js$/u, '.ts'), rawTarget.replace(/\.js$/u, '.tsx')]
      : [
          `${rawTarget}.ts`,
          `${rawTarget}.tsx`,
          `${rawTarget}.js`,
          resolve(rawTarget, 'index.ts'),
          resolve(rawTarget, 'index.tsx'),
        ];
    if (!candidates.some((candidate) => existsSync(candidate) && statSync(candidate).isFile())) {
      missing.push(`${relative(root, file)} -> ${specifier}`);
    }
  }
}
if (missing.length > 0) {
  throw new Error(`Unresolved relative imports:\n${missing.join('\n')}`);
}

const jsonFiles = walk(root).filter((path) => {
  const normalized = relative(root, path).replaceAll('\\', '/');
  return extname(path) === '.json'
    && !normalized.startsWith('.git/')
    && !normalized.startsWith('.core-dist/')
    && !normalized.startsWith('artifacts/');
});
for (const file of jsonFiles) JSON.parse(readFileSync(file, 'utf8'));

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
for (const scriptName of ['check', 'check:core', 'check:source', 'check:reference', 'build', 'test']) {
  if (!packageJson.scripts?.[scriptName]) throw new Error(`Missing package script: ${scriptName}`);
}

console.log(`✓ parsed ${sourceFiles.length} TypeScript/TSX files`);
console.log('✓ every relative source import resolves');
console.log(`✓ parsed ${jsonFiles.length} JSON files`);
console.log('✓ required validation/build scripts are declared');
