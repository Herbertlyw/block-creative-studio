import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  estimateOverlapPairs,
  FACE_LIBRARY,
  isStackProject,
  makeTemplateProject,
  maxLayer,
  nextTileId,
  normalizeTile,
  STACK_STAGE,
  TEMPLATE_OPTIONS,
  type SceneThemeId,
  type StackTemplateId,
  type StackTile,
  type TapTileStackProject,
  type TileMaterialId,
} from './stackModel';
import {
  alignStackTiles,
  type StackAlignmentCommand,
} from './stackAlignment';
import {
  solveSmartSnap,
  type SnapGuide,
  type SnapLocks,
} from './smartSnap';
import {
  makeSelectionRect,
  tileIdsInsideSelection,
  type StackPoint,
  type StackSelectionRect,
} from './stackSelection';
import './taptile-studio.css';

const AUTOSAVE_KEY = 'taptile-stack-studio/autosave/v1';

const ALIGNMENT_ACTIONS: Array<{
  command: StackAlignmentCommand;
  label: string;
  shortLabel: string;
  minimum: number;
}> = [
  { command: 'left', label: '左边缘对齐', shortLabel: '左对齐', minimum: 2 },
  { command: 'center-x', label: '水平中心对齐', shortLabel: '水平居中', minimum: 2 },
  { command: 'right', label: '右边缘对齐', shortLabel: '右对齐', minimum: 2 },
  { command: 'top', label: '上边缘对齐', shortLabel: '顶对齐', minimum: 2 },
  { command: 'center-y', label: '垂直中心对齐', shortLabel: '垂直居中', minimum: 2 },
  { command: 'bottom', label: '下边缘对齐', shortLabel: '底对齐', minimum: 2 },
  { command: 'distribute-x', label: '横向等距分布', shortLabel: '横向等距', minimum: 3 },
  { command: 'distribute-y', label: '纵向等距分布', shortLabel: '纵向等距', minimum: 3 },
];

interface HistoryState {
  past: TapTileStackProject[];
  present: TapTileStackProject;
  future: TapTileStackProject[];
}

type HistoryAction =
  | { type: 'commit'; value: TapTileStackProject }
  | { type: 'replace'; value: TapTileStackProject }
  | { type: 'record-drag'; baseline: TapTileStackProject }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; value: TapTileStackProject };

function sameProject(left: TapTileStackProject, right: TapTileStackProject): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === 'commit') {
    if (sameProject(state.present, action.value)) return state;
    return {
      past: [...state.past.slice(-79), state.present],
      present: action.value,
      future: [],
    };
  }
  if (action.type === 'replace') return { ...state, present: action.value };
  if (action.type === 'record-drag') {
    if (sameProject(action.baseline, state.present)) return state;
    return {
      past: [...state.past.slice(-79), action.baseline],
      present: state.present,
      future: [],
    };
  }
  if (action.type === 'undo') {
    const previous = state.past.at(-1);
    if (!previous) return state;
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future.slice(0, 79)],
    };
  }
  if (action.type === 'redo') {
    const next = state.future[0];
    if (!next) return state;
    return {
      past: [...state.past.slice(-79), state.present],
      present: next,
      future: state.future.slice(1),
    };
  }
  return { past: [], present: action.value, future: [] };
}

function initialProject(): TapTileStackProject {
  try {
    const stored = window.localStorage.getItem(AUTOSAVE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (isStackProject(parsed)) return parsed;
    }
  } catch {
    // A malformed local draft should never block the editor from opening.
  }
  return makeTemplateProject('hourglass');
}

interface DragSession {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  baseline: TapTileStackProject;
  positions: Map<string, { x: number; y: number }>;
  locks: SnapLocks;
  guides: SnapGuide[];
  axisLock: 'x' | 'y' | null;
}

interface MarqueeSession {
  pointerId: number;
  start: StackPoint;
  baselineSelection: string[];
  additive: boolean;
  moved: boolean;
}

const cloneProject = (project: TapTileStackProject): TapTileStackProject => structuredClone(project);

