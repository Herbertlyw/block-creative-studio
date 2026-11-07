import { useEffect, useMemo, useRef, useState } from 'react';
import { downloadBlob } from '../utils/download';
import {
  calibrationScore,
  compareCalibrationFrames,
  type CalibrationMetrics,
} from './calibrationMetrics';
import { REFERENCE_CANVAS, REFERENCE_LAYOUT } from './referenceProfile';

export type ReferenceCalibrationMode = 'overlay' | 'difference' | 'split';

interface LoadedReference {
  name: string;
  url: string;
  image: HTMLImageElement;
  width: number;
  height: number;
}

interface ReferenceCalibrationOverlayProps {
  frameLabel: string;
  captureCurrentFrame(): HTMLCanvasElement | null;
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}%`;
}

function loadImage(file: File): Promise<LoadedReference> {
  return new Promise<LoadedReference>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve({
      name: file.name,
      url,
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('参考帧图片无法解码。'));
    };
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('当前帧 PNG 编码失败。'));
    }, 'image/png');
  });
}

function referenceAspectMatches(reference: LoadedReference): boolean {
  const expected = REFERENCE_CANVAS.width / REFERENCE_CANVAS.height;
  const actual = reference.width / Math.max(1, reference.height);
  return Math.abs(expected - actual) / expected <= 0.005;
}

export function ReferenceCalibrationOverlay({
  frameLabel,
  captureCurrentFrame,
}: ReferenceCalibrationOverlayProps) {
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState<LoadedReference | null>(null);
  const [mode, setMode] = useState<ReferenceCalibrationMode>('overlay');
  const [opacity, setOpacity] = useState(0.5);
  const [split, setSplit] = useState(0.5);
  const [guides, setGuides] = useState(true);
  const [metrics, setMetrics] = useState<CalibrationMetrics | null>(null);
  const [differenceUrl, setDifferenceUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const referenceRef = useRef<LoadedReference | null>(null);

  useEffect(() => {
    referenceRef.current = reference;
  }, [reference]);

  useEffect(() => () => {
    const current = referenceRef.current;
    if (current) URL.revokeObjectURL(current.url);
  }, []);

  const aspectMatches = reference ? referenceAspectMatches(reference) : true;
  const score = metrics ? calibrationScore(metrics) : null;
  const overlaySource = mode === 'difference' && differenceUrl
    ? differenceUrl
    : reference?.url ?? null;
  const overlayStyle = useMemo(() => {
    if (mode === 'split') {
      return {
        opacity: 1,
        clipPath: `inset(0 ${(1 - split) * 100}% 0 0)`,
        mixBlendMode: 'normal' as const,
      };
    }
    if (mode === 'difference' && !differenceUrl) {
      return {
        opacity: 1,
        clipPath: 'none',
        mixBlendMode: 'difference' as const,
      };
    }
    return {
      opacity: mode === 'difference' ? 0.94 : opacity,
      clipPath: 'none',
      mixBlendMode: 'normal' as const,
    };
  }, [differenceUrl, mode, opacity, split]);

  const clearReference = (): void => {
    if (reference) URL.revokeObjectURL(reference.url);
    setReference(null);
    setMetrics(null);
    setDifferenceUrl(null);
    setError(null);
  };

  const importReference = async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const loaded = await loadImage(file);
      if (reference) URL.revokeObjectURL(reference.url);
      setReference(loaded);
      setMetrics(null);
      setDifferenceUrl(null);
      setMode('overlay');
      setOpen(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const compare = async (): Promise<void> => {
    if (!reference) {
      setError('请先导入一个 Golden Reference 帧。');
      return;
    }
    if (!referenceAspectMatches(reference)) {
      setError(
        `参考图片为 ${reference.width}×${reference.height}，应与 ${REFERENCE_CANVAS.width}×${REFERENCE_CANVAS.height} 保持相同比例。`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const candidateCanvas = captureCurrentFrame();
      if (!candidateCanvas) {
        throw new Error('当前 Reference 2D 场景尚未准备好。');
      }
      const referenceCanvas = document.createElement('canvas');
      referenceCanvas.width = REFERENCE_CANVAS.width;
      referenceCanvas.height = REFERENCE_CANVAS.height;
      const referenceContext = referenceCanvas.getContext('2d', { willReadFrequently: true });
      const candidateContext = candidateCanvas.getContext('2d', { willReadFrequently: true });
      if (!referenceContext || !candidateContext) {
        throw new Error('无法读取参考帧或当前帧像素。');
      }
      referenceContext.drawImage(
        reference.image,
        0,
        0,
        REFERENCE_CANVAS.width,
        REFERENCE_CANVAS.height,
      );
      const comparison = compareCalibrationFrames(
        referenceContext.getImageData(0, 0, REFERENCE_CANVAS.width, REFERENCE_CANVAS.height),
        candidateContext.getImageData(0, 0, REFERENCE_CANVAS.width, REFERENCE_CANVAS.height),
      );
      const differenceCanvas = document.createElement('canvas');
      differenceCanvas.width = REFERENCE_CANVAS.width;
      differenceCanvas.height = REFERENCE_CANVAS.height;
      const differenceContext = differenceCanvas.getContext('2d');
      if (!differenceContext) throw new Error('无法创建差异热图。');
      differenceContext.putImageData(
        new ImageData(
          comparison.difference.data,
          comparison.difference.width,
          comparison.difference.height,
        ),
        0,
        0,
      );
      setMetrics(comparison.metrics);
      setDifferenceUrl(differenceCanvas.toDataURL('image/png'));
      setMode('difference');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const exportCurrentFrame = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const canvas = captureCurrentFrame();
      if (!canvas) {
        throw new Error('当前 Reference 2D 场景尚未准备好。');
      }
      downloadBlob(
        await canvasBlob(canvas),
        `reference-2d-${frameLabel.replace(/[^0-9A-Za-z_-]+/gu, '-')}.png`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`reference-calibration ${open ? 'is-open' : ''}`}>
      {overlaySource && (
        <img
          className={`reference-calibration-image is-${mode}`}
          src={overlaySource}
          alt="本地 Golden Reference 校准层"
          style={overlayStyle}
          draggable={false}
        />
      )}

      {guides && open && (
        <svg
          className="reference-calibration-guides"
          viewBox={`0 0 ${REFERENCE_CANVAS.width} ${REFERENCE_CANVAS.height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          <rect
            x={REFERENCE_LAYOUT.board.outer.x}
            y={REFERENCE_LAYOUT.board.outer.y}
            width={REFERENCE_LAYOUT.board.outer.size}
            height={REFERENCE_LAYOUT.board.outer.size}
            rx={REFERENCE_LAYOUT.board.outer.radius}
          />
          <rect
            x={REFERENCE_LAYOUT.board.grid.x}
            y={REFERENCE_LAYOUT.board.grid.y}
            width={REFERENCE_LAYOUT.board.grid.pitch * 8 - REFERENCE_LAYOUT.board.grid.gap}
            height={REFERENCE_LAYOUT.board.grid.pitch * 8 - REFERENCE_LAYOUT.board.grid.gap}
          />
          <line x1="0" y1={REFERENCE_LAYOUT.rack.centerY} x2={REFERENCE_CANVAS.width} y2={REFERENCE_LAYOUT.rack.centerY} />
          {REFERENCE_LAYOUT.rack.centersX.map((x) => (
            <circle key={x} cx={x} cy={REFERENCE_LAYOUT.rack.centerY} r="18" />
          ))}
          <circle cx={REFERENCE_LAYOUT.hud.scoreCenter.x} cy={REFERENCE_LAYOUT.hud.scoreCenter.y} r="22" />
        </svg>
      )}

      {!open ? (
        <button
          type="button"
          className="reference-calibration-toggle"
          onClick={() => setOpen(true)}
        >
          2D 校准
        </button>
      ) : (
        <div className="reference-calibration-panel">
          <div className="reference-calibration-heading">
            <div>
              <strong>Golden Diff</strong>
              <span>{REFERENCE_CANVAS.width}×{REFERENCE_CANVAS.height} · {frameLabel}</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="关闭校准面板">×</button>
          </div>

          <div className="reference-calibration-actions">
            <label className="reference-calibration-file">
              {busy ? '处理中…' : reference ? '更换参考帧' : '导入参考帧'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void importReference(file);
                }}
              />
            </label>
            <button type="button" disabled={busy} onClick={() => void exportCurrentFrame()}>
              导出当前帧
            </button>
            <button type="button" disabled={busy || !reference} onClick={() => void compare()}>
              计算差异
            </button>
          </div>

          {reference && (
            <div className="reference-calibration-reference">
              <span title={reference.name}>{reference.name}</span>
              <small className={aspectMatches ? '' : 'is-warning'}>
                {reference.width}×{reference.height}{aspectMatches ? ' · 比例正确' : ' · 比例不匹配'}
              </small>
              <button type="button" onClick={clearReference}>清除</button>
            </div>
          )}

          <div className="reference-calibration-modes">
            {(['overlay', 'difference', 'split'] as ReferenceCalibrationMode[]).map((item) => (
              <button
                key={item}
                type="button"
                className={mode === item ? 'is-active' : ''}
                disabled={!reference}
                onClick={() => setMode(item)}
              >
                {item === 'overlay' ? '叠加' : item === 'difference' ? '差异' : '分屏'}
              </button>
            ))}
            <label>
              <input type="checkbox" checked={guides} onChange={(event) => setGuides(event.target.checked)} />
              对齐线
            </label>
          </div>

          {mode === 'overlay' && reference && (
            <label className="reference-calibration-range">
              <span>参考透明度</span>
              <output>{Math.round(opacity * 100)}%</output>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={opacity}
                onChange={(event) => setOpacity(Number(event.target.value))}
              />
            </label>
          )}
          {mode === 'split' && reference && (
            <label className="reference-calibration-range">
              <span>参考分割线</span>
              <output>{Math.round(split * 100)}%</output>
              <input
                type="range"
                min="0.05"
                max="0.95"
                step="0.01"
                value={split}
                onChange={(event) => setSplit(Number(event.target.value))}
              />
            </label>
          )}

          {metrics && score !== null && (
            <div className="reference-calibration-metrics">
              <div><span>诊断分</span><strong>{score.toFixed(1)}</strong></div>
              <div><span>平均色差</span><strong>{percentage(metrics.meanAbsoluteError)}</strong></div>
              <div><span>变化像素</span><strong>{percentage(metrics.changedPixelRatio)}</strong></div>
              <div><span>边缘错位</span><strong>{percentage(metrics.edgeMismatchRatio)}</strong></div>
            </div>
          )}

          {error && <p className="reference-calibration-error">{error}</p>}
          <p className="reference-calibration-note">
            该分数用于定位布局、色彩和边缘偏差；随机花瓣、粒子和压缩噪声不应单独决定通过与否。
          </p>
        </div>
      )}
    </div>
  );
}
