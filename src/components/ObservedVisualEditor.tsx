import { useState } from 'react';
import type { BBWorkPackage } from '../contracts/bbWorkPackage';
import {
  OBSERVED_THEMES,
  OBSERVED_CLEAR_STYLES,
  observedVisualTracks,
  setObservedWorkVisual,
  type ObservedVisualChange,
} from '../contracts/setObservedWorkVisual';

export function ObservedVisualEditor({
  work,
  selected,
  onChange,
}: {
  work: BBWorkPackage;
  selected: string;
  onChange: (work: BBWorkPackage) => void;
}) {
  const [scope, setScope] = useState<'selected' | 'all'>('selected'),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  const tracks = observedVisualTracks(work.project),
    current = tracks.find((track) => track.takeId === selected);
  if (!tracks.length) return null;
  async function apply(change: ObservedVisualChange) {
    setBusy(true);
    try {
      const next = await setObservedWorkVisual(work, scope === 'all' ? 'all' : selected, change);
      onChange(next);
      setStatus('外观已应用到当前作品；动作、时间、图片和混音保持不变。保存作品即可保留变体。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  const clearStyles = new Set(
    current?.calibration.actions.map((action) => action.clearStyle ?? 'spectrum'),
  );
  const clear = clearStyles.size === 1 ? [...clearStyles][0] : '';
  return (
    <details>
      <summary>复刻作品的外观与消除变体</summary>
      <p>
        直接修改当前作品，支持单 Take 或多
        Take。主题改变程序背景、棋盘和反馈；已绑定图片保留原像素。清除效果沿用工程事件时间，特效颗粒由程序绘制。
      </p>
      <label>
        作用范围{' '}
        <select
          aria-label="复刻外观作用范围"
          value={scope}
          disabled={busy}
          onChange={(event) => setScope(event.target.value as 'selected' | 'all')}
        >
          <option value="selected">当前 Take</option>
          <option value="all">全部 Take</option>
        </select>
      </label>{' '}
      <label>
        程序主题{' '}
        <select
          aria-label="复刻程序主题"
          value={current?.calibration.theme ?? ''}
          disabled={busy || !current}
          onChange={(event) =>
            void apply({ theme: event.target.value as (typeof OBSERVED_THEMES)[number] })
          }
        >
          {OBSERVED_THEMES.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>{' '}
      <label>
        消除效果{' '}
        <select
          aria-label="复刻消除效果"
          value={clear ?? ''}
          disabled={busy || !current}
          onChange={(event) =>
            void apply({ clearStyle: event.target.value as (typeof OBSERVED_CLEAR_STYLES)[number] })
          }
        >
          <option value="" disabled>
            按动作分别配置
          </option>
          {clear &&
            !OBSERVED_CLEAR_STYLES.includes(clear as (typeof OBSERVED_CLEAR_STYLES)[number]) && (
              <option value={clear}>{clear}（现有）</option>
            )}
          {OBSERVED_CLEAR_STYLES.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      {status && <p role="status">{status}</p>}
    </details>
  );
}
