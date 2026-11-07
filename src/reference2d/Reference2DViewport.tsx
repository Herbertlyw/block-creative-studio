import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type {
  ClearResult,
  GameSnapshot,
  GridCell,
  PointerSample,
  PresentationFrame,
  StudioMode,
  StyleSpec,
} from '../domain/types';
import type { RuntimeAssetBindings } from '../assets/runtimeAssetBindings';
import { ReferenceCalibrationOverlay } from './ReferenceCalibrationOverlay';
import { Reference2DScene } from './Reference2DScene';

interface ClearSignal {
  id: number;
  clear: ClearResult;
  seed: number;
}

interface Reference2DViewportProps {
  mode: StudioMode;
  snapshot: GameSnapshot;
  frame: PresentationFrame | null;
  style: StyleSpec;
  runtimeAssets: RuntimeAssetBindings;
  fps: number;
  clearSignal: ClearSignal | null;
  onEditCell(cell: GridCell): void;
  onPlace(pieceId: string, anchor: GridCell, durationFrames: number, path: PointerSample[]): boolean;
  isPlacementValid(pieceId: string, anchor: GridCell): boolean;
}

interface DragSession {
  pointerId: number;
  pieceId: string;
  startedAt: number;
  path: PointerSample[];
  anchor: GridCell | null;
  valid: boolean;
}

function normalizedPointer(event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
  };
}

export function Reference2DViewport({
  mode,
  snapshot,
  frame,
  style,
  runtimeAssets,
  fps,
  clearSignal,
  onEditCell,
  onPlace,
  isPlacementValid,
}: Reference2DViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<Reference2DScene | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stage = new Reference2DScene(canvas, { quality: 'interactive' });
    stageRef.current = stage;
    stage.setRuntimeAssets(runtimeAssets);
    stage.setLiveSnapshot(snapshotRef.current, style);
    stage.start();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      stage.resize(
        entry.contentRect.width,
        entry.contentRect.height,
        Math.min(window.devicePixelRatio || 1, 2),
      );
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      stage.dispose();
      stageRef.current = null;
    };
    // Scene lifetime is deliberately independent from React renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stageRef.current?.setRuntimeAssets(runtimeAssets);
  }, [runtimeAssets]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if ((mode === 'replay' || mode === 'render') && frame) stage.setFrame(frame, style);
    else stage.setLiveSnapshot(snapshot, style);
  }, [frame, mode, snapshot, style]);

  useEffect(() => {
    if (!clearSignal) return;
    stageRef.current?.triggerClear({
      clear: clearSignal.clear,
      progress: 0,
      seed: clearSignal.seed,
    });
  }, [clearSignal]);

  const captureCurrentFrame = (): HTMLCanvasElement | null =>
    stageRef.current?.captureReferenceFrame() ?? null;

  const moveDrag = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const stage = stageRef.current;
    const session = dragRef.current;
    if (!stage || !session || event.pointerId !== session.pointerId) return;
    const anchor = stage.anchorForPiece(event.clientX, event.clientY, session.pieceId);
    const valid = anchor ? isPlacementValid(session.pieceId, anchor) : false;
    const pointer = normalizedPointer(event);
    const frameOffset = Math.max(
      0,
      Math.round(((performance.now() - session.startedAt) / 1_000) * fps),
    );
    const previous = session.path[session.path.length - 1];
    if (!previous || previous.frameOffset < frameOffset) session.path.push({ frameOffset, ...pointer });
    else if (previous.frameOffset === frameOffset) Object.assign(previous, pointer);
    session.anchor = anchor;
    session.valid = valid;
    stage.setDragPreview(session.pieceId, anchor, pointer);
  };

  const clearDrag = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const session = dragRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    stageRef.current?.setDragPreview(null, null);
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const finishDrag = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const stage = stageRef.current;
    const session = dragRef.current;
    if (!stage || !session || event.pointerId !== session.pointerId) return;
    moveDrag(event);
    const complete = dragRef.current;
    if (complete?.anchor && complete.valid) {
      const durationFrames = Math.max(
        5,
        Math.round(((performance.now() - complete.startedAt) / 1_000) * fps),
      );
      onPlace(complete.pieceId, complete.anchor, durationFrames, complete.path);
    }
    clearDrag(event);
  };

  return (
    <div className="viewport-shell reference-2d-shell">
      <canvas
        ref={canvasRef}
        className="studio-canvas"
        aria-label="真机参考二维方块玩法预览"
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          const stage = stageRef.current;
          if (!stage) return;
          const hit = stage.pick(event.clientX, event.clientY);
          if (mode === 'edit' && hit?.kind === 'cell') {
            onEditCell({ row: hit.row, col: hit.col });
            return;
          }
          if (mode !== 'play' || snapshot.status === 'game-over' || hit?.kind !== 'piece') return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const pointer = normalizedPointer(event);
          stage.setDragPreview(hit.pieceId, null, pointer);
          dragRef.current = {
            pointerId: event.pointerId,
            pieceId: hit.pieceId,
            startedAt: performance.now(),
            path: [{ frameOffset: 0, ...pointer }],
            anchor: null,
            valid: false,
          };
        }}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={clearDrag}
      />
      <ReferenceCalibrationOverlay
        frameLabel={`frame-${frame?.frame ?? snapshot.turn}`}
        captureCurrentFrame={captureCurrentFrame}
      />
      <div className="viewport-badges" aria-hidden="true">
        <span>REFERENCE 2D · 1064×1788</span>
        <span>{mode === 'render' ? 'OFFLINE RENDER' : mode.toUpperCase()}</span>
      </div>
      {mode === 'edit' && <div className="viewport-hint">按真机布局点击格子绘制或擦除牌面</div>}
      {mode === 'play' && <div className="viewport-hint">方块拾取后放大并上移；有效落点显示预消除填充</div>}
    </div>
  );
}
