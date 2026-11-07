export type TapTileWorkspaceMode = 'edit' | 'validate' | 'play' | 'replay' | 'direct' | 'export';

export const TAPTILE_WORKSPACE_MODES: Array<{ id: TapTileWorkspaceMode; label: string }> = [
  { id: 'edit', label: '编辑' },
  { id: 'validate', label: '验证' },
  { id: 'play', label: '试玩' },
  { id: 'replay', label: '回放' },
  { id: 'direct', label: '导演' },
  { id: 'export', label: '导出' },
];
