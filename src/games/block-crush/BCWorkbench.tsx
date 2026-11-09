import { useEffect, useRef, useState } from 'react';
import type { BrowserAssetSources } from '../../contracts/browserAssetReferences';
import { createWavAsset } from '../../contracts/audioAsset';
import {
  bcCalibration,
  bcColours,
  bcProduction,
  editBCProject,
  setBCProduction,
  type BCProject,
} from './document';
import { importBCProject, imageAsset, makePaletteAsset } from './assets';
import {
  BC_CLEAR_GEOMETRIES,
  bcBoardText,
  changeBCAction,
  changeBCBoard,
  changeBCColours,
  changeBCImage,
  changeBCMaterial,
  changeBCClearGeometry,
  generateBCTake,
  parseBCActionDraft,
  refreshBCClips,
} from './editing';
import { createBCDemo } from './demo';
import { useBCSession } from './useBCSession';
import { useBCPlayer } from './useBCPlayer';
import './workbench.css';

const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));
const actionKey = (takeId: string, actionId: string) => JSON.stringify([takeId, actionId]);

export function BCWorkbench({ onExit }: { onExit: () => void }) {
  const session = useBCSession(),
    { project } = session;
  const [takeId, setTakeId] = useState(''),
    [full, setFull] = useState(false);
  const player = useBCPlayer(project, takeId, full);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [drafts, setDrafts] = useState(new Set<string>());
  const [name, setName] = useState(''),
    [colours, setColours] = useState<string[]>([]),
    [board, setBoard] = useState(''),
    [tracks, setTracks] = useState('');
  const [actionDrafts, setActionDrafts] = useState<
    Record<string, { column: string; seconds: string }>
  >({});
  const [sources, setSources] = useState<BrowserAssetSources>({});
  const input = useRef<HTMLInputElement>(null),
    pendingFile = useRef<File | null>(null);
  const take = project?.takes.find((item) => item.takeId === takeId);
  const locked = busy || player.exporting;
  function resetDrafts(current: BCProject) {
    setName(current.name);
    setBoard(bcBoardText(current));
    setColours(bcColours(current));
    setTracks(JSON.stringify(bcCalibration(current).pieceTracks ?? [], null, 2));
    setActionDrafts({});
    setDrafts(new Set());
  }
  useEffect(() => {
    if (!project) return;
    setTakeId((current) =>
      project.takes.some((item) => item.takeId === current)
        ? current
        : (project.takes[0]?.takeId ?? ''),
    );
    resetDrafts(project);
  }, [project]);
  useEffect(() => {
    if (!drafts.size) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts]);
  const markDraft = (key: string) => setDrafts((current) => new Set([...current, key]));
  const allow = (consumed?: string, leaving = false) => {
    const pending = [...drafts].filter((key) => key !== consumed);
    if (
      pending.length &&
      !window.confirm('有尚未应用的编辑草稿。确定放弃这些草稿并继续吗？取消后可先应用修改。')
    )
      return false;
    if (
      leaving &&
      session.dirty &&
      !window.confirm('工程有尚未保存的修改。确定离开吗？取消后可先保存工程。')
    )
      return false;
    return true;
  };
  async function run(
    operation: (base: BCProject) => BCProject | Promise<BCProject>,
    consumed?: string,
  ) {
    if (!allow(consumed)) return;
    setBusy(true);
    setError('');
    try {
      await session.perform(operation);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }
  async function open(file: File) {
    if (!allow(undefined, true)) return;
    pendingFile.current = file;
    setBusy(true);
    setError('');
    const ticket = ++session.generation.current;
    try {
      const text = await file.text();
      const next = await importBCProject(JSON.parse(text.replace(/^\uFEFF/, '')), sources);
      if (ticket !== session.generation.current) return;
      session.update(next, undefined, true);
      setFull(false);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }
  async function uploadImage(file: File, slot: 'world.background' | 'tile.palette') {
    await run(async (base) => {
      const asset =
        slot === 'tile.palette'
          ? await makePaletteAsset(file, bcColours(base))
          : await imageAsset(
              new Uint8Array(await file.arrayBuffer()),
              'bc-edited-background',
              file.name,
            );
      return changeBCImage(base, slot, asset);
    });
  }
  async function uploadBgm(file: File) {
    await run(async (base) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const asset = await createWavAsset(bytes, 'bc-edited-bgm', file.name);
      return editBCProject(base, (draft) => {
        const production = bcProduction(draft),
          audio = production.audio ?? {};
        production.audio = {
          ...audio,
          assets: { ...audio.assets, [asset.id]: asset },
          bgm: { ...audio.bgm, assetId: asset.id, enabled: true },
        };
        setBCProduction(draft, production);
      });
    });
  }
  const choose =
    (handler: (file: File) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) handler(file);
    };
  return (
    <div className="bc-shell">
      <main className="bc-workbench">
        <header className="bc-header">
          <div>
            <span className="bc-eyebrow">BLOCK CREATIVE STUDIO</span>
            <h1>BC 落消工作台</h1>
            <p>一份工程，继续编辑与变体创作。</p>
          </div>
          <div className="bc-toolbar">
            <button
              disabled={locked}
              onClick={() => {
                if (allow(undefined, true)) {
                  player.seek(0);
                  session.update(createBCDemo());
                  setFull(true);
                }
              }}
            >
              新建示例
            </button>
            <button disabled={locked} onClick={() => input.current?.click()}>
              导入工程
            </button>
            <button
              disabled={!project || locked}
              onClick={() => {
                if (allow()) {
                  if (project) resetDrafts(project);
                  session.save();
                }
              }}
            >
              保存 JSON{session.dirty ? ' ·' : ''}
            </button>
            <button
              disabled={!session.canUndo || locked}
              onClick={() => {
                if (allow()) session.undo();
              }}
            >
              撤销
            </button>
            <button
              disabled={locked}
              onClick={() => {
                if (allow(undefined, true)) onExit();
              }}
            >
              返回 BB
            </button>
            <input
              ref={input}
              hidden
              type="file"
              accept="application/json,.json"
              onChange={choose((file) => void open(file))}
            />
          </div>
        </header>
        {(error || player.error || player.exportError) && (
          <p className="bc-error" role="alert">
            {error || player.error || player.exportError}
          </p>
        )}
        {!project ? (
          <section className="bc-welcome">
            <span className="bc-badge">落位 · 消除 · 连锁</span>
            <h2>从一个局面开始</h2>
            <p>打开已有的 BC 工程，或用原生示例体验换色、材质、背景、动作和声音。</p>
            <button
              className="bc-primary"
              disabled={busy}
              onClick={() => {
                session.update(createBCDemo());
                setFull(true);
              }}
            >
              打开落消示例
            </button>
          </section>
        ) : (
          <div className="bc-layout">
            <section className="bc-preview" aria-label="落消预览">
              <div className="bc-preview-heading">
                <strong>{project.name}</strong>
                <span>
                  {project.production.output.width} × {project.production.output.height} · 30 fps
                </span>
              </div>
              <canvas
                ref={player.canvas}
                aria-label="BC 视频画面"
                data-ready={player.ready}
                data-frame={player.frame}
              />
              <div className="bc-transport">
                <button disabled={!player.ready || locked} onClick={() => void player.play()}>
                  {player.playing ? '暂停' : '播放'}
                </button>
                <input
                  aria-label="BC 时间线"
                  type="range"
                  min={0}
                  max={Math.max(0, (player.playback?.totalFrames ?? 1) - 1)}
                  value={player.frame}
                  onChange={(event) => player.seek(Number(event.target.value))}
                  disabled={!player.ready || locked}
                />
                <output>
                  {(player.frame / 30).toFixed(2)} /{' '}
                  {((player.playback?.totalFrames ?? 0) / 30).toFixed(2)} 秒
                </output>
              </div>
              <div className="bc-toolbar">
                <label>
                  Take{' '}
                  <select
                    aria-label="BC Take"
                    value={takeId}
                    disabled={locked}
                    onChange={(event) => {
                      if (allow()) {
                        resetDrafts(project);
                        player.pause();
                        setTakeId(event.target.value);
                      }
                    }}
                  >
                    {project.takes.map((item) => (
                      <option key={item.takeId}>{item.takeId}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={full}
                    disabled={locked}
                    onChange={(event) => setFull(event.target.checked)}
                  />
                  全程（取消则使用保存的片段）
                </label>
              </div>
              <button
                className="bc-primary"
                disabled={!player.ready || locked || !!player.error || drafts.size > 0}
                onClick={() => void player.exportVideo()}
              >
                导出当前范围 MP4
              </button>
              {player.exporting && <button onClick={player.cancelExport}>取消导出</button>}
              <p className="bc-status" role="status">
                {busy
                  ? '正在应用修改…'
                  : player.progress ||
                    (player.ready ? '画面已就绪；使用工程自身的素材与音频。' : '正在准备画面…')}
              </p>
            </section>
            <aside className="bc-editors">
              <section className="bc-card">
                <h2>作品</h2>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(
                      (base) =>
                        editBCProject(base, (draft) => {
                          draft.name = name;
                        }),
                      'name',
                    );
                  }}
                >
                  <label>
                    名称
                    <input
                      value={name}
                      maxLength={160}
                      onChange={(event) => {
                        setName(event.target.value);
                        markDraft('name');
                      }}
                      disabled={locked}
                    />
                  </label>
                  <button disabled={locked || !name.trim()}>应用名称</button>
                </form>
              </section>
              <section className="bc-card">
                <h2>外观变体</h2>
                <p>保留动作和时序，修改实际进入画面的颜色与素材。</p>
                <div className="bc-colours">
                  {colours.map((colour, i) => (
                    <label key={i}>
                      颜色 {i + 1}
                      <input
                        aria-label={`BC 颜色 ${i + 1}`}
                        type="color"
                        value={colour}
                        disabled={locked}
                        onChange={(event) => {
                          setColours((current) =>
                            current.map((c, j) => (i === j ? event.target.value : c)),
                          );
                          markDraft('colours');
                        }}
                      />
                    </label>
                  ))}
                </div>
                <button
                  disabled={locked}
                  onClick={() => void run((base) => changeBCColours(base, colours), 'colours')}
                >
                  应用配色
                </button>
                <label>
                  程序材质（切回程序牌面）
                  <select
                    aria-label="BC 材质"
                    disabled={locked}
                    value={bcCalibration(project).material}
                    onChange={(event) => {
                      const value = event.target.value as ReturnType<
                        typeof bcCalibration
                      >['material'];
                      void run((base) => changeBCMaterial(base, value));
                    }}
                  >
                    <option value="bevel">柔光倒角</option>
                    <option value="ice">冰晶</option>
                    <option value="pyramid">立体棱面</option>
                    <option value="wood-star">木纹星形</option>
                  </select>
                </label>
                <label>
                  替换背景
                  <input
                    aria-label="BC 背景图片"
                    disabled={locked}
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={choose((file) => void uploadImage(file, 'world.background'))}
                  />
                </label>
                <label>
                  替换牌面材质
                  <input
                    aria-label="BC 牌面图片"
                    disabled={locked}
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={choose((file) => void uploadImage(file, 'tile.palette'))}
                  />
                </label>
                <small>
                  正方形图片会保留明暗与透明度，按当前色板生成牌面；也可导入对应颜色顺序的横向图集。已烘焙的花瓣等序列像素保持原样。
                </small>
              </section>
              {bcCalibration(project).clear && (
                <section className="bc-card">
                  <h2>消除演出</h2>
                  <label>
                    原生碎片形状
                    <select
                      aria-label="BC 碎片形状"
                      disabled={locked}
                      value={bcCalibration(project).clear?.fragmentGeometry ?? 'faceted-chip'}
                      onChange={(event) => {
                        const geometry = event.target.value as keyof typeof BC_CLEAR_GEOMETRIES;
                        void run((base) => changeBCClearGeometry(base, geometry));
                      }}
                    >
                      {!Object.hasOwn(
                        BC_CLEAR_GEOMETRIES,
                        bcCalibration(project).clear?.fragmentGeometry ?? 'faceted-chip',
                      ) && (
                        <option value={bcCalibration(project).clear?.fragmentGeometry}>
                          工程原有形状
                        </option>
                      )}
                      {Object.entries(BC_CLEAR_GEOMETRIES).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <small>保留原有消除时间、运动和声音；已绑定的透明序列仍按原配置播放。</small>
                </section>
              )}
              <section className="bc-card">
                <h2>动作与路线</h2>
                <div className="bc-toolbar">
                  <span>{take?.actions.length ?? 0} 步动作</span>
                  <button
                    disabled={locked}
                    onClick={() => void run((base) => generateBCTake(base))}
                  >
                    生成合法路线
                  </button>
                </div>
                <div className="bc-actions">
                  {take?.actions.map((entry, index) => {
                    const action = entry.action as { release: { x: number }; impactTick: number };
                    const key = actionKey(take.takeId, entry.id);
                    const draft = actionDrafts[key] ?? {
                      column: String(action.release.x),
                      seconds: String(action.impactTick / 30),
                    };
                    return (
                      <form
                        key={key}
                        noValidate
                        onSubmit={(event) => {
                          event.preventDefault();
                          void run((base) => {
                            const values = parseBCActionDraft(draft, base.game.config.data.columns);
                            return changeBCAction(
                              base,
                              takeId,
                              index,
                              values.column,
                              values.seconds,
                            );
                          }, `action-${index}`);
                        }}
                      >
                        <strong>{index + 1}</strong>
                        <label>
                          列（从 0 起）
                          <input
                            name="column"
                            type="number"
                            value={draft.column}
                            onChange={(event) => {
                              const column = event.target.value;
                              setActionDrafts((current) => ({
                                ...current,
                                [key]: { ...draft, column },
                              }));
                              markDraft(`action-${index}`);
                            }}
                            min={0}
                            max={project.game.config.data.columns - 1}
                            disabled={locked}
                          />
                        </label>
                        <label>
                          落位秒数
                          <input
                            name="seconds"
                            type="number"
                            step={1 / 30}
                            min={0}
                            value={draft.seconds}
                            onChange={(event) => {
                              const seconds = event.target.value;
                              setActionDrafts((current) => ({
                                ...current,
                                [key]: { ...draft, seconds },
                              }));
                              markDraft(`action-${index}`);
                            }}
                            disabled={locked}
                          />
                        </label>
                        <button disabled={locked}>应用</button>
                      </form>
                    );
                  })}
                </div>
              </section>
              <section className="bc-card">
                <h2>音乐与音效</h2>
                <label>
                  替换 BGM（PCM WAV）
                  <input
                    aria-label="BC 背景音乐"
                    type="file"
                    accept="audio/wav,.wav"
                    disabled={locked}
                    onChange={choose((file) => void uploadBgm(file))}
                  />
                </label>
                <label>
                  音乐增益
                  <input
                    aria-label="BC 音乐增益"
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={bcProduction(project).audio?.bgm?.gain ?? 1}
                    disabled={locked || !bcProduction(project).audio?.bgm}
                    onChange={(event) => {
                      const gain = Number(event.target.value);
                      void run((base) =>
                        editBCProject(base, (draft) => {
                          const p = bcProduction(draft);
                          if (p.audio?.bgm) p.audio.bgm.gain = gain;
                          setBCProduction(draft, p);
                        }),
                      );
                    }}
                  />
                </label>
                <small>
                  沿用原工程的音效、音乐起点、源内偏移和循环设置。连续预览与导出使用同一份混音。
                </small>
              </section>
              <details className="bc-card">
                <summary>棋盘与轨迹高级编辑</summary>
                <p>修改后会重新计算状态哈希并检查所有 Take；失败时保留原工程。</p>
                <label>
                  初始棋盘（# 为方块，. 为空）
                  <textarea
                    aria-label="BC 初始棋盘"
                    spellCheck={false}
                    value={board}
                    onChange={(event) => {
                      setBoard(event.target.value);
                      markDraft('board');
                    }}
                    disabled={locked}
                  />
                </label>
                <button
                  disabled={locked}
                  onClick={() =>
                    void run((base) => changeBCBoard(base, board.trim().split(/\r?\n/)), 'board')
                  }
                >
                  应用棋盘
                </button>
                <label>
                  参考方块轨迹
                  <textarea
                    aria-label="BC 方块轨迹"
                    spellCheck={false}
                    value={tracks}
                    onChange={(event) => {
                      setTracks(event.target.value);
                      markDraft('tracks');
                    }}
                    disabled={locked}
                  />
                </label>
                <button
                  disabled={locked}
                  onClick={() =>
                    void run(
                      (base) =>
                        refreshBCClips(
                          editBCProject(base, (draft) => {
                            bcCalibration(draft).pieceTracks = JSON.parse(tracks);
                          }),
                        ),
                      'tracks',
                    )
                  }
                >
                  应用轨迹
                </button>
              </details>
            </aside>
          </div>
        )}
        <details className="bc-card bc-attachments" open={!!error && !!pendingFile.current}>
          <summary>工程引用外部素材时，选择本地目录</summary>
          <p>只读取你选择的目录，按路径与哈希载入图片、序列和 WAV；保存时内嵌，不修改原素材。</p>
          {(['project', 'cas', 'library'] as const).map((kind, i) => (
            <label key={kind}>
              {['工程目录', 'CAS 素材库', '元素库缓存'][i]}
              <input
                type="file"
                multiple
                {...({ webkitdirectory: '' } as Record<string, string>)}
                disabled={locked}
                onChange={(event) => {
                  setSources((current) => ({
                    ...current,
                    [kind]: Array.from(event.target.files ?? []),
                  }));
                }}
              />
            </label>
          ))}
          {pendingFile.current && (
            <button disabled={locked} onClick={() => void open(pendingFile.current!)}>
              用所选目录重新打开
            </button>
          )}
        </details>
      </main>
    </div>
  );
}
