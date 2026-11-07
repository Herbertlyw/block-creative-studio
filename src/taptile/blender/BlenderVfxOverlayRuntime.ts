import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { TapTileBlenderVfxAsset } from './blenderVfxAsset';

const VFX_ROLES = new Set(['match-core', 'match-fragment', 'match-shockwave']);

function inheritsVfxRole(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (VFX_ROLES.has(String(current.userData.bcs_role ?? ''))) return true;
    current = current.parent;
  }
  return false;
}

function parseGlb(buffer: ArrayBuffer): Promise<GLTF> {
  return new Promise<GLTF>((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
}

function disposeGltfResources(root: THREE.Object3D): void {
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

export interface TapTileBlenderVfxOverlayRuntime {
  readonly meshCount: number;
  renderInto(canvas: HTMLCanvasElement, sourceFrame: number): void;
  dispose(): void;
}

export async function createTapTileBlenderVfxOverlayRuntime(asset: TapTileBlenderVfxAsset): Promise<TapTileBlenderVfxOverlayRuntime> {
  const timeline = asset.validation.inspection.timeline;
  if (!timeline) throw new Error('BLENDER_VFX_TIMELINE_MISSING');
  const gltf = await parseGlb(asset.buffer);
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(new THREE.HemisphereLight('#d9edff', '#17233d', 2.1));
  const key = new THREE.DirectionalLight('#fff0da', 3.4);
  key.position.set(-4, -8, 7);
  const fill = new THREE.DirectionalLight('#89bcff', 2.2);
  fill.position.set(5, -4, 3);
  scene.add(key, fill, gltf.scene);
  let meshCount = 0;
  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const isVfx = inheritsVfxRole(object);
    object.visible = isVfx;
    if (isVfx) meshCount += 1;
  });
  if (meshCount <= 0) {
    disposeGltfResources(gltf.scene);
    renderer.dispose();
    throw new Error('BLENDER_VFX_OBJECTS_MISSING');
  }
  const camera = gltf.cameras[0];
  if (!camera) {
    disposeGltfResources(gltf.scene);
    renderer.dispose();
    throw new Error('BLENDER_GLB_FIXED_CAMERA_MISSING');
  }
  const mixer = new THREE.AnimationMixer(gltf.scene);
  for (const clip of gltf.animations) mixer.clipAction(clip).play();
  let disposed = false;
  let lastRenderedFrame = -1;
  let lastWidth = -1;
  let lastHeight = -1;
  return {
    meshCount,
    renderInto(target, sourceFrame) {
      if (disposed) throw new Error('BLENDER_VFX_RUNTIME_DISPOSED');
      const width = target.width;
      const height = target.height;
      const bounded = Math.max(0, Math.min(timeline.frameCount - 1, Math.round(sourceFrame)));
      if (bounded !== lastRenderedFrame || width !== lastWidth || height !== lastHeight) {
        if (width !== lastWidth || height !== lastHeight) {
          renderer.setSize(width, height, false);
          if (camera instanceof THREE.PerspectiveCamera) {
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
          }
        }
        mixer.setTime((timeline.frameStart + bounded) / timeline.fps);
        scene.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);
        renderer.render(scene, camera);
        lastRenderedFrame = bounded;
        lastWidth = width;
        lastHeight = height;
      }
      const context = target.getContext('2d');
      if (!context) throw new Error('BLENDER_VFX_CANVAS_2D_UNAVAILABLE');
      context.save();
      context.globalCompositeOperation = 'source-over';
      context.drawImage(canvas, 0, 0, width, height);
      context.restore();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(gltf.scene);
      disposeGltfResources(gltf.scene);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}
