import extension from '@bb/calibrated';
import type { CompiledFrameSource } from '../nativeReference/game-runtime/frameSource';
import {
  assertRenderResourcePolicy,
  type RenderResourcePolicy,
} from '../nativeReference/rendering/resourcePolicy';
import type { RenderBackendAdapter } from '../nativeReference/rendering/backendRegistry';
import type { VerifiedPointerOverlay } from './observedPointer';
import type { BBTimelinePlan } from '../games/block-placement/planning/bbTimelinePlan';
import { validateCalibratedRequest } from './validateObservedRequest';

interface CalibratedStage {
  resize(width: number, height: number, scale?: number): void;
  warmup(): Promise<void>;
  renderAt(packet: unknown): void;
  dispose(): void;
}
interface CalibratedPrepared {
  frameSource: CompiledFrameSource;
  timelinePlan: BBTimelinePlan;
  backend: { createStage(canvas: HTMLCanvasElement): CalibratedStage };
}

/** Workbench state-carrying renderer derived from the supplied extension; frozen source remains unchanged. */
export function prepareCalibratedRenderer(
  document: unknown,
  takeId: string,
  pointer?: VerifiedPointerOverlay | null,
): CalibratedPrepared {
  const options = validateCalibratedRequest(document, takeId, pointer);
  if (
    extension.id !== 'bcs.workbench.block-placement.calibrated-state' ||
    extension.version !== '1.0.0'
  )
    throw new Error('校准渲染器版本不匹配。');
  const driver = extension.renderDrivers.find(
    (item) => item.id === extension.id && item.gameId === 'block-placement',
  );
  if (!driver) throw new Error('校准渲染器没有匹配 BB 的驱动。');
  const prepared = driver.prepare(document, options) as CalibratedPrepared & {
    resourcePolicy: RenderResourcePolicy;
    backend: RenderBackendAdapter;
  };
  if (
    prepared.resourcePolicy?.mode !== 'bundled-assets' ||
    prepared.resourcePolicy.bundleId !== prepared.frameSource.frameSourceHash
  )
    throw new Error('校准资源策略与帧源身份不一致，不能预览或导出。');
  assertRenderResourcePolicy(prepared.resourcePolicy, { backend: prepared.backend });
  return prepared;
}
