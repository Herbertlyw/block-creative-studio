import { useEffect, useRef, useState } from 'react';
import {
  parseProductionDirection,
  type ProductionAudio,
} from '../nativeReference/agent-director/contracts';
import {
  productionBgm,
  productionDefaultCues,
  productionSoundLibrary,
  validateProductionAudioAsset,
  validateProductionAudioReferences,
  validateProductionVoiceTakes,
  verifyProductionAudioAssets,
} from '../nativeReference/agent-director/audioMix';
import { createWavAsset } from '../contracts/audioAsset';

const emptyAudio = (): ProductionAudio => ({ sfxEnabled: false, cues: [], assets: {} });
const numberValue = (value: number | undefined, fallback = 0) =>
  value === undefined ? fallback : Number.isFinite(value) ? value : '';

/** One controlled draft for both games; apply validates bytes before changing the project. */
export function ProductionAudioEditor({
  audio,
  game,
  takeIds,
  disabled,
  revision,
  onApply,
  onDraftChange,
}: {
  audio: ProductionAudio | undefined;
  game: 'block-placement' | 'block-crush-drop';
  takeIds: string[];
  disabled: boolean;
  revision: unknown;
  onApply: (audio: ProductionAudio) => Promise<void>;
  onDraftChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<ProductionAudio>(() => structuredClone(audio ?? emptyAudio()));
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const generation = useRef(0);
  const fingerprint = JSON.stringify(audio ?? emptyAudio());
  const dirty = JSON.stringify(draft) !== fingerprint;
  useEffect(() => {
    generation.current++;
    setDraft(structuredClone(audio ?? emptyAudio()));
    setError('');
    setWorking(false);
  }, [fingerprint, revision]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    onDraftChange(dirty);
  }, [dirty, onDraftChange]);
  useEffect(() => () => onDraftChange(false), [onDraftChange]);
  const locked = disabled || working;
  function change(edit: (next: ProductionAudio) => void) {
    setDraft((current) => {
      const next = structuredClone(current);
      edit(next);
      return next;
    });
    setError('');
  }
  const cues = draft.cues ?? productionDefaultCues(draft.selectedPackId);
  const bgm = productionBgm(draft);
  const choices = [
    ...Object.values(draft.assets ?? {}).map((asset) => ({ id: asset.id, name: asset.sourceName })),
    ...productionSoundLibrary(),
  ];
  const selectAsset = (label: string, value: string, update: (id: string) => void) => (
    <select aria-label={label} value={value} onChange={(e) => update(e.target.value)}>
      <option value="">选择素材</option>
      {choices.map((asset) => (
        <option key={asset.id} value={asset.id}>
          {asset.name} · {asset.id}
        </option>
      ))}
    </select>
  );
  const numeric = (
    label: string,
    value: number | undefined,
    fallback: number,
    update: (value: number) => void,
    min = 0,
    max = 3600,
  ) => (
    <label>
      {label}{' '}
      <input
        aria-label={label}
        type="number"
        step="any"
        min={min}
        max={max}
        value={numberValue(value, fallback)}
        onChange={(e) => update(e.target.valueAsNumber)}
      />
    </label>
  );
  const updateBgm = (patch: Partial<NonNullable<ProductionAudio['bgm']>>) =>
    change((next) => {
      const current = productionBgm(next);
      next.bgm = { assetId: '', ...current, ...patch };
    });
  const updateCue = (index: number, patch: Partial<NonNullable<ProductionAudio['cues']>[number]>) =>
    change((next) => {
      next.cues = next.cues ?? productionDefaultCues(next.selectedPackId);
      Object.assign(next.cues[index]!, patch);
    });
  async function importWav(file: File) {
    const ticket = ++generation.current;
    setWorking(true);
    try {
      if (!file.size || file.size > 16 * 1024 * 1024) throw new Error('WAV 为空或超过 16 MiB。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const asset = await createWavAsset(bytes, 'pending', file.name);
      if (ticket !== generation.current) return;
      asset.id = `audio-${asset.sha256}`;
      change((next) => {
        next.assets = { ...next.assets, [asset.id]: asset };
      });
    } catch (reason) {
      if (ticket === generation.current)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (ticket === generation.current) setWorking(false);
    }
  }
  async function apply() {
    const ticket = ++generation.current;
    setWorking(true);
    setError('');
    try {
      const parsed = parseProductionDirection({ version: '1.0.0', audio: draft }).audio!;
      validateProductionAudioReferences(parsed);
      validateProductionVoiceTakes(parsed, takeIds);
      await verifyProductionAudioAssets(parsed);
      for (const asset of Object.values(parsed.assets ?? {})) validateProductionAudioAsset(asset);
      if (ticket !== generation.current) return;
      await onApply(parsed);
    } catch (reason) {
      if (ticket === generation.current)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (ticket === generation.current) setWorking(false);
    }
  }
  const events =
    game === 'block-placement'
      ? {
          placement: ['block-placement.placement-committed'],
          clear: [
            'block-placement.line-cleared',
            'block-placement.cross-cleared',
            'block-placement.reference-clear-body',
            'block-placement.reference-clear-heavy',
          ],
        }
      : {
          placement: ['block-crush-drop.piece-committed'],
          clear: ['block-crush-drop.blocks-eliminated'],
        };
  return (
    <details className="audio-mix-editor">
      <summary>分轨混音与人声</summary>
      <p>
        预览和导出共用此混音。WAV
        可能包含预混音乐与固定音效；替换这种素材会同时替换其中全部声音，无法自动拆轨。人声按指定
        Take 的秒数播放，与游戏事件音效独立。
      </p>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={locked}>
        <legend>声音素材与总线</legend>
        <label>
          导入声音 WAV{' '}
          <input
            aria-label="混音导入 WAV"
            type="file"
            accept=".wav,audio/wav,audio/x-wav"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (file) void importWav(file);
            }}
          />
        </label>
        <p>仅导入素材不会自动绑定或添加声音；支持单/双声道 PCM16 或 float32 WAV，最多 16 MiB。</p>
        {numeric(
          '混音总增益',
          draft.masterGain,
          1,
          (value) =>
            change((next) => {
              next.masterGain = value;
            }),
          0,
          2,
        )}{' '}
        {numeric(
          '混音音效总增益',
          draft.sfxGain,
          1,
          (value) =>
            change((next) => {
              next.sfxGain = value;
            }),
          0,
          2,
        )}{' '}
        <label>
          <input
            aria-label="混音启用事件音效"
            type="checkbox"
            checked={draft.sfxEnabled !== false}
            onChange={(e) =>
              change((next) => {
                next.sfxEnabled = e.target.checked;
              })
            }
          />
          启用事件音效（不控制人声）
        </label>
      </fieldset>
      <fieldset disabled={locked}>
        <legend>BGM</legend>
        {selectAsset('混音 BGM 素材', bgm?.assetId ?? '', (id) => updateBgm({ assetId: id }))}{' '}
        {bgm && (
          <>
            <label>
              <input
                aria-label="混音 BGM 启用"
                type="checkbox"
                checked={bgm.enabled !== false}
                onChange={(e) => updateBgm({ enabled: e.target.checked })}
              />
              启用
            </label>{' '}
            {numeric('混音 BGM 增益', bgm.gain, 0.2, (value) => updateBgm({ gain: value }), 0, 2)}{' '}
            {numeric('混音 BGM 开始秒', bgm.startSeconds, 0, (value) =>
              updateBgm({ startSeconds: value }),
            )}{' '}
            {numeric('混音 BGM 源内偏移秒', bgm.sourceOffsetSeconds, 0, (value) =>
              updateBgm({ sourceOffsetSeconds: value }),
            )}{' '}
            {numeric(
              '混音 BGM 淡入秒',
              bgm.fadeInSeconds,
              0.15,
              (value) => updateBgm({ fadeInSeconds: value }),
              0,
              30,
            )}{' '}
            {numeric(
              '混音 BGM 淡出秒',
              bgm.fadeOutSeconds,
              0.3,
              (value) => updateBgm({ fadeOutSeconds: value }),
              0,
              30,
            )}{' '}
            <label>
              <input
                aria-label="混音 BGM 循环"
                type="checkbox"
                checked={bgm.loop ?? true}
                onChange={(e) => updateBgm({ loop: e.target.checked })}
              />
              循环
            </label>
          </>
        )}
      </fieldset>
      <fieldset disabled={locked}>
        <legend>落位、消除与其他事件 cue</legend>
        <p>
          按各自游戏的实际语义事件触发；没有命中的事件会在混音时提示。事件偏移范围 −2 至 10 秒；事件
          cue 合同不支持源偏移、循环或淡入淡出。
        </p>
        {cues.map((cue, index) => (
          <div key={index}>
            <strong>
              {index + 1}. {cue.eventType}
              {cue.eventId ? ` · ${cue.eventId}` : ''}
            </strong>{' '}
            {selectAsset(`音效 ${index + 1} 素材`, cue.assetId, (id) =>
              updateCue(index, { assetId: id }),
            )}{' '}
            {numeric(
              `音效 ${index + 1} 增益`,
              cue.gain,
              1,
              (value) => updateCue(index, { gain: value }),
              0,
              2,
            )}{' '}
            {numeric(
              `音效 ${index + 1} 偏移秒`,
              cue.offsetSeconds,
              0,
              (value) => updateCue(index, { offsetSeconds: value }),
              -2,
              10,
            )}
          </div>
        ))}
        {(['placement', 'clear'] as const).map((role) => (
          <button
            key={role}
            type="button"
            onClick={() =>
              change((next) => {
                next.cues = next.cues ?? productionDefaultCues(next.selectedPackId);
                const existing = new Set(next.cues.map((cue) => cue.eventType));
                for (const eventType of events[role])
                  if (!existing.has(eventType))
                    next.cues.push({ eventType, assetId: '', gain: 0.5, offsetSeconds: 0 });
                next.sfxEnabled = true;
              })
            }
          >
            添加{role === 'placement' ? '落位' : '消除'}绑定
          </button>
        ))}
      </fieldset>
      <fieldset disabled={locked}>
        <legend>人声时间 cue</legend>
        {(draft.voices ?? []).map((voice, index) => {
          const update = (patch: Partial<typeof voice>) =>
            change((next) => {
              Object.assign(next.voices![index]!, patch);
            });
          return (
            <fieldset key={voice.id}>
              <legend>
                人声 {index + 1} · {voice.id}
              </legend>
              <label>
                Take{' '}
                <select
                  aria-label={`人声 ${index + 1} Take`}
                  value={voice.takeId}
                  onChange={(e) => update({ takeId: e.target.value })}
                >
                  {takeIds.map((id) => (
                    <option key={id}>{id}</option>
                  ))}
                </select>
              </label>{' '}
              {selectAsset(`人声 ${index + 1} 素材`, voice.assetId, (assetId) =>
                update({ assetId }),
              )}{' '}
              <label>
                <input
                  aria-label={`人声 ${index + 1} 启用`}
                  type="checkbox"
                  checked={voice.enabled !== false}
                  onChange={(e) => update({ enabled: e.target.checked })}
                />
                启用
              </label>{' '}
              {numeric(`人声 ${index + 1} 开始秒`, voice.startSeconds, 0, (value) =>
                update({ startSeconds: value }),
              )}{' '}
              {numeric(
                `人声 ${index + 1} 增益`,
                voice.gain,
                1,
                (value) => update({ gain: value }),
                0,
                2,
              )}{' '}
              {numeric(`人声 ${index + 1} 源内偏移秒`, voice.sourceOffsetSeconds, 0, (value) =>
                update({ sourceOffsetSeconds: value }),
              )}{' '}
              {numeric(
                `人声 ${index + 1} 淡入秒`,
                voice.fadeInSeconds,
                0,
                (value) => update({ fadeInSeconds: value }),
                0,
                30,
              )}{' '}
              {numeric(
                `人声 ${index + 1} 淡出秒`,
                voice.fadeOutSeconds,
                0,
                (value) => update({ fadeOutSeconds: value }),
                0,
                30,
              )}{' '}
              <button
                type="button"
                onClick={() =>
                  change((next) => {
                    next.voices!.splice(index, 1);
                  })
                }
              >
                删除人声 {index + 1}
              </button>
            </fieldset>
          );
        })}
        <button
          type="button"
          disabled={!takeIds.length}
          onClick={() =>
            change((next) => {
              next.voices = [
                ...(next.voices ?? []),
                {
                  id: crypto.randomUUID(),
                  takeId: takeIds[0]!,
                  assetId: '',
                  startSeconds: 0,
                  gain: 1,
                },
              ];
            })
          }
        >
          添加人声 cue
        </button>
      </fieldset>
      <fieldset disabled={locked}>
        <legend>人声期间压低</legend>
        <label>
          <input
            aria-label="启用人声压低"
            type="checkbox"
            checked={draft.ducking?.enabled ?? false}
            onChange={(e) =>
              change((next) => {
                next.ducking = {
                  bgmGain: 0.35,
                  sfxGain: 0.6,
                  eventTypes: [],
                  attackSeconds: 0.08,
                  releaseSeconds: 0.25,
                  ...next.ducking,
                  enabled: e.target.checked,
                };
              })
            }
          />
          启用人声压低（默认关闭）
        </label>
        {draft.ducking && (
          <>
            {numeric(
              '人声期间 BGM 倍率',
              draft.ducking.bgmGain,
              0.35,
              (value) =>
                change((next) => {
                  next.ducking!.bgmGain = value;
                }),
              0,
              1,
            )}{' '}
            {numeric(
              '人声期间指定音效倍率',
              draft.ducking.sfxGain,
              0.6,
              (value) =>
                change((next) => {
                  next.ducking!.sfxGain = value;
                }),
              0,
              1,
            )}{' '}
            {numeric(
              '压低起音秒',
              draft.ducking.attackSeconds,
              0.08,
              (value) =>
                change((next) => {
                  next.ducking!.attackSeconds = value;
                }),
              0,
              10,
            )}{' '}
            {numeric(
              '压低恢复秒',
              draft.ducking.releaseSeconds,
              0.25,
              (value) =>
                change((next) => {
                  next.ducking!.releaseSeconds = value;
                }),
              0,
              10,
            )}{' '}
            {[...new Set(cues.map((cue) => cue.eventType))].map((eventType) => (
              <label key={eventType}>
                <input
                  aria-label={`压低 ${eventType}`}
                  type="checkbox"
                  checked={draft.ducking!.eventTypes.includes(eventType)}
                  onChange={(e) =>
                    change((next) => {
                      next.ducking!.eventTypes = e.target.checked
                        ? [...next.ducking!.eventTypes, eventType]
                        : next.ducking!.eventTypes.filter((type) => type !== eventType);
                    })
                  }
                />
                {eventType}{' '}
              </label>
            ))}
          </>
        )}
        <p>
          倍率 1 为保持原音量，0
          为静音；压低起音在人声开始前完成，文件有效时长内保持，结束后恢复。重叠人声不叠乘；间隔不超过起音与恢复之和的人声合并压低，避免反复起伏。人声自身不被压低。
        </p>
      </fieldset>
      <button disabled={locked || !dirty} onClick={() => void apply()}>
        核验并应用混音
      </button>{' '}
      <button
        disabled={locked || !dirty}
        onClick={() => {
          setDraft(structuredClone(audio ?? emptyAudio()));
          setError('');
        }}
      >
        恢复已保存的混音
      </button>
      <p>
        {working
          ? '正在核验声音…'
          : dirty
            ? '混音草稿尚未应用；应用成功后请另存工程。'
            : '当前混音已应用；工程保存会发起下载。'}
      </p>
    </details>
  );
}