function downloadProject(project: TapTileStackProject): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${project.name.replace(/[\\/:*?"<>|]/g, '-')}.taptile-stack.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function faceGlyph(faceId: string): string {
  return FACE_LIBRARY.find((face) => face.id === faceId)?.glyph ?? '⭐';
}

function faceAccent(faceId: string): string {
  return FACE_LIBRARY.find((face) => face.id === faceId)?.accent ?? '#ffc946';
}

export function TapTileStackStudio({ onOpenBlockStudio }: { onOpenBlockStudio(): void }) {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({
    past: [],
    present: initialProject(),
    future: [],
  }));
  const project = history.present;
  const projectRef = useRef(project);
  projectRef.current = project;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;
  const [layerFocus, setLayerFocus] = useState<number | 'all'>('all');
  const [autosaveLabel, setAutosaveLabel] = useState('已自动保存');
  const [notice, setNotice] = useState('拖动任意牌块开始编辑');
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [snapTargetIds, setSnapTargetIds] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<StackSelectionRect | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const marqueeRef = useRef<MarqueeSession | null>(null);
  const snapClearTimerRef = useRef<number | null>(null);

  const commit = useCallback((mutate: (draft: TapTileStackProject) => void): void => {
    const next = cloneProject(projectRef.current);
    mutate(next);
    next.updatedAt = new Date().toISOString();
    dispatch({ type: 'commit', value: next });
  }, []);

  const selectedTiles = useMemo(
    () => project.tiles.filter((tile) => selectedIds.includes(tile.id)),
    [project.tiles, selectedIds],
  );
  const primaryTile = selectedTiles.at(-1) ?? null;
  const highestLayer = maxLayer(project.tiles);
  const usedLayers = useMemo(
    () => [...new Set(project.tiles.map((tile) => tile.layer))].sort((left, right) => left - right),
    [project.tiles],
  );
  const layerRanks = useMemo(
    () => new Map(usedLayers.map((layer, index) => [layer, index])),
    [usedLayers],
  );
  const overlapPairs = useMemo(() => estimateOverlapPairs(project.tiles), [project.tiles]);

  const visibleTileIds = useMemo(
    () => project.tiles
      .filter((tile) => layerFocus === 'all' || tile.layer === layerFocus)
      .map((tile) => tile.id),
    [layerFocus, project.tiles],
  );

  useEffect(() => {
    setAutosaveLabel('正在保存…');
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
        setAutosaveLabel('已自动保存');
      } catch {
        setAutosaveLabel('自动保存不可用');
      }
    }, 240);
    return () => window.clearTimeout(timer);
  }, [project]);

  useEffect(() => () => {
    if (snapClearTimerRef.current !== null) window.clearTimeout(snapClearTimerRef.current);
  }, []);

  useEffect(() => {
    if (layerFocus !== 'all' && !usedLayers.includes(layerFocus)) setLayerFocus('all');
  }, [layerFocus, usedLayers]);

  const updateSelected = useCallback((mutate: (tile: StackTile) => StackTile): void => {
    const ids = new Set(selectedRef.current);
    if (ids.size === 0) return;
    commit((draft) => {
      draft.tiles = draft.tiles.map((tile) => ids.has(tile.id)
        ? normalizeTile(mutate(tile))
        : tile);
    });
  }, [commit]);

  const deleteSelected = useCallback((): void => {
    const ids = new Set(selectedRef.current);
    if (ids.size === 0) return;
    commit((draft) => {
      draft.tiles = draft.tiles.filter((tile) => !ids.has(tile.id));
    });
    setSelectedIds([]);
    setNotice(`已删除 ${ids.size} 张牌`);
  }, [commit]);

  const duplicateSelected = useCallback((): void => {
    const ids = new Set(selectedRef.current);
    if (ids.size === 0) return;
    const newIds: string[] = [];
    commit((draft) => {
      const additions = draft.tiles
        .filter((tile) => ids.has(tile.id))
        .map((tile, index) => {
          const id = `${nextTileId(draft)}-${index + 1}`;
          newIds.push(id);
          return normalizeTile({
            ...tile,
            id,
            x: tile.x + 14,
            y: tile.y + 14,
            layer: tile.layer + 1,
            locked: false,
          });
        });
      draft.tiles.push(...additions);
    });
    setSelectedIds(newIds);
    setNotice(`已复制 ${newIds.length} 张牌`);
  }, [commit]);

  const alignSelection = useCallback((command: StackAlignmentCommand, label: string, minimum: number): void => {
    const ids = [...selectedRef.current];
    if (ids.length < minimum) {
      setNotice(minimum === 3 ? '等距分布至少需要选中 3 张牌' : '对齐至少需要选中 2 张牌');
      return;
    }
    const idSet = new Set(ids);
    commit((draft) => {
      draft.tiles = alignStackTiles(draft.tiles, idSet, command)
        .map((tile) => idSet.has(tile.id) ? normalizeTile(tile) : tile);
    });
    setNotice(`已完成${label}`);
  }, [commit]);

  const selectAllVisible = useCallback((): void => {
    const ids = projectRef.current.tiles
      .filter((tile) => layerFocus === 'all' || tile.layer === layerFocus)
      .map((tile) => tile.id);
    setSelectedIds(ids);
    setNotice(layerFocus === 'all' ? `已全选 ${ids.length} 张牌` : `已选中第 ${layerFocus + 1} 层的 ${ids.length} 张牌`);
  }, [layerFocus]);

  const clearSelection = useCallback((): void => {
    setSelectedIds([]);
    setMarquee(null);
    marqueeRef.current = null;
    setNotice('已取消选择');
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select')) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (command && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
        return;
      }
      if (command && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (command && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAllVisible();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        clearSelection();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
        return;
      }
      const delta = event.shiftKey ? 10 : 2;
      const movement = event.key === 'ArrowLeft'
        ? { x: -delta, y: 0 }
        : event.key === 'ArrowRight'
          ? { x: delta, y: 0 }
          : event.key === 'ArrowUp'
            ? { x: 0, y: -delta }
            : event.key === 'ArrowDown'
              ? { x: 0, y: delta }
              : null;
      if (movement) {
        event.preventDefault();
        updateSelected((tile) => ({ ...tile, x: tile.x + movement.x, y: tile.y + movement.y }));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearSelection, deleteSelected, duplicateSelected, selectAllVisible, updateSelected]);

  const chooseTemplate = (templateId: StackTemplateId): void => {
    const next = makeTemplateProject(templateId);
    next.material = project.material;
    next.theme = project.theme;
    next.snap = project.snap;
    next.showLayerBadges = project.showLayerBadges;
    dispatch({ type: 'commit', value: next });
    setSelectedIds([]);
    setLayerFocus('all');
    setNotice(`${TEMPLATE_OPTIONS.find((option) => option.id === templateId)?.label ?? ''}模板已载入`);
  };

  const chooseFace = (faceId: string): void => {
    if (selectedRef.current.length > 0) {
      updateSelected((tile) => ({ ...tile, faceId }));
      setNotice(`已替换 ${selectedRef.current.length} 张牌的牌面`);
      return;
    }
    let newId = '';
    commit((draft) => {
      newId = nextTileId(draft);
      const count = draft.tiles.length;
      draft.tiles.push(normalizeTile({
        id: newId,
        x: STACK_STAGE.width / 2 + ((count % 3) - 1) * 18,
        y: 410 + ((count % 5) - 2) * 12,
        layer: draft.tiles.length === 0 ? 0 : maxLayer(draft.tiles) + 1,
        rotation: 0,
        scale: 1,
        faceId,
        locked: false,
      }));
    });
    setSelectedIds([newId]);
    setNotice('已在画布中央新增牌块');
  };

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, tile: StackTile): void => {
    event.stopPropagation();
    if (tile.locked) {
      setNotice('这张牌已锁定，请先在右侧解锁');
      return;
    }
    const nextSelection = event.shiftKey
      ? selectedIds.includes(tile.id)
        ? selectedIds.filter((id) => id !== tile.id)
        : [...selectedIds, tile.id]
      : selectedIds.includes(tile.id)
        ? selectedIds
        : [tile.id];
    setSelectedIds(nextSelection);
    if (event.shiftKey) return;
    event.preventDefault();
    if (snapClearTimerRef.current !== null) {
      window.clearTimeout(snapClearTimerRef.current);
      snapClearTimerRef.current = null;
    }
    setSnapGuides([]);
    setSnapTargetIds([]);
    const ids = new Set(nextSelection);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      baseline: cloneProject(projectRef.current),
      positions: new Map(projectRef.current.tiles
        .filter((candidate) => ids.has(candidate.id))
        .map((candidate) => [candidate.id, { x: candidate.x, y: candidate.y }])),
      locks: { x: null, y: null },
      guides: [],
      axisLock: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const session = dragRef.current;
    const stage = stageRef.current;
    if (!session || !stage || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    let rawDx = ((event.clientX - session.startClientX) / Math.max(1, rect.width)) * STACK_STAGE.width;
    let rawDy = ((event.clientY - session.startClientY) / Math.max(1, rect.height)) * STACK_STAGE.height;
    if (event.shiftKey) {
      if (session.axisLock === null && Math.hypot(rawDx, rawDy) >= 4) {
        session.axisLock = Math.abs(rawDx) >= Math.abs(rawDy) ? 'x' : 'y';
      }
    } else {
      session.axisLock = null;
    }
    if (session.axisLock === 'x') rawDy = 0;
    if (session.axisLock === 'y') rawDx = 0;

    const snapped = solveSmartSnap({
      tiles: session.baseline.tiles,
      movingIds: [...session.positions.keys()],
      rawDx,
      rawDy,
      enabled: session.baseline.snap && !event.altKey,
      previousLocks: session.locks,
      threshold: (9 * STACK_STAGE.width) / Math.max(1, rect.width),
      releaseThreshold: (18 * STACK_STAGE.width) / Math.max(1, rect.width),
    });
    session.locks = snapped.locks;
    session.guides = snapped.guides;
    const next = cloneProject(session.baseline);
    next.tiles = next.tiles.map((tile) => {
      const start = session.positions.get(tile.id);
      return start ? normalizeTile({ ...tile, x: start.x + snapped.dx, y: start.y + snapped.dy }) : tile;
    });
    next.updatedAt = new Date().toISOString();
    dispatch({ type: 'replace', value: next });
    setSnapGuides(snapped.guides);
    setSnapTargetIds(snapped.targetIds);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const finalProject = cloneProject(projectRef.current);
    finalProject.tiles = finalProject.tiles.map((tile) => normalizeTile(tile));
    dispatch({ type: 'replace', value: finalProject });
    dispatch({ type: 'record-drag', baseline: session.baseline });
    dragRef.current = null;
    const labels = [...new Set(session.guides.map((guide) => guide.label))];
    setNotice(labels.length > 0
      ? `已吸附：${labels.join(' + ')}`
      : `已移动 ${session.positions.size} 张牌`);
    snapClearTimerRef.current = window.setTimeout(() => {
      setSnapGuides([]);
      setSnapTargetIds([]);
      snapClearTimerRef.current = null;
    }, labels.length > 0 ? 520 : 0);
  };

  const clientToStagePoint = (clientX: number, clientY: number): StackPoint | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(STACK_STAGE.width, ((clientX - rect.left) / Math.max(1, rect.width)) * STACK_STAGE.width)),
      y: Math.max(0, Math.min(STACK_STAGE.height, ((clientY - rect.top) / Math.max(1, rect.height)) * STACK_STAGE.height)),
    };
  };

  const beginMarquee = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || (event.target !== event.currentTarget && !target.closest('.tpt-scene-background'))) return;
    const start = clientToStagePoint(event.clientX, event.clientY);
    if (!start) return;
    event.preventDefault();
    const baselineSelection = event.shiftKey ? [...selectedRef.current] : [];
    marqueeRef.current = {
      pointerId: event.pointerId,
      start,
      baselineSelection,
      additive: event.shiftKey,
      moved: false,
    };
    if (!event.shiftKey) setSelectedIds([]);
    setMarquee(makeSelectionRect(start, start));
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveMarquee = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = marqueeRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const current = clientToStagePoint(event.clientX, event.clientY);
    if (!current) return;
    event.preventDefault();
    const rect = makeSelectionRect(session.start, current);
    if (!session.moved && Math.hypot(current.x - session.start.x, current.y - session.start.y) >= 4) {
      session.moved = true;
    }
    setMarquee(rect);
    if (!session.moved) return;
    const inside = tileIdsInsideSelection(projectRef.current.tiles, rect, layerFocus);
    setSelectedIds(session.additive ? [...new Set([...session.baselineSelection, ...inside])] : inside);
  };

  const finishMarquee = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = marqueeRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    marqueeRef.current = null;
    setMarquee(null);
    if (session.moved) {
      setNotice(`已框选 ${selectedRef.current.length} 张牌；拖动任意选中牌可整体移动`);
    } else if (!session.additive) {
      setNotice('已取消选择');
    }
  };

  const setSceneOption = <Key extends keyof TapTileStackProject>(
    key: Key,
    value: TapTileStackProject[Key],
  ): void => {
    commit((draft) => {
      draft[key] = value;
    });
  };

  const importProject = async (file: File): Promise<void> => {
    const parsed: unknown = JSON.parse(await file.text());
    if (!isStackProject(parsed)) throw new Error('不是可识别的 TapTile Stack Studio 工程。');
    dispatch({ type: 'commit', value: parsed });
    setSelectedIds([]);
    setLayerFocus('all');
    setNotice('工程已导入');
  };

  return (
    <div className={`tpt-studio theme-${project.theme} material-${project.material}`}>
      <header className="tpt-topbar">
        <div className="tpt-brand">
          <span className="tpt-brand-mark">T</span>
          <div>
            <strong>TapTile Stack Studio</strong>
            <small>手工堆叠编辑器 · Preview 02</small>
          </div>
        </div>
        <div className="tpt-project-name">
          <span>项目</span>
          <input
            value={project.name}
            onChange={(event) => setSceneOption('name', event.target.value)}
            aria-label="项目名称"
          />
        </div>
        <nav className="tpt-actions" aria-label="工程操作">
          <button disabled={history.past.length === 0} onClick={() => dispatch({ type: 'undo' })} title="Ctrl+Z">↶ 撤销</button>
          <button disabled={history.future.length === 0} onClick={() => dispatch({ type: 'redo' })} title="Ctrl+Y">↷ 重做</button>
          <button onClick={() => importRef.current?.click()}>导入</button>
          <button onClick={() => downloadProject(project)}>导出工程</button>
          <button className="tpt-action-primary" onClick={() => setNotice('第一版先聚焦堆叠编辑，玩法预览将在下一阶段接入')}>▶ 预览</button>
          <button className="tpt-block-link" onClick={onOpenBlockStudio}>Block Studio</button>
        </nav>
        <input
          ref={importRef}
          className="tpt-hidden-input"
          type="file"
          accept=".json,.taptile-stack.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            importProject(file).catch((error: unknown) => {
              setNotice(error instanceof Error ? error.message : '导入失败');
            });
            event.currentTarget.value = '';
          }}
        />
      </header>

      <main className="tpt-workspace">
        <aside className="tpt-panel tpt-library-panel">
          <section>
            <div className="tpt-section-title"><span>起始结构</span><small>STACK TEMPLATES</small></div>
            <div className="tpt-template-grid">
              {TEMPLATE_OPTIONS.map((template) => (
                <button
                  key={template.id}
                  className={project.templateId === template.id ? 'is-active' : ''}
                  onClick={() => chooseTemplate(template.id)}
                >
                  <i className={`template-glyph template-${template.id}`} aria-hidden="true" />
                  <strong>{template.label}</strong>
                  <span>{template.hint}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="tpt-face-section">
            <div className="tpt-section-title"><span>牌面库</span><small>{FACE_LIBRARY.length} FACES</small></div>
            <p className="tpt-helper">有选中时替换牌面；未选中时新增牌块。</p>
            <div className="tpt-face-grid">
              {FACE_LIBRARY.map((face) => (
                <button
                  key={face.id}
                  title={face.label}
                  style={{ '--face-accent': face.accent } as React.CSSProperties}
                  onClick={() => chooseFace(face.id)}
                >
                  <span>{face.glyph}</span>
                  <small>{face.label}</small>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="tpt-stage-column">
          <div className="tpt-stage-toolbar">
            <div className="tpt-tool-group">
              <button
                className={`tpt-magnet-button${project.snap ? ' is-active' : ''}`}
                onClick={() => {
                  setSceneOption('snap', !project.snap);
                  setSnapGuides([]);
                  setSnapTargetIds([]);
                }}
                title="识别中心、边缘、两牌中线与等距轨道"
              ><span aria-hidden="true">⌁</span> 智能吸附</button>
              <button onClick={selectAllVisible} disabled={visibleTileIds.length === 0} title="Ctrl+A">全选</button>
              <button onClick={clearSelection} disabled={selectedIds.length === 0} title="Esc">取消选择</button>
              <button onClick={duplicateSelected} disabled={selectedIds.length === 0}>＋ 复制</button>
              <button onClick={deleteSelected} disabled={selectedIds.length === 0}>⌫ 删除</button>
              <button
                onClick={() => updateSelected((tile) => ({ ...tile, layer: tile.layer + 1 }))}
                disabled={selectedIds.length === 0}
              >层 +1</button>
              <button
                onClick={() => updateSelected((tile) => ({ ...tile, layer: Math.max(0, tile.layer - 1) }))}
                disabled={selectedIds.length === 0}
              >层 −1</button>
            </div>
            <div className={`tpt-snap-readout${snapGuides.length > 0 ? ' is-active' : ''}`} aria-live="polite">
              <i aria-hidden="true">⌁</i>
              <span>{snapGuides.length > 0
                ? [...new Set(snapGuides.map((guide) => guide.label))].join(' · ')
                : project.snap ? '等待吸附' : '吸附已关闭'}</span>
            </div>
            <div className="tpt-tool-group tpt-layer-filter">
              <span>查看</span>
              <button className={layerFocus === 'all' ? 'is-active' : ''} onClick={() => setLayerFocus('all')}>全部</button>
              {usedLayers.map((layer) => (
                <button key={layer} className={layerFocus === layer ? 'is-active' : ''} onClick={() => setLayerFocus(layer)}>{layer + 1}</button>
              ))}
            </div>
          </div>

          <div className="tpt-stage-shell">
            <div
              ref={stageRef}
              className="tpt-phone-stage"
              onPointerDown={beginMarquee}
              onPointerMove={moveMarquee}
              onPointerUp={finishMarquee}
              onPointerCancel={finishMarquee}
            >
              <div className="tpt-scene-background" aria-hidden="true">
                <i className="scene-cloud cloud-one" />
                <i className="scene-cloud cloud-two" />
                <i className="scene-island island-one" />
                <i className="scene-island island-two" />
              </div>
              <div className="tpt-hud" aria-hidden="true">
                <button tabIndex={-1}>↶</button>
                <button tabIndex={-1}>⚙</button>
                <strong>LEVEL 07</strong>
                <div className="tpt-logo"><span>TAP</span><b>TILE</b></div>
              </div>
              <div className="tpt-tray" aria-hidden="true">
                {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
              </div>
              <div className="tpt-safe-area" aria-hidden="true"><span>游戏区域</span></div>

              {marquee && (
                <div
                  className="tpt-selection-marquee"
                  style={{
                    left: `${(marquee.left / STACK_STAGE.width) * 100}%`,
                    top: `${(marquee.top / STACK_STAGE.height) * 100}%`,
                    width: `${(marquee.width / STACK_STAGE.width) * 100}%`,
                    height: `${(marquee.height / STACK_STAGE.height) * 100}%`,
                  }}
                  aria-hidden="true"
                />
              )}

              {snapGuides.map((guide) => (
                <div
                  key={`${guide.axis}-${guide.kind}-${guide.value}`}
                  className={`tpt-snap-guide is-${guide.axis} kind-${guide.kind}`}
                  data-snap-kind={guide.kind}
                  style={guide.axis === 'x'
                    ? { left: `${(guide.value / STACK_STAGE.width) * 100}%` }
                    : { top: `${(guide.value / STACK_STAGE.height) * 100}%` }}
                  aria-hidden="true"
                >
                  <span>{guide.label}</span>
                </div>
              ))}

              {project.tiles.map((tile, index) => {
                const selected = selectedIds.includes(tile.id);
                const dimmed = layerFocus !== 'all' && tile.layer !== layerFocus;
                const snapTarget = snapTargetIds.includes(tile.id);
                return (
                  <button
                    key={tile.id}
                    type="button"
                    data-tile-id={tile.id}
                    className={`stack-tile${selected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}${tile.locked ? ' is-locked' : ''}${snapTarget ? ' is-snap-target' : ''}`}
                    aria-label={`${faceGlyph(tile.faceId)} 第 ${tile.layer + 1} 层`}
                    style={{
                      left: `${(tile.x / STACK_STAGE.width) * 100}%`,
                      top: `${(tile.y / STACK_STAGE.height) * 100}%`,
                      width: `${((STACK_STAGE.tileSize * tile.scale) / STACK_STAGE.width) * 100}%`,
                      zIndex: 100 + (layerRanks.get(tile.layer) ?? 0) * (project.tiles.length + 1) + index,
                      transform: `translate(-50%, -50%) rotate(${tile.rotation}deg)`,
                      '--tile-accent': faceAccent(tile.faceId),
                    } as React.CSSProperties}
                    onPointerDown={(event) => beginDrag(event, tile)}
                    onPointerMove={moveDrag}
                    onPointerUp={finishDrag}
                    onPointerCancel={finishDrag}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      if (!selectedIds.includes(tile.id)) setSelectedIds([tile.id]);
                      window.setTimeout(duplicateSelected, 0);
                    }}
                  >
                    <span className="tile-body">
                      <span className="tile-face">{faceGlyph(tile.faceId)}</span>
                    </span>
                    {project.showLayerBadges && <small className="tile-layer-badge">{tile.layer + 1}</small>}
                    {tile.locked && <small className="tile-lock-badge">●</small>}
                  </button>
                );
              })}
            </div>
            <div className="tpt-snap-coach" aria-hidden="true">
              <b>框选与智能轨道</b>
              <span>空白处拖框 · Shift 追加 · 选中后整体拖动</span>
              <small><kbd>Alt</kbd> 关闭吸附　<kbd>Shift</kbd> 锁定拖动方向</small>
            </div>
          </div>

          <footer className="tpt-stage-status">
            <span><i className="status-ready" />自由编辑模式</span>
            <span><strong>{project.tiles.length}</strong> 张牌</span>
            {selectedIds.length > 0 && <span className="tpt-selected-count"><strong>{selectedIds.length}</strong> 已选</span>}
            <span><strong>{usedLayers.length}</strong> 个层级</span>
            <span>最高第 <strong>{project.tiles.length > 0 ? highestLayer + 1 : 0}</strong> 层</span>
            <span><strong>{overlapPairs}</strong> 处跨层遮挡</span>
            <span className="tpt-status-notice">{notice}</span>
          </footer>
        </section>

        <aside className="tpt-panel tpt-inspector-panel">
          <section>
            <div className="tpt-section-title"><span>场景</span><small>SCENE</small></div>
            <label className="tpt-field">
              <span>背景风格</span>
              <select value={project.theme} onChange={(event) => setSceneOption('theme', event.target.value as SceneThemeId)}>
                <option value="deep-ocean">深海蓝岛</option>
                <option value="sunset">日落旷野</option>
                <option value="candy">糖果乐园</option>
                <option value="forest">薄雾森林</option>
              </select>
            </label>
            <label className="tpt-field">
              <span>牌体材质</span>
              <select value={project.material} onChange={(event) => setSceneOption('material', event.target.value as TileMaterialId)}>
                <option value="porcelain">经典休闲牌</option>
                <option value="ice">冰瓷圆角</option>
                <option value="jelly">透明果冻</option>
                <option value="paper">磨砂纸牌</option>
              </select>
            </label>
            <div className="tpt-toggle-row">
              <label><input type="checkbox" checked={project.snap} onChange={(event) => setSceneOption('snap', event.target.checked)} /><span>智能吸附</span></label>
              <label><input type="checkbox" checked={project.showLayerBadges} onChange={(event) => setSceneOption('showLayerBadges', event.target.checked)} /><span>显示层数</span></label>
            </div>
          </section>

          <section className="tpt-selection-section">
            <div className="tpt-section-title"><span>选中牌块</span><small>{selectedIds.length || 'NONE'}</small></div>
            {!primaryTile ? (
              <div className="tpt-empty-selection">
                <span>◇</span>
                <strong>点击或拖框选择牌块</strong>
                <p>Shift 点击/框选可追加；选中后拖动任意一张即可整体移动。</p>
              </div>
            ) : (
              <div className="tpt-selection-controls">
                <div className="tpt-selected-preview">
                  <span>{faceGlyph(primaryTile.faceId)}</span>
                  <div><strong>{FACE_LIBRARY.find((face) => face.id === primaryTile.faceId)?.label}</strong><small>{selectedIds.length > 1 ? `同时选中 ${selectedIds.length} 张` : primaryTile.id}</small></div>
                </div>
                <div className="tpt-number-grid">
                  <label><span>X</span><input type="number" value={Math.round(primaryTile.x)} onChange={(event) => {
                    const delta = Number(event.target.value) - primaryTile.x;
                    updateSelected((tile) => ({ ...tile, x: tile.x + delta }));
                  }} /></label>
                  <label><span>Y</span><input type="number" value={Math.round(primaryTile.y)} onChange={(event) => {
                    const delta = Number(event.target.value) - primaryTile.y;
                    updateSelected((tile) => ({ ...tile, y: tile.y + delta }));
                  }} /></label>
                  <label><span>层</span><input type="number" min={1} value={primaryTile.layer + 1} onChange={(event) => updateSelected((tile) => ({ ...tile, layer: Number(event.target.value) - 1 }))} /></label>
                </div>
                <div className="tpt-layer-stepper">
                  <button
                    onClick={() => updateSelected((tile) => ({ ...tile, layer: Math.max(0, tile.layer - 1) }))}
                    disabled={selectedTiles.every((tile) => tile.layer === 0)}
                    title="层数减一"
                  >−</button>
                  <span><b>第 {primaryTile.layer + 1} 层</b><small>层数越大，显示越靠上</small></span>
                  <button onClick={() => updateSelected((tile) => ({ ...tile, layer: tile.layer + 1 }))} title="层数加一">＋</button>
                </div>
                {selectedIds.length > 1 && (
                  <div className="tpt-align-tools">
                    <div><b>多选对齐</b><small>{selectedIds.length} 张牌</small></div>
                    <div className="tpt-align-grid">
                      {ALIGNMENT_ACTIONS.map((action) => (
                        <button
                          key={action.command}
                          disabled={selectedIds.length < action.minimum}
                          onClick={() => alignSelection(action.command, action.label, action.minimum)}
                          title={action.label}
                        >{action.shortLabel}</button>
                      ))}
                    </div>
                  </div>
                )}
                <label className="tpt-range-field">
                  <span><b>大小</b><output>{Math.round(primaryTile.scale * 100)}%</output></span>
                  <input type="range" min={55} max={165} value={primaryTile.scale * 100} onChange={(event) => updateSelected((tile) => ({ ...tile, scale: Number(event.target.value) / 100 }))} />
                </label>
                <label className="tpt-range-field">
                  <span><b>旋转</b><output>{Math.round(primaryTile.rotation)}°</output></span>
                  <input type="range" min={-45} max={45} value={primaryTile.rotation} onChange={(event) => updateSelected((tile) => ({ ...tile, rotation: Number(event.target.value) }))} />
                </label>
                <div className="tpt-inspector-buttons">
                  <button onClick={() => updateSelected((tile) => ({ ...tile, layer: highestLayer + 1 }))}>置于顶层</button>
                  <button onClick={() => updateSelected((tile) => ({ ...tile, layer: 0 }))}>置于底层</button>
                  <button onClick={() => updateSelected((tile) => ({ ...tile, locked: !tile.locked }))}>{selectedTiles.every((tile) => tile.locked) ? '解锁' : '锁定'}</button>
                </div>
              </div>
            )}
          </section>

          <section className="tpt-shortcuts">
            <div className="tpt-section-title"><span>快捷操作</span><small>SHORTCUTS</small></div>
            <dl>
              <div><dt>移动</dt><dd>拖动 / 方向键</dd></div>
              <div><dt>框选</dt><dd>空白处拖动</dd></div>
              <div><dt>追加多选</dt><dd>Shift + 点击 / 框选</dd></div>
              <div><dt>全选</dt><dd>Ctrl + A</dd></div>
              <div><dt>锁定方向</dt><dd>拖动中按 Shift</dd></div>
              <div><dt>临时关闭吸附</dt><dd>Alt + 拖动</dd></div>
              <div><dt>复制</dt><dd>Ctrl + D / 双击</dd></div>
              <div><dt>大步微调</dt><dd>Shift + 方向键</dd></div>
              <div><dt>撤销</dt><dd>Ctrl + Z</dd></div>
            </dl>
          </section>
        </aside>
      </main>

      <div className="tpt-bottom-status">
        <span>{autosaveLabel}</span>
        <span>画布 9:16</span>
        <span>参考：TPT240 / TPT760 / TPT811 / TPT884 / TPT1118</span>
        <strong>当前重点：牌块堆叠与智能对齐</strong>
      </div>
    </div>
  );
}
