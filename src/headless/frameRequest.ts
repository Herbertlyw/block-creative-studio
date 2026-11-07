import type {
  ContractIssue,
  DiagnosticViewId,
  FrameRenderRequest,
  FrameTimeBase,
  HeadlessRendererId,
  ReferencePassId,
} from './contracts.js';
import { BCS_CONTRACT_VERSION, REFERENCE_PASS_ORDER } from './contracts.js';
import { DESIGN_RESOLUTION, VIDEO_RESOLUTION } from './coordinateMapping.js';

const DIAGNOSTIC_VIEWS: DiagnosticViewId[] = [
  'beauty',
  'albedo',
  'world-normal',
  'roughness',
  'metalness',
  'emission',
  'bloom-contribution',
  'highlight-clip',
];

function issue(code: string, message: string, path: string): ContractIssue {
  return { code, severity: 'error', message, path, recoverable: true };
}

export function defaultEnabledPasses(): ReferencePassId[] {
  return [...REFERENCE_PASS_ORDER];
}

export function createFrameRenderRequest(input: {
  planId: string;
  planHash: string;
  takeId: string;
  takeHash: string;
  frameIndex: number;
  fps: number;
  renderer: HeadlessRendererId;
  coordinateSpace?: FrameRenderRequest['coordinateSpace'];
  diagnosticView?: DiagnosticViewId;
  enabledPasses?: ReferencePassId[];
  requireResources?: boolean;
}): FrameRenderRequest {
  const coordinateSpace = input.coordinateSpace ?? 'design';
  const targetPixels = coordinateSpace === 'video' ? VIDEO_RESOLUTION : DESIGN_RESOLUTION;
  return {
    contract: 'bcs.frame-render-request',
    contractVersion: BCS_CONTRACT_VERSION,
    planId: input.planId,
    planHash: input.planHash,
    takeId: input.takeId,
    takeHash: input.takeHash,
    frameIndex: input.frameIndex,
    fps: input.fps,
    renderer: input.renderer,
    targetPixels: { width: targetPixels.width, height: targetPixels.height },
    coordinateSpace,
    timeBase: 'presentation-frame',
    diagnosticView: input.diagnosticView ?? 'beauty',
    enabledPasses: input.enabledPasses ? [...input.enabledPasses] : defaultEnabledPasses(),
    requireResources: input.requireResources ?? true,
  };
}

export function validateFrameRenderRequest(request: FrameRenderRequest): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (request.contract !== 'bcs.frame-render-request') {
    issues.push(issue('FRAME_REQUEST_CONTRACT', 'Unknown frame render request contract.', '$.contract'));
  }
  if (request.timeBase === ('wall-clock-forbidden' as FrameTimeBase)) {
    issues.push(issue('FRAME_TIMEBASE_WALL_CLOCK', 'Wall-clock time cannot drive a frozen frame capture.', '$.timeBase'));
  }
  if (request.timeBase !== 'presentation-frame' && request.timeBase !== 'source-pts') {
    issues.push(issue('FRAME_TIMEBASE_INVALID', 'timeBase must be presentation-frame or source-pts.', '$.timeBase'));
  }
  if (!Number.isInteger(request.frameIndex) || request.frameIndex < 0) {
    issues.push(issue('FRAME_INDEX_INVALID', 'frameIndex must be a non-negative integer.', '$.frameIndex'));
  }
  if (!Number.isFinite(request.fps) || request.fps <= 0) {
    issues.push(issue('FRAME_FPS_INVALID', 'fps must be positive.', '$.fps'));
  }
  if (!DIAGNOSTIC_VIEWS.includes(request.diagnosticView)) {
    issues.push(issue('DIAGNOSTIC_VIEW_INVALID', 'Unknown diagnostic view.', '$.diagnosticView'));
  }
  const expected = request.coordinateSpace === 'video' ? VIDEO_RESOLUTION : DESIGN_RESOLUTION;
  if (
    request.targetPixels.width !== expected.width
    || request.targetPixels.height !== expected.height
  ) {
    issues.push(issue(
      'FRAME_PIXEL_SIZE_MISMATCH',
      `targetPixels must be ${expected.width}×${expected.height} for ${request.coordinateSpace} space.`,
      '$.targetPixels',
    ));
  }
  for (const pass of request.enabledPasses) {
    if (!REFERENCE_PASS_ORDER.includes(pass)) {
      issues.push(issue('FRAME_PASS_UNKNOWN', `Unknown pass ${pass}.`, '$.enabledPasses'));
    }
  }
  return issues;
}

export function presentationSeconds(frameIndex: number, fps: number): number {
  return frameIndex / Math.max(1, fps);
}
