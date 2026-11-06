import { ObservedVisualEditor } from './ObservedVisualEditor';
import { NativeSupplyEditor } from './NativeSupplyEditor';
import { NativeMediaEditor } from './NativeMediaEditor';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { BBWorkPackage } from '../contracts/bbWorkPackage';
import {
  appendNativeMove,
  createNativeTake,
  deleteNativeTake,
  generateNativeMachineTake,
  nativeTakeState,
} from '../contracts/nativeWorkAuthor';
import { TILE_COLORS, getShape } from '../nativeReference/games/block-placement/runtime/shapes';
import { hasReferenceCalibration } from '../contracts/hasReferenceCalibration';
import {
  quantizeRecordedPointer,
  type TimedPointerSample,
} from '../contracts/recordPointerSamples';
import { blockPlacementLayoutProfile as recordingLayout } from '../nativeReference/games/block-placement/profiles/layout';
import { BOARD_PRESETS } from '../nativeReference/games/block-placement/runtime/boardPresets';
import {
  MATERIAL_OPTIONS,
  LIGHTING_OPTIONS,
  CAMERA_OPTIONS,
  FX_OPTIONS,
  GEOMETRY_OPTIONS,
} from '../renderer/stylePresets';
import {
  BB_2D_APPEARANCE_OPTIONS,
  setBB2DAppearance,
  setBBDisplaySetting,
} from '../contracts/setBB2DAppearance';
import { BB_RHYTHM_FIELDS, setBBRhythm, setBBRhythmPreset } from '../contracts/setBBRhythm';
import { RHYTHM_PRESET_LIST } from '../nativeReference/director/rhythmPresets';
import {
  readBBExportQuality,
  setBBExportQuality,
  type BBExportPreset,
} from '../contracts/bbExportQuality';
import { BBSyntheticAudioEditor } from './BBSyntheticAudioEditor';

