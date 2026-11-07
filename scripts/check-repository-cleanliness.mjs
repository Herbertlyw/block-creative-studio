import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

const root = process.cwd();
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const trackedTargets = new Set(tracked);
trackedTargets.add('');
for (const path of tracked) {
  const parts = path.split('/');
  while (parts.length > 1) {
    parts.pop();
    trackedTargets.add(parts.join('/'));
  }
}

const findings = [];
const extensions = /\.(?:[cm]?js|tsx?|py|json|md)$/;
const media = /\.(?:mp4|mov|mkv|webm|wav|mp3|aac|m4a|flac|ogg|pcm|f32)$/i;
const archives = /\.(?:zip|bundle|tar|tar\.gz|tgz|7z|rar|orig)$/i;
const images = /\.(?:png|jpe?g|webp|gif|avif|bmp|tiff?)$/i;

function checkLinks(path, content) {
  const prose = content.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
  for (const match of prose.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^)\n]+)\)/g)) {
    const raw = match[1].trim();
    const target = raw.startsWith('<') ? raw.slice(1, raw.indexOf('>')) : raw.split(/\s+/)[0];
    if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
    try {
      const file = decodeURIComponent(target.split(/[?#]/)[0]);
      if (!file) continue;
      const destination = relative(root, resolve(root, dirname(path), file))
        .split(sep)
        .join('/');
      if (!trackedTargets.has(destination))
        findings.push(`link: ${path} -> ${target} (target is not tracked)`);
    } catch {
      findings.push(`link: ${path} -> ${target} (invalid URL encoding)`);
    }
  }
}

for (const path of tracked) {
  const sourceImage = path.startsWith('src/assets/') || path.startsWith('public/');
  if (
    path.startsWith('examples/generated/') ||
    path.startsWith('outputs/') ||
    path.startsWith('reference-materials/') ||
    /^contracts\/bb\/(reference-snapshot|supplement-)/.test(path) ||
    /(^|\/)(__pycache__|\.state-lock)(\/|$)/.test(path) ||
    media.test(path) ||
    archives.test(path) ||
    (images.test(path) && !sourceImage)
  )
    findings.push(`artifact: ${path}`);
  let content;
  try {
    if (statSync(path).size > 1024 * 1024) findings.push(`size: ${path} exceeds 1 MiB`);
    if (!extensions.test(path)) continue;
    content = readFileSync(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      findings.push(`missing: ${path}`);
      continue;
    }
    throw error;
  }
  if (
    path !== 'scripts/check-repository-cleanliness.mjs' &&
    /^(src|tests|scripts|\.agents)\//.test(path) &&
    content.includes('examples/generated/')
  )
    findings.push(`dependency: ${path} still references retired generated fixtures`);
  if (path.endsWith('.md')) checkLinks(path, content);
}

if (findings.length) {
  console.error(`Repository check failed: ${findings.length} finding(s).`);
  for (const finding of findings.slice(0, 20)) console.error(`  ${finding}`);
  process.exitCode = 1;
} else
  console.log(
    `Repository check passed: ${tracked.length} tracked files; no generated media, oversized files, retired fixtures, or broken local Markdown links.`,
  );
