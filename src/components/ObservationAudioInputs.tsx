type Props = {
  disabled: boolean;
  savedAudio: readonly { role: string; name: string; sha256: string }[];
  onClearSaved: () => void;
  bgmStart: number;
  bgmOffset: number;
  bgmGain: number;
  cueGain: number;
  bgmLoop: boolean;
  onBgmChange: (file: File | null) => void;
  onPlacementChange: (file: File | null) => void;
  onClearCueChange: (file: File | null) => void;
  onBgmStartChange: (value: number) => void;
  onBgmOffsetChange: (value: number) => void;
  onBgmGainChange: (value: number) => void;
  onCueGainChange: (value: number) => void;
  onBgmLoopChange: (value: boolean) => void;
};

/** Controlled audio inputs; values and save protection remain in the parent session. */
export function ObservationAudioInputs({
  disabled,
  savedAudio,
  onClearSaved,
  bgmStart,
  bgmOffset,
  bgmGain,
  cueGain,
  bgmLoop,
  onBgmChange,
  onPlacementChange,
  onClearCueChange,
  onBgmStartChange,
  onBgmOffsetChange,
  onBgmGainChange,
  onCueGainChange,
  onBgmLoopChange,
}: Props) {
  return (
    <fieldset disabled={disabled}>
      <legend>初次生成的音频</legend>
      <p>
        可选音频：所选 WAV
        会核验并内嵌到新工程；不选择则生成无工程音频的工程。关闭页面后需重新选择文件。
      </p>
      {savedAudio.length > 0 && (
        <p>
          之前记录的音频：{savedAudio.map((x) => `${x.role}: ${x.name}`).join('、')}
          ；作品包内嵌音频会自动恢复；单独观察记录需要重新选择文件。
          <button onClick={() => onClearSaved()}>清除已保存音频绑定</button>
        </p>
      )}
      <label>
        BGM WAV{' '}
        <input
          aria-label="校准 BGM WAV"
          type="file"
          accept="audio/wav,.wav"
          onChange={(e) => onBgmChange(e.target.files?.[0] ?? null)}
        />
      </label>{' '}
      <label>
        落子 WAV{' '}
        <input
          aria-label="校准落子 WAV"
          type="file"
          accept="audio/wav,.wav"
          onChange={(e) => onPlacementChange(e.target.files?.[0] ?? null)}
        />
      </label>{' '}
      <label>
        消除 WAV{' '}
        <input
          aria-label="校准消除 WAV"
          type="file"
          accept="audio/wav,.wav"
          onChange={(e) => onClearCueChange(e.target.files?.[0] ?? null)}
        />
      </label>{' '}
      <label>
        BGM 起点秒{' '}
        <input
          aria-label="校准 BGM 起点"
          type="number"
          min={0}
          step={0.1}
          value={bgmStart}
          onChange={(e) => onBgmStartChange(e.target.valueAsNumber)}
        />
      </label>{' '}
      <label>
        源内偏移秒{' '}
        <input
          aria-label="校准 BGM 偏移"
          type="number"
          min={0}
          step={0.1}
          value={bgmOffset}
          onChange={(e) => onBgmOffsetChange(e.target.valueAsNumber)}
        />
      </label>{' '}
      <label>
        BGM 增益{' '}
        <input
          aria-label="校准 BGM 增益"
          type="number"
          min={0}
          max={1}
          step={0.1}
          value={bgmGain}
          onChange={(e) => onBgmGainChange(e.target.valueAsNumber)}
        />
      </label>{' '}
      <label>
        事件音效增益{' '}
        <input
          aria-label="校准音效增益"
          type="number"
          min={0}
          max={1}
          step={0.1}
          value={cueGain}
          onChange={(e) => onCueGainChange(e.target.valueAsNumber)}
        />
      </label>{' '}
      <label>
        <input
          aria-label="校准 BGM 循环"
          type="checkbox"
          checked={bgmLoop}
          onChange={(e) => onBgmLoopChange(e.target.checked)}
        />
        循环
      </label>{' '}
    </fieldset>
  );
}
