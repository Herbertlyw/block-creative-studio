import { useState } from 'react';
import { observedFramePosition } from '../contracts/observedDraftReview';
import type { ReferenceMeasurement } from '../contracts/referenceMeasurement';

const colors = ['coral', 'amber', 'lime', 'cyan', 'blue', 'violet', 'rose'];
type Props = {
  text: string;
  setText: (s: string) => void;
  hash: string;
  width: number;
  height: number;
  frame: number;
  hasMeasurement: boolean;
  measurement?: ReferenceMeasurement | null;
};
/** Structured form edits the same JSON that is saved and validated by the builder. */
export function ObservedAnnotationEditor({
  text,
  setText,
  hash,
  width,
  height,
  frame,
  hasMeasurement,
  measurement,
}: Props) {
  const [paint, setPaint] = useState('unknown');
  let draft: any = null;
  try {
    draft = text ? JSON.parse(text) : null;
  } catch {
    /* raw JSON remains editable */
  }
  const change = (fn: (d: any) => void) => {
    try {
      const d = JSON.parse(text),
        before = JSON.stringify([d.board, d.supply]);
      fn(d);
      if (before !== JSON.stringify([d.board, d.supply]))
        d.actions.forEach((a: any) => {
          a.confirmed = false;
        });
      setText(JSON.stringify(d, null, 2));
    } catch {
      /* preserve invalid author text */
    }
  };
  const number = (value: string) => (value === '' ? null : Number(value));
  const setAction = (i: number, key: string, value: unknown) =>
    change((d) => {
      d.actions[i][key] = value;
      d.actions[i].confirmed = false;
    });
  if (!text)
    return (
      <button
        onClick={() =>
          setText(
            JSON.stringify(
              {
                version: '1.0.0',
                sourceSha256: hash,
                seed: 0,
                board: {
                  confirmed: false,
                  cells: Array.from({ length: 8 }, () => Array(8).fill('unknown')),
                },
                supply: {
                  confirmed: false,
                  initialUsedSlots: [],
                  rounds: [Array.from({ length: 3 }, () => ({ shapeId: '', color: '' }))],
                },
                output: { width, height, fps: 30 },
                actions: [],
              },
              null,
              2,
            ),
          )
        }
      >
        创建空白标注表
      </button>
    );
  if (
    !Array.isArray(draft?.board?.cells) ||
    draft.board.cells.length !== 8 ||
    draft.board.cells.some((r: any) => !Array.isArray(r) || r.length !== 8) ||
    !Array.isArray(draft?.supply?.rounds) ||
    draft.supply.rounds.some(
      (r: any) =>
        !Array.isArray(r) || r.length !== 3 || r.some((p: any) => !p || typeof p !== 'object'),
    ) ||
    !Array.isArray(draft.supply.initialUsedSlots) ||
    !draft.output ||
    !Array.isArray(draft?.actions) ||
    draft.actions.some(
      (a: any) =>
        !a || !Array.isArray(a.path) || !Array.isArray(a.clearRows) || !Array.isArray(a.clearCols),
    )
  )
    return <p>当前 JSON 不完整或无效；原文已保留，请修正后使用表单。</p>;
  return (
    <div>
      <p>
        表单与下方 JSON 共用同一份标注。修改棋盘、供给或动作后，相关确认会撤销；unknown
        不代表空格。种子、尺寸及帧率请按工程设置核实。
      </p>
      <label>
        工程种子{' '}
        <input
          aria-label="标注种子"
          type="number"
          value={draft.seed ?? ''}
          onChange={(e) =>
            change((d) => {
              d.seed = number(e.target.value);
            })
          }
        />
      </label>{' '}
      <label>
        输出宽度{' '}
        <input
          aria-label="标注输出宽度"
          type="number"
          value={draft.output?.width ?? ''}
          onChange={(e) =>
            change((d) => {
              d.output.width = number(e.target.value);
            })
          }
        />
      </label>{' '}
      <label>
        输出高度{' '}
        <input
          aria-label="标注输出高度"
          type="number"
          value={draft.output?.height ?? ''}
          onChange={(e) =>
            change((d) => {
              d.output.height = number(e.target.value);
            })
          }
        />
      </label>{' '}
      <label>
        输出帧率{' '}
        <input
          aria-label="标注输出帧率"
          type="number"
          value={draft.output?.fps ?? ''}
          onChange={(e) =>
            change((d) => {
              d.output.fps = number(e.target.value);
            })
          }
        />
      </label>
      <p>
        <label>
          棋盘画笔{' '}
          <select
            aria-label="棋盘标注画笔"
            value={paint}
            onChange={(e) => setPaint(e.target.value)}
          >
            <option value="unknown">未确认</option>
            <option value="empty">空格</option>
            {colors.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>{' '}
        <label>
          <input
            type="checkbox"
            checked={draft.board.confirmed === true}
            onChange={(e) =>
              change((d) => {
                d.board.confirmed = e.target.checked;
              })
            }
          />
          作者确认整个初盘
        </label>
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8,minmax(3.5em,1fr))',
          maxWidth: 640,
        }}
      >
        {draft.board.cells.map((row: any[], r: number) =>
          row.map((cell: any, c: number) => (
            <button
              key={`${r}-${c}`}
              aria-label={`初盘 ${r} 行 ${c} 列 ${cell === null ? '空' : cell}`}
              onClick={() =>
                change((d) => {
                  d.board.cells[r][c] = paint === 'empty' ? null : paint;
                  d.board.confirmed = false;
                })
              }
            >
              {cell === null ? '空' : cell === 'unknown' ? '?' : String(cell)}
            </button>
          )),
        )}
      </div>
      <p>固定供给：逐轮填写三个形状 ID 和颜色；勾选初始已用槽位。</p>
      {[0, 1, 2].map((slot) => (
        <label key={slot}>
          <input
            type="checkbox"
            checked={draft.supply.initialUsedSlots?.includes(slot) ?? false}
            onChange={(e) =>
              change((d) => {
                d.supply.initialUsedSlots = e.target.checked
                  ? [...d.supply.initialUsedSlots, slot]
                  : d.supply.initialUsedSlots.filter((x: number) => x !== slot);
                d.supply.confirmed = false;
              })
            }
          />
          槽位 {slot} 已用{' '}
        </label>
      ))}
      {draft.supply.rounds.map((round: any[], r: number) => (
        <div key={r}>
          <p>第 {r + 1} 轮</p>
          {round.map((piece: any, s: number) => (
            <label key={s}>
              槽 {s} 形状{' '}
              <input
                aria-label={`供给 ${r} ${s} 形状`}
                value={piece.shapeId ?? ''}
                onChange={(e) =>
                  change((d) => {
                    d.supply.rounds[r][s].shapeId = e.target.value;
                    d.supply.confirmed = false;
                  })
                }
              />{' '}
              颜色{' '}
              <select
                aria-label={`供给 ${r} ${s} 颜色`}
                value={piece.color ?? ''}
                onChange={(e) =>
                  change((d) => {
                    d.supply.rounds[r][s].color = e.target.value;
                    d.supply.confirmed = false;
                  })
                }
              >
                <option value="">未确认</option>
                {colors.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>{' '}
            </label>
          ))}
          <button
            onClick={() =>
              change((d) => {
                d.supply.rounds.splice(r, 1);
                d.supply.confirmed = false;
              })
            }
          >
            删除本轮
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          change((d) => {
            d.supply.rounds.push(Array.from({ length: 3 }, () => ({ shapeId: '', color: '' })));
            d.supply.confirmed = false;
          })
        }
      >
        添加供给轮次
      </button>{' '}
      <label>
        <input
          type="checkbox"
          checked={draft.supply.confirmed === true}
          onChange={(e) =>
            change((d) => {
              d.supply.confirmed = e.target.checked;
            })
          }
        />
        作者确认全部供给
      </label>
      <p>动作按顺序填写；空行列表示作者确认没有消除。帧按钮取当前选择的测量源帧。</p>
      {draft.actions.map((a: any, i: number) => (
        <fieldset key={a.id}>
          <legend>
            第 {i + 1} 步 · {a.id}
          </legend>
          {(['slot', 'row', 'col', 'pickupFrame', 'releaseFrame', 'clearFrame'] as const).map(
            (key) => (
              <label key={key}>
                {key}{' '}
                <input
                  aria-label={`动作 ${i + 1} ${key}`}
                  type="number"
                  value={a[key] ?? ''}
                  onChange={(e) => setAction(i, key, number(e.target.value))}
                />
                {['pickupFrame', 'releaseFrame', 'clearFrame'].includes(key) && (
                  <button
                    disabled={
                      !hasMeasurement ||
                      !Number.isInteger(frame) ||
                      frame < 0 ||
                      (!!measurement && frame >= measurement.source.frameCount)
                    }
                    onClick={() => setAction(i, key, frame)}
                  >
                    取所选帧
                  </button>
                )}{' '}
                {['pickupFrame', 'releaseFrame', 'clearFrame'].includes(key) &&
                  measurement &&
                  (() => {
                    try {
                      const position = observedFramePosition(measurement, a[key], draft.output.fps);
                      return (
                        <small>
                          源 {position.seconds.toFixed(4)} 秒 → 校准输出帧 {position.outputFrame}
                          。{' '}
                        </small>
                      );
                    } catch {
                      return <small>时间未确认或超出测量范围。 </small>;
                    }
                  })()}
              </label>
            ),
          )}
          {(['clearRows', 'clearCols'] as const).map((key) => (
            <label key={key}>
              {key}{' '}
              <input
                aria-label={`动作 ${i + 1} ${key}`}
                value={a[key].join(',')}
                onChange={(e) =>
                  setAction(
                    i,
                    key,
                    e.target.value === '' ? [] : e.target.value.split(',').map(Number),
                  )
                }
              />{' '}
            </label>
          ))}
          <p>指针路径（归一化坐标）：</p>
          {a.path.map((point: any, j: number) => (
            <span key={j}>
              {(['frame', 'x', 'y'] as const).map((k) => (
                <label key={k}>
                  {k}
                  <input
                    aria-label={`动作 ${i + 1} 路径 ${j + 1} ${k}`}
                    type="number"
                    step={k === 'frame' ? 1 : 0.01}
                    value={point[k] ?? ''}
                    onChange={(e) =>
                      change((d) => {
                        d.actions[i].path[j][k] = number(e.target.value);
                        d.actions[i].confirmed = false;
                      })
                    }
                  />
                </label>
              ))}
              <button
                onClick={() =>
                  change((d) => {
                    d.actions[i].path.splice(j, 1);
                    d.actions[i].confirmed = false;
                  })
                }
              >
                删除路径点
              </button>
            </span>
          ))}
          <button
            onClick={() =>
              change((d) => {
                d.actions[i].path.push({ frame: hasMeasurement ? frame : null, x: null, y: null });
                d.actions[i].confirmed = false;
              })
            }
          >
            添加路径点
          </button>{' '}
          <label>
            <input
              type="checkbox"
              checked={a.confirmed === true}
              onChange={(e) =>
                change((d) => {
                  d.actions[i].confirmed = e.target.checked;
                })
              }
            />
            作者确认此步
          </label>{' '}
          <button
            disabled={i === 0}
            onClick={() =>
              change((d) => {
                [d.actions[i - 1], d.actions[i]] = [d.actions[i], d.actions[i - 1]];
                d.actions.forEach((x: any) => {
                  x.confirmed = false;
                });
              })
            }
          >
            上移此步
          </button>{' '}
          <button
            disabled={i === draft.actions.length - 1}
            onClick={() =>
              change((d) => {
                [d.actions[i + 1], d.actions[i]] = [d.actions[i], d.actions[i + 1]];
                d.actions.forEach((x: any) => {
                  x.confirmed = false;
                });
              })
            }
          >
            下移此步
          </button>{' '}
          <button
            onClick={() =>
              change((d) => {
                d.actions.splice(i, 1);
                d.actions.forEach((x: any) => {
                  x.confirmed = false;
                });
              })
            }
          >
            删除此步
          </button>
        </fieldset>
      ))}
      <button
        onClick={() =>
          change((d) => {
            d.actions.push({
              id: crypto.randomUUID(),
              confirmed: false,
              slot: null,
              row: null,
              col: null,
              pickupFrame: null,
              releaseFrame: null,
              clearFrame: null,
              clearRows: [],
              clearCols: [],
              path: [],
            });
          })
        }
      >
        添加动作
      </button>
    </div>
  );
}
