import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createGreedyAgentTake } from '../director/botDirector';
import { compileTake, evaluateCompiledTake } from '../director/presentationCompiler';
import { RHYTHM_PRESETS } from '../director/rhythmPresets';
import { BOARD_PRESETS, createCrossClearBoard } from '../domain/boardPresets';
import { getShape } from '../domain/shapes';
import {
  applyPlacement,
  canPlace,
  cloneSnapshot,
  createGame,
  createPieceSet,
  pieceCellColor,
  recolorBoardCell,
  replayActions,
  replacePieceShape,
} from '../domain/gameEngine';
import { parseStudioBundle, type StudioBundle } from '../domain/projectValidation';
import { createRuntimeId } from '../domain/runtimeId';
import type {
  GameSnapshot,
  GridCell,
  PieceInstance,
  PlacementAction,
  PointerSample,
  PresentationFrame,
  ProjectSpec,
  RhythmProfile,
  StudioMode,
  StyleSpec,
  Take,
  TileColor,
} from '../domain/types';
import { exportTakeVideo, type RenderProgress } from '../exporter/offlineVideoExporter';
import { useVariantWorkspace } from './useVariantWorkspace';
import { DEFAULT_STYLE } from '../renderer/stylePresets';
import { materialDescriptorKey } from '../headless/materialRuntime';
import { runtimeTextureResourceKey } from '../renderer/runtimeTextures';
import {
  IDLE_MATERIAL_RUNTIME_STATUS,
  materialRuntimeReadyFor,
  type MaterialRuntimeStatus,
} from '../renderer/materialRuntimeStatus';
import { downloadBlob, safeFileName } from '../utils/download';

interface ClearSignal {
  id: number;
  clear: NonNullable<ReturnType<typeof applyPlacement>>['clear'];
  seed: number;
}

interface ExportState {
  running: boolean;
  progress: RenderProgress | null;
  error: string | null;
}

const AUTOSAVE_KEY = 'block-creative-studio/autosave/v1';

function makeInitialProject(): ProjectSpec {
  const seed = 41782;
  const pieces = createPieceSet(seed, 0, ['single', 'tri-h', 'square-2']);
  pieces[0]!.cellColors = ['cyan'];
  pieces[1]!.cellColors = ['violet', 'amber', 'blue'];
  pieces[2]!.cellColors = ['lime', 'amber', 'coral', 'cyan'];
  return {
    schemaVersion: '1.0.0',
    id: 'block-creative-demo',
    name: 'Block Creative · 横纵双消',
    ruleProfile: 'block-placement-classic-v1',
    seed,
    setupBoard: createCrossClearBoard(),
    setupPieces: pieces,
    style: structuredClone(DEFAULT_STYLE),
    rhythm: { ...RHYTHM_PRESETS['human-natural'] },
    render: { width: 1080, height: 1920, fps: 30, quality: 'standard' },
  };
}

function initialStateFor(project: ProjectSpec): GameSnapshot {
  return createGame(project.setupBoard, project.seed, project.setupPieces);
}

function makeInitialBundle(): StudioBundle {
  const project = makeInitialProject();
  const initial = initialStateFor(project);
  return {
    format: 'block-creative-studio-project',
    version: '1.0.0',
    project,
    takes: [createGreedyAgentTake(initial, 8)],
  };
}

function loadInitialBundle(): StudioBundle {
  if (typeof window === 'undefined') return makeInitialBundle();
  try {
    const stored = window.localStorage.getItem(AUTOSAVE_KEY);
    if (!stored) return makeInitialBundle();
    return parseStudioBundle(JSON.parse(stored));
  } catch {
    window.localStorage.removeItem(AUTOSAVE_KEY);
    return makeInitialBundle();
  }
}

function cloneTake(take: Take): Take {
  return {
    ...take,
    initial: cloneSnapshot(take.initial),
    actions: take.actions.map((action) => ({
      ...action,
      anchor: { ...action.anchor },
      pointerPath: action.pointerPath.map((sample) => ({ ...sample })),
    })),
  };
}

