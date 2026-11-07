type ImageMode = 'shared' | 'grouped';

type Props = {
  disabled: boolean;
  savedImages: readonly { role: string; name: string; sha256: string }[];
  onClearSaved: () => void;
  imageMode: ImageMode;
  onImageModeChange: (value: ImageMode) => void;
  onBackgroundChange: (file: File | null) => void;
  onTileChange: (file: File | null) => void;
  onWhiteChange: (file: File | null) => void;
  onCoralChange: (file: File | null) => void;
  onCyanChange: (file: File | null) => void;
};

/** Controlled media inputs; the observation session owns files and draft state. */
export function ObservationImageInputs({
  disabled,
  savedImages,
  onClearSaved,
  imageMode,
  onImageModeChange,
  onBackgroundChange,
  onTileChange,
  onWhiteChange,
  onCoralChange,
  onCyanChange,
}: Props) {
  return (
    <fieldset disabled={disabled}>
      <legend>初次生成的图片</legend>
      <p>
        可选 PNG 精灵：背景铺满 1080×1920
        画布；牌面用于棋盘、候选及拖动方块。共用模式使用一张图片，分槽模式按下面明确的三组使用；部分清除覆盖层和碎片由程序绘制。每张不超过
        2 MiB；不提供时使用程序图形，不代表与参考一致。
      </p>
      {savedImages.length > 0 && (
        <p>
          之前记录的图片：{savedImages.map((x) => `${x.role}: ${x.name}`).join('、')}
          ；作品包内嵌图片会自动恢复，否则生成前须重新选择并核验哈希。
          <button onClick={() => onClearSaved()}>清除已保存图片绑定</button>
        </p>
      )}
      <label>
        校准背景 PNG{' '}
        <input
          aria-label="校准背景 PNG"
          type="file"
          accept="image/png,.png"
          onChange={(e) => onBackgroundChange(e.target.files?.[0] ?? null)}
        />
      </label>{' '}
      <label>
        方块图片模式{' '}
        <select
          aria-label="方块图片模式"
          value={imageMode}
          onChange={(e) => onImageModeChange(e.target.value as typeof imageMode)}
        >
          <option value="shared">全部共用一张</option>
          <option value="grouped">灰色主题：white、coral、cyan 分槽</option>
        </select>
      </label>{' '}
      {imageMode === 'shared' ? (
        <label>
          校准方块 PNG{' '}
          <input
            aria-label="校准方块 PNG"
            type="file"
            accept="image/png,.png"
            onChange={(e) => onTileChange(e.target.files?.[0] ?? null)}
          />
        </label>
      ) : (
        <>
          <p>
            灰色主题下 coral、cyan 使用各自图片；blue、amber、lime、violet、rose 与其他颜色共用
            white。三槽均须选择，其他主题不支持此分槽模式。
          </p>
          {(
            [
              ['white', onWhiteChange],
              ['coral', onCoralChange],
              ['cyan', onCyanChange],
            ] as const
          ).map(([role, set]) => (
            <label key={role}>
              {role} PNG{' '}
              <input
                aria-label={`校准 ${role} PNG`}
                type="file"
                accept="image/png,.png"
                onChange={(e) => set(e.target.files?.[0] ?? null)}
              />
            </label>
          ))}
        </>
      )}
    </fieldset>
  );
}
