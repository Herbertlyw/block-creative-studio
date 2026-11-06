import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const forbidden = tracked.filter(
  (path) =>
    path.startsWith('examples/generated/') ||
    path.startsWith('outputs/') ||
    /^contracts\/bb\/(reference-snapshot|supplement-)/.test(path) ||
    /(^|\/)(__pycache__|\.state-lock)(\/|$)/.test(path) ||
    /\.(?:orig|f32|pcm|mp4|wav|aac|m4a|webm)$/i.test(path) ||
    (/\.(?:png|jpe?g)$/i.test(path) &&
      !path.startsWith('src/assets/') &&
      !path.startsWith('public/')),
);
const extensions = /\.(?:[cm]?js|tsx?|py|json|md)$/;
const dependent = tracked
  .filter(
    (path) =>
      path !== 'scripts/check-repository-cleanliness.mjs' &&
      /^(src|tests|scripts|\.agents)\//.test(path) &&
      extensions.test(path),
  )
  .filter((path) => {
    try {
      return readFileSync(path, 'utf8').includes('examples/generated/');
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  });
if (forbidden.length || dependent.length) {
  console.error(
    `Repository cleanup incomplete: ${forbidden.length} forbidden tracked artifacts, ${dependent.length} source/test files still reference historical fixtures.`,
  );
  for (const path of forbidden.slice(0, 12)) console.error(`  artifact: ${path}`);
  for (const path of dependent.slice(0, 12)) console.error(`  dependency: ${path}`);
  process.exitCode = 1;
} else
  console.log(
    'Repository tracked files and source references contain no retired handoff artifacts.',
  );
