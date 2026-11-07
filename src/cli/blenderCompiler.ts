import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_GLB_INSPECTION_LIMITS,
  inspectGlbArrayBuffer,
  type GlbInspection,
} from '../assets/glbInspector.js';
import {
  BcsHeadlessError,
  isBlenderCompileReport,
  validateBlenderSceneExchange,
  validateBlenderCompileReport,
  type BlenderCompileReport,
} from '../headless/index.js';

const execFileAsync = promisify(execFile);

export interface BlenderCompileOptions {
  source: string;
  output: string;
  blenderExecutable?: string;
  engine?: 'BLENDER_EEVEE' | 'CYCLES';
  timeoutMs?: number;
  maxTriangleCount?: number;
  assetRoot?: string;
}

export interface BlenderCompileResult {
  executable: string;
  outputDirectory: string;
  reportPath: string;
  report: BlenderCompileReport;
  glbInspection: GlbInspection;
  vfxGlbInspection?: GlbInspection;
  elapsedMs: number;
  blenderLogTail: string[];
}

export interface BlenderPackageVerification {
  outputDirectory: string;
  reportPath: string;
  report: BlenderCompileReport;
  glbInspection: GlbInspection;
  vfxGlbInspection?: GlbInspection;
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isFile() === true;
}

function numericVersionParts(name: string): number[] {
  return name.match(/\d+(?:\.\d+)*/)?.[0]?.split('.').map(Number) ?? [];
}

function compareVersionNames(left: string, right: string): number {
  const a = numericVersionParts(left);
  const b = numericVersionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (b[index] ?? 0) - (a[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return right.localeCompare(left);
}

async function windowsBlenderCandidates(): Promise<string[]> {
  const roots = [...new Set([
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    'C:\\Program Files',
  ].filter((value): value is string => Boolean(value)))];
  const candidates: string[] = [];
  for (const root of roots) {
    const foundation = join(root, 'Blender Foundation');
    const entries = await readdir(foundation, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((a, b) => compareVersionNames(a.name, b.name))) {
      candidates.push(join(foundation, entry.name, 'blender.exe'));
    }
  }
  return candidates;
}

export async function locateBlenderExecutable(explicit?: string): Promise<string> {
  const requested = explicit ?? process.env.BLENDER_EXECUTABLE;
  if (requested) {
    const absolute = resolve(requested);
    if (!await isFile(absolute)) {
      throw new BcsHeadlessError('BLENDER_EXECUTABLE_NOT_FOUND', `Blender executable not found: ${absolute}`, {
        path: explicit ? '--blender' : 'BLENDER_EXECUTABLE',
      });
    }
    return absolute;
  }

  const candidates = process.platform === 'win32'
    ? await windowsBlenderCandidates()
    : process.platform === 'darwin'
      ? ['/Applications/Blender.app/Contents/MacOS/Blender']
      : ['/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender'];
  for (const candidate of candidates) {
    if (await isFile(candidate)) return resolve(candidate);
  }
  throw new BcsHeadlessError(
    'BLENDER_EXECUTABLE_NOT_FOUND',
    'Blender was not found. Pass --blender <path> or set BLENDER_EXECUTABLE.',
    { path: '--blender' },
  );
}

function compilerScriptPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return resolve(dirname(currentFile), '../../scripts/blender/compile_bcs_scene.py');
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolveStream, rejectStream) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', rejectStream);
    stream.on('end', resolveStream);
  });
  return hash.digest('hex');
}

async function assertEmptyOutputDirectory(output: string): Promise<void> {
  const info = await stat(output).catch(() => null);
  if (info && !info.isDirectory()) {
    throw new BcsHeadlessError('BLENDER_OUTPUT_INVALID', `Output path is not a directory: ${output}`, { path: '--output' });
  }
  if (info) {
    const entries = await readdir(output);
    if (entries.length > 0) {
      throw new BcsHeadlessError(
        'BLENDER_OUTPUT_NOT_EMPTY',
        `Refusing to overwrite non-empty Blender output directory: ${output}`,
        { path: '--output', details: { entries: entries.slice(0, 20) } },
      );
    }
  } else {
    await mkdir(output, { recursive: true });
  }
}

