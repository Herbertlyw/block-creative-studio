import * as THREE from 'three';
import type { RenderBackendAdapter } from './backendRegistry';

/** Camera-local translation, in reference pixels at a 1920px frame height.
 * Positive X moves the camera right; positive Y moves it up. */
export interface CameraMicroAdjustment { microX?: number; microY?: number }

export function hasCameraMicroAdjustment(value?: CameraMicroAdjustment): boolean {
  return Boolean(value?.microX || value?.microY);
}

/** Call once after restoring the authored camera pose on each frame.
 * Never lookAt again: orientation, projection and axial distance stay intact. */
export function applyCameraMicroAdjustment(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  adjustment: CameraMicroAdjustment = {},
  referenceDistance = camera.position.length(),
): void {
  if (!hasCameraMicroAdjustment(adjustment)) return;
  const height = camera instanceof THREE.PerspectiveCamera
    ? 2 * referenceDistance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.zoom
    : (camera.top - camera.bottom) / camera.zoom;
  const delta = new THREE.Vector3(adjustment.microX ?? 0, adjustment.microY ?? 0, 0)
    .multiplyScalar(height / 1920).applyQuaternion(camera.quaternion);
  camera.position.add(delta);
  camera.updateMatrixWorld();
}

/** Bind public camera controls without changing packets, assets or game rules.
 * Scene backends consume the physical offset. Flat backends have no depth. */
export function withCameraMicroAdjustment(backend: RenderBackendAdapter, adjustment?: CameraMicroAdjustment): RenderBackendAdapter {
  if (!hasCameraMicroAdjustment(adjustment)) return backend;
  if (!backend.cameraMicroProjection) throw new Error(`CAMERA_MICRO_UNSUPPORTED: ${backend.id}`);
  return { ...backend, createStage(canvas, resources) {
    if (backend.cameraMicroProjection !== 'flat') {
      return backend.createStage(canvas, { ...resources, cameraMicroAdjustment: { ...adjustment } });
    }
    const buffer = document.createElement('canvas');
    buffer.width = canvas.width; buffer.height = canvas.height;
    const stage = backend.createStage(buffer, { ...resources, cameraMicroAdjustment: { ...adjustment } });
    const compose = () => {
      const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      if (!context) throw new Error('CAMERA_MICRO_CANVAS_UNAVAILABLE');
      context.save(); context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = '#111322'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(buffer, -(adjustment?.microX ?? 0) * canvas.height / 1920,
        (adjustment?.microY ?? 0) * canvas.height / 1920, canvas.width, canvas.height);
      context.restore();
    };
    return {
      resize(w, h, ratio) { stage.resize(w, h, ratio); canvas.width = buffer.width; canvas.height = buffer.height; },
      async warmup(packet) { await stage.warmup(packet); compose(); },
      renderAt(packet) { stage.renderAt(packet); compose(); },
      captureStill: () => canvas,
      dispose: () => stage.dispose(),
    };
  } };
}
