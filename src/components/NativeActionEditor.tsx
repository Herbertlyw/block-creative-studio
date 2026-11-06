import type { BBWorkPackage } from '../contracts/bbWorkPackage';
import { useEffect, useState } from 'react';
import { editNativeActionTarget } from '../contracts/editNativeAction';
import { downloadBlob } from '../utils/download';

type ReplayView = {
  takes?: Array<{
    takeId?: string;
    actions?: Array<{ id?: string; action?: { anchor?: { row?: number; col?: number } } }>;
  }>;
};
export function NativeActionEditor({
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
  const takes = (document as ReplayView)?.takes ?? [];
  const takeIndex = Math.max(
    0,
    takes.findIndex((take) => take.takeId === selectedTake),
  );
  const [selection, setSelection] = useState<{ takeId: string; actionId: string } | null>(null);
  const actionIndex = Math.max(
    0,
    takes[takeIndex]?.actions?.findIndex(
      (action) => selection?.takeId === selectedTake && action.id === selection.actionId,
    ) ?? 0,
  );
  const current = takes[takeIndex]?.actions?.[actionIndex];
  const [row, setRow] = useState(current?.action?.anchor?.row ?? 0),
    [col, setCol] = useState(current?.action?.anchor?.col ?? 0);
  const [error, setError] = useState('');
  const changeSelection = (take: number, action: number) => {
    const id = takes[take]?.takeId;
    if (id && id !== selectedTake) onSelectTake(id);
    const selected = takes[take]?.actions?.[action]?.id;
    setSelection(id && selected ? { takeId: id, actionId: selected } : null);
    const anchor = takes[take]?.actions?.[action]?.action?.anchor;
    setRow(anchor?.row ?? 0);
    setCol(anchor?.col ?? 0);
    setError('');
  };
  useEffect(() => {
    setRow(current?.action?.anchor?.row ?? 0);
    setCol(current?.action?.anchor?.col ?? 0);
    setError('');
  }, [selectedTake, current?.id, current?.action?.anchor?.row, current?.action?.anchor?.col]);
  const targetDraft =
    !!current && (row !== current.action?.anchor?.row || col !== current.action?.anchor?.col);
  useEffect(() => {
    onDraftChange?.('action-target', targetDraft);
  }, [onDraftChange, targetDraft]);
  useEffect(() => () => onDraftChange?.('action-target', false), [onDraftChange]);
  if (!takes.some((take) => take.actions?.length)) return null;
  return (
    <section className="native-preview">
      <h2>修改 V2 动作目标</h2>
      <p>
        只替换选定动作的行列数字；检查全部 Take 和后续动作，失败时保留原件。Schema
        不支持的扩展会阻止编辑，原文仍可保存。
      </p>
      <label>
        Take{' '}
        <select
          aria-label="V2 动作 Take"
          value={takeIndex}
          onChange={(event) => changeSelection(Number(event.target.value), 0)}
        >
          {takes.map((take, index) => (
            <option key={index} value={index}>
              {take.takeId ?? index}
            </option>
          ))}
        </select>
      </label>{' '}
      <label>
        动作{' '}
        <select
          aria-label="V2 动作步骤"
          value={actionIndex}
          onChange={(event) => changeSelection(takeIndex, Number(event.target.value))}
        >
          {(takes[takeIndex]?.actions ?? []).map((action, index) => (
            <option key={index} value={index}>
              第 {index + 1} 步 · {action.id}
            </option>
          ))}
        </select>
      </label>
      {current && (
        <>
          <p>
            <label>
              目标行{' '}
              <input
                aria-label="V2 目标行"
                type="number"
                min={0}
                max={7}
                value={row}
                onChange={(event) => setRow(event.target.valueAsNumber)}
              />
            </label>{' '}
            <label>
              目标列{' '}
              <input
                aria-label="V2 目标列"
                type="number"
                min={0}
                max={7}
                value={col}
                onChange={(event) => setCol(event.target.valueAsNumber)}
              />
            </label>
          </p>
          <button
            className="button-secondary"
            onClick={() => {
              void (async () => {
                try {
                  let savedWork: BBWorkPackage | null = null;
                  let edited = editNativeActionTarget(text, takeIndex, actionIndex, row, col);
                  if (work) {
                    const next = await (
                      await import('../contracts/bbWorkPackage')
                    ).updateBBWorkPackageProject(work, JSON.parse(edited));
                    onWorkChange?.(next);
                    savedWork = next;
                    edited = JSON.stringify(next, null, 2);
                  }
                  downloadBlob(
                    new Blob([edited], { type: 'application/json' }),
                    fileName.replace(/(\.json)?$/i, '-action-edited.json'),
                  );
                  if (savedWork) onWorkSaved?.(savedWork);
                  setError('');
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : String(reason));
                }
              })();
            }}
          >
            检查并另存 V2 动作
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