async function readReport(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new BcsHeadlessError('BLENDER_REPORT_READ_FAILED', `Unable to read Blender report: ${path}`, {
      path,
      details: error instanceof Error ? error.message : error,
    });
  }
}

async function verifyReportArtifacts(report: BlenderCompileReport, outputDirectory: string): Promise<void> {
  for (const artifact of report.outputs) {
    const path = isAbsolute(artifact.path) ? resolve(artifact.path) : resolve(outputDirectory, artifact.path);
    if (!isInside(outputDirectory, path)) {
      throw new BcsHeadlessError('BLENDER_ARTIFACT_OUTSIDE_OUTPUT', `Artifact escapes output directory: ${path}`, { path });
    }
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) {
      throw new BcsHeadlessError('BLENDER_ARTIFACT_MISSING', `Blender artifact is missing: ${path}`, { path });
    }
    if (info.size !== artifact.byteLength) {
      throw new BcsHeadlessError('BLENDER_ARTIFACT_SIZE_MISMATCH', `Blender artifact size changed: ${path}`, {
        path,
        details: { expected: artifact.byteLength, actual: info.size },
      });
    }
    const actualHash = await sha256File(path);
    if (actualHash !== artifact.sha256.toLowerCase()) {
      throw new BcsHeadlessError('BLENDER_ARTIFACT_HASH_MISMATCH', `Blender artifact hash changed: ${path}`, {
        path,
        details: { expected: artifact.sha256, actual: actualHash },
      });
    }
  }
}

