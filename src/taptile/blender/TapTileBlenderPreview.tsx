import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { TapTileBlenderGlbValidation } from './blenderGlbRuntime';
import { validateTapTileBlenderGlb } from './blenderGlbRuntime';

interface TapTileBlenderPreviewProps {
  onNotice(message: string): void;
}

interface LoadedGlbSummary extends TapTileBlenderGlbValidation {
  fileName: string;
  byteLength: number;
  totalFrames: number;
  durationSeconds: number;
  frameStart: number;
  fps: number;
  timingSource: 'contract' | 'animation-fallback';
}

interface PreviewRuntime {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  fallbackCamera: THREE.PerspectiveCamera;
  root?: THREE.Object3D;
  mixer?: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
}

const VFX_ROLES = new Set(['match-core', 'match-fragment', 'match-shockwave']);

const PREVIEW_WIDTH = 270;
const PREVIEW_HEIGHT = 480;
const PREVIEW_FPS = 30;

function disposeRoot(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.geometry) geometries.add(object.geometry);
    const candidates = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of candidates) if (material) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material) as unknown[]) if (value instanceof THREE.Texture) textures.add(value);
  }
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

function clearLoaded(runtime: PreviewRuntime): void {
  runtime.mixer?.stopAllAction();
  if (runtime.root) {
    runtime.mixer?.uncacheRoot(runtime.root);
    runtime.scene.remove(runtime.root);
    disposeRoot(runtime.root);
  }
  delete runtime.root;
  delete runtime.mixer;
  runtime.clips = [];
  runtime.camera = runtime.fallbackCamera;
}

function frameFallbackCamera(camera: THREE.PerspectiveCamera, root: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(root);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(0.5, sphere.radius);
  camera.position.set(sphere.center.x, sphere.center.y - radius * 3.2, sphere.center.z + radius * 0.08);
  camera.near = Math.max(0.01, radius / 100);
  camera.far = radius * 20;
  camera.lookAt(sphere.center);
  camera.updateProjectionMatrix();
}

function isVfxMesh(object: THREE.Object3D): boolean {
  if (!(object instanceof THREE.Mesh)) return false;
  let current: THREE.Object3D | null = object;
  while (current) {
    if (VFX_ROLES.has(String(current.userData.bcs_role ?? ''))) return true;
    current = current.parent;
  }
  return false;
}

function applyVfxIsolation(root: THREE.Object3D | undefined, isolateVfx: boolean): { visibleMeshes: number; visibleVfxMeshes: number } {
  let visibleMeshes = 0;
  let visibleVfxMeshes = 0;
  root?.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const isVfx = isVfxMesh(object);
    object.visible = !isolateVfx || isVfx;
    if (object.visible) visibleMeshes += 1;
    if (object.visible && isVfx) visibleVfxMeshes += 1;
  });
  return { visibleMeshes, visibleVfxMeshes };
}

async function parseGlb(buffer: ArrayBuffer): Promise<GLTF> {
  return new Promise<GLTF>((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', resolve, reject);
  });
}