export function useStudioModel() {
  const initialBundleRef = useRef<StudioBundle | null>(null);
  if (!initialBundleRef.current) initialBundleRef.current = loadInitialBundle();
  const [project, setProject] = useState<ProjectSpec>(() => structuredClone(initialBundleRef.current!.project));
  const [mode, setMode] = useState<StudioMode>('edit');
  const [liveSnapshot, setLiveSnapshotState] = useState<GameSnapshot>(() => initialStateFor(initialBundleRef.current!.project));
  const liveSnapshotRef = useRef(liveSnapshot);
  const [takes, setTakes] = useState<Take[]>(() => initialBundleRef.current!.takes.map(cloneTake));
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(() => takes[0]?.id ?? null);
  const [playbackFrame, setPlaybackFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedColor, setSelectedColor] = useState<TileColor>('blue');
  const [selectedPieceSlot, setSelectedPieceSlot] = useState(0);
  const [clearSignal, setClearSignal] = useState<ClearSignal | null>(null);
  const [exportState, setExportState] = useState<ExportState>({ running: false, progress: null, error: null });
  const [materialRuntimeStatus, setMaterialRuntimeStatus] = useState<MaterialRuntimeStatus>(IDLE_MATERIAL_RUNTIME_STATUS);
  const exportAbortRef = useRef<AbortController | null>(null);
  const recordingInitialRef = useRef<GameSnapshot | null>(null);
  const recordingActionsRef = useRef<PlacementAction[]>([]);

  const clearRecording = useCallback((): void => {
    recordingInitialRef.current = null;
    recordingActionsRef.current = [];
  }, []);

  const setLiveSnapshot = useCallback((snapshot: GameSnapshot): void => {
    liveSnapshotRef.current = snapshot;
    setLiveSnapshotState(snapshot);
  }, []);

  const invalidateTakesForSetupChange = useCallback((): void => {
    setTakes([]);
    setSelectedTakeId(null);
    setPlaybackFrame(0);
    setIsPlaying(false);
    setClearSignal(null);
  }, []);

  useEffect(() => {
    try {
      const bundle: StudioBundle = {
        format: 'block-creative-studio-project',
        version: '1.0.0',
        project,
        takes: takes.map(cloneTake),
      };
      window.localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(bundle));
    } catch {
      // Local autosave is best-effort; explicit project export remains available.
    }
  }, [project, takes]);

  const selectedTake = useMemo(
    () => takes.find((take) => take.id === selectedTakeId) ?? null,
    [selectedTakeId, takes],
  );

  const compiledTake = useMemo(
    () => (selectedTake ? compileTake(selectedTake, project.rhythm, project.render.fps) : null),
    [project.render.fps, project.rhythm, selectedTake],
  );

  const presentationFrame: PresentationFrame | null = useMemo(
    () =>
      compiledTake
        ? evaluateCompiledTake(compiledTake, playbackFrame, project.rhythm)
        : null,
    [compiledTake, playbackFrame, project.rhythm],
  );

  const variantWorkspace = useVariantWorkspace({
    project,
    selectedTake,
    compiledTake,
    mode,
    setProject,
  });
  const resolvedStyle = variantWorkspace.resolvedStyle;
  const activeVariantRow = variantWorkspace.activeRow;
  const runtimeAssets = variantWorkspace.runtimeAssets;
  const resetVariantToCurrentLook = variantWorkspace.resetToCurrentLook;

  useEffect(() => {
    if (!isPlaying || !compiledTake || (mode !== 'replay' && mode !== 'render')) return;
    const interval = window.setInterval(() => {
      setPlaybackFrame((current) => {
        if (current >= compiledTake.totalFrames - 1) {
          setIsPlaying(false);
          return compiledTake.totalFrames - 1;
        }
        return current + 1;
      });
    }, 1_000 / compiledTake.fps);
    return () => window.clearInterval(interval);
  }, [compiledTake, isPlaying, mode]);

  useEffect(() => {
    if (compiledTake) setPlaybackFrame((current) => Math.min(current, compiledTake.totalFrames - 1));
  }, [compiledTake]);

  const resetLive = useCallback(
    (nextProject = project): void => {
      setLiveSnapshot(initialStateFor(nextProject));
    },
    [project, setLiveSnapshot],
  );

  const enterEdit = useCallback((): void => {
    if (exportState.running) return;
    setIsPlaying(false);
    clearRecording();
    setClearSignal(null);
    setMode('edit');
    resetLive();
  }, [clearRecording, exportState.running, resetLive]);

  const beginHumanPlay = useCallback((): void => {
    if (exportState.running || mode === 'play') return;
    const initial = initialStateFor(project);
    recordingInitialRef.current = cloneSnapshot(initial);
    recordingActionsRef.current = [];
    setLiveSnapshot(initial);
    setIsPlaying(false);
    setClearSignal(null);
    setMode('play');
  }, [exportState.running, mode, project, setLiveSnapshot]);

  const cancelHumanPlay = useCallback((): void => {
    if (mode !== 'play') return;
    clearRecording();
    setClearSignal(null);
    setMode('edit');
    resetLive();
  }, [clearRecording, mode, resetLive]);

  const finishHumanTake = useCallback((): void => {
    if (mode !== 'play') return;
    const initial = recordingInitialRef.current;
    const actions = recordingActionsRef.current;
    if (!initial || actions.length === 0) {
      cancelHumanPlay();
      return;
    }
    const take: Take = {
      id: createRuntimeId('human-take'),
      name: `真人试玩 · ${actions.length} 步`,
      createdAt: new Date().toISOString(),
      initial: cloneSnapshot(initial),
      actions: actions.map((action) => ({
        ...action,
        anchor: { ...action.anchor },
        pointerPath: action.pointerPath.map((sample) => ({ ...sample })),
      })),
    };
    setTakes((current) => [...current, take]);
    setSelectedTakeId(take.id);
    clearRecording();
    setClearSignal(null);
    setPlaybackFrame(0);
    setMode('replay');
  }, [cancelHumanPlay, clearRecording, mode]);

  const commitHumanPlacement = useCallback(
    (pieceId: string, anchor: GridCell, durationFrames: number, pointerPath: PointerSample[]): boolean => {
      if (mode !== 'play' || !recordingInitialRef.current) return false;
      const action: PlacementAction = {
        id: createRuntimeId(`human-action-${recordingActionsRef.current.length + 1}`),
        actor: 'human',
        pieceId,
        anchor: { ...anchor },
        durationFrames: Math.max(5, durationFrames),
        pointerPath: pointerPath.map((sample) => ({ ...sample })),
      };
      const transition = applyPlacement(liveSnapshotRef.current, action);
      if (!transition) return false;
      recordingActionsRef.current.push(action);
      setLiveSnapshot(transition.after);
      if (transition.clear.cells.length > 0) {
        setClearSignal({
          id: Date.now(),
          clear: transition.clear,
          seed: transition.after.seed + transition.after.turn * 977,
        });
      }
      return true;
    },
    [mode, setLiveSnapshot],
  );

  const undoHumanPlacement = useCallback((): void => {
    if (mode !== 'play') return;
    const initial = recordingInitialRef.current;
    if (!initial || recordingActionsRef.current.length === 0) return;
    recordingActionsRef.current = recordingActionsRef.current.slice(0, -1);
    const transitions = replayActions(initial, recordingActionsRef.current);
    const previous = transitions.at(-1)?.after ?? cloneSnapshot(initial);
    setClearSignal(null);
    setLiveSnapshot(cloneSnapshot(previous));
  }, [mode, setLiveSnapshot]);

  const isPlacementValid = useCallback((piece: PieceInstance, anchor: GridCell): boolean => {
    return canPlace(liveSnapshotRef.current.board, piece, anchor);
  }, []);

  const applyBoardPreset = useCallback(
    (presetId: (typeof BOARD_PRESETS)[number]['id']): void => {
      if (mode !== 'edit') return;
      const preset = BOARD_PRESETS.find((candidate) => candidate.id === presetId);
      if (!preset) return;
      const board = preset.create();
      const nextProject = { ...project, setupBoard: board };
      setProject(nextProject);
      invalidateTakesForSetupChange();
      setMode('edit');
      setLiveSnapshot(initialStateFor(nextProject));
    },
    [invalidateTakesForSetupChange, mode, project, setLiveSnapshot],
  );

  const editBoardCell = useCallback(
    (cell: GridCell): void => {
      if (mode !== 'edit') return;
      const current = project.setupBoard.cells[cell.row]?.[cell.col];
      const board = recolorBoardCell(project.setupBoard, cell, current === selectedColor ? null : selectedColor);
      const nextProject = { ...project, setupBoard: board };
      setProject(nextProject);
      invalidateTakesForSetupChange();
      setLiveSnapshot(initialStateFor(nextProject));
    },
    [invalidateTakesForSetupChange, mode, project, selectedColor, setLiveSnapshot],
  );

  const updatePieceShape = useCallback(
    (shapeId: string): void => {
      if (mode !== 'edit') return;
      const pieces = replacePieceShape(project.setupPieces, selectedPieceSlot, shapeId, selectedColor);
      const nextProject = { ...project, setupPieces: pieces };
      setProject(nextProject);
      invalidateTakesForSetupChange();
      setLiveSnapshot(initialStateFor(nextProject));
    },
    [invalidateTakesForSetupChange, mode, project, selectedColor, selectedPieceSlot, setLiveSnapshot],
  );

  const updatePieceColor = useCallback(
    (slotIndex: number, color: TileColor): void => {
      if (mode !== 'edit') return;
      const pieces = project.setupPieces.map((piece) =>
        piece.slotIndex === slotIndex
          ? { ...piece, color, cellColors: getShape(piece.shapeId).cells.map(() => color), used: false }
          : { ...piece, ...(piece.cellColors ? { cellColors: [...piece.cellColors] } : {}) },
      );
      const nextProject = { ...project, setupPieces: pieces };
      setProject(nextProject);
      invalidateTakesForSetupChange();
      setLiveSnapshot(initialStateFor(nextProject));
    },
    [invalidateTakesForSetupChange, mode, project, setLiveSnapshot],
  );

  const updatePieceCellColor = useCallback(
    (slotIndex: number, cellIndex: number, color: TileColor): void => {
      if (mode !== 'edit') return;
      const pieces = project.setupPieces.map((piece) => {
        if (piece.slotIndex !== slotIndex) {
          return { ...piece, ...(piece.cellColors ? { cellColors: [...piece.cellColors] } : {}) };
        }
        const shape = getShape(piece.shapeId);
        if (cellIndex < 0 || cellIndex >= shape.cells.length) return { ...piece };
        const cellColors = shape.cells.map((_, index) => pieceCellColor(piece, index));
        cellColors[cellIndex] = color;
        return { ...piece, color: cellColors[0] ?? piece.color, cellColors, used: false };
      });
      const nextProject = { ...project, setupPieces: pieces };
      setProject(nextProject);
      invalidateTakesForSetupChange();
      setLiveSnapshot(initialStateFor(nextProject));
    },
    [invalidateTakesForSetupChange, mode, project, setLiveSnapshot],
  );

  const runAgent = useCallback((): void => {
    if (mode === 'play' || mode === 'render') return;
    const initial = initialStateFor(project);
    const take = createGreedyAgentTake(initial, 12);
    setTakes((current) => [...current, take]);
    setSelectedTakeId(take.id);
    setPlaybackFrame(0);
    setIsPlaying(true);
    setClearSignal(null);
    setMode('replay');
  }, [mode, project]);

  const selectTake = useCallback((takeId: string): void => {
    if (mode === 'play' || mode === 'render') return;
    setSelectedTakeId(takeId);
    setPlaybackFrame(0);
    setIsPlaying(false);
    setMode('replay');
  }, [mode]);

  const deleteTake = useCallback(
    (takeId: string): void => {
      if (mode === 'play' || mode === 'render') return;
      setTakes((current) => {
        const next = current.filter((take) => take.id !== takeId);
        if (selectedTakeId === takeId) {
          setSelectedTakeId(next[0]?.id ?? null);
          setPlaybackFrame(0);
          setMode(next.length > 0 ? 'replay' : 'edit');
        }
        return next;
      });
    },
    [mode, selectedTakeId],
  );

  const setStyle = useCallback((patch: Partial<StyleSpec>): void => {
    if (mode === 'play' || mode === 'render') return;
    setProject((current) => ({ ...current, style: { ...current.style, ...patch } }));
    resetVariantToCurrentLook();
  }, [mode, resetVariantToCurrentLook]);

  const setGeometry = useCallback((patch: Partial<StyleSpec['geometry']>): void => {
    if (mode === 'play' || mode === 'render') return;
    setProject((current) => ({
      ...current,
      style: { ...current.style, geometry: { ...current.style.geometry, ...patch } },
    }));
    resetVariantToCurrentLook();
  }, [mode, resetVariantToCurrentLook]);

  const setRhythmPreset = useCallback((presetId: keyof typeof RHYTHM_PRESETS): void => {
    if (mode === 'play' || mode === 'render') return;
    setProject((current) => ({ ...current, rhythm: { ...RHYTHM_PRESETS[presetId] } }));
    setPlaybackFrame(0);
  }, [mode]);

  const setRhythm = useCallback((patch: Partial<RhythmProfile>): void => {
    if (mode === 'play' || mode === 'render') return;
    setProject((current) => ({ ...current, rhythm: { ...current.rhythm, ...patch } }));
    setPlaybackFrame(0);
  }, [mode]);

  const updateProjectName = useCallback((name: string): void => {
    if (mode === 'play' || mode === 'render') return;
    setProject((current) => ({ ...current, name }));
  }, [mode]);

  const updateProjectSeed = useCallback(
    (seed: number): void => {
      if (mode !== 'edit') return;
      const normalized = Math.max(0, Math.min(2_147_483_647, Math.trunc(seed || 0)));
      const nextProject = { ...project, seed: normalized };
      setProject(nextProject);
      invalidateTakesForSetupChange();
      setMode('edit');
      setLiveSnapshot(initialStateFor(nextProject));
    },
    [invalidateTakesForSetupChange, mode, project, setLiveSnapshot],
  );

  const updateRenderQuality = useCallback((quality: ProjectSpec['render']['quality']): void => {
    if (mode === 'play' || mode === 'render') return;
    setProject((current) => ({ ...current, render: { ...current.render, quality } }));
  }, [mode]);

  const enterReplay = useCallback((): void => {
    if (mode === 'play' || mode === 'render') return;
    if (!selectedTakeId && takes[0]) setSelectedTakeId(takes[0].id);
    setIsPlaying(false);
    setMode('replay');
  }, [mode, selectedTakeId, takes]);

  const togglePlayback = useCallback((): void => {
    if (!compiledTake || mode === 'play' || mode === 'render') return;
    if (playbackFrame >= compiledTake.totalFrames - 1) setPlaybackFrame(0);
    setIsPlaying((current) => !current);
    setMode('replay');
  }, [compiledTake, mode, playbackFrame]);

  const exportVideo = useCallback(async (): Promise<void> => {
    if (!selectedTake || exportState.running || mode === 'play' || mode === 'render') return;
    if (!activeVariantRow?.plan || !activeVariantRow.quality?.passed) {
      setExportState({
        running: false,
        progress: null,
        error: '当前 Variant 尚未通过编译和质量门禁，不能进入正式导出。',
      });
      return;
    }
    if (!activeVariantRow.previewSupported && !activeVariantRow.resolvedStyle.materialRuntime) {
      setExportState({
        running: false,
        progress: null,
        error: '当前 Look Pack 没有网页渲染绑定。请先实现该资产的 Renderer Adapter，或选择可预览的 Look。',
      });
      return;
    }
    if (!variantWorkspace.runtimeReady) {
      setExportState({
        running: false,
        progress: null,
        error: '当前 Render Plan 的本机二进制资产尚未全部解析，不能进入正式导出。',
      });
      return;
    }
    if (
      resolvedStyle.renderer !== 'reference-2d'
      && !materialRuntimeReadyFor(materialRuntimeStatus, {
        descriptorKey: resolvedStyle.materialRuntime ? materialDescriptorKey(resolvedStyle.materialRuntime) : '',
        resourceKey: runtimeTextureResourceKey(resolvedStyle.materialRuntime?.maps ?? [], runtimeAssets),
      })
    ) {
      const reason = materialRuntimeStatus.state === 'error'
        ? `新材质加载失败，当前仍显示上一套材质：${materialRuntimeStatus.error ?? '加载失败'}`
        : materialRuntimeStatus.state === 'stale'
          ? '新材质尚未提交，当前仍显示上一套材质，不能进入正式导出。'
          : materialRuntimeStatus.state === 'ready'
            ? '三维材质状态与当前 Plan descriptor 不一致，不能进入正式导出。'
            : '三维材质尚未就绪，不能进入正式导出。';
      setExportState({
        running: false,
        progress: null,
        error: reason,
      });
      return;
    }
    const exportProjectSnapshot = structuredClone(project);
    const exportStyleSnapshot = structuredClone(resolvedStyle);
    const exportTakeSnapshot = cloneTake(selectedTake);
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setMode('render');
    setIsPlaying(false);
    setExportState({ running: true, progress: null, error: null });
    try {
      const result = await exportTakeVideo({
        take: exportTakeSnapshot,
        rhythm: exportProjectSnapshot.rhythm,
        style: exportStyleSnapshot,
        render: exportProjectSnapshot.render,
        projectName: exportProjectSnapshot.name,
        runtimeAssets,
        signal: controller.signal,
        onProgress: (progress) => setExportState({ running: true, progress, error: null }),
      });
      downloadBlob(result.blob, result.fileName);
      setExportState((current) => ({ ...current, running: false }));
    } catch (error) {
      const canceled = error instanceof DOMException && error.name === 'AbortError';
      setExportState({
        running: false,
        progress: null,
        error: canceled ? null : error instanceof Error ? error.message : '视频导出失败。',
      });
    } finally {
      exportAbortRef.current = null;
      setMode('replay');
    }
  }, [activeVariantRow, exportState.running, materialRuntimeStatus, mode, project, resolvedStyle, runtimeAssets, selectedTake, variantWorkspace.runtimeReady]);

  const cancelExport = useCallback((): void => {
    exportAbortRef.current?.abort();
  }, []);

  const exportProject = useCallback((): void => {
    if (mode === 'play' || mode === 'render') return;
    const bundle: StudioBundle = {
      format: 'block-creative-studio-project',
      version: '1.0.0',
      project,
      takes: takes.map(cloneTake),
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${safeFileName(project.name)}.block-creative.json`);
  }, [mode, project, takes]);

  const importProject = useCallback(
    async (file: File): Promise<void> => {
      if (mode === 'play' || mode === 'render' || exportState.running) {
        throw new Error('试玩录制或视频渲染期间不能导入项目。');
      }
      const payload = parseStudioBundle(JSON.parse(await file.text()));
      const nextProject = payload.project;
      setProject(nextProject);
      setTakes(payload.takes.map(cloneTake));
      setSelectedTakeId(payload.takes[0]?.id ?? null);
      setPlaybackFrame(0);
      setIsPlaying(false);
      clearRecording();
      setClearSignal(null);
      setMode('edit');
      setLiveSnapshot(initialStateFor(nextProject));
    },
    [clearRecording, exportState.running, mode, setLiveSnapshot],
  );

  const seekPlaybackFrame = useCallback((frame: number): void => {
    if (mode === 'play' || mode === 'render') return;
    setPlaybackFrame(frame);
  }, [mode]);

  return {
    project,
    resolvedStyle,
    mode,
    liveSnapshot,
    takes,
    selectedTake,
    compiledTake,
    presentationFrame,
    playbackFrame,
    isPlaying,
    selectedColor,
    selectedPieceSlot,
    clearSignal,
    exportState,
    materialRuntimeStatus,
    variantWorkspace: variantWorkspace.panel,
    runtimeAssets,
    recordedActionCount: recordingActionsRef.current.length,
    boardPresets: BOARD_PRESETS,
    setSelectedColor,
    setSelectedPieceSlot,
    enterEdit,
    beginHumanPlay,
    cancelHumanPlay,
    finishHumanTake,
    enterReplay,
    commitHumanPlacement,
    undoHumanPlacement,
    isPlacementValid,
    applyBoardPreset,
    editBoardCell,
    updatePieceShape,
    updatePieceColor,
    updatePieceCellColor,
    runAgent,
    selectTake,
    deleteTake,
    setStyle,
    setGeometry,
    setRhythmPreset,
    setRhythm,
    updateProjectName,
    updateProjectSeed,
    updateRenderQuality,
    setPlaybackFrame: seekPlaybackFrame,
    togglePlayback,
    exportVideo,
    cancelExport,
    exportProject,
    importProject,
    setMaterialRuntimeStatus,
  };
}