const colors: Record<string, string> = {
  coral: '#ef7771',
  amber: '#edbd55',
  lime: '#a9d36a',
  cyan: '#6ccbd3',
  blue: '#749fe0',
  violet: '#aa8bd9',
  rose: '#ee9ac3',
};
const rhythmLabels: Record<(typeof BB_RHYTHM_FIELDS)[number], string> = {
  globalSpeed: '整体速度',
  dragFrames: '拖动帧长',
  pickupDelayFrames: '拾取延迟',
  placementSettleFrames: '落位稳定',
  betweenActionFrames: '动作间隔',
  clearDelayFrames: '消除延迟',
  clearDurationFrames: '消除帧长',
  cameraRecoveryFrames: '镜头恢复',
};
/** BB authoring uses the same native state and replay contract as the project preview. */
export function NativeWorkAuthor({
  work,
  onChange,
  selected,
  onSelect,
  onDraftChange,
}: {
  work: BBWorkPackage;
  onChange: (next: BBWorkPackage) => void;
  selected: string;
  onSelect: (takeId: string) => void;
  onDraftChange?: (editor: string, dirty: boolean) => void;
}) {
  const doc = work.project as any,
    takes = doc.takes as Array<{ takeId: string; actions: unknown[] }>;
  const [boardColor, setBoardColor] = useState('coral');
  const [threeBackground, setThreeBackground] = useState<string>(
    doc.direction?.style?.background ?? '#07142d',
  );
  const [twoBackground, setTwoBackground] = useState<string>(
    doc.direction?.style?.workbenchBackground2DV1?.color ?? '#5ab99d',
  );
  const [geometryDraft, setGeometryDraft] = useState<Record<'depth' | 'bevel' | 'gap', number>>(
    () => ({
      depth: doc.direction?.style?.geometry?.depth ?? 0.3,
      bevel: doc.direction?.style?.geometry?.bevel ?? 0.1,
      gap: doc.direction?.style?.geometry?.gap ?? 0.08,
    }),
  );
  const [bestScore, setBestScore] = useState<number>(
    doc.direction?.style?.reference2d?.bestScore ?? 0,
  );
  const [rhythmDraft, setRhythmDraft] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      BB_RHYTHM_FIELDS.map((field) => [field, doc.direction?.rhythm?.[field] ?? 0]),
    ),
  );
  const [takeId, setTakeId] = useState('human-1'),
    [count, setCount] = useState(3),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    drag = useRef<{
      pieceId: string;
      pointerId: number;
      startX: number;
      startY: number;
      moved: boolean;
      points: TimedPointerSample[];
    } | null>(null),
    suppressClick = useRef(false);
  const [chosen, setChosen] = useState<{ pieceId: string; start: { x: number; y: number } } | null>(
    null,
  );
  const authorDraft =
    BB_RHYTHM_FIELDS.some(
      (field) => rhythmDraft[field] !== (doc.direction?.rhythm?.[field] ?? 0),
    ) ||
    (!!doc.direction?.style?.reference2d &&
      bestScore !== (doc.direction.style.reference2d.bestScore ?? 0)) ||
    (!!doc.direction?.style?.reference2d &&
      twoBackground !== (doc.direction.style.workbenchBackground2DV1?.color ?? '#5ab99d')) ||
    (!!doc.direction?.style?.geometry &&
      (geometryDraft.depth !== (doc.direction.style.geometry.depth ?? 0.3) ||
        geometryDraft.bevel !== (doc.direction.style.geometry.bevel ?? 0.1) ||
        geometryDraft.gap !== (doc.direction.style.geometry.gap ?? 0.08))) ||
    (!!doc.direction?.style?.geometry &&
      threeBackground !== (doc.direction.style.background ?? '#07142d'));
  useEffect(() => {
    onDraftChange?.('author-forms', authorDraft);
  }, [onDraftChange, authorDraft]);
  useEffect(() => () => onDraftChange?.('author-forms', false), [onDraftChange]);
  const locked = !!work.source || !!work.pointer || hasReferenceCalibration(doc);
  const current = useMemo(() => {
    try {
      return selected ? nativeTakeState(work, selected) : null;
    } catch {
      return null;
    }
  }, [work, selected]);
  async function run(operation: () => Promise<BBWorkPackage>, next?: string, applied?: () => void) {
    setBusy(true);
    setStatus('');
    try {
      const result = await operation();
      onChange(result);
      applied?.();
      if (next !== undefined) onSelect(next);
      setStatus('已更新作品；请保存作品包。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  function point(x: number, y: number) {
    const r = root.current?.getBoundingClientRect();
    return r
      ? {
          x: Math.max(0, Math.min(1, (x - r.left) / r.width)),
          y: Math.max(0, Math.min(1, (y - r.top) / r.height)),
        }
      : null;
  }
  function startDrag(e: ReactPointerEvent<HTMLButtonElement>, pieceId: string) {
    if (e.button !== 0 || busy || locked || !selected) return;
    const p = point(e.clientX, e.clientY);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      pieceId,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      points: [{ ...p, timeMs: performance.now() }],
    };
  }
  function moveDrag(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4) d.moved = true;
    const p = point(e.clientX, e.clientY);
    if (p && d.points.length < 9999) d.points.push({ ...p, timeMs: performance.now() });
  }
  function finishDrag(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d.moved) return;
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    const p = point(e.clientX, e.clientY),
      target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLButtonElement>('button[data-record-row]');
    if (!p || !target || !root.current?.contains(target) || !selected) {
      setStatus('已取消拖动，未改变作品。');
      return;
    }
    const row = Number(target.dataset.recordRow),
      col = Number(target.dataset.recordCol);
    try {
      const recorded = quantizeRecordedPointer(
        [...d.points, { ...p, timeMs: performance.now() }],
        doc.production.output.fps,
      );
      setChosen(null);
      void run(() =>
        appendNativeMove(
          work,
          selected,
          d.pieceId,
          row,
          col,
          'human',
          recorded.path,
          recorded.durationFrames,
        ),
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }
  function cancelDrag() {
    if (drag.current) {
      drag.current = null;
      setStatus('已取消拖动，未改变作品。');
    }
  }
  return (
    <section className="native-preview">
      <h2>BB 创作与试玩</h2>
      <p>
        拖动候选到棋盘会按实际耗时记录路径；点击方式使用固定 15
        帧。录制区按参考设计画布比例显示，坐标保存为设计画布归一化值；普通节奏会重新编排动作，拖动末段会逐渐吸附到所选目标格。多格方块的点击目标是左上锚点。新作品的种子供给使用七色、单色规则。每次修改后请保存。
      </p>
      {locked && (
        <p>
          此作品使用确认过的动作轨道。
          {work.source ? (
            <button
              onClick={() => {
                const editor = window.document.getElementById(
                  'bb-reference-editor',
                ) as HTMLDetailsElement | null;
                if (editor) {
                  editor.open = true;
                  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }}
            >
              修改复刻动作与几何
            </button>
          ) : (
            '请在多 Take 校准轨道编辑器修改对应轨道。'
          )}{' '}
          图片、音乐和视觉变体可直接修改；不会自动抹掉原轨道。
        </p>
      )}
      <label>
        新 Take 名称{' '}
        <input
          aria-label="新 Take 名称"
          value={takeId}
          onChange={(e) => setTakeId(e.target.value)}
        />
      </label>{' '}
      <button
        disabled={busy || locked}
        onClick={() => void run(() => createNativeTake(work, takeId), takeId)}
      >
        创建真人 Take
      </button>{' '}
      <label>
        机器步数{' '}
        <input
          aria-label="机器步数"
          type="number"
          min={1}
          max={100}
          value={count}
          onChange={(e) => setCount(e.target.valueAsNumber)}
        />
      </label>{' '}
      <button
        disabled={busy || locked}
        onClick={() => void run(() => generateNativeMachineTake(work, takeId, count), takeId)}
      >
        生成机器 Take
      </button>{' '}
      {takes.length > 0 && (
        <>
          <label>
            选择 Take{' '}
            <select
              aria-label="创作 Take"
              value={selected}
              onChange={(e) => onSelect(e.target.value)}
            >
              {takes.map((t) => (
                <option key={t.takeId} value={t.takeId}>
                  {t.takeId} · {t.actions.length} 步
                </option>
              ))}
            </select>
          </label>{' '}
          <button
            disabled={busy || locked || !selected}
            onClick={() =>
              void run(
                () => deleteNativeTake(work, selected),
                takes.find((t) => t.takeId !== selected)?.takeId ?? '',
              )
            }
          >
            删除所选 Take
          </button>
        </>
      )}
      {selected && (
        <button
          disabled={
            busy || locked || !takes.find((take) => take.takeId === selected)?.actions.length
          }
          onClick={() =>
            void run(async () => {
              const { undoNativeMove } = await import('../contracts/nativeWorkAuthor');
              return undoNativeMove(work, selected);
            })
          }
        >
          撤销所选 Take 最后一步
        </button>
      )}
      {current && (
        <div>
          <p>
            回合 {current.turn} · 得分 {current.score} · Combo {current.combo} · {current.status}
          </p>
          <p>选择或拖动候选到目标格：{chosen ? `已选 ${chosen.pieceId}` : '未选择'}</p>
          <div
            ref={root}
            aria-label="录制设计画布"
            style={{
              position: 'relative',
              width: 'min(360px, 100%)',
              aspectRatio: `${recordingLayout.canvas.width} / ${recordingLayout.canvas.height}`,
              background: '#243250',
              overflow: 'hidden',
              touchAction: 'none',
            }}
          >
            <div
              className="native-preview-board"
              style={{
                position: 'absolute',
                left: `${(100 * recordingLayout.board.grid.x) / recordingLayout.canvas.width}%`,
                top: `${(100 * recordingLayout.board.grid.y) / recordingLayout.canvas.height}%`,
                width: `${(100 * (8 * recordingLayout.board.grid.pitch - recordingLayout.board.grid.gap)) / recordingLayout.canvas.width}%`,
                height: 'auto',
                gridTemplateColumns: 'repeat(8,minmax(0,1fr))',
                gap: `${(100 * recordingLayout.board.grid.gap) / (8 * recordingLayout.board.grid.pitch - recordingLayout.board.grid.gap)}%`,
                padding: 0,
              }}
              role="grid"
              aria-label="录制棋盘"
            >
              {current.board.cells.flatMap((row, r) =>
                row.map((cell, c) => (
                  <button
                    key={`${r}-${c}`}
                    role="gridcell"
                    aria-label={`棋盘 ${r} ${c}`}
                    data-record-row={r}
                    data-record-col={c}
                    style={{
                      aspectRatio: '1',
                      minWidth: 0,
                      padding: 0,
                      border: 0,
                      background: cell ? colors[cell] : '#242c42',
                    }}
                    onClick={(e) => {
                      if (!chosen || !selected || busy || locked) return;
                      const end = point(e.clientX, e.clientY);
                      if (!end) return;
                      const choice = chosen;
                      setChosen(null);
                      void run(() =>
                        appendNativeMove(work, selected, choice.pieceId, r, c, 'human', [
                          { frameOffset: 0, ...choice.start },
                          { frameOffset: 15, ...end },
                        ]),
                      );
                    }}
                  />
                )),
              )}
            </div>
            {current.pieces.map((piece) => (
              <button
                key={piece.id}
                disabled={piece.used || locked || busy}
                style={{
                  position: 'absolute',
                  left: `${(100 * recordingLayout.rack.centersX[piece.slotIndex]!) / recordingLayout.canvas.width}%`,
                  top: `${(100 * recordingLayout.rack.centerY) / recordingLayout.canvas.height}%`,
                  transform: 'translate(-50%,-50%)',
                  width: '26%',
                  background: colors[piece.color],
                  padding: '6px 1px',
                  touchAction: 'none',
                }}
                onPointerDown={(e) => startDrag(e, piece.id)}
                onPointerMove={moveDrag}
                onPointerUp={finishDrag}
                onPointerCancel={cancelDrag}
                onLostPointerCapture={cancelDrag}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') cancelDrag();
                }}
                onClick={(e) => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  const box = e.currentTarget.getBoundingClientRect(),
                    p = point(box.left + box.width / 2, box.top + box.height / 2);
                  if (p) setChosen({ pieceId: piece.id, start: p });
                }}
              >
                {piece.slotIndex + 1} · {piece.shapeId} · {piece.color}
                {piece.used ? '（已用）' : ''}
              </button>
            ))}
          </div>
        </div>
      )}
      <details>
        <summary>编辑初始棋盘</summary>
        <p>修改初始棋盘会重验所有 Take；若任一步失效则保留原作品。再次点击同色格可擦除。</p>
        <p>
          棋盘预设：
          {BOARD_PRESETS.map((preset) => (
            <button
              key={preset.id}
              disabled={busy || locked}
              onClick={() =>
                void run(async () => {
                  const { setNativeBoardPreset } = await import('../contracts/nativeWorkAuthor');
                  return setNativeBoardPreset(work, preset.id);
                })
              }
            >
              {preset.label}
            </button>
          ))}
        </p>
        <button
          disabled={busy || locked}
          onClick={() =>
            void run(async () => {
              const { rotateNativeSetupColors } = await import('../contracts/nativeWorkAuthor');
              return rotateNativeSetupColors(work);
            })
          }
        >
          轮换初盘和供给颜色
        </button>
        <p>轮换棋盘、当前候选及固定供给；后续种子发牌仍使用作品种子。所有 Take 会重新检查。</p>
        <label>
          绘制颜色{' '}
          <select
            aria-label="初始棋盘颜色"
            value={boardColor}
            onChange={(e) => setBoardColor(e.target.value)}
          >
            {TILE_COLORS.map((color) => (
              <option key={color} value={color}>
                {color}
              </option>
            ))}
          </select>
        </label>
        <div
          className="native-preview-board"
          style={{ gridTemplateColumns: 'repeat(8,1fr)', maxWidth: 400 }}
          role="grid"
          aria-label="初始棋盘"
        >
          {doc.game.initialState.data.board.cells.flatMap((row: (string | null)[], r: number) =>
            row.map((cell, c) => (
              <button
                key={`${r}-${c}`}
                role="gridcell"
                aria-label={`初始棋盘 ${r} ${c}`}
                disabled={busy || locked}
                style={{ aspectRatio: '1', background: cell ? colors[cell] : '#242c42' }}
                onClick={() =>
                  void run(async () => {
                    const { setNativeWorkBoardCell } = await import(
                      '../contracts/nativeWorkAuthor'
                    );
                    return setNativeWorkBoardCell(
                      work,
                      r,
                      c,
                      cell === boardColor ? null : boardColor,
                    );
                  })
                }
              />
            )),
          )}
        </div>
      </details>
      <NativeSupplyEditor
        work={work}
        supply={doc.game.initialState.data.fixedPieceSupply ?? [doc.game.initialState.data.pieces]}
        seed={doc.game.initialState.data.seed}
        busy={busy}
        locked={locked}
        run={run}
        onDraftChange={onDraftChange}
      />
      {doc.direction?.style?.reference2d && (
        <details>
          <summary>2D 牌面与效果</summary>
          <p>
            每次修改一个实际支持的 2D 绘制设置，并重验所有
            Take；已保存的外观变体需要先在变体编辑器中修改。
          </p>
          {(
            [
              ['tileMaterial', '牌面材质'],
              ['tileFaceSet', '牌面纹样'],
              ['previewFx', '预消除'],
              ['clearFx', '清除效果'],
              ['feedbackFx', '评分反馈'],
              ['ambientFx', '背景粒子'],
              ['screenFx', '屏幕效果'],
            ] as const
          ).map(([property, label]) => (
            <label key={property}>
              {label}{' '}
              <select
                aria-label={`2D ${label}`}
                value={
                  doc.direction.style.reference2d[property] ??
                  (property === 'screenFx' ? 'default' : '')
                }
                disabled={busy || locked}
                onChange={(e) => {
                  const value = e.target.value;
                  void run(() => setBB2DAppearance(work, property, value));
                }}
              >
                {BB_2D_APPEARANCE_OPTIONS[property].map((option) => (
                  <option key={option} value={option}>
                    {option === 'default' ? '皮肤默认' : option}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            2D 背景颜色{' '}
            <input
              aria-label="2D 背景颜色"
              type="color"
              value={twoBackground}
              disabled={busy || locked}
              onChange={(e) => setTwoBackground(e.target.value)}
            />
          </label>{' '}
          <button
            disabled={busy || locked}
            onClick={() =>
              void run(async () => {
                const { setWorkbenchBackground } = await import('../contracts/workbenchBackground');
                return setWorkbenchBackground(work, twoBackground);
              })
            }
          >
            核验并应用 2D 背景
          </button>{' '}
          <button
            disabled={busy || locked || !doc.direction.style.workbenchBackground2DV1}
            onClick={() =>
              void run(async () => {
                const { setWorkbenchBackground } = await import('../contracts/workbenchBackground');
                return setWorkbenchBackground(work, null);
              })
            }
          >
            恢复 2D 默认背景
          </button>
          <p>纯色与工程背景图片不能同时绑定；环境粒子继续独立绘制。3D 暂不消费此设置。</p>
          <label>
            历史最高分{' '}
            <input
              aria-label="2D 历史最高分"
              type="number"
              min={0}
              max={2147483647}
              value={bestScore}
              disabled={busy || locked}
              onChange={(e) => setBestScore(e.target.valueAsNumber)}
            />
          </label>{' '}
          <button
            disabled={busy || locked}
            onClick={() => void run(() => setBBDisplaySetting(work, 'bestScore', bestScore))}
          >
            核验并应用最高分
          </button>{' '}
          <label>
            <input
              aria-label="显示操作指针"
              type="checkbox"
              checked={doc.direction.style.showPointer}
              disabled={busy || locked}
              onChange={(e) =>
                void run(() => setBBDisplaySetting(work, 'showPointer', e.target.checked))
              }
            />
            显示操作指针
          </label>
        </details>
      )}
      {doc.direction?.rhythm && (
        <details>
          <summary>动作节奏</summary>
          <p>
            修改会改变动作和语义音效的实际时间，并重编译所有
            Take；含确认来源或指针的作品需要重新确认轨道。
          </p>
          <label>
            节奏模板{' '}
            <select
              aria-label="BB 节奏模板"
              value={doc.direction.rhythm.id}
              disabled={busy || locked}
              onChange={(e) => {
                const id = e.target.value;
                void run(async () => {
                  const updated = await setBBRhythmPreset(work, id),
                    rhythm = (updated.project as any).direction.rhythm;
                  setRhythmDraft(
                    Object.fromEntries(BB_RHYTHM_FIELDS.map((field) => [field, rhythm[field]])),
                  );
                  return updated;
                });
              }}
            >
              {RHYTHM_PRESET_LIST.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          {BB_RHYTHM_FIELDS.map((field) => (
            <div key={field}>
              <label>
                {rhythmLabels[field]}{' '}
                <input
                  aria-label={`节奏 ${rhythmLabels[field]}`}
                  type="number"
                  min={
                    field === 'globalSpeed'
                      ? 0.1
                      : field === 'dragFrames' || field === 'clearDurationFrames'
                        ? 1
                        : 0
                  }
                  max={field === 'globalSpeed' ? 8 : 1000}
                  step={field === 'globalSpeed' ? 0.1 : 1}
                  value={rhythmDraft[field]}
                  disabled={busy || locked}
                  onChange={(e) =>
                    setRhythmDraft((old) => ({ ...old, [field]: e.target.valueAsNumber }))
                  }
                />
              </label>{' '}
              <button
                disabled={busy || locked}
                onClick={() => void run(() => setBBRhythm(work, field, rhythmDraft[field]!))}
              >
                核验并应用 {rhythmLabels[field]}
              </button>
            </div>
          ))}
        </details>
      )}
      {doc.direction?.style?.geometry && (
        <details>
          <summary>3D 材质与镜头</summary>
          <p>
            每次只修改所选外观字段并重验作品；3D 当前不消费图片、观察几何或 2D 效果，lookDev
            参数也未接入。
          </p>
          {(
            [
              ['material', '材质', MATERIAL_OPTIONS],
              ['lighting', '灯光', LIGHTING_OPTIONS],
              ['camera', '相机', CAMERA_OPTIONS],
              ['fx', '清除效果', FX_OPTIONS],
              ['geometry', '方块几何', GEOMETRY_OPTIONS],
            ] as const
          ).map(([property, label, options]) => (
            <label key={property}>
              {label}{' '}
              <select
                aria-label={`3D ${label}`}
                value={
                  property === 'geometry'
                    ? doc.direction.style.geometry.id
                    : doc.direction.style[property]
                }
                disabled={busy}
                onChange={(e) => {
                  const value = e.target.value;
                  void run(async () => {
                    const { setBBThreeAppearance } = await import(
                      '../contracts/setBBThreeAppearance'
                    );
                    const updated = await setBBThreeAppearance(work, property, value);
                    if (property === 'geometry') {
                      const geometry = (updated.project as any).direction.style.geometry;
                      setGeometryDraft({
                        depth: geometry.depth,
                        bevel: geometry.bevel,
                        gap: geometry.gap,
                      });
                    }
                    return updated;
                  });
                }}
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {(
            [
              ['depth', '厚度', 0.18, 0.72],
              ['bevel', '倒角', 0.04, 0.24],
              ['gap', '间隙', 0.04, 0.18],
            ] as const
          ).map(([property, label, min, max]) => (
            <div key={property}>
              <label>
                3D {label}{' '}
                <input
                  aria-label={`3D ${label}`}
                  type="number"
                  min={min}
                  max={max}
                  step={0.01}
                  value={geometryDraft[property]}
                  disabled={busy}
                  onChange={(e) =>
                    setGeometryDraft((old) => ({ ...old, [property]: e.target.valueAsNumber }))
                  }
                />
              </label>{' '}
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const { setBBThreeGeometry } = await import(
                      '../contracts/setBBThreeAppearance'
                    );
                    return setBBThreeGeometry(work, property, geometryDraft[property]);
                  })
                }
              >
                核验并应用 3D {label}
              </button>
            </div>
          ))}
          <label>
            背景色{' '}
            <input
              aria-label="3D 背景色"
              type="color"
              value={threeBackground}
              disabled={busy}
              onChange={(e) => setThreeBackground(e.target.value)}
            />
          </label>{' '}
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { setBBThreeAppearance } = await import('../contracts/setBBThreeAppearance');
                return setBBThreeAppearance(work, 'background', threeBackground);
              })
            }
          >
            核验并应用 3D 背景
          </button>
        </details>
      )}
      <details>
        <summary>视频质量</summary>
        <p>
          快速、标准、电影档分别使用 8/14/24 Mbps 目标码率及 1/1.35/2
          倍渲染采样；输出分辨率和帧率保持工程设置，编码器会根据画面复杂度调整实际码率。设置保存在作品中。
        </p>
        <label>
          质量档{' '}
          <select
            aria-label="BB 视频质量"
            value={readBBExportQuality(doc)}
            disabled={busy}
            onChange={(e) => {
              const value = e.target.value as BBExportPreset;
              void run(() => setBBExportQuality(work, value));
            }}
          >
            <option value="preview">快速预览</option>
            <option value="standard">标准成片</option>
            <option value="cinematic">电影档</option>
          </select>
        </label>
      </details>
      <ObservedVisualEditor work={work} selected={selected} onChange={onChange} />
      <BBSyntheticAudioEditor
        work={work}
        onChange={onChange}
        {...(onDraftChange ? { onDraftChange } : {})}
      />
      <NativeMediaEditor
        work={work}
        hasProduction={!!doc.direction?.production}
        busy={busy}
        run={run}
        onChange={onChange}
        setBusy={setBusy}
        setStatus={setStatus}
        onDraftChange={onDraftChange}
      />
      {status && <p role="status">{status}</p>}
    </section>
  );
}
