import { useEffect, useRef, useState, type RefObject } from 'react';
import { verifyPointerAgainstObservation, type PointerOverlay } from '../contracts/observedPointer';
import { verifyObservedSourceLink } from '../contracts/observedSourceLink';
import type { BBWorkPackage } from '../contracts/bbWorkPackage';
import {
  measuredFrameSeconds,
  validateReferenceMeasurement,
  type ReferenceMeasurement,
} from '../contracts/referenceMeasurement';

/** Browser seek is deliberately presented as approximate; exact frame evidence is external. */
export function CalibratedComparison({
  document,
  pointer,
  workSource,
  frame,
  fps,
  sourceCanvas,
  actions,
  stageReady,
}: {
  document: unknown;
  pointer: PointerOverlay | null;
  workSource?: BBWorkPackage['source'];
  frame: number;
  fps: number;
  sourceCanvas: RefObject<HTMLCanvasElement | null>;
  stageReady: boolean;
  actions: Array<{ actionId: string; start: number; release: number; clear: number }>;
}) {
  const [file, setFile] = useState<File | null>(null),
    [url, setUrl] = useState(''),
    [hash, setHash] = useState(''),
    [size, setSize] = useState({ width: 0, height: 0 }),
    [measurement, setMeasurement] = useState<ReferenceMeasurement | null>(null),
    [error, setError] = useState('');
  const [sidecar, setSidecar] = useState<unknown>(workSource?.link ?? null),
    [observation, setObservation] = useState<unknown>(workSource?.observation ?? null),
    [verified, setVerified] = useState(false);
  const source = useRef<HTMLVideoElement>(null),
    output = useRef<HTMLCanvasElement>(null),
    selection = useRef(0);
  useEffect(() => {
    setVerified(false);
  }, [document, pointer]);
  useEffect(() => {
    if (!file) {
      setUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const seconds = frame / fps;
  let index = 0;
  if (measurement) {
    const timestamps = measurement.timing.timestampTicks;
    const [n, d = 1] = measurement.source.timeBase.split('/').map(Number);
    const ticks = seconds / (n! / d) + measurement.source.firstTimestamp;
    let low = 0,
      high = timestamps.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (timestamps[mid]! < ticks) low = mid + 1;
      else high = mid;
    }
    index = low;
    if (
      index > 0 &&
      Math.abs(timestamps[index - 1]! - ticks) < Math.abs(timestamps[index]! - ticks)
    )
      index--;
  }
  const sourceSeconds = measurement && verified ? measuredFrameSeconds(measurement, index) : null;
  useEffect(() => {
    if (source.current && sourceSeconds !== null) source.current.currentTime = sourceSeconds;
  }, [sourceSeconds]);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const from = sourceCanvas.current,
        to = output.current;
      if (from && to) {
        to.width = from.width;
        to.height = from.height;
        to.getContext('2d')?.drawImage(from, 0, 0);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [frame, sourceCanvas, stageReady]);
  async function choose(next: File | undefined) {
    const current = ++selection.current;
    setFile(null);
    setHash('');
    setMeasurement(null);
    setVerified(false);
    setSize({ width: 0, height: 0 });
    setError('');
    if (!next) return;
    if (next.size > 512 * 1024 * 1024) {
      setError('视频超过 512 MiB。');
      return;
    }
    try {
      const digest = await crypto.subtle.digest('SHA-256', await next.arrayBuffer());
      if (current !== selection.current) return;
      setHash(Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join(''));
      setFile(next);
    } catch (e) {
      setError(String(e));
    }
  }
  async function load(input: File | undefined) {
    if (!input) return;
    setVerified(false);
    try {
      setMeasurement(
        validateReferenceMeasurement(JSON.parse(await input.text()), hash, size.width, size.height),
      );
      setError('');
    } catch (e) {
      setMeasurement(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function jsonFile(input: File | undefined, set: (value: unknown) => void) {
    setVerified(false);
    if (!input) return;
    try {
      set(JSON.parse(await input.text()));
      setError('');
    } catch {
      set(null);
      setError('关联文件 JSON 无法解析。');
    }
  }
  async function verify() {
    setVerified(false);
    try {
      if (!measurement || !sidecar || !observation)
        throw new Error('请先选择视频、测量、观察记录和来源旁车；历史工程没有来源绑定。');
      await verifyObservedSourceLink(
        sidecar,
        document,
        observation,
        measurement,
        hash,
        size.width,
        size.height,
      );
      if (pointer) await verifyPointerAgainstObservation(document, pointer, observation);
      setVerified(true);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <details>
      <summary>参考和校准画面对照（近似预览）</summary>
      <p>
        重新选择源视频与同源 CFR 测量，按输出帧时刻寻找最近的源帧。播放器 seek
        可能落在其他帧；精确比较须用独立解码提帧。须核验工程、来源旁车、视频、测量及观察记录；历史工程没有旁车时显示未绑定来源，不能生成来源对照。
      </p>
      <label>
        对照视频{' '}
        <input
          type="file"
          accept="video/*"
          aria-label="对照源视频"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
      </label>
      {file && (
        <>
          <p>
            SHA-256：{hash}，尺寸 {size.width}×{size.height}
          </p>
          {!workSource && (
            <label>
              源帧测量{' '}
              <input
                type="file"
                accept="application/json,.json"
                aria-label="对照源帧测量"
                disabled={!size.width}
                onChange={(e) => void load(e.target.files?.[0])}
              />
            </label>
          )}
        </>
      )}
      <p>
        {!workSource && (
          <>
            <label>
              观察记录{' '}
              <input
                type="file"
                accept="application/json,.json"
                aria-label="对照观察记录"
                onChange={(e) => void jsonFile(e.target.files?.[0], setObservation)}
              />
            </label>{' '}
            <label>
              来源旁车{' '}
              <input
                type="file"
                accept="application/json,.json"
                aria-label="对照来源旁车"
                onChange={(e) => void jsonFile(e.target.files?.[0], setSidecar)}
              />
            </label>
          </>
        )}{' '}
        <button onClick={() => void verify()}>核验来源关联</button>
        {verified
          ? workSource?.provenance
            ? ' 已核验动作与来源记录；这是派生作品，素材可能不同，声明的父作品身份未单独核验'
            : ' 已核验来源玩法与轨道；素材未作来源逐项对照'
          : ' 未绑定来源'}
      </p>
      {error && <p role="alert">{error}</p>}
      <div style={{ display: 'flex', alignItems: 'start', gap: 8 }}>
        {url && (
          <video
            ref={source}
            src={url}
            muted
            playsInline
            style={{ width: '48%', display: verified ? 'block' : 'none' }}
            onLoadedMetadata={(e) => {
              const width = e.currentTarget.videoWidth,
                height = e.currentTarget.videoHeight;
              setSize({ width, height });
              if (workSource) {
                try {
                  setMeasurement(
                    validateReferenceMeasurement(
                      (workSource.observation as any)?.measurement,
                      hash,
                      width,
                      height,
                    ),
                  );
                  setError('');
                } catch (err) {
                  setMeasurement(null);
                  setError(err instanceof Error ? err.message : String(err));
                }
              }
            }}
          />
        )}
        <canvas ref={output} aria-label="对照输出画面" style={{ width: '48%' }} />
      </div>
      {measurement && verified && (
        <p>
          输出帧 {frame}：{seconds.toFixed(6)} 秒；最近源帧 {index}：{sourceSeconds!.toFixed(6)}{' '}
          秒；时间差 {((sourceSeconds! - seconds) * 1000).toFixed(3)} 毫秒。源时间基{' '}
          {measurement.source.timeBase}，帧率 {measurement.source.fps}，首时间戳{' '}
          {measurement.source.firstTimestamp}。
        </p>
      )}
      {actions.length > 0 && (
        <ul>
          {actions.map((a) => (
            <li key={a.actionId}>
              动作 {a.actionId}：
              {(['start', 'release', 'clear'] as const)
                .map((k) => {
                  const f = Math.ceil(a[k] * fps - 1e-7);
                  return `${k} ${a[k].toFixed(3)} 秒 → 输出第 ${f} 帧（${((f / fps - a[k]) * 1000).toFixed(2)} 毫秒）`;
                })
                .join('；')}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
