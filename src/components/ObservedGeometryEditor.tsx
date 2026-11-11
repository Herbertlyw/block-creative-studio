import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { sourceDesignMap, type SourceDesignMap } from '../contracts/sourceDesignMap';
import type { ReferenceMeasurement } from '../contracts/referenceMeasurement';
import { measuredFrameSeconds } from '../contracts/referenceMeasurement';
import { observedFramePosition } from '../contracts/observedDraftReview';

type Props = {
  mapping: SourceDesignMap | null;
  setMapping: (m: SourceDesignMap) => void;
  text: string;
  setText: (value: string) => void;
  annotation: string;
  setAnnotation: (value: string) => void;
  url: string;
  measurement: ReferenceMeasurement | null;
  frame: number;
  width: number;
  height: number;
  onSelectFrame?: (frame: number) => void;
};
/** An explicit stretched source-to-design map matching the calibrated canvas. */
export function ObservedGeometryEditor({
  mapping,
  setMapping,
  text,
  setText,
  annotation,
  setAnnotation,
  url,
  measurement,
  frame,
  width,
  height,
  onSelectFrame,
}: Props) {
  const [action, setAction] = useState(0),
    [point, setPoint] = useState(0),
    [pointerIndex, setPointerIndex] = useState(0);
  const video = useRef<HTMLVideoElement>(null),
    drag = useRef<'board' | 'size' | 'rack' | 'point' | 'pointer' | null>(null);
  useEffect(() => {
    if (video.current && measurement) {
      try {
        video.current.currentTime = measuredFrameSeconds(measurement, frame);
      } catch {
        /* invalid frame remains visible in form */
      }
    }
  }, [measurement, frame]);
  let g: any;
  try {
    g = JSON.parse(text);
  } catch {
    g = null;
  }
  let a: any;
  try {
    a = JSON.parse(annotation);
  } catch {
    a = null;
  }
  const valid =
    !!g &&
    Array.isArray(g.board) &&
    g.board.length === 3 &&
    g.board.every(Number.isFinite) &&
    Number.isFinite(g.rackY) &&
    Array.isArray(g.motions) &&
    g.motions.every(
      (m: any) =>
        m &&
        typeof m.actionId === 'string' &&
        Array.isArray(m.points) &&
        m.points.every((p: any) => p && [p.frame, p.x, p.y, p.cellSize].every(Number.isFinite)),
    ) &&
    Array.isArray(g.rackCenters);
  const current = valid ? g.motions[action] : null,
    p = current?.points?.[point];
  const bindingValid = !!current && a?.actions?.[action]?.id === current.actionId;
  const pointerAction =
      a?.actions?.[action]?.id === current?.actionId && Array.isArray(a?.actions?.[action]?.path)
        ? a.actions[action]
        : null,
    pointerPoint = pointerAction?.path?.[pointerIndex];
  let transform: ReturnType<typeof sourceDesignMap> | null = null;
  try {
    if (mapping) transform = sourceDesignMap(mapping, width, height);
  } catch {
    /* invalid mapping is shown below */
  }
  function update(fn: (value: any) => void) {
    try {
      const next = JSON.parse(text);
      fn(next);
      setText(JSON.stringify(next, null, 2));
    } catch {
      /* preserve invalid JSON for correction */
    }
  }
  function reset(next: any, all = false) {
    next.confirmed = false;
    if (all) for (const m of next.motions ?? []) m.confirmed = false;
    else if (next.motions?.[action]) next.motions[action].confirmed = false;
  }
  function begin(
    e: PointerEvent<SVGElement>,
    kind: 'board' | 'size' | 'rack' | 'point' | 'pointer',
  ) {
    if ((kind === 'point' || kind === 'pointer') && !bindingValid) return;
    e.preventDefault();
    drag.current = kind;
    (e.currentTarget.ownerSVGElement ?? e.currentTarget).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = Math.max(0, Math.min(1080, ((e.clientX - r.left) * 1080) / r.width)),
      y = Math.max(0, Math.min(1920, ((e.clientY - r.top) * 1920) / r.height));
    if (drag.current === 'pointer') {
      if (!pointerPoint || (mapping && !transform)) return;
      const pos = transform
        ? transform.designToSource(x, y)
        : { x: (x / 1080) * width, y: (y / 1920) * height };
      if (pos.x < 0 || pos.x > width || pos.y < 0 || pos.y > height) return;
      try {
        const next = JSON.parse(annotation);
        const entry = next.actions[action];
        if (entry.id !== current.actionId) return;
        entry.path[pointerIndex].x = Number((pos.x / width).toFixed(6));
        entry.path[pointerIndex].y = Number((pos.y / height).toFixed(6));
        entry.confirmed = false;
        setAnnotation(JSON.stringify(next, null, 2));
      } catch {
        /* preserve invalid annotation */
      }
      return;
    }
    update((next) => {
      if (drag.current === 'board') {
        next.board[0] = Math.round(x);
        next.board[1] = Math.round(y);
        reset(next, true);
      } else if (drag.current === 'size') {
        next.board[2] = Math.round(
          Math.max(20, Math.min(200, (x - next.board[0] + (y - next.board[1])) / 16)),
        );
        reset(next, true);
      } else if (drag.current === 'rack') {
        next.rackY = Math.round(y);
        reset(next, true);
      } else if (next.motions?.[action]?.points?.[point]) {
        next.motions[action].points[point].x = Math.round(x);
        next.motions[action].points[point].y = Math.round(y);
        reset(next);
      }
    });
  }
  function init() {
    if (!Array.isArray(a?.actions) || !a.actions.length) return;
    const next = {
      confirmed: false,
      coordinateSystem: 'design-1080x1920-piece-top-left',
      board: [0, 0, 100],
      rackY: 1450,
      rackCell: 70,
      rackCenters: [236, 540, 844],
      theme: 'grey',
      bestScore: 0,
      motions: a.actions.map((entry: any) => ({
        actionId: entry.id,
        confirmed: false,
        points: [
          { frame: entry.pickupFrame, x: 0, y: 0, cellSize: 70 },
          { frame: entry.releaseFrame, x: 0, y: 0, cellSize: 100 },
        ],
      })),
    };
    setText(JSON.stringify(next, null, 2));
  }
  return (
    <details>
      <summary>可视几何与方块轨迹（实验）</summary>
      <p>
        覆盖层使用已选源裁切和缩放映射到 1080×1920
        设计画布。旧记录未设置映射时使用历史的分别拉伸；新建映射必须确认。预览视频跳转仅近似，精确源帧请用独立提帧核对。拖动棋盘左上、右下、候选线或选中动作的方块左上圆点；修改会撤销确认。
      </p>
      {!mapping && (
        <button
          type="button"
          disabled={!width || !height}
          onClick={() =>
            setMapping({
              version: '1.0.0',
              mode: 'contain',
              crop: { x: 0, y: 0, width, height },
              x: 0,
              y: 0,
              confirmed: false,
            })
          }
        >
          创建待确认的源画面映射
        </button>
      )}
      {mapping && (
        <div>
          <label>
            缩放{' '}
            <select
              aria-label="源画面缩放"
              value={mapping.mode}
              onChange={(e) =>
                setMapping({
                  ...mapping,
                  mode: e.target.value as SourceDesignMap['mode'],
                  confirmed: false,
                })
              }
            >
              <option value="contain">等比留边 contain</option>
              <option value="cover">等比裁切 cover</option>
              <option value="stretch">分别拉伸 stretch</option>
            </select>
          </label>{' '}
          {(['x', 'y', 'width', 'height'] as const).map((k) => (
            <label key={k}>
              裁切 {k}{' '}
              <input
                aria-label={`源裁切 ${k}`}
                type="number"
                value={mapping.crop[k]}
                onChange={(e) => {
                  if (Number.isFinite(e.target.valueAsNumber))
                    setMapping({
                      ...mapping,
                      crop: { ...mapping.crop, [k]: e.target.valueAsNumber },
                      confirmed: false,
                    });
                }}
              />
            </label>
          ))}
          {(['x', 'y'] as const).map((k) => (
            <label key={k}>
              平移 {k}{' '}
              <input
                aria-label={`映射平移 ${k}`}
                type="number"
                value={mapping[k]}
                onChange={(e) => {
                  if (Number.isFinite(e.target.valueAsNumber))
                    setMapping({ ...mapping, [k]: e.target.valueAsNumber, confirmed: false });
                }}
              />
            </label>
          ))}
          <label>
            <input
              type="checkbox"
              aria-label="确认源画面映射"
              checked={mapping.confirmed}
              disabled={!transform}
              onChange={(e) => setMapping({ ...mapping, confirmed: e.target.checked })}
            />
            确认映射
          </label>
          {transform ? (
            <p>
              比例 x={transform.sx.toFixed(4)}、y={transform.sy.toFixed(4)}，裁切左上映射至 (
              {transform.left.toFixed(1)}, {transform.top.toFixed(1)}
              )；轨迹以设计坐标保存，改变映射后需重新检查和确认。
            </p>
          ) : (
            <p role="alert">映射无效：裁切须位于源画面内且宽高大于零。</p>
          )}
        </div>
      )}
      {!text && (
        <button type="button" disabled={!a?.actions?.length} onClick={init}>
          建立未确认的几何模板
        </button>
      )}
      {text && !valid && (
        <p role="alert">几何 JSON 无效或缺少棋盘、候选、动作；请在 JSON 中修正，原文保留。</p>
      )}
      {valid && (
        <>
          {!bindingValid && (
            <p role="alert">
              当前方块轨迹的动作 ID 或顺序与结构化标注不匹配；轨迹保留，请核对绑定后再编辑或确认。
            </p>
          )}
          {Array.isArray(a?.actions) &&
            g.motions.length === a.actions.length &&
            g.motions.every((motion: any) =>
              a.actions.some((entry: any) => entry.id === motion.actionId),
            ) &&
            new Set(g.motions.map((motion: any) => motion.actionId)).size === g.motions.length &&
            !bindingValid && (
              <button
                type="button"
                onClick={() =>
                  update((next) => {
                    next.motions = a.actions.map((entry: any) =>
                      next.motions.find((motion: any) => motion.actionId === entry.id),
                    );
                    reset(next, true);
                  })
                }
              >
                按动作 ID 重排并撤销轨迹确认
              </button>
            )}
          <div
            style={{
              position: 'relative',
              width: 'min(100%, 420px)',
              aspectRatio: '9/16',
              background: '#111',
            }}
          >
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
              <video
                ref={video}
                src={url}
                muted
                playsInline
                style={
                  mapping && transform
                    ? {
                        position: 'absolute',
                        left: `${((transform.left - mapping.crop.x * transform.sx) / 1080) * 100}%`,
                        top: `${((transform.top - mapping.crop.y * transform.sy) / 1920) * 100}%`,
                        width: `${((width * transform.sx) / 1080) * 100}%`,
                        height: `${((height * transform.sy) / 1920) * 100}%`,
                        clipPath: `inset(${(mapping.crop.y / height) * 100}% ${((width - mapping.crop.x - mapping.crop.width) / width) * 100}% ${((height - mapping.crop.y - mapping.crop.height) / height) * 100}% ${(mapping.crop.x / width) * 100}%)`,
                      }
                    : { width: '100%', height: '100%', display: 'block', objectFit: 'fill' }
                }
              />
            </div>
            <svg
              aria-label="校准几何覆盖层"
              viewBox="0 0 1080 1920"
              preserveAspectRatio="none"
              onPointerMove={move}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                touchAction: 'none',
              }}
            >
              <rect
                x={g.board[0]}
                y={g.board[1]}
                width={g.board[2] * 8}
                height={g.board[2] * 8}
                fill="none"
                stroke="#00ffff"
                strokeWidth="8"
              />
              {Array.from({ length: 7 }, (_, i) => (
                <g key={i} stroke="#00ffff" strokeWidth="2">
                  <line
                    x1={g.board[0] + (i + 1) * g.board[2]}
                    y1={g.board[1]}
                    x2={g.board[0] + (i + 1) * g.board[2]}
                    y2={g.board[1] + 8 * g.board[2]}
                  />
                  <line
                    x1={g.board[0]}
                    y1={g.board[1] + (i + 1) * g.board[2]}
                    x2={g.board[0] + 8 * g.board[2]}
                    y2={g.board[1] + (i + 1) * g.board[2]}
                  />
                </g>
              ))}
              <circle
                aria-label="拖动棋盘左上"
                cx={g.board[0]}
                cy={g.board[1]}
                r="24"
                fill="#00ffff"
                onPointerDown={(e) => begin(e, 'board')}
              />
              <circle
                aria-label="拖动棋盘右下调整格子"
                cx={g.board[0] + 8 * g.board[2]}
                cy={g.board[1] + 8 * g.board[2]}
                r="24"
                fill="#00ffff"
                onPointerDown={(e) => begin(e, 'size')}
              />
              <line x1="0" y1={g.rackY} x2="1080" y2={g.rackY} stroke="#ffdf00" strokeWidth="5" />
              {g.rackCenters.map((x: number, index: number) => (
                <g key={index}>
                  <rect
                    x={x - g.rackCell}
                    y={g.rackY - g.rackCell}
                    width={g.rackCell * 2}
                    height={g.rackCell * 2}
                    fill="none"
                    stroke="#ffdf00"
                    strokeWidth="3"
                  />
                  <text
                    x={x}
                    y={g.rackY - g.rackCell - 12}
                    textAnchor="middle"
                    fill="#ffdf00"
                    fontSize="28"
                  >
                    候选 {index}
                  </text>
                </g>
              ))}
              <circle
                aria-label="拖动候选纵向位置"
                cx="540"
                cy={g.rackY}
                r="25"
                fill="#ffdf00"
                onPointerDown={(e) => begin(e, 'rack')}
              />
              {pointerPoint &&
                (!mapping || transform) &&
                (() => {
                  const q = transform
                    ? transform.sourceToDesign(pointerPoint.x * width, pointerPoint.y * height)
                    : { x: pointerPoint.x * 1080, y: pointerPoint.y * 1920 };
                  return (
                    <circle
                      aria-label="拖动指针位置"
                      cx={q.x}
                      cy={q.y}
                      r="25"
                      fill="#ffffff88"
                      stroke="#000000"
                      strokeWidth="5"
                      onPointerDown={(e) => begin(e, 'pointer')}
                    />
                  );
                })()}
              {p && (
                <>
                  <rect
                    x={p.x}
                    y={p.y}
                    width={p.cellSize}
                    height={p.cellSize}
                    fill="#ff00ff44"
                    stroke="#ff00ff"
                    strokeWidth="6"
                  />
                  <circle
                    aria-label="拖动方块位置"
                    cx={p.x}
                    cy={p.y}
                    r="25"
                    fill="#ff00ff"
                    onPointerDown={(e) => begin(e, 'point')}
                  />
                </>
              )}
              {current && (
                <>
                  <polyline
                    aria-label="选中动作方块轨迹"
                    pointerEvents="none"
                    points={current.points.map((v: any) => `${v.x},${v.y}`).join(' ')}
                    fill="none"
                    stroke="#ff83ff"
                    strokeWidth="5"
                  />
                  {current.points.map((v: any, index: number) => (
                    <g
                      key={index}
                      onPointerDown={(event) => {
                        setPoint(index);
                        begin(event, 'point');
                      }}
                      onClick={() => setPoint(index)}
                    >
                      <circle
                        cx={v.x}
                        cy={v.y}
                        r={index === point ? 16 : 10}
                        fill={index === point ? '#fff' : '#ff83ff'}
                      />
                      <text
                        pointerEvents="none"
                        x={v.x + 18}
                        y={v.y - 18}
                        fill="#fff"
                        stroke="#111"
                        strokeWidth="1"
                        fontSize="27"
                      >
                        {index + 1} · f{v.frame}
                      </text>
                    </g>
                  ))}
                </>
              )}
            </svg>
          </div>
          <p>
            三个候选横坐标使用 1080×1920
            设计像素；黄色框只示意候选中心，真实形状仍由供给标注确认。修改后重新确认几何及各动作轨迹。
          </p>
          {[0, 1, 2].map((index) => (
            <label key={index}>
              候选 {index + 1} 横坐标{' '}
              <input
                aria-label={`候选 ${index + 1} 横坐标`}
                type="number"
                min={0}
                max={1080}
                value={g.rackCenters[index] ?? 0}
                onChange={(e) => {
                  const value = e.target.valueAsNumber;
                  if (Number.isFinite(value))
                    update((n) => {
                      n.rackCenters[index] = value;
                      reset(n, true);
                    });
                }}
              />
            </label>
          ))}
          <label>
            动作{' '}
            <select
              aria-label="几何动作"
              value={action}
              onChange={(e) => {
                setAction(Number(e.target.value));
                setPoint(0);
                setPointerIndex(0);
              }}
            >
              {g.motions.map((m: any, i: number) => (
                <option key={i} value={i}>
                  {m.actionId}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            轨迹点{' '}
            <select
              aria-label="几何轨迹点"
              value={point}
              onChange={(e) => setPoint(Number(e.target.value))}
            >
              {current?.points?.map((v: any, i: number) => (
                <option key={i} value={i}>
                  源帧 {v.frame}
                </option>
              ))}
            </select>
          </label>{' '}
          {p && (
            <>
              <p aria-label="轨迹点绑定信息">
                动作 {current.actionId} · 点 {point + 1} · 源帧 {p.frame}
                {measurement &&
                  (() => {
                    try {
                      const position = observedFramePosition(measurement, p.frame, a.output.fps);
                      return ` · ${position.seconds.toFixed(6)} 秒 · 校准输出帧 ${position.outputFrame}`;
                    } catch {
                      return ' · 时间或输出帧率无效';
                    }
                  })()}{' '}
                ·{' '}
                {!bindingValid
                  ? '绑定失效，须重新确认'
                  : current.confirmed
                    ? '作者已确认'
                    : '待确认'}
              </p>
              {(['x', 'y'] as const).map((key) => (
                <label key={key}>
                  方块左上 {key}{' '}
                  <input
                    aria-label={`方块轨迹 ${key}`}
                    type="number"
                    step="any"
                    value={p[key]}
                    disabled={!bindingValid}
                    onChange={(e) => {
                      const value = e.target.valueAsNumber;
                      if (Number.isFinite(value))
                        update((next) => {
                          next.motions[action].points[point][key] = value;
                          reset(next);
                        });
                    }}
                  />
                </label>
              ))}{' '}
              <label>
                点的源帧{' '}
                <input
                  aria-label="方块轨迹源帧"
                  type="number"
                  value={p.frame}
                  onChange={(e) =>
                    update((n) => {
                      n.motions[action].points[point].frame = e.target.valueAsNumber;
                      reset(n);
                    })
                  }
                />
              </label>{' '}
              <label>
                方块单格尺寸{' '}
                <input
                  aria-label="方块轨迹尺寸"
                  type="number"
                  value={p.cellSize}
                  onChange={(e) =>
                    update((n) => {
                      n.motions[action].points[point].cellSize = e.target.valueAsNumber;
                      reset(n);
                    })
                  }
                />
              </label>{' '}
              <button
                type="button"
                disabled={
                  !bindingValid ||
                  !measurement ||
                  !Number.isInteger(frame) ||
                  frame < 0 ||
                  frame >= measurement.source.frameCount
                }
                onClick={() =>
                  update((n) => {
                    n.motions[action].points.splice(point + 1, 0, {
                      ...n.motions[action].points[point],
                      frame,
                    });
                    reset(n);
                    setPoint(point + 1);
                  })
                }
              >
                在所选源帧添加点
              </button>{' '}
              <button
                type="button"
                disabled={
                  !measurement ||
                  !Number.isInteger(p.frame) ||
                  p.frame < 0 ||
                  p.frame >= measurement.source.frameCount
                }
                onClick={() => onSelectFrame?.(p.frame)}
              >
                定位所选轨迹点（近似）
              </button>{' '}
              <button
                type="button"
                disabled={current.points.length <= 2}
                onClick={() =>
                  update((n) => {
                    n.motions[action].points.splice(point, 1);
                    reset(n);
                    setPoint(Math.max(0, point - 1));
                  })
                }
              >
                删除点
              </button>
            </>
          )}
          {pointerAction && (
            <p>
              <label>
                指针控制点{' '}
                <select
                  aria-label="可视指针控制点"
                  value={pointerIndex}
                  onChange={(e) => setPointerIndex(Number(e.target.value))}
                >
                  {pointerAction.path.map((v: any, i: number) => (
                    <option key={i} value={i}>
                      源帧 {v.frame}
                    </option>
                  ))}
                </select>
              </label>{' '}
              白色圆点是指针中心，紫色圆点是方块左上；拖动指针会撤销动作和轨道确认。
            </p>
          )}
          <p>
            <label>
              <input
                key={current?.actionId}
                data-action-id={current?.actionId}
                type="checkbox"
                aria-label="确认选中方块轨迹"
                checked={bindingValid && current?.confirmed === true}
                disabled={!bindingValid}
                onChange={(e) =>
                  update((n) => {
                    n.motions[action].confirmed = e.target.checked;
                  })
                }
              />
              确认此动作方块轨迹
            </label>{' '}
            <label>
              <input
                type="checkbox"
                aria-label="确认棋盘候选几何"
                checked={g.confirmed === true}
                onChange={(e) =>
                  update((n) => {
                    n.confirmed = e.target.checked;
                  })
                }
              />
              确认棋盘及候选几何
            </label>
          </p>
        </>
      )}
    </details>
  );
}
