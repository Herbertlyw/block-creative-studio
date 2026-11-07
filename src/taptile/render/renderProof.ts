import type { FrameRenderJob } from '../../exporter/fixedFrameExporter';
import { stableHash } from '../project';
import type { TapTileRenderIdentity } from './TapTileRenderJob';
import { hashCanvasPixels } from './frameHash';

export interface TapTileFrameRenderProof {
  renderIdentityHash: string;
  frameNumber: number;
  pixelHash: string;
  width: number;
  height: number;
}

export interface TapTileFrameProofComparison {
  valid: boolean;
  reasons: string[];
}

export function hashTapTileRenderIdentity(identity: TapTileRenderIdentity): string {
  return stableHash(identity, 'render-identity');
}

export async function renderTapTileFrameProof<Frame>(
  job: FrameRenderJob<Frame> & { readonly identity: TapTileRenderIdentity },
  frameNumber: number,
  canvas: HTMLCanvasElement = document.createElement('canvas'),
): Promise<TapTileFrameRenderProof> {
  if (!Number.isInteger(frameNumber) || frameNumber < 0 || frameNumber >= job.totalFrames) {
    throw new Error(`RENDER_PROOF_FRAME_INVALID: ${frameNumber}`);
  }
  canvas.width = job.width;
  canvas.height = job.height;
  await job.prepare?.(canvas);
  await job.render(job.evaluate(frameNumber), canvas);
  return Object.freeze({
    renderIdentityHash: hashTapTileRenderIdentity(job.identity),
    frameNumber,
    pixelHash: hashCanvasPixels(canvas),
    width: canvas.width,
    height: canvas.height,
  });
}

export function compareTapTileFrameProofs(
  preview: TapTileFrameRenderProof,
  candidate: TapTileFrameRenderProof,
): TapTileFrameProofComparison {
  const reasons: string[] = [];
  if (preview.renderIdentityHash !== candidate.renderIdentityHash) reasons.push('RENDER_IDENTITY_MISMATCH');
  if (preview.frameNumber !== candidate.frameNumber) reasons.push('RENDER_FRAME_MISMATCH');
  if (preview.width !== candidate.width || preview.height !== candidate.height) reasons.push('RENDER_DIMENSIONS_MISMATCH');
  if (preview.pixelHash !== candidate.pixelHash) reasons.push('RENDER_PIXELS_MISMATCH');
  return { valid: reasons.length === 0, reasons };
}

export function assertTapTileFrameProofsMatch(
  preview: TapTileFrameRenderProof,
  candidate: TapTileFrameRenderProof,
): void {
  const comparison = compareTapTileFrameProofs(preview, candidate);
  if (!comparison.valid) {
    throw new Error(`PREVIEW_EXPORT_PARITY_FAILED: ${comparison.reasons.join(', ')}`);
  }
}