export function TapTileBlenderPreview({ onNotice }: TapTileBlenderPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const runtimeRef = useRef<PreviewRuntime | null>(null);
  const frameRef = useRef(0);
  const playingRef = useRef(false);
  const totalFramesRef = useRef(0);
  const frameStartRef = useRef(1);
  const fpsRef = useRef(PREVIEW_FPS);
  const [summary, setSummary] = useState<LoadedGlbSummary | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isolateVfx, setIsolateVfx] = useState(false);
  const [visibleMeshCount, setVisibleMeshCount] = useState(0);
  const [visibleVfxMeshCount, setVisibleVfxMeshCount] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(PREVIEW_WIDTH, PREVIEW_HEIGHT, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#030b19');
    const hemisphere = new THREE.HemisphereLight('#d9edff', '#17233d', 2.1);
    const key = new THREE.DirectionalLight('#fff0da', 3.4);
    key.position.set(-4, -8, 7);
    const fill = new THREE.DirectionalLight('#89bcff', 2.2);
    fill.position.set(5, -4, 3);
    scene.add(hemisphere, key, fill);
    const fallbackCamera = new THREE.PerspectiveCamera(36, PREVIEW_WIDTH / PREVIEW_HEIGHT, 0.01, 1000);
    fallbackCamera.position.set(0, -12, 1);
    const runtime: PreviewRuntime = { renderer, scene, camera: fallbackCamera, fallbackCamera, clips: [] };
    runtimeRef.current = runtime;
    let active = true;
    let prior = performance.now();
    const tick = (now: number): void => {
      if (!active) return;
      const elapsed = Math.min(0.1, Math.max(0, (now - prior) / 1000));
      prior = now;
      if (playingRef.current && totalFramesRef.current > 1) {
        frameRef.current = (frameRef.current + elapsed * fpsRef.current) % totalFramesRef.current;
        setFrame(Math.floor(frameRef.current));
      }
      runtime.mixer?.setTime((frameRef.current + frameStartRef.current) / fpsRef.current);
      runtime.scene.updateMatrixWorld(true);
      runtime.camera.updateMatrixWorld(true);
      runtime.renderer.render(runtime.scene, runtime.camera);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      active = false;
      clearLoaded(runtime);
      renderer.dispose();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => {
    frameRef.current = frame;
    const runtime = runtimeRef.current;
    runtime?.mixer?.setTime((frame + frameStartRef.current) / fpsRef.current);
  }, [frame]);

  useEffect(() => {
    const visibility = applyVfxIsolation(runtimeRef.current?.root, isolateVfx);
    setVisibleMeshCount(visibility.visibleMeshes);
    setVisibleVfxMeshCount(visibility.visibleVfxMeshes);
  }, [isolateVfx, summary]);

  const loadFile = async (file: File): Promise<void> => {
    const runtime = runtimeRef.current;
    if (!runtime || loading) return;
    setLoading(true);
    setPlaying(false);
    setError('');
    try {
      const buffer = await file.arrayBuffer();
      const validation = validateTapTileBlenderGlb(buffer);
      const gltf = await parseGlb(buffer);
      clearLoaded(runtime);
      runtime.root = gltf.scene;
      runtime.scene.add(gltf.scene);
      const visibility = applyVfxIsolation(gltf.scene, isolateVfx);
      setVisibleMeshCount(visibility.visibleMeshes);
      setVisibleVfxMeshCount(visibility.visibleVfxMeshes);
      runtime.clips = gltf.animations;
      if (gltf.animations.length > 0) {
        runtime.mixer = new THREE.AnimationMixer(gltf.scene);
        for (const clip of gltf.animations) runtime.mixer.clipAction(clip).play();
      }
      const fixedCamera = gltf.cameras[0];
      if (fixedCamera) {
        runtime.camera = fixedCamera;
        if (fixedCamera instanceof THREE.PerspectiveCamera) {
          fixedCamera.aspect = PREVIEW_WIDTH / PREVIEW_HEIGHT;
          fixedCamera.updateProjectionMatrix();
        }
      } else {
        runtime.camera = runtime.fallbackCamera;
        frameFallbackCamera(runtime.fallbackCamera, gltf.scene);
      }
      const animationEndSeconds = gltf.animations.reduce((maximum, clip) => Math.max(maximum, clip.duration), 0);
      const timeline = validation.inspection.timeline;
      const frameStart = timeline?.frameStart ?? 1;
      const fps = timeline?.fps ?? PREVIEW_FPS;
      // Blender exports absolute frame time (frame / fps). New bundles carry an
      // explicit contract; older GLBs fall back to the maximum animation key.
      const totalFrames = timeline?.frameCount
        ?? Math.max(1, Math.round(animationEndSeconds * fps) - frameStart + 1);
      const durationSeconds = totalFrames / fps;
      totalFramesRef.current = totalFrames;
      frameStartRef.current = frameStart;
      fpsRef.current = fps;
      frameRef.current = 0;
      setFrame(0);
      setSummary({
        ...validation,
        fileName: file.name,
        byteLength: file.size,
        totalFrames,
        durationSeconds,
        frameStart,
        fps,
        timingSource: timeline ? 'contract' : 'animation-fallback',
      });
      onNotice(`Blender GLB 已安全回读：${validation.inspection.nodeCount} 节点 · ${validation.inspection.triangleCount.toLocaleString()} 三角形 · ${validation.inspection.textureCount} 贴图`);
    } catch (reason) {
      clearLoaded(runtime);
      totalFramesRef.current = 0;
      setSummary(null);
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      onNotice(`Blender GLB 回读失败：${message}`);
    } finally {
      setLoading(false);
    }
  };

  const vfxObjectCount = summary
    ? Object.entries(summary.inspection.semanticRoleCounts)
      .filter(([role]) => role.startsWith('match-'))
      .reduce((total, [, count]) => total + count, 0)
    : 0;
  const vfxStyles = summary ? Object.entries(summary.inspection.vfxStyleCounts) : [];

  return (
    <section
      className="tpt-blender-preview-card"
      data-blender-preview-loaded={summary ? 'true' : 'false'}
      data-blender-preview-loading={loading ? 'true' : 'false'}
      data-blender-preview-frame={frame}
      data-blender-preview-frames={summary?.totalFrames ?? 0}
      data-blender-preview-frame-start={summary?.frameStart ?? 0}
      data-blender-preview-fps={summary?.fps ?? 0}
      data-blender-preview-timing-source={summary?.timingSource ?? 'none'}
      data-blender-preview-nodes={summary?.inspection.nodeCount ?? 0}
      data-blender-preview-triangles={summary?.inspection.triangleCount ?? 0}
      data-blender-preview-textures={summary?.inspection.textureCount ?? 0}
      data-blender-preview-animations={summary?.inspection.animationCount ?? 0}
      data-blender-preview-vfx-objects={vfxObjectCount}
      data-blender-preview-vfx-fragments={summary?.effectFragmentCount ?? 0}
      data-blender-preview-vfx-styles={vfxStyles.map(([style, count]) => `${style}:${count}`).join(',')}
      data-blender-preview-isolate-vfx={isolateVfx ? 'true' : 'false'}
      data-blender-preview-visible-meshes={visibleMeshCount}
      data-blender-preview-visible-vfx-meshes={visibleVfxMeshCount}
    >
      <div className="tpt-blender-preview-copy">
        <strong>Blender GLB 回读验收</strong>
        <small>先做完整 GLB/语义/预算检查，再执行 Three.js；固定相机与动画可逐帧审看，Area Light 使用中性审看灯替代。</small>
        {summary && <>
          <b>{summary.fileName}</b>
          <span>{(summary.byteLength / 1024 / 1024).toFixed(2)} MiB · {summary.inspection.nodeCount} 节点 · {summary.inspection.triangleCount.toLocaleString()} 三角形</span>
          <span>{summary.inspection.textureCount} 贴图 · {summary.inspection.animationCount} 动画 · {summary.durationSeconds.toFixed(2)} 秒 · {summary.fps}fps</span>
          <span>{summary.timingSource === 'contract' ? `精确时间轴：${summary.frameStart}–${summary.frameStart + summary.totalFrames - 1}` : '兼容时间轴：由动画末帧推断'}</span>
          <span>{vfxObjectCount} 个 VFX 对象 · {summary.effectFragmentCount} 片视觉碎片{vfxStyles.length > 0 ? ` · ${vfxStyles.map(([style, count]) => `${style} ${count}`).join(' / ')}` : ''}</span>
          <span>{isolateVfx ? `特效隔离：${visibleVfxMeshCount} 个特效网格` : `完整场景：${visibleMeshCount} 个可见网格`}</span>
        </>}
        {error && <small className="is-error" data-blender-preview-error>{error}</small>}
        <div>
          <button type="button" data-action="import-blender-glb" disabled={loading} onClick={() => inputRef.current?.click()}>{loading ? '正在验证与载入…' : '选择编译后的 GLB'}</button>
          <input ref={inputRef} className="tpt-hidden-input" data-blender-glb-input type="file" accept=".glb,model/gltf-binary" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadFile(file);
            event.currentTarget.value = '';
          }} />
          <button type="button" data-action="toggle-blender-preview" disabled={!summary || summary.totalFrames <= 1} onClick={() => setPlaying((current) => !current)}>{playing ? '暂停' : '播放'}</button>
          <button type="button" data-action="toggle-blender-vfx-isolation" disabled={!summary || vfxObjectCount === 0} aria-pressed={isolateVfx} onClick={() => setIsolateVfx((current) => !current)}>{isolateVfx ? '显示完整场景' : '只看特效'}</button>
        </div>
      </div>
      <div className="tpt-blender-preview-viewport">
        <canvas ref={canvasRef} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} data-blender-preview-canvas />
        {summary && <input data-blender-preview-seek type="range" min={0} max={summary.totalFrames - 1} value={frame} onChange={(event) => {
          setPlaying(false);
          setFrame(Number(event.target.value));
        }} />}
        {summary && <small>{frame + 1} / {summary.totalFrames} 帧</small>}
      </div>
    </section>
  );
}
