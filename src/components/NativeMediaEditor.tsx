import { useEffect, useState } from 'react';
import type { BBWorkPackage } from '../contracts/bbWorkPackage';
type RunOperation = (
  operation: () => Promise<BBWorkPackage>,
  next?: string,
  applied?: () => void,
) => Promise<void>;
/** Verify selected images and WAVs before attaching them to the current work. */
export function NativeMediaEditor({
  work,
  hasProduction,
  busy,
  run,
  onChange,
  setBusy,
  setStatus,
  onDraftChange,
}: {
  work: BBWorkPackage;
  hasProduction: boolean;
  busy: boolean;
  run: RunOperation;
  onChange: (work: BBWorkPackage) => void;
  setBusy: (busy: boolean) => void;
  setStatus: (message: string) => void;
  onDraftChange: ((editor: string, dirty: boolean) => void) | undefined;
}) {
  const [image, setImage] = useState<File | null>(null),
    [imageSlot, setImageSlot] = useState<'background.base' | 'tile.face' | 'board.atlas'>(
      'background.base',
    );
  const [bgm, setBgm] = useState<File | null>(null),
    [placement, setPlacement] = useState<File | null>(null),
    [clear, setClear] = useState<File | null>(null);
  const [replacementAudio, setReplacementAudio] = useState<File | null>(null),
    [audioRole, setAudioRole] = useState<'bgm' | 'placement' | 'clear'>('bgm');
  const draft = !!image || !!bgm || !!placement || !!clear || !!replacementAudio;
  useEffect(() => {
    onDraftChange?.('media-form', draft);
  }, [onDraftChange, draft]);
  useEffect(() => () => onDraftChange?.('media-form', false), [onDraftChange]);
  async function bindAudio() {
    setBusy(true);
    try {
      const { attachObservedAudio } = await import('../contracts/attachObservedAudio');
      const result = await attachObservedAudio(work.project, {
        ...(bgm ? { bgm } : {}),
        ...(placement ? { placement } : {}),
        ...(clear ? { clear } : {}),
        bgmStart: 0,
        bgmOffset: 0,
        bgmGain: 0.2,
        bgmLoop: true,
        cueGain: 0.5,
      });
      const { updateBBWorkPackageProject } = await import('../contracts/bbWorkPackage');
      onChange(await updateBBWorkPackageProject(work, result.document));
      setBgm(null);
      setPlacement(null);
      setClear(null);
      setStatus(`音频已绑定，请保存作品。${result.warning}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <details>
        <summary>绑定作品图片</summary>
        <p>
          背景用于画面；牌面用于候选与拖动，棋盘图集用于已占格。观察画面的清除碎片使用牌面，不按棋盘格切片。更改一个槽会保留其他素材和玩法。
        </p>
        <label>
          图片槽{' '}
          <select
            aria-label="作品图片槽"
            value={imageSlot}
            onChange={(e) => setImageSlot(e.target.value as typeof imageSlot)}
          >
            <option value="background.base">背景</option>
            <option value="tile.face">候选和拖动牌面</option>
            <option value="board.atlas">棋盘方块</option>
          </select>
        </label>{' '}
        <label>
          PNG 或 JPEG{' '}
          <input
            type="file"
            aria-label="作品图片文件"
            accept="image/png,image/jpeg,.png,.jpg,.jpeg"
            onChange={(e) => setImage(e.target.files?.[0] ?? null)}
          />
        </label>{' '}
        <button
          disabled={busy || !image}
          onClick={() =>
            void run(
              async () => {
                const { setNativeWorkImage } = await import('../contracts/setNativeWorkImage');
                return setNativeWorkImage(work, imageSlot, image!);
              },
              undefined,
              () => setImage(null),
            )
          }
        >
          核验并绑定图片
        </button>
      </details>
      {!hasProduction && (
        <details>
          <summary>绑定工程 WAV 音频</summary>
          <p>
            选择 PCM WAV，保存到作品中。未选择的角色不会自动添加音效；每个非空 Take
            在保存前会实际混音核验。
          </p>
          <label>
            背景音乐{' '}
            <input
              aria-label="作品背景 WAV"
              type="file"
              accept=".wav,audio/wav"
              onChange={(e) => setBgm(e.target.files?.[0] ?? null)}
            />
          </label>{' '}
          <label>
            落子音效{' '}
            <input
              aria-label="作品落子 WAV"
              type="file"
              accept=".wav,audio/wav"
              onChange={(e) => setPlacement(e.target.files?.[0] ?? null)}
            />
          </label>{' '}
          <label>
            消除音效{' '}
            <input
              aria-label="作品消除 WAV"
              type="file"
              accept=".wav,audio/wav"
              onChange={(e) => setClear(e.target.files?.[0] ?? null)}
            />
          </label>{' '}
          <button disabled={busy || !(bgm || placement || clear)} onClick={() => void bindAudio()}>
            核验并绑定 WAV
          </button>
        </details>
      )}
      <details>
        <summary>添加或替换工程音频</summary>
        <p>
          仅替换选定角色；原有音量、起点、源偏移、循环、其他音效及玩法会保留。缺少该角色时会新增绑定；只支持
          PCM16 WAV。
        </p>
        <label>
          音频角色{' '}
          <select
            aria-label="替换音频角色"
            value={audioRole}
            onChange={(e) => setAudioRole(e.target.value as typeof audioRole)}
          >
            <option value="bgm">背景音乐</option>
            <option value="placement">落子音效</option>
            <option value="clear">消除音效</option>
          </select>
        </label>{' '}
        <label>
          新 WAV{' '}
          <input
            aria-label="替换音频文件"
            type="file"
            accept=".wav,audio/wav,audio/x-wav"
            onChange={(e) => setReplacementAudio(e.target.files?.[0] ?? null)}
          />
        </label>{' '}
        <button
          disabled={busy || !replacementAudio}
          onClick={() =>
            void run(
              async () => {
                const { setNativeWorkAudio } = await import('../contracts/setNativeWorkAudio');
                return setNativeWorkAudio(work, audioRole, replacementAudio!);
              },
              undefined,
              () => setReplacementAudio(null),
            )
          }
        >
          核验并添加或替换音频
        </button>
      </details>
    </>
  );
}