export async function verifyBlenderPackage(
  inputReportPath: string,
  maxTriangleCount = DEFAULT_GLB_INSPECTION_LIMITS.maximumTriangles,
): Promise<BlenderPackageVerification> {
  const reportPath = resolve(inputReportPath);
  const outputDirectory = dirname(reportPath);
  const rawReport = await readReport(reportPath);
  const reportIssues = validateBlenderCompileReport(rawReport).filter((candidate) => candidate.severity === 'error');
  if (!isBlenderCompileReport(rawReport) || reportIssues.length > 0) {
    throw new BcsHeadlessError('BLENDER_REPORT_INVALID', 'Blender returned an invalid compile report.', {
      path: reportPath,
      details: reportIssues,
    });
  }
  if (rawReport.status !== 'passed') {
    throw new BcsHeadlessError('BLENDER_REPORT_FAILED', 'Blender compile report did not pass.', {
      path: reportPath,
      details: rawReport.errors,
    });
  }
  await verifyReportArtifacts(rawReport, outputDirectory);
  const exchangeArtifact = rawReport.outputs.find((artifact) => artifact.role === 'scene-exchange');
  if (!exchangeArtifact) {
    throw new BcsHeadlessError('BLENDER_EXCHANGE_COPY_MISSING', 'Compile report has no scene-exchange artifact.', { path: reportPath });
  }
  const exchangePath = isAbsolute(exchangeArtifact.path)
    ? resolve(exchangeArtifact.path)
    : resolve(outputDirectory, exchangeArtifact.path);
  const exchange = await readReport(exchangePath);
  const exchangeIssues = validateBlenderSceneExchange(exchange).filter((candidate) => candidate.severity === 'error');
  if (exchangeIssues.length > 0) {
    throw new BcsHeadlessError('BLENDER_EXCHANGE_COPY_INVALID', 'Packaged scene exchange failed validation.', {
      path: exchangePath,
      details: exchangeIssues,
    });
  }
  if (exchangeArtifact.sha256.toLowerCase() !== rawReport.source.sha256.toLowerCase()) {
    throw new BcsHeadlessError(
      'BLENDER_EXCHANGE_SOURCE_HASH_MISMATCH',
      'Packaged scene exchange does not match the source hash recorded by Blender.',
      { path: exchangePath },
    );
  }
  const glbArtifact = rawReport.outputs.find((artifact) => artifact.role === 'scene-glb');
  if (!glbArtifact) {
    throw new BcsHeadlessError('BLENDER_GLB_MISSING', 'Compile report has no scene-glb artifact.', { path: reportPath });
  }
  const glbPath = isAbsolute(glbArtifact.path)
    ? resolve(glbArtifact.path)
    : resolve(outputDirectory, glbArtifact.path);
  let glbInspection: GlbInspection;
  try {
    glbInspection = inspectGlbArrayBuffer(await readFile(glbPath), {
      ...DEFAULT_GLB_INSPECTION_LIMITS,
      maximumTriangles: maxTriangleCount,
    });
  } catch (error) {
    throw new BcsHeadlessError('BLENDER_GLB_INVALID', `Compiled GLB failed independent inspection: ${error instanceof Error ? error.message : String(error)}`, {
      path: glbPath,
    });
  }
  if (glbInspection.triangleCount !== rawReport.metrics.triangleCount) {
    throw new BcsHeadlessError(
      'BLENDER_TRIANGLE_COUNT_MISMATCH',
      `Blender reported ${rawReport.metrics.triangleCount} triangles but GLB contains ${glbInspection.triangleCount}.`,
      { path: glbPath },
    );
  }
  if ((glbInspection.entityIdsByRole.tile?.length ?? 0) === 0) {
    throw new BcsHeadlessError(
      'BLENDER_GLB_SEMANTICS_MISSING',
      'Compiled GLB is missing BCS tile roles or stable entity ids.',
      { path: glbPath, details: { semanticRoles: glbInspection.semanticRoles, entityIds: glbInspection.entityIds } },
    );
  }
  if (rawReport.metrics.triangleCount > maxTriangleCount) {
    throw new BcsHeadlessError(
      'BLENDER_TRIANGLE_BUDGET_EXCEEDED',
      `Compiled scene has ${rawReport.metrics.triangleCount} triangles; budget is ${maxTriangleCount}.`,
      { path: reportPath, details: { triangleCount: rawReport.metrics.triangleCount, maxTriangleCount } },
    );
  }
  const vfxArtifact = rawReport.outputs.find((artifact) => artifact.role === 'vfx-glb');
  let vfxGlbInspection: GlbInspection | undefined;
  if (vfxArtifact) {
    const vfxPath = isAbsolute(vfxArtifact.path) ? resolve(vfxArtifact.path) : resolve(outputDirectory, vfxArtifact.path);
    try {
      vfxGlbInspection = inspectGlbArrayBuffer(await readFile(vfxPath), {
        ...DEFAULT_GLB_INSPECTION_LIMITS,
        maximumTriangles: maxTriangleCount,
      });
    } catch (error) {
      throw new BcsHeadlessError('BLENDER_VFX_GLB_INVALID', `Compiled VFX GLB failed independent inspection: ${error instanceof Error ? error.message : String(error)}`, { path: vfxPath });
    }
    if (!vfxGlbInspection.semanticRoles.includes('fixed-camera') || !vfxGlbInspection.semanticRoles.includes('match-core') || !vfxGlbInspection.semanticRoles.includes('match-fragment')) {
      throw new BcsHeadlessError('BLENDER_VFX_GLB_SEMANTICS_MISSING', 'VFX GLB must contain the fixed camera, match core, and match fragments.', { path: vfxPath });
    }
    const stableRoles = ['fixed-camera', 'match-core', 'match-fragment', 'match-shockwave'];
    for (const role of stableRoles) {
      const roleCount = vfxGlbInspection.semanticRoleCounts[role] ?? 0;
      const stableIdCount = vfxGlbInspection.entityIdsByRole[role]?.length ?? 0;
      if (roleCount !== stableIdCount) {
        throw new BcsHeadlessError('BLENDER_VFX_STABLE_ID_INVALID', `Every ${role} node must carry a unique bcs_id.`, {
          path: vfxPath,
          details: { role, roleCount, stableIdCount },
        });
      }
    }
    const vfxIds = stableRoles.flatMap((role) => vfxGlbInspection!.entityIdsByRole[role] ?? []);
    if (new Set(vfxIds).size !== vfxIds.length) {
      throw new BcsHeadlessError('BLENDER_VFX_STABLE_ID_INVALID', 'Fixed-camera and VFX ids must be globally unique across semantic roles.', {
        path: vfxPath,
        details: { vfxIds },
      });
    }
    const matchCoreIds = vfxGlbInspection.entityIdsByRole['match-core'] ?? [];
    if (rawReport.metrics.eventCount !== undefined && matchCoreIds.length !== rawReport.metrics.eventCount) {
      throw new BcsHeadlessError('BLENDER_VFX_EVENT_COUNT_MISMATCH', 'VFX GLB match cores do not match the compiled event count.', {
        path: vfxPath,
        details: { reportEventCount: rawReport.metrics.eventCount, matchCoreIds },
      });
    }
    if (matchCoreIds.some((id) => !id.endsWith('::core'))) {
      throw new BcsHeadlessError('BLENDER_VFX_EVENT_ID_INVALID', 'Match core ids must end with ::core so the Studio can bind them to Take events.', {
        path: vfxPath,
        details: { matchCoreIds },
      });
    }
    if (vfxGlbInspection.semanticRoles.includes('tile') || vfxGlbInspection.textureCount > 0) {
      throw new BcsHeadlessError('BLENDER_VFX_GLB_NOT_ISOLATED', 'VFX GLB unexpectedly contains tiles or textures.', { path: vfxPath });
    }
    if (rawReport.metrics.vfxTriangleCount !== undefined && vfxGlbInspection.triangleCount !== rawReport.metrics.vfxTriangleCount) {
      throw new BcsHeadlessError('BLENDER_VFX_TRIANGLE_COUNT_MISMATCH', 'VFX GLB triangle count differs from the Blender report.', { path: vfxPath });
    }
  }
  return { outputDirectory, reportPath, report: rawReport, glbInspection, ...(vfxGlbInspection ? { vfxGlbInspection } : {}) };
}

