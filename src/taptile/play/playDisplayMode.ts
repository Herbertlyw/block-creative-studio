export type TapTilePlayDisplayMode = 'all' | 'playable';

export interface TapTilePlayDisplayOption {
  id: TapTilePlayDisplayMode;
  label: string;
  description: string;
}

export const TAPTILE_PLAY_DISPLAY_STORAGE_KEY = 'taptile-director/play-display-mode/v1';

export const TAPTILE_PLAY_DISPLAY_MODES: readonly TapTilePlayDisplayOption[] = Object.freeze([
  {
    id: 'all',
    label: '全部显示',
    description: '所有牌保持正常亮度；被遮挡的牌仍然不能点击。',
  },
  {
    id: 'playable',
    label: '可点击高亮',
    description: '仅可点击牌保持明亮并高亮，其他牌压暗。',
  },
]);

export function normalizeTapTilePlayDisplayMode(value: unknown): TapTilePlayDisplayMode {
  return value === 'playable' ? 'playable' : 'all';
}

export function tapTilePlayDisplayTreatment(
  mode: TapTilePlayDisplayMode,
  playable: boolean,
): Readonly<{ dimmed: boolean; highlighted: boolean }> {
  if (mode === 'all') return { dimmed: false, highlighted: false };
  return { dimmed: !playable, highlighted: playable };
}
