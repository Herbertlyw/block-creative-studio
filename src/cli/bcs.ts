#!/usr/bin/env node

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AssetRegistry,
  BCS_CAPABILITIES,
  BcsHeadlessError,
  compileMaterialRuntime,
  compileVariant,
  expandGoldenSceneCases,
  renderGoldenReportHtml,
  validateBlenderSceneExchange,
  runQualityGate,
  summarizeCalibrationCases,
  validateAssetManifest,
  type AssetManifest,
  type CalibrationCase,
  type CreativeMaster,
  type GoldenBatchReport,
  type HeadlessRendererId,
  type MaterialPackManifest,
  type ResolvedRenderPlan,
  type VariantRecipe,
} from '../headless/index.js';
import { compileBlenderScene, verifyBlenderPackage } from './blenderCompiler.js';
import { renderBlenderVideo, type BlenderVideoQuality } from './blenderVideoRenderer.js';
import { extractBlenderSceneBundle } from './blenderSceneBundle.js';
import { DEFAULT_GLB_INSPECTION_LIMITS, inspectGlbArrayBuffer } from '../assets/glbInspector.js';

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | boolean>;
}

const SCHEMAS: Record<string, string> = {
  'asset-manifest@1': 'headless/asset-manifest.schema.json',
  'creative-master@1': 'headless/creative-master.schema.json',
  'variant-recipe@1': 'headless/variant-recipe.schema.json',
  'resolved-render-plan@1': 'headless/resolved-render-plan.schema.json',
  'blender-scene-exchange@1': 'dcc/blender-scene-exchange.schema.json',
  'blender-compile-report@1': 'dcc/blender-compile-report.schema.json',
  'blender-video-render-report@1': 'dcc/blender-video-render-report.schema.json',
};

function parseArgs(values: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const equals = value.indexOf('=');
    if (equals > 2) {
      flags.set(value.slice(2, equals), value.slice(equals + 1));
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith('--')) {
      flags.set(key, next);
      index += 1;
    } else {
      flags.set(key, true);
    }
  }
  return { positionals, flags };
}

function flagString(args: ParsedArgs, name: string, required = false): string | undefined {
  const value = args.flags.get(name);
  if (typeof value === 'string') return value;
  if (required) throw new BcsHeadlessError('CLI_ARGUMENT_REQUIRED', `--${name} is required.`, { path: `--${name}` });
  return undefined;
}

function flagNumber(args: ParsedArgs, name: string): number | undefined {
  const value = flagString(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new BcsHeadlessError('CLI_ARGUMENT_INVALID', `--${name} must be numeric.`, { path: `--${name}` });
  return parsed;
}

function flagBoolean(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

async function readJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    throw new BcsHeadlessError('JSON_READ_FAILED', `Unable to read JSON file ${path}.`, {
      path,
      details: error instanceof Error ? error.message : error,
    });
  }
}

async function collectJsonFiles(root: string): Promise<string[]> {
  const info = await stat(root).catch(() => null);
  if (!info) throw new BcsHeadlessError('ASSET_PATH_NOT_FOUND', `Asset path ${root} does not exist.`, { path: root });
  if (info.isFile()) return extname(root).toLowerCase() === '.json' ? [root] : [];
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await collectJsonFiles(child));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.json') files.push(child);
  }
  return files.sort();
}

async function loadRegistry(root: string): Promise<AssetRegistry> {
  const registry = new AssetRegistry();
  for (const file of await collectJsonFiles(root)) {
    const value = await readJson<unknown>(file);
    if (
      typeof value === 'object'
      && value !== null
      && (value as { contract?: unknown }).contract === 'bcs.asset-manifest'
    ) {
      try {
        registry.register(value as AssetManifest);
      } catch (error) {
        if (error instanceof BcsHeadlessError) {
          throw new BcsHeadlessError(error.code, `${file}: ${error.message}`, {
            path: error.path ?? file,
            recoverable: error.recoverable,
            details: error.details,
          });
        }
        throw error;
      }
    }
  }
  return registry;
}

function schemaRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return resolve(dirname(currentFile), '../../schemas');
}

async function commandSchema(args: ParsedArgs): Promise<unknown> {
  const action = args.positionals[0];
  if (action === 'list') return { ok: true, schemas: Object.keys(SCHEMAS).sort() };
  if (action === 'get') {
    const name = args.positionals[1];
    if (!name || !SCHEMAS[name]) {
      throw new BcsHeadlessError('SCHEMA_NOT_FOUND', `Unknown schema ${name ?? '(missing)'}.`, { path: 'schema' });
    }
    return { ok: true, name, schema: await readJson<unknown>(join(schemaRoot(), SCHEMAS[name])) };
  }
  throw new BcsHeadlessError('CLI_COMMAND_INVALID', 'Use `schema list` or `schema get <name>`.', { path: 'schema' });
}

async function commandAsset(args: ParsedArgs): Promise<unknown> {
  if (args.positionals[0] !== 'validate') {
    throw new BcsHeadlessError('CLI_COMMAND_INVALID', 'Use `asset validate <manifest.json>`.', { path: 'asset' });
  }
  const path = args.positionals[1];
  if (!path) throw new BcsHeadlessError('CLI_ARGUMENT_REQUIRED', 'Asset manifest path is required.', { path: 'asset' });
  const manifest = await readJson<unknown>(path);
  const issues = validateAssetManifest(manifest);
  return {
    ok: !issues.some((candidate) => candidate.severity === 'error'),
    file: resolve(path),
    issues,
  };
}

