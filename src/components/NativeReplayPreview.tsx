import { useState } from 'react';
import type { NativeRuntimeAudit } from '../contracts/inspectNativeRuntime';

const colors: Record<string, string> = {
  coral: '#ef7771',
  amber: '#edbd55',
  lime: '#a9d36a',
  cyan: '#6ccbd3',
  blue: '#749fe0',
  violet: '#aa8bd9',
  rose: '#ee9ac3',
};

/** A semantic board viewer, deliberately distinct from native styled frame rendering. */
export function NativeReplayPreview({ audit }: { audit: NativeRuntimeAudit }) {
  const valid = audit.takes.filter((take) => take.legal && take.actions > 0);
  const [selected, setSelected] = useState(0);
  const [step, setStep] = useState(0);
  const take = valid[selected];
  const frame = take?.frames[step];
  if (!take || !frame) return null;
  return (
    <section className="native-preview">
      <h2>语义棋盘预览</h2>
      <p>
        显示参考规则计算的每步结果；方格颜色为程序占位，不包含原生布局、指针、动画、音频或素材。
      </p>
      <label>
        Take{' '}
        <select
          aria-label="V2 预览 Take"
          value={selected}
          onChange={(event) => {
            setSelected(Number(event.target.value));
            setStep(0);
          }}
        >
          {valid.map((item, index) => (
            <option key={item.takeId} value={index}>
              {item.takeId}
            </option>
          ))}
        </select>
      </label>
      <div
        className="native-preview-board"
        role="img"
        aria-label={`第 ${step} 步棋盘，得分 ${frame.score}，Combo ${frame.combo}`}
        style={{ gridTemplateColumns: `repeat(${frame.cells[0]?.length ?? 8}, 1fr)` }}
      >
        {frame.cells.flatMap((row, r) =>
          row.map((cell, c) => (
            <span key={`${r}-${c}`} style={{ backgroundColor: cell ? colors[cell] : '#242c42' }} />
          )),
        )}
      </div>
      <p>
        第 {step} / {take.actions} 步 · 得分 {frame.score} · Combo {frame.combo}
      </p>
      <button className="button-secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
        上一步
      </button>{' '}
      <button
        className="button-secondary"
        disabled={step === take.actions}
        onClick={() => setStep(step + 1)}
      >
        下一步
      </button>
    </section>
  );
}
