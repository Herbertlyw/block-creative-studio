import { useEffect, useState } from 'react';
import type { BBWorkPackage } from '../contracts/bbWorkPackage';
import {
  DEFAULT_BB_TEST_AUDIO,
  readBBTestAudio,
  setBBTestAudio,
  type BBTestAudio,
  type BBTestCueKind,
} from '../contracts/bbSyntheticAudio';

const kinds: Array<{ id: BBTestCueKind; label: string }> = [
  { id: 'place', label: '落位' },
  { id: 'line-cleared', label: '单向／观察消除' },
  { id: 'cross-cleared', label: '交叉消除' },
  { id: 'praise', label: '评价' },
  { id: 'game-over', label: '结束' },
];
export function BBSyntheticAudioEditor({
  work,
  onChange,
}: {
  work: BBWorkPackage;
  onChange: (next: BBWorkPackage) => void;
}) {
  const existing = readBBTestAudio(work.project),
    snapshot = JSON.stringify(existing);
  const [draft, setDraft] = useState<BBTestAudio>(() =>
    structuredClone(existing ?? DEFAULT_BB_TEST_AUDIO),
  );
  const [kind, setKind] = useState<BBTestCueKind>('place'),
    [eventId, setEventId] = useState(''),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  useEffect(() => {
    setDraft(structuredClone(existing ?? DEFAULT_BB_TEST_AUDIO));
  }, [snapshot]);
  const change = (patch: Partial<BBTestAudio>) => setDraft((old) => ({ ...old, ...patch }));
  const cue = (
    cueKind: BBTestCueKind,
    id: string | undefined,
    patch: Partial<{ gain: number; offsetSeconds: number }>,
  ) =>
    setDraft((old) => {
      const index = old.cueOverrides.findIndex(
          (item) => item.kind === cueKind && item.eventId === id,
        ),
        list = [...old.cueOverrides];
      const prior =
        index < 0
          ? { kind: cueKind, ...(id ? { eventId: id } : {}), gain: 1, offsetSeconds: 0 }
          : list[index]!;
      if (index < 0) list.push({ ...prior, ...patch });
      else list[index] = { ...prior, ...patch };
      return { ...old, cueOverrides: list };
    });
  async function save(value: BBTestAudio | null) {
    setBusy(true);
    try {
      const result = await setBBTestAudio(work, value);
      onChange(result);
      setStatus('测试音设置已更新；请保存作品。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>合成测试音乐与音效</summary>
      <p>
        这是程序生成的测试声音，与工程 WAV
        分开；预览或导出须明确选择测试音。观察作品的消除体感音使用“单向／观察消除”设置，交叉类型按普通作品的明确语义事件处理。
      </p>
      {(
        [
          ['sfxGain', '音效总增益', 0, 1, 0.05],
          ['bgmGain', '音乐增益', 0, 1, 0.05],
          ['bgmStartSeconds', '音乐视频起点', 0, 3600, 0.1],
          ['bgmSourceOffsetSeconds', '音乐源内偏移', 0, 3600, 0.1],
        ] as const
      ).map(([field, label, min, max, step]) => (
        <label key={field}>
          {label}{' '}
          <input
            aria-label={`测试音${label}`}
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft[field]}
            disabled={busy}
            onChange={(e) => change({ [field]: e.target.valueAsNumber })}
          />
        </label>
      ))}
      <label>
        音乐{' '}
        <select
          aria-label="测试音音乐类型"
          value={draft.bgmPattern}
          disabled={busy}
          onChange={(e) => change({ bgmPattern: e.target.value as BBTestAudio['bgmPattern'] })}
        >
          <option value="tone">单音</option>
          <option value="melody-v1">测试旋律</option>
        </select>
      </label>
      <label>
        <input
          aria-label="测试音音乐循环"
          type="checkbox"
          checked={draft.bgmLoop}
          disabled={busy}
          onChange={(e) => change({ bgmLoop: e.target.checked })}
        />
        循环
      </label>
      {kinds.map((item) => {
        const current = draft.cueOverrides.find(
          (entry) => entry.kind === item.id && !entry.eventId,
        );
        return (
          <div key={item.id}>
            <span>{item.label}</span>
            <label>
              增益{' '}
              <input
                aria-label={`测试音${item.label}增益`}
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={current?.gain ?? 1}
                disabled={busy}
                onChange={(e) => cue(item.id, undefined, { gain: e.target.valueAsNumber })}
              />
            </label>
            <label>
              偏移秒{' '}
              <input
                aria-label={`测试音${item.label}偏移`}
                type="number"
                min={-60}
                max={60}
                step={0.01}
                value={current?.offsetSeconds ?? 0}
                disabled={busy}
                onChange={(e) => cue(item.id, undefined, { offsetSeconds: e.target.valueAsNumber })}
              />
            </label>
          </div>
        );
      })}
      <details>
        <summary>按事件单独设置</summary>
        <label>
          事件类型{' '}
          <select
            aria-label="测试音单事件类型"
            value={kind}
            onChange={(e) => setKind(e.target.value as BBTestCueKind)}
          >
            {kinds.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          事件 ID{' '}
          <input
            aria-label="测试音单事件 ID"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          />
        </label>
        <button
          disabled={busy || !eventId.trim()}
          onClick={() => {
            cue(kind, eventId.trim(), {});
            setEventId('');
          }}
        >
          添加指定事件
        </button>
        {draft.cueOverrides
          .filter((item) => item.eventId)
          .map((item) => (
            <div key={`${item.kind}:${item.eventId}`}>
              {item.kind} · {item.eventId}
              <label>
                增益{' '}
                <input
                  aria-label={`${item.eventId} 测试音增益`}
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={item.gain}
                  onChange={(e) => cue(item.kind, item.eventId, { gain: e.target.valueAsNumber })}
                />
              </label>
              <label>
                偏移{' '}
                <input
                  aria-label={`${item.eventId} 测试音偏移`}
                  type="number"
                  min={-60}
                  max={60}
                  step={0.01}
                  value={item.offsetSeconds}
                  onChange={(e) =>
                    cue(item.kind, item.eventId, { offsetSeconds: e.target.valueAsNumber })
                  }
                />
              </label>
              <button
                onClick={() =>
                  setDraft((old) => ({
                    ...old,
                    cueOverrides: old.cueOverrides.filter(
                      (value) => value.kind !== item.kind || value.eventId !== item.eventId,
                    ),
                  }))
                }
              >
                删除此事件设置
              </button>
            </div>
          ))}
      </details>
      <button disabled={busy} onClick={() => void save(draft)}>
        核验并保存测试音设置
      </button>{' '}
      <button disabled={busy || !existing} onClick={() => void save(null)}>
        移除测试音设置
      </button>
      {status && <p role="status">{status}</p>}
    </details>
  );
}
