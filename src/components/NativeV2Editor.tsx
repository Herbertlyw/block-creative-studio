import { useRebasedDraft } from '../state/useRebasedDraft';
import type { BBWorkPackage } from '../contracts/bbWorkPackage';
import { useEffect, useRef, useState } from 'react';
import {
  addNativeAction,
  deleteNativeAction,
  editNativeBoardCell,
  editNativeInteraction,
  editNativeSupplyPiece,
  reorderNativeAction,
  editNativeBgm,
  editNativeImageBinding,
  editNativeOutputSize,
  retimeNativeFps,
  retimeNativeFpsAbsolute,
  editNativeCueGain,
  editNativeCueOffset,
} from '../contracts/editNativeDocument';
import { SHAPES, TILE_COLORS } from '../nativeReference/domain/shapes';
import { downloadBlob } from '../utils/download';
import { saveWorkbenchCalibrationTracks } from '../contracts/workbenchCalibration';
import { saveWorkbenchVariant } from '../contracts/workbenchVariant';
import { hasReferenceCalibration } from '../contracts/hasReferenceCalibration';
import { saveWorkbenchView } from '../contracts/reference2dView';
import { hasStudioAssetReferences } from '../contracts/browserAssetReferences';

type Piece = { shapeId: string; color: string };
type Action = { id: string };
type Interaction = {
  committedActionId?: string;
  startFrame: number;
  endFrame: number;
  samples?: unknown[];
};
type Binding = { fit: string; opacity: number; blendMode: string; inset: number };
function sameJson(a: string, b: string): boolean {
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return false;
  }
}
type View = {
  production: { output: { fps: number; width: number; height: number } };
  direction?: {
    style?: { agentAssets?: { bindings?: Record<string, Binding> } };
    production?: {
      audio?: {
        bgm?: { startSeconds: number; sourceOffsetSeconds: number; loop: boolean; gain: number };
        cues?: Array<{ eventType: string; assetId: string; gain?: number; offsetSeconds?: number }>;
      };
    };
  };
  game: {
    initialState: { data: { board: { rows: number; cols: number }; fixedPieceSupply?: Piece[][] } };
  };
  takes: Array<{ takeId: string; actions: Action[]; interactions: Interaction[] }>;
};
export function NativeV2Editor({
  document,
  text,
  fileName,
  work,
  onWorkChange,
  onWorkSaved,
  selectedTake,
  onSelectTake,
  onDraftChange,
}: {
  document: unknown;
  text: string;
  fileName: string;
  work?: BBWorkPackage | null;
  onWorkChange?: (work: BBWorkPackage) => void;
  onWorkSaved?: (work: BBWorkPackage) => void;
  selectedTake: string;
  onSelectTake: (takeId: string) => void;
  onDraftChange?: (editor: string, dirty: boolean) => void;
}) {
  const doc = document as View;
  const [row, setRow] = useState(0),
    [col, setCol] = useState(0),
    [color, setColor] = useState('empty');
  const firstPiece = doc.game.initialState.data.fixedPieceSupply?.[0]?.[0];
  const firstInteraction = doc.takes[0]?.interactions.find(
    (x) => x.committedActionId === doc.takes[0]?.actions[0]?.id,
  );
  const [round, setRound] = useState(0),
    [slot, setSlot] = useState(0),
    [shape, setShape] = useState(firstPiece?.shapeId ?? 'single'),
    [pieceColor, setPieceColor] = useState(firstPiece?.color ?? 'blue');
  const take = Math.max(
    0,
    doc.takes.findIndex((item) => item.takeId === selectedTake),
  );
  const [actionId, setActionId] = useState<{ takeId: string; id: string } | null>(null);
  const action = Math.max(
    0,
    doc.takes[take]?.actions.findIndex(
      (item) => actionId?.takeId === selectedTake && item.id === actionId.id,
    ) ?? 0,
  );
  const [duration, setDuration] = useState(
      firstInteraction ? firstInteraction.endFrame - firstInteraction.startFrame : 15,
    ),
    [samples, setSamples] = useState(JSON.stringify(firstInteraction?.samples ?? [], null, 2));
  const [newAction, setNewAction] = useState(''),
    [newInteraction, setNewInteraction] = useState(''),
    [status, setStatus] = useState('');
  const bindings = doc.direction?.style?.agentAssets?.bindings ?? {},
    firstSlot =
      Object.keys(bindings).find((x) =>
        ['background.base', 'tile.face', 'board.atlas'].includes(x),
      ) ?? '';
  const bgm = doc.direction?.production?.audio?.bgm;
  const [assetSlot, setAssetSlot] = useState(firstSlot);
  const currentBinding = bindings[assetSlot];
  const [fit, setFit] = useRebasedDraft(currentBinding?.fit ?? 'cover'),
    [opacity, setOpacity] = useRebasedDraft(currentBinding?.opacity ?? 1),
    [blend, setBlend] = useRebasedDraft(currentBinding?.blendMode ?? 'source-over'),
    [inset, setInset] = useRebasedDraft(currentBinding?.inset ?? 0);
  const [fps, setFps] = useRebasedDraft(doc.production.output.fps),
    [width, setWidth] = useRebasedDraft(doc.production.output.width),
    [height, setHeight] = useRebasedDraft(doc.production.output.height);
  const cues = doc.direction?.production?.audio?.cues ?? [];
  const [cueIndex, setCueIndex] = useState(0);
  const [cueGain, setCueGain] = useRebasedDraft(cues[cueIndex]?.gain ?? 1),
    [cueOffset, setCueOffset] = useRebasedDraft(cues[cueIndex]?.offsetSeconds ?? 0);
  const [bgmStart, setBgmStart] = useRebasedDraft(bgm?.startSeconds ?? 0),
    [bgmOffset, setBgmOffset] = useRebasedDraft(bgm?.sourceOffsetSeconds ?? 0),
    [bgmLoop, setBgmLoop] = useRebasedDraft(bgm?.loop ?? false),
    [bgmGain, setBgmGain] = useRebasedDraft(bgm?.gain ?? 1);
  const calibrationStyle = (document as any)?.direction?.style;
  const existingTracks = calibrationStyle?.workbenchCalibrationV2?.tracks;
  const initialTracks = Array.isArray(existingTracks)
    ? Object.fromEntries(existingTracks.map((t: any) => [t.takeId, t.calibration]))
    : calibrationStyle?.referenceCalibration && doc.takes[0]
      ? { [doc.takes[0].takeId]: calibrationStyle.referenceCalibration }
      : {};
  const [calibrationJson, setCalibrationJson] = useState(() =>
    JSON.stringify(initialTracks, null, 2),
  );
  const oldVariant = calibrationStyle?.workbenchVariantV1;
  const [savedLook, setSavedLook] = useRebasedDraft<string>(
    oldVariant?.lookKey ?? 'builtin.reference-clean.look@1.0.0',
  );
  const [savedClear, setSavedClear] = useRebasedDraft<string>(
    oldVariant?.clearFromLook ?? 'builtin.reference-clean.look@1.0.0',
  );
  useEffect(() => {
    if (!currentBinding && firstSlot && firstSlot !== assetSlot) setAssetSlot(firstSlot);
  }, [currentBinding, firstSlot, assetSlot]);
  const currentView = JSON.stringify(
    calibrationStyle?.workbenchView2D ?? {
      contract: 'bcs.workbench.reference2d-view',
      version: '1.0.0',
      design: { width: 1064, height: 1788 },
      fps: doc.production.output.fps,
      layout: { scale: 1, x: 0, y: 0 },
      camera: { mode: 'fixed', keyframes: [{ frame: 0, scale: 1, x: 0, y: 0 }] },
    },
    null,
    2,
  );
  const [viewJson, setViewJson] = useState(() => currentView);
  const currentTracks = JSON.stringify(initialTracks, null, 2);
  const previousTracks = useRef(currentTracks),
    previousView = useRef(currentView);
  useEffect(() => {
    setCalibrationJson((draft) => (draft === previousTracks.current ? currentTracks : draft));
    previousTracks.current = currentTracks;
  }, [currentTracks]);
  useEffect(() => {
    setViewJson((draft) => (draft === previousView.current ? currentView : draft));
    previousView.current = currentView;
  }, [currentView]);
  const [projectFiles, setProjectFiles] = useState<File[]>([]),
    [casFiles, setCasFiles] = useState<File[]>([]),
    [libraryFiles, setLibraryFiles] = useState<File[]>([]);
  const sources = { project: projectFiles, cas: casFiles, library: libraryFiles };
  const saveAsync = async (fn: () => Promise<string>) => {
    try {
      let result = await fn();
      let savedWork: BBWorkPackage | null = null;
      if (work) {
        const next = await (
          await import('../contracts/bbWorkPackage')
        ).updateBBWorkPackageProject(work, JSON.parse(result));
        onWorkChange?.(next);
        savedWork = next;
        result = JSON.stringify(next, null, 2);
      }
      downloadBlob(
        new Blob([result], { type: 'application/json' }),
        fileName.replace(/(\.json)?$/i, '-edited.json'),
      );
      if (savedWork) onWorkSaved?.(savedWork);
      setStatus(
        work
          ? '校验通过，已更新当前作品并另存。'
          : '校验通过，已另存；重新打开该文件以继续修改或预览。',
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const save = (fn: () => string) => {
    void saveAsync(async () => fn());
  };
  const selectAction = (ti: number, ai: number) => {
    const t = doc.takes[ti],
      a = t?.actions[ai];
    if (t && t.takeId !== selectedTake) onSelectTake(t.takeId);
    setActionId(t && a ? { takeId: t.takeId, id: a.id } : null);
  };
  const selected = doc.takes[take]?.actions[action],
    supply = doc.game.initialState.data.fixedPieceSupply;
  const interaction = doc.takes[take]?.interactions.find(
    (item) => item.committedActionId === selected?.id,
  );
  const interactionText = JSON.stringify(interaction?.samples ?? [], null, 2);
  useEffect(() => {
    setDuration(interaction ? interaction.endFrame - interaction.startFrame : 15);
    setSamples(interactionText);
  }, [selectedTake, selected?.id, interaction?.startFrame, interaction?.endFrame, interactionText]);
  const selectPiece = (r: number, s: number) => {
    setRound(r);
    setSlot(s);
    const p = supply?.[r]?.[s];
    if (p) {
      setShape(p.shapeId);
      setPieceColor(p.color);
    }
  };
  const piece = supply?.[round]?.[slot];
  const draft =
    width !== doc.production.output.width ||
    height !== doc.production.output.height ||
    fps !== doc.production.output.fps ||
    savedLook !== (oldVariant?.lookKey ?? 'builtin.reference-clean.look@1.0.0') ||
    savedClear !== (oldVariant?.clearFromLook ?? 'builtin.reference-clean.look@1.0.0') ||
    (!!piece && (shape !== piece.shapeId || pieceColor !== piece.color)) ||
    (!!interaction &&
      (duration !== interaction.endFrame - interaction.startFrame ||
        samples !== interactionText)) ||
    !!newAction.trim() ||
    !!newInteraction.trim() ||
    (!!currentBinding &&
      (fit !== currentBinding.fit ||
        opacity !== currentBinding.opacity ||
        blend !== currentBinding.blendMode ||
        inset !== currentBinding.inset)) ||
    (!!bgm &&
      (bgmStart !== bgm.startSeconds ||
        bgmOffset !== bgm.sourceOffsetSeconds ||
        bgmLoop !== bgm.loop ||
        bgmGain !== bgm.gain)) ||
    !sameJson(calibrationJson, currentTracks) ||
    !sameJson(viewJson, currentView) ||
    (!!cues[cueIndex] &&
      (cueGain !== (cues[cueIndex].gain ?? 1) ||
        cueOffset !== (cues[cueIndex].offsetSeconds ?? 0)));
  useEffect(() => {
    onDraftChange?.('project-forms', draft);
  }, [onDraftChange, draft]);
  useEffect(() => () => onDraftChange?.('project-forms', false), [onDraftChange]);
  return (
    <section className="native-preview">
      <h2>V2 棋盘、固定供给与动作编辑</h2>
      <p>
        每次操作均检查全部 Take 并另存一个新文件；原文件不变。
        {work
          ? '作品包编辑成功后立即更新当前作品。'
          : '裸工程逐次编辑时，请重新打开上一步另存的文件。'}
        更改供给形状或颜色会将该方块的逐格颜色统一为所选颜色。
      </p>
      {hasStudioAssetReferences(document) && (
        <div>
          <p>编辑时请选择工程引用的素材目录；只用于核验，另存的工程仍保留原素材引用。</p>
          {(
            [
              ['工程所在目录', setProjectFiles, projectFiles],
              ['CAS 素材库目录', setCasFiles, casFiles],
              ['元素库缓存目录', setLibraryFiles, libraryFiles],
            ] as const
          ).map(([label, set, files]) => (
            <p key={label}>
              <label>
                选择{label}{' '}
                <input
                  type="file"
                  aria-label={`编辑${label}`}
                  multiple
                  {...({ webkitdirectory: '' } as Record<string, string>)}
                  onChange={(e) => {
                    set(Array.from(e.target.files ?? []));
                    e.target.value = '';
                  }}
                />
              </label>{' '}
              已选择 {files.length} 个文件
            </p>
          ))}
        </div>
      )}
      {(calibrationStyle?.referenceCalibration !== undefined ||
        calibrationStyle?.workbenchCalibrationV2 !== undefined) && (
        <details>
          <summary>工作台多 Take 校准轨道（新增 2.0 合同）</summary>
          <p>
            以 Take ID 为键提供每个 Take
            的完整校准轨道。已有首轨仅供迁移参考；其他轨道必须由作者明确填写，系统不会推测动作时间。保存前逐轨核验动作
            ID、初始状态、时间和素材，原工程与旧轨道保持不变。校准工程玩法编辑仍会拒绝。
          </p>
          <label>
            按 Take ID 编写轨道 JSON{' '}
            <textarea
              aria-label="多 Take 校准轨道 JSON"
              rows={12}
              value={calibrationJson}
              onChange={(event) => setCalibrationJson(event.target.value)}
            />
          </label>{' '}
          <button
            onClick={() =>
              void saveAsync(() =>
                saveWorkbenchCalibrationTracks(text, JSON.parse(calibrationJson), sources),
              )
            }
          >
            校验并另存多轨道工程
          </button>
        </details>
      )}
      {!hasReferenceCalibration(document) && (
        <details>
          <summary>保存工作台 2D 外观与清除效果</summary>
          <p>
            以新增版本合同保存明确的本地目录引用和哈希，核验每个 Take
            后另存；布局与镜头引用仍需能解析。
          </p>
          <label>
            外观{' '}
            <select
              aria-label="保存 V2 外观"
              value={savedLook}
              onChange={(e) => setSavedLook(e.target.value)}
            >
              <option value="builtin.reference-clean.look@1.0.0">参考 2D · 清洁</option>
              <option value="builtin.reference-garden.look@1.0.0">参考花园</option>
            </select>
          </label>{' '}
          <label>
            清除效果{' '}
            <select
              aria-label="保存 V2 清除效果"
              value={savedClear}
              onChange={(e) => setSavedClear(e.target.value)}
            >
              <option value="builtin.reference-clean.look@1.0.0">简洁扫光</option>
              <option value="builtin.reference-garden.look@1.0.0">扫光及计分粒子</option>
            </select>
          </label>{' '}
          <button
            onClick={() =>
              void saveAsync(() => saveWorkbenchVariant(text, savedLook, savedClear, sources))
            }
          >
            检查并另存 2D 效果
          </button>
        </details>
      )}
      {!hasReferenceCalibration(document) && (
        <details>
          <summary>工作台 2D 全画面布局与镜头</summary>
          <p>
            新增视图合同在参考画布上整体缩放、平移，并按帧线性采样固定或关键帧镜头；输出画布裁切画外内容。它不改变棋盘与候选的相对位置，不消费原生布局或
            3D 镜头 profile；旋转尚不支持。
          </p>
          <label>
            视图 JSON{' '}
            <textarea
              aria-label="工作台 2D 视图 JSON"
              rows={12}
              value={viewJson}
              onChange={(e) => setViewJson(e.target.value)}
            />
          </label>{' '}
          <button
            onClick={() =>
              void saveAsync(() => saveWorkbenchView(text, JSON.parse(viewJson), sources))
            }
          >
            检查并另存 2D 视图
          </button>
        </details>
      )}
      <h3>初始棋盘</h3>
      <label>
        行{' '}
        <input
          aria-label="V2 棋盘行"
          type="number"
          min={0}
          max={doc.game.initialState.data.board.rows - 1}
          value={row}
          onChange={(e) => setRow(e.target.valueAsNumber)}
        />
      </label>{' '}
      <label>
        列{' '}
        <input
          aria-label="V2 棋盘列"
          type="number"
          min={0}
          max={doc.game.initialState.data.board.cols - 1}
          value={col}
          onChange={(e) => setCol(e.target.valueAsNumber)}
        />
      </label>{' '}
      <label>
        颜色{' '}
        <select aria-label="V2 棋盘颜色" value={color} onChange={(e) => setColor(e.target.value)}>
          <option value="empty">空格</option>
          {TILE_COLORS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>{' '}
      <button
        className="button-secondary"
        onClick={() =>
          save(() => editNativeBoardCell(text, row, col, color === 'empty' ? null : color))
        }
      >
        检查并另存棋盘
      </button>
      {supply && (
        <>
          <h3>固定供给</h3>
          <label>
            轮次{' '}
            <select
              aria-label="V2 供给轮次"
              value={round}
              onChange={(e) => selectPiece(Number(e.target.value), slot)}
            >
              {supply.map((_, i) => (
                <option value={i} key={i}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            候选槽{' '}
            <select
              aria-label="V2 供给候选槽"
              value={slot}
              onChange={(e) => selectPiece(round, Number(e.target.value))}
            >
              {[0, 1, 2].map((i) => (
                <option key={i} value={i}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            形状{' '}
            <select
              aria-label="V2 供给形状"
              value={shape}
              onChange={(e) => setShape(e.target.value)}
            >
              {SHAPES.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.id}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            颜色{' '}
            <select
              aria-label="V2 供给颜色"
              value={pieceColor}
              onChange={(e) => setPieceColor(e.target.value)}
            >
              {TILE_COLORS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>{' '}
          <button
            className="button-secondary"
            onClick={() => save(() => editNativeSupplyPiece(text, round, slot, shape, pieceColor))}
          >
            检查并另存供给
          </button>
        </>
      )}
      <h3>动作顺序、时长与路径</h3>
      <label>
        Take{' '}
        <select
          aria-label="V2 扩展编辑 Take"
          value={take}
          onChange={(e) => selectAction(Number(e.target.value), 0)}
        >
          {doc.takes.map((t, i) => (
            <option key={t.takeId} value={i}>
              {t.takeId}
            </option>
          ))}
        </select>
      </label>{' '}
      <label>
        动作{' '}
        <select
          aria-label="V2 扩展编辑动作"
          value={action}
          onChange={(e) => selectAction(take, Number(e.target.value))}
        >
          {doc.takes[take]?.actions.map((a, i) => (
            <option key={a.id} value={i}>
              {i + 1} · {a.id}
            </option>
          ))}
        </select>
      </label>{' '}
      {selected && (
        <>
          <button
            disabled={action === 0}
            onClick={() => save(() => reorderNativeAction(text, take, action, action - 1))}
          >
            上移并另存
          </button>{' '}
          <button
            disabled={action >= doc.takes[take]!.actions.length - 1}
            onClick={() => save(() => reorderNativeAction(text, take, action, action + 1))}
          >
            下移并另存
          </button>{' '}
          <button onClick={() => save(() => deleteNativeAction(text, take, action))}>
            删除动作并另存
          </button>
          <p>
            <label>
              交互帧长{' '}
              <input
                aria-label="V2 动作帧长"
                type="number"
                min={1}
                value={duration}
                onChange={(e) => setDuration(e.target.valueAsNumber)}
              />
            </label>
          </p>
          <label>
            指针样本 JSON{' '}
            <textarea
              aria-label="V2 指针路径 JSON"
              rows={5}
              value={samples}
              onChange={(e) => setSamples(e.target.value)}
            />
          </label>{' '}
          <button
            onClick={() =>
              save(() => editNativeInteraction(text, take, action, duration, JSON.parse(samples)))
            }
          >
            检查并另存时长与路径
          </button>
        </>
      )}
      <details>
        <summary>追加动作（高级 JSON）</summary>
        <p>动作和提交交互分别使用原生合同；交互的 committedActionId 必须等于动作 id。</p>
        <label>
          动作 JSON{' '}
          <textarea
            aria-label="V2 新动作 JSON"
            value={newAction}
            onChange={(e) => setNewAction(e.target.value)}
          />
        </label>
        <label>
          交互 JSON{' '}
          <textarea
            aria-label="V2 新交互 JSON"
            value={newInteraction}
            onChange={(e) => setNewInteraction(e.target.value)}
          />
        </label>
        <button onClick={() => save(() => addNativeAction(text, take, newAction, newInteraction))}>
          检查并追加另存
        </button>
      </details>
      <h3>输出尺寸</h3>
      <p>修改视频尺寸并另存；未知 production 画面控制会阻止修改。</p>
      <label>
        宽{' '}
        <input
          aria-label="V2 输出宽度"
          type="number"
          min={64}
          max={1920}
          step={2}
          value={width}
          onChange={(e) => setWidth(e.target.valueAsNumber)}
        />
      </label>{' '}
      <label>
        高{' '}
        <input
          aria-label="V2 输出高度"
          type="number"
          min={64}
          max={1920}
          step={2}
          value={height}
          onChange={(e) => setHeight(e.target.valueAsNumber)}
        />
      </label>{' '}
      <button onClick={() => save(() => editNativeOutputSize(text, width, height))}>
        检查并另存输出尺寸
      </button>
      <h3>帧率</h3>
      <p>
        将已识别的动作交互和节奏帧按比例转换并四舍五入；音乐秒数保持不变。逐步重新编译并检查动作时间，超过较低帧率的两帧时拒绝转换；时间可能因编译器取整变化，并非精确保持。存在未接入的
        production 时序或序列时也拒绝转换。
      </p>
      <label>
        输出 fps{' '}
        <input
          aria-label="V2 输出帧率"
          type="number"
          min={15}
          max={60}
          value={fps}
          onChange={(e) => setFps(e.target.valueAsNumber)}
        />
      </label>{' '}
      <button onClick={() => save(() => retimeNativeFps(text, fps))}>旧式逐字段取整并另存</button>{' '}
      <button onClick={() => save(() => retimeNativeFpsAbsolute(text, fps))}>
        按绝对时间边界转换并另存
      </button>
      <p>
        绝对边界转换可微调节奏；最多 12
        个动作时还可能调整交互终点及路径末点，调整量不超过一个目标帧。会逐动作、指针及语义事件验证实际时间；最多处理
        512 个动作；超过 128 个动作时只接受直接换算已满足精度的工程，无法满足一个目标帧时拒绝保存。
      </p>
      {firstSlot && (
        <>
          <h3>图片槽配置</h3>
          <p>外部图片引用使用上方所选目录核验，工程保留原始引用。</p>
          <label>
            槽位{' '}
            <select
              aria-label="V2 图片槽"
              value={assetSlot}
              onChange={(e) => {
                const id = e.target.value,
                  b = bindings[id];
                if (!b) return;
                setAssetSlot(id);
                setFit(b.fit);
                setOpacity(b.opacity);
                setBlend(b.blendMode);
                setInset(b.inset);
              }}
            >
              {Object.keys(bindings)
                .filter((x) => ['background.base', 'tile.face', 'board.atlas'].includes(x))
                .map((x) => (
                  <option key={x}>{x}</option>
                ))}
            </select>
          </label>{' '}
          <label>
            适配{' '}
            <select aria-label="V2 图片适配" value={fit} onChange={(e) => setFit(e.target.value)}>
              {['cover', 'contain', 'stretch'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>{' '}
          <label>
            透明度{' '}
            <input
              aria-label="V2 图片透明度"
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={opacity}
              onChange={(e) => setOpacity(e.target.valueAsNumber)}
            />
          </label>{' '}
          <label>
            混合{' '}
            <select
              aria-label="V2 图片混合"
              value={blend}
              onChange={(e) => setBlend(e.target.value)}
            >
              {['source-over', 'multiply', 'screen', 'overlay', 'soft-light'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>{' '}
          <label>
            缩进{' '}
            <input
              aria-label="V2 图片缩进"
              type="number"
              min={0}
              max={0.45}
              step={0.01}
              value={inset}
              onChange={(e) => setInset(e.target.valueAsNumber)}
            />
          </label>{' '}
          <button
            onClick={() =>
              void saveAsync(() =>
                editNativeImageBinding(
                  text,
                  assetSlot,
                  fit,
                  opacity,
                  blend,
                  inset,
                  undefined,
                  sources,
                ),
              )
            }
          >
            检查并另存图片配置
          </button>
        </>
      )}
      {bgm && (
        <>
          <h3>工程音乐</h3>
          <label>
            视频起点秒{' '}
            <input
              aria-label="V2 音乐起点"
              type="number"
              min={0}
              step={0.1}
              value={bgmStart}
              onChange={(e) => setBgmStart(e.target.valueAsNumber)}
            />
          </label>{' '}
          <label>
            源偏移秒{' '}
            <input
              aria-label="V2 音乐源偏移"
              type="number"
              min={0}
              step={0.1}
              value={bgmOffset}
              onChange={(e) => setBgmOffset(e.target.valueAsNumber)}
            />
          </label>{' '}
          <label>
            增益{' '}
            <input
              aria-label="V2 音乐增益"
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={bgmGain}
              onChange={(e) => setBgmGain(e.target.valueAsNumber)}
            />
          </label>{' '}
          <label>
            <input
              aria-label="V2 音乐循环"
              type="checkbox"
              checked={bgmLoop}
              onChange={(e) => setBgmLoop(e.target.checked)}
            />
            循环
          </label>{' '}
          <button
            onClick={() =>
              void saveAsync(() =>
                editNativeBgm(
                  text,
                  doc.takes[take]!.takeId,
                  bgmStart,
                  bgmOffset,
                  bgmLoop,
                  bgmGain,
                  sources,
                ),
              )
            }
          >
            检查并另存音乐
          </button>
        </>
      )}
      {cues.length > 0 && (
        <>
          <h3>事件音效</h3>
          <label>
            事件{' '}
            <select
              aria-label="V2 音效事件"
              value={cueIndex}
              onChange={(e) => {
                const i = Number(e.target.value);
                setCueIndex(i);
                setCueGain(cues[i]?.gain ?? 1);
                setCueOffset(cues[i]?.offsetSeconds ?? 0);
              }}
            >
              {cues.map((cue, i) => (
                <option key={i} value={i}>
                  {cue.eventType} · {cue.assetId}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            增益{' '}
            <input
              aria-label="V2 音效增益"
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={cueGain}
              onChange={(e) => setCueGain(e.target.valueAsNumber)}
            />
          </label>{' '}
          <button
            onClick={() =>
              void saveAsync(() =>
                editNativeCueGain(text, doc.takes[take]!.takeId, cueIndex, cueGain, sources),
              )
            }
          >
            检查并另存音效
          </button>{' '}
          <label>
            偏移秒{' '}
            <input
              aria-label="V2 音效偏移"
              type="number"
              min={-2}
              max={10}
              step={0.01}
              value={cueOffset}
              onChange={(e) => setCueOffset(e.target.valueAsNumber)}
            />
          </label>{' '}
          <button
            onClick={() =>
              void saveAsync(() =>
                editNativeCueOffset(text, doc.takes[take]!.takeId, cueIndex, cueOffset, sources),
              )
            }
          >
            检查并另存音效偏移
          </button>
          <p>偏移相对该语义事件的实际时间；超出视频的部分会在预览和导出时提示。</p>
        </>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
