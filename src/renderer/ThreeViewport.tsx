import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
import { materialDescriptorKey } from '../headless/materialRuntime';
import { StudioScene } from './StudioScene';
import { runtimeTextureResourceKey } from './runtimeTextures';
import {
  IDLE_MATERIAL_RUNTIME_STATUS,
  type MaterialRuntimeStatus,
} from './materialRuntimeStatus';

interface ClearSignal {
  id: number;
  clear: ClearResult;
  seed: number;
}

interface ThreeViewportProps {
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
  onMaterialRuntimeStatus?(status: MaterialRuntimeStatus): void;
}

interface DragSession {
  pointerId: number;
  pieceId: string;
  startedAt: number;
  path: PointerSample[];
  anchor: GridCell | null;
  valid: boolean;
}

function compositionPointer(
  stage: StudioScene,
  event: ReactPointerEvent<HTMLCanvasElement>,
): { x: number; y: number } | null {
  return stage.mapClientPointer(event.clientX, event.clientY);
}

export function ThreeViewport({
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
  onMaterialRuntimeStatus,
}: ThreeViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<StudioScene | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const statusCallbackRef = useRef(onMaterialRuntimeStatus);
  statusCallbackRef.current = onMaterialRuntimeStatus;
  const [runtimeStatus, setRuntimeStatus] = useState<MaterialRuntimeStatus>(IDLE_MATERIAL_RUNTIME_STATUS);
  const hadReadyRef = useRef(false);
  const lastReadyDescriptorRef = useRef<string | null>(null);

  const reportStatus = (status: MaterialRuntimeStatus): void => {
    if (status.state === 'ready') {
      hadReadyRef.current = true;
      lastReadyDescriptorRef.current = status.descriptorKey;
    }
    setRuntimeStatus(status);
    statusCallbackRef.current?.(status);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stage = new StudioScene(canvas, { quality: 'interactive' });
    stageRef.current = stage;
    stage.setRuntimeAssets(runtimeAssets);
    stage.setLiveSnapshot(snapshotRef.current, style);
    stage.start();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      stage.resize(entry.contentRect.width, entry.contentRect.height, Math.min(window.devicePixelRatio || 1, 2));
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      stage.dispose();
      stageRef.current = null;
      statusCallbackRef.current?.(IDLE_MATERIAL_RUNTIME_STATUS);
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
    let cancelled = false;
    const apply = (): void => {
      if (cancelled || stageRef.current !== stage) return;
      if ((mode === 'replay' || mode === 'render') && frame) stage.setFrame(frame, style);
      else stage.setLiveSnapshot(snapshot, style);
    };
    apply();
    stage.setRuntimeAssets(runtimeAssets);
    const maps = style.materialRuntime?.maps ?? [];
    const resourceKey = runtimeTextureResourceKey(maps, runtimeAssets);
    const descriptorKey = style.materialRuntime ? materialDescriptorKey(style.materialRuntime) : '';
    if (hadReadyRef.current && lastReadyDescriptorRef.current === descriptorKey) {
      void stage.prepareMaterialRuntime(style).then(() => {
        if (cancelled || stageRef.current !== stage) return;
        apply();
      }).catch((error: unknown) => {
        if (cancelled || stageRef.current !== stage) return;
        reportStatus({
          state: 'error',
          generation: Date.now(),
          resourceKey,
          descriptorKey,
          error: error instanceof Error ? error.message : String(error),
          showingPrevious: true,
        });
      });
      return () => {
        cancelled = true;
      };
    }
    const showingPrevious = hadReadyRef.current;
    reportStatus({
      state: showingPrevious ? 'stale' : 'loading',
      generation: Date.now(),
      resourceKey,
      descriptorKey,
      error: null,
      showingPrevious,
    });
    void stage.prepareMaterialRuntime(style)
      .then(() => {
        if (cancelled || stageRef.current !== stage) return;
        reportStatus({
          state: 'ready',
          generation: Date.now(),
          resourceKey,
          descriptorKey,
          error: null,
          showingPrevious: false,
        });
        apply();
      })
      .catch((error: unknown) => {
        if (cancelled || stageRef.current !== stage) return;
        reportStatus({
          state: 'error',
          generation: Date.now(),
          resourceKey,
          descriptorKey,
          error: error instanceof Error ? error.message : String(error),
          showingPrevious,
        });
        apply();
      });
    return () => {
      cancelled = true;
    };
  }, [frame, mode, snapshot, style, runtimeAssets]);

  useEffect(() => {
    if (!clearSignal) return;
    stageRef.current?.triggerClear({ clear: clearSignal.clear, progress: 0, seed: clearSignal.seed });
  }, [clearSignal]);

  const moveDrag = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const stage = stageRef.current;
    const session = dragRef.current;
    if (!stage || !session || event.pointerId !== session.pointerId) return;
    const anchor = stage.anchorForPiece(event.clientX, event.clientY, session.pieceId);
    const valid = anchor ? isPlacementValid(session.pieceId, anchor) : false;
    const pointer = compositionPointer(stage, event);
    if (!pointer) {
      session.anchor = null;
      session.valid = false;
      stage.setDragPreview(session.pieceId, null);
      return;
    }
    const frameOffset = Math.max(0, Math.round(((performance.now() - session.startedAt) / 1_000) * fps));
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
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const stage = stageRef.current;
    const session = dragRef.current;
    if (!stage || !session || event.pointerId !== session.pointerId) return;
    moveDrag(event);
    const complete = dragRef.current;
    if (complete?.anchor && complete.valid) {
      const durationFrames = Math.max(5, Math.round(((performance.now() - complete.startedAt) / 1_000) * fps));
      onPlace(complete.pieceId, complete.anchor, durationFrames, complete.path);
    }
    clearDrag(event);
  };

  return (
    <div className="viewport-shell">
      <canvas
        ref={canvasRef}
        className="studio-canvas"
        aria-label="三维方块玩法预览"
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
          const pointer = compositionPointer(stage, event);
          if (!pointer) return;
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
      <div className="viewport-badges" aria-hidden="true">
        <span>{style.renderer === 'fixed-camera-cinematic' ? 'FIXED CAMERA' : 'THREE.JS'} · {style.lookDev.id.toUpperCase()}</span>
        <span>{mode === 'render' ? 'OFFLINE RENDER' : mode.toUpperCase()}</span>
      </div>
      {mode === 'edit' && <div className="viewport-hint">点击格子绘制或擦除牌面</div>}
      {mode === 'play' && <div className="viewport-hint">拖动底部方块，系统只记录 Replay，不录屏</div>}
      {runtimeStatus.state === 'error' && (
        <div className="viewport-runtime-error" role="alert">
          <strong>新材质加载失败</strong>
          <span>{runtimeStatus.showingPrevious ? '当前仍显示上一套完整材质。正式导出已阻止。' : '当前材质未就绪，正式导出已阻止。'}</span>
          {runtimeStatus.error && <span>{runtimeStatus.error}</span>}
        </div>
      )}
      {(runtimeStatus.state === 'loading' || runtimeStatus.state === 'stale') && style.materialRuntime && (
        <div className="viewport-runtime-status">
          {runtimeStatus.showingPrevious ? '新材质加载中，当前仍显示上一套材质。正式导出已阻止。' : '材质贴图加载中…'}
        </div>
      )}
      {snapshot.status === 'game-over' && mode === 'play' && (
        <div className="game-over-card">
          <strong>本次试玩结束</strong>
          <span>保存 Take 后仍可替换材质、特效和节奏。</span>
        </div>
      )}
    </div>
  );
}