function logTail(stdout: string, stderr: string): string[] {
  return `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-24);
}

export async function compileBlenderScene(options: BlenderCompileOptions): Promise<BlenderCompileResult> {
  const source = resolve(options.source);
  const outputDirectory = resolve(options.output);
  if (!await isFile(source)) {
    throw new BcsHeadlessError('BLENDER_SOURCE_NOT_FOUND', `Scene exchange source not found: ${source}`, { path: source });
  }
  await assertEmptyOutputDirectory(outputDirectory);
  const executable = await locateBlenderExecutable(options.blenderExecutable);
  const script = compilerScriptPath();
  await access(script).catch((error) => {
    throw new BcsHeadlessError('BLENDER_COMPILER_SCRIPT_MISSING', `Blender compiler script not found: ${script}`, {
      path: script,
      details: error instanceof Error ? error.message : error,
    });
  });
  const reportPath = join(outputDirectory, 'compile-report.json');
  const engine = options.engine ?? 'BLENDER_EEVEE';
  const timeoutMs = Math.max(10_000, Math.min(30 * 60_000, options.timeoutMs ?? 5 * 60_000));
  const started = performance.now();
  let stdout = '';
  let stderr = '';
  try {
    const blenderArgs = [
      '--background',
      '--factory-startup',
      '--python',
      script,
      '--',
      '--source',
      source,
      '--output',
      outputDirectory,
      '--engine',
      engine,
    ];
    if (options.assetRoot) blenderArgs.push('--asset-root', resolve(options.assetRoot));
    const result = await execFileAsync(executable, blenderArgs, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string; code?: unknown; signal?: unknown };
    stdout = failure.stdout ?? '';
    stderr = failure.stderr ?? '';
    const report = await readReport(reportPath).catch(() => null);
    throw new BcsHeadlessError('BLENDER_COMPILE_FAILED', 'Blender scene compilation failed.', {
      path: source,
      details: {
        message: failure.message,
        code: failure.code,
        signal: failure.signal,
        report,
        logTail: logTail(stdout, stderr),
      },
      recoverable: true,
    });
  }

  const maxTriangleCount = options.maxTriangleCount ?? 250_000;
  const verified = await verifyBlenderPackage(reportPath, maxTriangleCount);
  return {
    executable,
    outputDirectory,
    reportPath,
    report: verified.report,
    glbInspection: verified.glbInspection,
    ...(verified.vfxGlbInspection ? { vfxGlbInspection: verified.vfxGlbInspection } : {}),
    elapsedMs: Math.round(performance.now() - started),
    blenderLogTail: logTail(stdout, stderr),
  };
}
