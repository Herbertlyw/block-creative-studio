import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBrowserCapture } from './browser-capture.mjs';

const full = process.env.BCS_CAPTURE_FULL === '1' || process.argv.includes('--full');
const report = await runBrowserCapture({ mode: full ? 'full' : 'smoke' });
const out = new URL('../outputs/review/run/browser-e2e.json', import.meta.url);
mkdirSync(dirname(fileURLToPath(out)), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
const skipAllowed = process.env.CI !== 'true' && process.env.BCS_ALLOW_E2E_SKIP === '1';
const ok = report.status === 'PASS' || (report.status === 'NOT_RUN' && skipAllowed);
console.log(JSON.stringify({
  ok,
  status: report.status,
  mode: report.mode,
  reason: report.reason,
  frames: report.frames?.length ?? 0,
  videos: report.videos?.length ?? 0,
  renderer: report.webglRenderer ?? report.renderer ?? 'unknown',
}, null, 2));
if (!ok) process.exit(1);