async function commandVariant(args: ParsedArgs): Promise<unknown> {
  if (args.positionals[0] !== 'compile') {
    throw new BcsHeadlessError('CLI_COMMAND_INVALID', 'Use `variant compile --master … --recipe … --assets …`.', { path: 'variant' });
  }
  const masterPath = flagString(args, 'master', true)!;
  const recipePath = flagString(args, 'recipe', true)!;
  const assetsPath = flagString(args, 'assets', true)!;
  const renderer = (flagString(args, 'renderer') ?? 'fixed-camera-cinematic') as HeadlessRendererId;
  if (!BCS_CAPABILITIES.renderers.includes(renderer)) {
    throw new BcsHeadlessError('RENDERER_UNSUPPORTED', `Renderer ${renderer} is not supported.`, { path: '--renderer' });
  }
  const registry = await loadRegistry(assetsPath);
  const master = await readJson<CreativeMaster>(masterPath);
  const recipe = await readJson<VariantRecipe>(recipePath);
  const plan = compileVariant(master, recipe, registry, {
    renderer,
    requireHashes: flagBoolean(args, 'require-hashes'),
  });
  const out = flagString(args, 'out');
  if (out) await writeFile(out, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  return { ok: true, registryAssets: registry.size, out: out ? resolve(out) : null, plan };
}

async function commandQuality(args: ParsedArgs): Promise<unknown> {
  if (args.positionals[0] !== 'check') {
    throw new BcsHeadlessError('CLI_COMMAND_INVALID', 'Use `quality check --plan …`.', { path: 'quality' });
  }
  const planPath = flagString(args, 'plan', true)!;
  const plan = await readJson<ResolvedRenderPlan>(planPath);
  const maxTextureMemoryMiB = flagNumber(args, 'max-texture-mib');
  const maxTriangleCount = flagNumber(args, 'max-triangles');
  const maxPluginMemoryMiB = flagNumber(args, 'max-plugin-mib');
  const report = runQualityGate(plan, {
    strict: flagBoolean(args, 'strict'),
    requireHashes: flagBoolean(args, 'require-hashes'),
    ...(maxTextureMemoryMiB !== undefined ? { maxTextureMemoryMiB } : {}),
    ...(maxTriangleCount !== undefined ? { maxTriangleCount } : {}),
    ...(maxPluginMemoryMiB !== undefined ? { maxPluginMemoryMiB } : {}),
  });
  const out = flagString(args, 'out');
  if (out) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { ok: report.passed, out: out ? resolve(out) : null, report };
}

async function commandMaterial(args: ParsedArgs): Promise<unknown> {
  if (args.positionals[0] !== 'compile') {
    throw new BcsHeadlessError('CLI_COMMAND_INVALID', 'Use `material compile --pack …`.', { path: 'material' });
  }
  const packPath = flagString(args, 'pack', true)!;
  const pack = await readJson<MaterialPackManifest>(packPath);
  const descriptor = compileMaterialRuntime({ pack });
  const out = flagString(args, 'out');
  if (out) await writeFile(out, `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8');
  return {
    ok: true,
    rendered: false,
    resourcesReady: descriptor.maps.length === 0,
    out: out ? resolve(out) : null,
    descriptor,
  };
}

async function commandGolden(args: ParsedArgs): Promise<unknown> {
  if (args.positionals[0] !== 'batch') {
    throw new BcsHeadlessError('CLI_COMMAND_INVALID', 'Use `golden batch --index …`.', { path: 'golden' });
  }
  const indexPath = flagString(args, 'index', true)!;
  const index = await readJson<{
    sourceVideoSha256?: string;
    scenes: Array<{ id: string; startFrame: number; peakFrame: number; endFrame: number; purpose: string }>;
  }>(indexPath);
  const targetTakeHash = flagString(args, 'target-take-hash');
  const correspondence = targetTakeHash ? 'exact-replay' as const : 'isolated-presentation' as const;
  const unresolvedReasons = [
    'Reference source video is not in the public repository.',
    ...(targetTakeHash
      ? []
      : ['No target Take hash; correspondence is isolated-presentation, not exact-replay.']),
  ];
  const cases = expandGoldenSceneCases(index.scenes, {
    correspondence,
    reviewStatus: 'BLOCKED',
    unresolvedReasons,
    ...(index.sourceVideoSha256 ? { referenceMediaHash: `sha256:${index.sourceVideoSha256}` } : {}),
    sourceFps: 60,
    targetFps: 30,
    ...(targetTakeHash !== undefined ? { targetTakeHash } : {}),
  });
  const report: GoldenBatchReport = {
    contract: 'bcs.golden-batch-report',
    contractVersion: '1.0.0',
    generatedAt: 'not-a-wall-clock-render',
    designResolution: { width: 1064, height: 1788 },
    cases: cases.map((item: CalibrationCase) => ({
      case: item,
      identity: `${item.id}:${item.correspondence}:${item.targetFrame}`,
    })),
    summary: summarizeCalibrationCases(cases),
  };
  const out = flagString(args, 'out');
  const htmlOut = flagString(args, 'html');
  if (out) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (htmlOut) await writeFile(htmlOut, renderGoldenReportHtml(report), 'utf8');
  return { ok: true, rendered: false, out: out ? resolve(out) : null, html: htmlOut ? resolve(htmlOut) : null, report };
}

async function commandDcc(args: ParsedArgs): Promise<unknown> {
  const action = args.positionals[0];
  const sourcePath = args.positionals[1];
  if (action === 'validate-exchange') {
    if (!sourcePath) {
      throw new BcsHeadlessError('CLI_ARGUMENT_REQUIRED', 'Scene exchange path is required.', { path: 'dcc' });
    }
    const source = await readJson<unknown>(sourcePath);
    const issues = validateBlenderSceneExchange(source);
    return {
      ok: !issues.some((candidate) => candidate.severity === 'error'),
      file: resolve(sourcePath),
      issues,
    };
  }
  if (action === 'compile-blender') {
    if (!sourcePath) {
      throw new BcsHeadlessError('CLI_ARGUMENT_REQUIRED', 'Scene exchange path is required.', { path: 'dcc' });
    }
    const sourceIsBundle = sourcePath.toLowerCase().endsWith('.zip');
    const bundle = sourceIsBundle ? await extractBlenderSceneBundle(sourcePath) : undefined;
    try {
    const resolvedSourcePath = bundle?.scenePath ?? sourcePath;
    const source = await readJson<unknown>(resolvedSourcePath);
    const issues = validateBlenderSceneExchange(source);
    const errors = issues.filter((candidate) => candidate.severity === 'error');
    if (errors.length > 0) {
      throw new BcsHeadlessError('BLENDER_EXCHANGE_INVALID', 'Scene exchange failed validation.', {
        path: resolve(sourcePath),
        details: issues,
      });
    }
    const output = flagString(args, 'output') ?? flagString(args, 'out');
    if (!output) throw new BcsHeadlessError('CLI_ARGUMENT_REQUIRED', '--output is required.', { path: '--output' });
    const engineFlag = flagString(args, 'engine') ?? 'eevee';
    if (engineFlag !== 'eevee' && engineFlag !== 'cycles') {
      throw new BcsHeadlessError('CLI_ARGUMENT_INVALID', '--engine must be eevee or cycles.', { path: '--engine' });
    }
    const blenderExecutable = flagString(args, 'blender');
    const timeoutMs = flagNumber(args, 'timeout-ms');
    const maxTriangleCount = flagNumber(args, 'max-triangles');
    const assetRoot = flagString(args, 'asset-root');
      const result = await compileBlenderScene({
        source: resolvedSourcePath,
        output,
        ...(blenderExecutable !== undefined ? { blenderExecutable } : {}),
        engine: engineFlag === 'cycles' ? 'CYCLES' : 'BLENDER_EEVEE',
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(maxTriangleCount !== undefined ? { maxTriangleCount } : {}),
        ...(bundle ? { assetRoot: bundle.directory } : assetRoot !== undefined ? { assetRoot } : {}),
      });
      return {
        ok: true,
        input: bundle ? { kind: 'bcs-blender-scene-bundle', file: resolve(sourcePath), packageId: bundle.packageId, assetCount: bundle.assetCount } : { kind: 'scene-exchange', file: resolve(sourcePath) },
        outputDirectory: result.outputDirectory,
        reportPath: result.reportPath,
        elapsedMs: result.elapsedMs,
        blender: result.report.blender,
        render: result.report.render,
        metrics: result.report.metrics,
        quality: result.report.quality ?? null,
        glb: result.glbInspection,
        vfxGlb: result.vfxGlbInspection ?? null,
        outputs: result.report.outputs,
        warnings: [...issues.filter((candidate) => candidate.severity === 'warning'), ...result.report.warnings],
        logTail: result.blenderLogTail,
      };
    } finally {
      await bundle?.cleanup();
    }
  }
  if (action === 'inspect-glb') {
    if (!sourcePath) {
      throw new BcsHeadlessError('CLI_ARGUMENT_REQUIRED', 'GLB path is required.', { path: 'dcc' });
    }
    const maximumTriangles = flagNumber(args, 'max-triangles') ?? DEFAULT_GLB_INSPECTION_LIMITS.maximumTriangles;
    const inspection = inspectGlbArrayBuffer(await readFile(sourcePath), {
      ...DEFAULT_GLB_INSPECTION_LIMITS,
      maximumTriangles,
    });
    return { ok: true, file: resolve(sourcePath), inspection };
  }
  if (action === 'verify-blender') {
    if (!sourcePath) {
      throw new BcsHeadlessError('CLI_ARGUMENT_REQUIRED', 'Blender compile report path is required.', { path: 'dcc' });
    }
    const maximumTriangles = flagNumber(args, 'max-triangles') ?? DEFAULT_GLB_INSPECTION_LIMITS.maximumTriangles;
    const verified = await verifyBlenderPackage(sourcePath, maximumTriangles);
    return {
      ok: true,
      outputDirectory: verified.outputDirectory,
      reportPath: verified.reportPath,
      packageId: verified.report.packageId,
      blender: verified.report.blender,
      render: verified.report.render,
      metrics: verified.report.metrics,
      quality: verified.report.quality ?? null,
      glb: verified.glbInspection,
      vfxGlb: verified.vfxGlbInspection ?? null,
      outputCount: verified.report.outputs.length,
    };
  }
  if (action === 'render-blender') {
    if (!sourcePath) {
      throw new BcsHeadlessError('CLI_ARGUMENT_REQUIRED', 'Compiled Blender .blend path is required.', { path: 'dcc' });
    }
    const output = flagString(args, 'output') ?? flagString(args, 'out');
    if (!output) throw new BcsHeadlessError('CLI_ARGUMENT_REQUIRED', '--output is required.', { path: '--output' });
    const quality = (flagString(args, 'quality') ?? 'standard') as BlenderVideoQuality;
    if (!['draft', 'standard', 'cinematic'].includes(quality)) {
      throw new BcsHeadlessError('CLI_ARGUMENT_INVALID', '--quality must be draft, standard, or cinematic.', { path: '--quality' });
    }
    const blenderExecutable = flagString(args, 'blender');
    const timeoutMs = flagNumber(args, 'timeout-ms');
    const frameStart = flagNumber(args, 'frame-start');
    const frameEnd = flagNumber(args, 'frame-end');
    const result = await renderBlenderVideo({
      source: sourcePath,
      output,
      quality,
      ...(blenderExecutable !== undefined ? { blenderExecutable } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(frameStart !== undefined ? { frameStart } : {}),
      ...(frameEnd !== undefined ? { frameEnd } : {}),
    });
    return {
      ok: true,
      output: result.report.output,
      reportPath: result.reportPath,
      elapsedMs: result.elapsedMs,
      blender: result.report.blender,
      render: result.report.render,
      inspection: result.inspection,
      warnings: result.report.warnings,
      logTail: result.blenderLogTail,
    };
  }
  throw new BcsHeadlessError(
    'CLI_COMMAND_INVALID',
    'Use `dcc validate-exchange`, `dcc inspect-glb`, `dcc verify-blender`, `dcc compile-blender`, or `dcc render-blender`.',
    { path: 'dcc' },
  );
}

async function execute(argv: string[]): Promise<unknown> {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  if (command === 'capabilities') return { ok: true, capabilities: BCS_CAPABILITIES };
  if (command === 'schema') return commandSchema(args);
  if (command === 'asset') return commandAsset(args);
  if (command === 'dcc') return commandDcc(args);
  if (command === 'variant') return commandVariant(args);
  if (command === 'quality') return commandQuality(args);
  if (command === 'material') return commandMaterial(args);
  if (command === 'golden') return commandGolden(args);
  throw new BcsHeadlessError(
    'CLI_COMMAND_INVALID',
    'Commands: capabilities, schema list|get, asset validate, dcc validate-exchange|inspect-glb|verify-blender|compile-blender|render-blender, variant compile, quality check, material compile, golden batch.',
    { path: command ?? '(missing command)' },
  );
}

try {
  const result = await execute(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (
    typeof result === 'object'
    && result !== null
    && 'ok' in result
    && (result as { ok: unknown }).ok === false
  ) process.exitCode = 1;
} catch (error) {
  const normalized = error instanceof BcsHeadlessError
    ? {
        code: error.code,
        message: error.message,
        ...(error.path !== undefined ? { path: error.path } : {}),
        recoverable: error.recoverable,
        ...(error.details !== undefined ? { details: error.details } : {}),
      }
    : {
        code: 'UNEXPECTED_ERROR',
        message: error instanceof Error ? error.message : String(error),
        recoverable: false,
      };
  process.stderr.write(`${JSON.stringify({ ok: false, error: normalized }, null, 2)}\n`);
  process.exitCode = 1;
}
