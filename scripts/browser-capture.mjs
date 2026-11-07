#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function captureIdentity() {
  let sourceHeadSha = process.env.GITHUB_SHA ?? '';
  let checkoutMergeSha = process.env.GITHUB_SHA ?? '';
  if (process.env.GITHUB_EVENT_PATH && existsSync(process.env.GITHUB_EVENT_PATH)) {
    try {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      if (event?.pull_request?.head?.sha) sourceHeadSha = event.pull_request.head.sha;
    } catch {
      // keep GITHUB_SHA
    }
  }
  if (!sourceHeadSha) {
    sourceHeadSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    checkoutMergeSha = sourceHeadSha;
  }
  return {
    sourceHeadSha,
    checkoutMergeSha,
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    capturedAt: new Date().toISOString(),
  };
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/local/bin/google-chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function listen(server, host, preferredPort) {
  return new Promise((resolveListen, reject) => {
    const onError = (error) => {
      if (error.code === 'EADDRINUSE' && preferredPort !== 0) {
        server.off('error', onError);
        server.listen(0, host, () => resolveListen(server.address().port));
        return;
      }
      reject(error);
    };
    server.on('error', onError);
    server.listen(preferredPort, host, () => {
      server.off('error', onError);
      resolveListen(server.address().port);
    });
  });
}

export async function runBrowserCapture(options = {}) {
  const mode = options.mode === 'full' ? 'full' : 'smoke';
  const timeoutMs = options.timeoutMs ?? (mode === 'full' ? 25 * 60_000 : 180_000);
  const chromePath = findChrome();
  const startedAt = new Date().toISOString();

  if (!chromePath) {
    return {
      status: 'NOT_RUN',
      reason: 'Google Chrome / Chromium was not found on PATH.',
      mode,
      startedAt,
      renderer: 'unknown',
    };
  }

  const vite = await createViteServer({
    root,
    appType: 'mpa',
    server: { middlewareMode: true, hmr: false },
    clearScreen: false,
  });

  let doneResolve;
  let doneReject;
  const done = new Promise((resolveDone, rejectDone) => {
    doneResolve = resolveDone;
    doneReject = rejectDone;
  });

  const reviewRoot = resolve(root, 'outputs/review');
  const runRoot = resolve(reviewRoot, 'run');
  rmSync(runRoot, { recursive: true, force: true });
  mkdirSync(runRoot, { recursive: true });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/__capture/progress') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        console.log(`[capture] ${text}`);
        res.writeHead(204);
        res.end();
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/__capture/done') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        try {
          const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          res.writeHead(204);
          res.end();
          doneResolve(report);
        } catch (error) {
          res.writeHead(400);
          res.end(String(error));
          doneReject(error);
        }
      });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/__capture/workspace/')) {
      const rel = url.pathname.slice('/__capture/workspace/'.length);
      const dest = resolve(root, rel);
      if (!dest.startsWith(root) || !existsSync(dest)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.setHeader('content-type', dest.endsWith('.json') ? 'application/json' : 'application/octet-stream');
      res.end(readFileSync(dest));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/__capture/artifact') {
      const rel = String(req.headers['x-artifact-path'] ?? '');
      const dest = resolve(root, rel);
      const allowed = dest.startsWith(runRoot + '/') || dest === runRoot;
      if (!rel || rel.includes('..') || !allowed) {
        res.writeHead(403);
        res.end('invalid artifact path');
        return;
      }
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const buffer = Buffer.concat(chunks);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, buffer);
        const digest = sha256(buffer);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, bytes: buffer.length, sha256: digest, path: relative(root, dest) }));
      });
      return;
    }
    vite.middlewares(req, res);
  });

  const host = '127.0.0.1';
  const port = await listen(server, host, 4177);
  const userData = mkdtempSync(resolve(tmpdir(), 'bcs-chrome-'));
  const captureUrl = `http://${host}:${port}/tools/capture.html?autorun=1&mode=${mode}`;
  const args = [
    '--headless',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-timer-throttling',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    `--user-data-dir=${userData}`,
    '--window-size=1080,1920',
    `--remote-debugging-port=0`,
    captureUrl,
  ];

  console.log(`[capture] chrome ${chromePath}`);
  console.log(`[capture] ${captureUrl}`);
  const chrome = spawn(chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  chrome.stderr.on('data', (chunk) => {
    const text = String(chunk);
    if (/ERROR|FATAL|VideoEncoder|WebGL/.test(text)) process.stderr.write(text);
  });

  const timer = setTimeout(() => {
    doneReject(new Error(`Capture timed out after ${timeoutMs}ms (${mode})`));
  }, timeoutMs);

  let settled = false;
  let report;
  try {
    report = await Promise.race([
      done,
      new Promise((_, reject) => chrome.on('exit', (code) => {
        if (!settled) reject(new Error(`Chrome exited before capture finished (code ${code})`));
      })),
    ]);
    settled = true;
  } catch (error) {
    settled = true;
    report = {
      status: 'FAIL',
      mode,
      startedAt,
      errors: [error instanceof Error ? error.message : String(error)],
      tests: [],
      frames: [],
      videos: [],
      browser: 'headless chrome',
      webglRenderer: null,
      videoEncoder: false,
    };
  } finally {
    clearTimeout(timer);
    chrome.kill('SIGKILL');
    await new Promise((resolveWait) => {
      if (chrome.exitCode !== null) {
        resolveWait();
        return;
      }
      chrome.once('exit', () => resolveWait());
      setTimeout(resolveWait, 2000);
    });
    server.close();
    await vite.close();
    try {
      rmSync(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
    } catch (error) {
      console.warn(`[capture] could not remove chrome profile: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const runReportPath = resolve(runRoot, 'browser-e2e.json');
  mkdirSync(dirname(runReportPath), { recursive: true });
  writeFileSync(runReportPath, `${JSON.stringify(report, null, 2)}\n`);
  const listed = [
    ...(report.frames ?? []).map((item) => item.path),
    ...(report.videos ?? []).map((item) => item.path),
    'outputs/review/run/browser-e2e.json',
  ];
  writeFileSync(resolve(runRoot, 'artifact-manifest.json'), `${JSON.stringify({
    mode: report.mode,
    status: report.status,
    ...captureIdentity(),
    planHashes: report.planHashes ?? [],
    files: listed,
  }, null, 2)}\n`);
  if (mode === 'full' && report.status === 'PASS') {
    const outPath = resolve(root, 'outputs/review/reports/browser-e2e.json');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const mode = process.argv.includes('--full') || process.env.BCS_CAPTURE_FULL === '1' ? 'full' : 'smoke';
  const report = await runBrowserCapture({ mode });
  console.log(JSON.stringify({ status: report.status, mode: report.mode, frames: report.frames?.length ?? 0, videos: report.videos?.length ?? 0, errors: report.errors ?? [] }, null, 2));
  if (report.status === 'FAIL' || (report.status === 'NOT_RUN' && process.env.CI === 'true')) process.exit(1);
}
