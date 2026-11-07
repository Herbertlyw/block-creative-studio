import { DEFAULT_STYLE } from '../renderer/stylePresets';
import { copyLookDevPreset } from '../renderer/lookDev';
import { Reference2DScene } from '../reference2d/Reference2DScene';
import { StudioScene } from '../renderer/StudioScene';
import { exportTakeVideo } from '../exporter/offlineVideoExporter';
import type { StyleSpec } from '../domain/types';
import { consecutiveTake } from '../domain/publicFixtures';
import {
  CAPTURE_FPS,
  STILL_SPECS,
  VIDEO_SIZE,
  VIDEO_SPECS,
  captureRhythm,
  presentationForSpec,
  resolveTakeAnchor,
  takeById,
} from './capturePlan';
import { compileVariantRuntime, VARIANT_PACK_PATHS, type VariantMaterialId } from './materialVariants';
import type { MaterialPackManifest } from '../headless/contracts';
import {
  planRenderEvidence,
  rendererConsumesMaterialRuntime,
  resolveStyleFromRenderPlan,
  type PlanRenderEvidence,
} from '../integration/studioAssetCatalog';
import { BrowserAssetStore, MemoryAssetBlobRepository } from '../assets/browserAssetStore';
import { EMPTY_RUNTIME_ASSET_BINDINGS } from '../assets/runtimeAssetBindings';
import { loadRuntimeTextureSet, resolveMaterialMapFetchUrl } from '../renderer/runtimeTextures';
import { activeShotProfile } from '../renderer/planShotAdapter';
import { viewportPolicyForRenderer } from '../renderer/shotProfile';

interface CaptureReport {
  status: 'PASS' | 'FAIL';
  mode: string;
  startedAt: string;
  finishedAt?: string;
  browser: string;
  webglRenderer: string | null;
  videoEncoder: boolean;
  tests: Array<{ name: string; status: 'PASS' | 'FAIL' | 'NOT_RUN'; detail?: string }>;
  frames: Array<{ id: string; path: string; sha256: string; width: number; height: number }>;
  videos: Array<{ id: string; path: string; sha256: string; bytes: number; frameCount: number; durationSeconds: number }>;
  planHashes: Array<{
    materialId: string;
    planHash: string;
    lockMode: string;
    validatedEffectId: string;
    renderedFxPreset: string;
    effectDrivesPixels: boolean;
    validatedCameraId: string;
    renderedCameraProfile: string;
    cameraDrivesPixels: boolean;
    validatedLayoutId: string;
    renderedLayoutProfile: string;
    layoutDrivesPixels: boolean;
  }>;
  errors: string[];
}

const statusEl = document.createElement('pre');
statusEl.id = 'capture-status';
statusEl.textContent = 'capture starting…';
document.body.style.margin = '0';
document.body.style.background = '#05070d';
document.body.style.color = '#dce7ff';
document.body.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace';
document.body.append(statusEl);

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'smoke' ? 'smoke' : 'full';
const autorun = params.get('autorun') !== '0';

