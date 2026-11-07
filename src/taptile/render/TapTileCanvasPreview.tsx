import { useEffect, useMemo, useRef, useState } from 'react';
import type { CompiledTapTileTake } from '../director';
import type { CompiledTapTileLevel, TapTileProjectV2 } from '../project';
import { hashCanvasPixels } from './frameHash';
import {
  hashTapTileRenderIdentity,
  renderTapTileFrameProof,
  type TapTileFrameRenderProof,
} from './renderProof';
import { createTapTileRenderJob } from './TapTileRenderJob';

export type TapTileCanvasPreviewStatus = 'rendering' | 'ready' | 'error';

export interface TapTileCanvasPreviewState {
  status: TapTileCanvasPreviewStatus;
  renderIdentityHash: string;
  requestedFrame: number;
  proof: TapTileFrameRenderProof | null;
  error: string;
}

export function TapTileCanvasPreview({
  project,
  level,
  compiledTake,
  frameNumber,
  onStateChange,
}: {
  project: TapTileProjectV2;
  level: CompiledTapTileLevel;
  compiledTake: CompiledTapTileTake;
  frameNumber: number;
  onStateChange?: (state: TapTileCanvasPreviewState) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderRequestRef = useRef(0);
  const job = useMemo(
    () => createTapTileRenderJob(project, level, compiledTake),
    [compiledTake, level, project],
  );
  const renderIdentityHash = hashTapTileRenderIdentity(job.identity);
  const [state, setState] = useState<TapTileCanvasPreviewState>(() => ({
    status: 'rendering',
    renderIdentityHash,
    requestedFrame: frameNumber,
    proof: null,
    error: '',
  }));

  useEffect(() => () => {
    renderRequestRef.current += 1;
    void job.dispose?.();
  }, [job]);

  useEffect(() => {
    const visibleCanvas = canvasRef.current;
    if (!visibleCanvas) return undefined;
    const requestId = renderRequestRef.current + 1;
    renderRequestRef.current = requestId;
    setState({
      status: 'rendering',
      renderIdentityHash,
      requestedFrame: frameNumber,
      proof: null,
      error: '',
    });
    let active = true;
    void (async () => {
      try {
        const renderedCanvas = document.createElement('canvas');
        const renderedProof = await renderTapTileFrameProof(job, frameNumber, renderedCanvas);
        if (!active || renderRequestRef.current !== requestId) return;
        visibleCanvas.width = job.width;
        visibleCanvas.height = job.height;
        const context = visibleCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
        if (!context) throw new Error('CANVAS_2D_CONTEXT_UNAVAILABLE');
        context.drawImage(renderedCanvas, 0, 0);
        const visiblePixelHash = hashCanvasPixels(visibleCanvas);
        if (visiblePixelHash !== renderedProof.pixelHash) {
          throw new Error(`PREVIEW_CANVAS_COPY_MISMATCH: ${renderedProof.pixelHash} != ${visiblePixelHash}`);
        }
        setState({
          status: 'ready',
          renderIdentityHash,
          requestedFrame: frameNumber,
          proof: renderedProof,
          error: '',
        });
      } catch (renderError) {
        if (!active || renderRequestRef.current !== requestId) return;
        setState({
          status: 'error',
          renderIdentityHash,
          requestedFrame: frameNumber,
          proof: null,
          error: renderError instanceof Error ? renderError.message : String(renderError),
        });
      }
    })();
    return () => { active = false; };
  }, [frameNumber, job, renderIdentityHash]);

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  const renderedFrame = state.proof?.frameNumber ?? -1;
  const pixelHash = state.proof?.pixelHash ?? (state.status === 'error' ? 'error' : 'pending');
  return (
    <>
      <canvas
        ref={canvasRef}
        className="tpt-canvas-preview"
        width={job.width}
        height={job.height}
        data-preview-status={state.status}
        data-preview-frame={frameNumber}
        data-preview-rendered-frame={renderedFrame}
        data-preview-render-identity={renderIdentityHash}
        data-preview-pixel-hash={pixelHash}
        data-preview-error={state.error}
        aria-label={`TapTile 正式固定帧预览 ${frameNumber}`}
      />
      {state.status !== 'ready' && (
        <div className={`tpt-canvas-preview-status is-${state.status}`} role="status">
          {state.status === 'error' ? `正式画面渲染失败：${state.error}` : `正在渲染正式第 ${frameNumber} 帧…`}
        </div>
      )}
    </>
  );
}