function log(message: string): void {
  statusEl.textContent += `\n${message}`;
  console.info(message);
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function blobPng(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('canvas.toBlob returned null');
  return blob;
}

async function postArtifact(path: string, blob: Blob, meta: Record<string, unknown>): Promise<{ sha256?: string }> {
  const response = await fetch('/__capture/artifact', {
    method: 'POST',
    headers: {
      'x-artifact-path': path,
      'x-artifact-meta': JSON.stringify(meta),
    },
    body: blob,
  });
  if (!response.ok) throw new Error(`artifact upload failed: ${path} ${response.status}`);
  return response.json() as Promise<{ sha256?: string }>;
}

async function postJson(path: string, body: unknown): Promise<void> {
  await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function webglRendererName(): string | null {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) return null;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  if (!info) return gl.getParameter(gl.RENDERER);
  return String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
}

const packCache = new Map<VariantMaterialId, MaterialPackManifest>();

async function loadPack(id: VariantMaterialId): Promise<MaterialPackManifest> {
  const cached = packCache.get(id);
  if (cached) return cached;
  const response = await fetch(`/__capture/workspace/${VARIANT_PACK_PATHS[id]}`);
  if (!response.ok) throw new Error(`Failed to load pack ${id}`);
  const pack = await response.json() as MaterialPackManifest;
  packCache.set(id, pack);
  return pack;
}

function baseStyle(): StyleSpec {
  return {
    ...DEFAULT_STYLE,
    showPointer: true,
  };
}

const capturedPlanHashes: Array<PlanRenderEvidence & { lockMode: string }> = [];

async function styleFor(
  renderer: StyleSpec['renderer'],
  materialId: VariantMaterialId | undefined,
  extras: Pick<StyleSpec, 'diagnosticView' | 'enabledPasses'> & { lookDevId?: StyleSpec['lookDev']['id'] } = {},
): Promise<StyleSpec> {
  const style: StyleSpec = {
    ...baseStyle(),
    renderer,
  };
  if (extras.diagnosticView) style.diagnosticView = extras.diagnosticView;
  if (extras.enabledPasses) style.enabledPasses = extras.enabledPasses;
  if (extras.lookDevId) style.lookDev = copyLookDevPreset(extras.lookDevId);
  if (!materialId) return style;
  const compiled = await compileVariantRuntime(await loadPack(materialId));
  const executed = resolveStyleFromRenderPlan(compiled.plan, style);
  const next: StyleSpec = { ...executed.style };
  if (extras.diagnosticView) next.diagnosticView = extras.diagnosticView;
  if (extras.enabledPasses) next.enabledPasses = extras.enabledPasses;
  if (extras.lookDevId) next.lookDev = copyLookDevPreset(extras.lookDevId);
  if (rendererConsumesMaterialRuntime(renderer)) next.renderer = renderer;
  if (!capturedPlanHashes.some((item) => item.materialId === materialId)) {
    capturedPlanHashes.push({
      ...planRenderEvidence(compiled.plan, next),
      lockMode: compiled.plan.lockMode,
    });
  }
  return next;
}

async function captureStill(spec: (typeof STILL_SPECS)[number]): Promise<{
  id: string;
  path: string;
  sha256: string;
  width: number;
  height: number;
}> {
  const frame = presentationForSpec(spec);
  const style = await styleFor(spec.renderer, spec.materialId, {
    ...(spec.diagnosticView ? { diagnosticView: spec.diagnosticView } : {}),
    ...(spec.enabledPasses ? { enabledPasses: spec.enabledPasses } : {}),
    ...(spec.lookDevId ? { lookDevId: spec.lookDevId } : {}),
  });
  const host = document.createElement('canvas');
  host.style.position = 'fixed';
  host.style.left = '-4096px';
  document.body.append(host);
  try {
    if (spec.renderer === 'reference-2d') {
      const scene = new Reference2DScene(host, { quality: 'cinematic' });
      await scene.warmup(frame, style);
      const native = scene.captureNativeFrame({ requireAssets: true });
      const blob = await blobPng(native);
      scene.dispose();
      const path = `outputs/review/run/frames/${spec.role}/${spec.id}.png`;
      const posted = await postArtifact(path, blob, {
        width: native.width,
        height: native.height,
        renderer: spec.renderer,
      });
      const sha256 = posted.sha256 ?? await sha256Hex(await blob.arrayBuffer());
      return { id: spec.id, path, sha256, width: native.width, height: native.height };
    }
    host.width = VIDEO_SIZE.width;
    host.height = VIDEO_SIZE.height;
    const scene = new StudioScene(host, { quality: 'cinematic' });
    scene.resize(VIDEO_SIZE.width, VIDEO_SIZE.height, 1);
    await scene.warmup(frame, style);
    const blob = await blobPng(host);
    scene.dispose();
    const path = `outputs/review/run/frames/${spec.role}/${spec.id}.png`;
    const posted = await postArtifact(path, blob, {
      width: host.width,
      height: host.height,
      renderer: spec.renderer,
    });
    const sha256 = posted.sha256 ?? await sha256Hex(await blob.arrayBuffer());
    return { id: spec.id, path, sha256, width: host.width, height: host.height };
  } finally {
    host.remove();
  }
}

async function captureVideo(spec: (typeof VIDEO_SPECS)[number]): Promise<{
  id: string;
  path: string;
  sha256: string;
  bytes: number;
  frameCount: number;
  durationSeconds: number;
}> {
  const take = consecutiveTake();
  const style = await styleFor(spec.renderer, spec.materialId);
  const result = await exportTakeVideo({
    take,
    rhythm: captureRhythm(),
    style,
    render: { ...VIDEO_SIZE, fps: CAPTURE_FPS, quality: 'preview' },
    projectName: `bcs-${spec.id}`,
    onProgress: (progress) => {
      if (progress.currentFrame % 30 === 0 || progress.phase !== 'rendering') {
        void postJson('/__capture/progress', {
          message: `video ${spec.id} ${progress.phase} ${progress.currentFrame}/${progress.totalFrames}`,
        });
      }
    },
  });
  const path = `outputs/review/run/videos/${spec.id}-1080x1920.mp4`;
  const posted = await postArtifact(path, result.blob, {
    frameCount: result.frameCount,
    durationSeconds: result.durationSeconds,
    renderer: spec.renderer,
  });
  const sha256 = posted.sha256 ?? await sha256Hex(await result.blob.arrayBuffer());
  return {
    id: spec.id,
    path,
    sha256,
    bytes: result.blob.size,
    frameCount: result.frameCount,
    durationSeconds: result.durationSeconds,
  };
}

async function runPreparedTextureTest(): Promise<{ name: string; status: 'PASS' | 'FAIL'; detail?: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext('2d');
  if (!context) return { name: 'prepared-pbr-maps', status: 'FAIL', detail: 'no 2d context' };
  context.fillStyle = '#c08040';
  context.fillRect(0, 0, 8, 8);
  const blob = await blobPng(canvas);
  const store = new BrowserAssetStore(new MemoryAssetBlobRepository());
  const record = await store.putBlob(blob, { fileName: 'albedo.png', mimeType: 'image/png', inspectMedia: false });
  const stored = await store.get(record.contentHash);
  if (!stored) return { name: 'prepared-pbr-maps', status: 'FAIL', detail: 'store miss' };
  const objectUrl = URL.createObjectURL(stored.blob);
  const map = {
    slot: 'baseColor' as const,
    uri: record.uri,
    contentHash: record.contentHash,
    channels: 'rgb' as const,
    colorSpace: 'srgb' as const,
  };
  const bindings = {
    ...EMPTY_RUNTIME_ASSET_BINDINGS,
    textureMaps: [{
      slotId: 'tile.material',
      role: 'texture-map' as const,
      contentHash: record.contentHash,
      sourceUri: record.uri,
      objectUrl,
      fileName: 'albedo.png',
      mimeType: 'image/png',
      fit: 'contain' as const,
      opacity: 1,
      blendMode: 'source-over' as const,
      inset: 0,
    }],
  };
  try {
    try {
      resolveMaterialMapFetchUrl(map, EMPTY_RUNTIME_ASSET_BINDINGS);
      return { name: 'prepared-pbr-maps', status: 'FAIL', detail: 'unprepared bcs-asset:// was fetchable' };
    } catch {
      // expected
    }
    const loaded = await loadRuntimeTextureSet([map], bindings);
    if (!loaded.baseColor) return { name: 'prepared-pbr-maps', status: 'FAIL', detail: 'texture missing' };
    loaded.baseColor.dispose();
    return { name: 'prepared-pbr-maps', status: 'PASS', detail: record.contentHash };
  } catch (error) {
    return { name: 'prepared-pbr-maps', status: 'FAIL', detail: error instanceof Error ? error.message : String(error) };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function runLetterboxPickTest(): Promise<{ name: string; status: 'PASS' | 'FAIL'; detail?: string }> {
  const spec = STILL_SPECS.find((item) => item.id === '3d-steel-idle');
  if (!spec) return { name: 'letterbox-pick', status: 'FAIL', detail: 'missing spec' };
  const frame = presentationForSpec(spec);
  const style = await styleFor(spec.renderer, spec.materialId);
  const host = document.createElement('canvas');
  host.style.position = 'fixed';
  host.style.left = '0';
  host.style.top = '0';
  host.style.width = '1920px';
  host.style.height = '1080px';
  document.body.append(host);
  const scene = new StudioScene(host, { quality: 'interactive' });
  try {
    scene.resize(1920, 1080, 1);
    await scene.warmup(frame, style);
    void host.offsetWidth;
    const rect = host.getBoundingClientRect();
    const viewport = viewportPolicyForRenderer(
      'fixed-camera-cinematic',
      1920,
      1080,
      activeShotProfile(style),
    ).viewport;
    const scaleX = rect.width / 1920;
    const scaleY = rect.height / 1080;
    const letterboxX = rect.left + Math.max(1, viewport.x * scaleX * 0.15);
    const letterboxY = rect.top + (viewport.y + viewport.height / 2) * scaleY;
    const centerX = rect.left + (viewport.x + viewport.width / 2) * scaleX;
    const centerY = rect.top + (viewport.y + viewport.height / 2) * scaleY;
    const miss = scene.pick(letterboxX, letterboxY);
    const hit = scene.pick(centerX, centerY);
    if (miss !== null) return { name: 'letterbox-pick', status: 'FAIL', detail: 'letterbox reported a hit' };
    if (hit?.kind !== 'cell') return { name: 'letterbox-pick', status: 'FAIL', detail: `center miss: ${JSON.stringify(hit)}` };
    return { name: 'letterbox-pick', status: 'PASS', detail: `${hit.row},${hit.col}` };
  } catch (error) {
    return { name: 'letterbox-pick', status: 'FAIL', detail: error instanceof Error ? error.message : String(error) };
  } finally {
    scene.dispose();
    host.remove();
  }
}

async function runSeekTest(): Promise<{ name: string; status: 'PASS' | 'FAIL'; detail?: string }> {
  const spec = STILL_SPECS.find((item) => item.id === '2d-legal-preview');
  if (!spec) return { name: 'seek-repeat', status: 'FAIL', detail: 'missing spec' };
  const a = await captureStill(spec);
  const b = await captureStill(spec);
  if (a.sha256 === b.sha256) return { name: 'seek-repeat', status: 'PASS', detail: a.sha256 };
  return { name: 'seek-repeat', status: 'FAIL', detail: `${a.sha256} !== ${b.sha256}` };
}

async function runAbortTest(): Promise<{ name: string; status: 'PASS' | 'FAIL'; detail?: string }> {
  const controller = new AbortController();
  const pending = exportTakeVideo({
    take: consecutiveTake(),
    rhythm: captureRhythm(),
    style: await styleFor('reference-2d', undefined),
    render: { ...VIDEO_SIZE, fps: CAPTURE_FPS, quality: 'preview' },
    projectName: 'bcs-abort',
    signal: controller.signal,
  });
  queueMicrotask(() => controller.abort());
  try {
    await pending;
    return { name: 'cancel-export', status: 'FAIL', detail: 'export completed after abort' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = error instanceof DOMException && error.name === 'AbortError' || /abort|cancel/i.test(message);
    return { name: 'cancel-export', status: aborted ? 'PASS' : 'FAIL', detail: message };
  }
}

async function run(): Promise<CaptureReport> {
  const report: CaptureReport = {
    status: 'PASS',
    mode,
    startedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    webglRenderer: webglRendererName(),
    videoEncoder: typeof VideoEncoder === 'function',
    tests: [],
    frames: [],
    videos: [],
    planHashes: [],
    errors: [],
  };
  try {
    const consecutive = resolveTakeAnchor(takeById('consecutive'));
    log(`consecutive take ${consecutive.compiledTotalFrames} frames / ${consecutive.durationSeconds.toFixed(2)}s`);
    await postJson('/__capture/progress', { message: 'initialized', consecutive });

    const stills = mode === 'smoke'
      ? STILL_SPECS.filter((item) => ['2d-idle', '2d-background-only', '3d-steel-idle'].includes(item.id))
      : STILL_SPECS;
    for (const spec of stills) {
      log(`still ${spec.id}`);
      await postJson('/__capture/progress', { message: `still ${spec.id}` });
      report.frames.push(await captureStill(spec));
    }

    report.tests.push(await runPreparedTextureTest());
    report.tests.push(await runLetterboxPickTest());
    report.tests.push(await runSeekTest());
    report.tests.push(await runAbortTest());
    report.tests.push({
      name: 'webcodecs',
      status: report.videoEncoder ? 'PASS' : 'NOT_RUN',
      detail: report.videoEncoder ? 'VideoEncoder present' : 'VideoEncoder missing',
    });

    if (mode === 'full' && report.videoEncoder) {
      for (const spec of VIDEO_SPECS) {
        log(`video ${spec.id}`);
        await postJson('/__capture/progress', { message: `video ${spec.id}` });
        report.videos.push(await captureVideo(spec));
      }
    } else {
      report.tests.push({ name: 'videos', status: 'NOT_RUN', detail: mode === 'smoke' ? 'smoke mode' : 'no VideoEncoder' });
    }

    report.planHashes = capturedPlanHashes;
    if (report.tests.some((item) => item.status === 'FAIL')) report.status = 'FAIL';
  } catch (error) {
    report.status = 'FAIL';
    report.errors.push(error instanceof Error ? error.stack ?? error.message : String(error));
    log(String(error));
  }
  report.finishedAt = new Date().toISOString();
  window.__CAPTURE_DONE__ = report;
  await postJson('/__capture/done', report);
  log(`done ${report.status}`);
  return report;
}

declare global {
  interface Window {
    __CAPTURE_DONE__?: CaptureReport;
  }
}

if (autorun) {
  void run();
} else {
  statusEl.textContent = 'capture page loaded (autorun=0)';
}
