import type {
  CameraPresetId,
  FxPresetId,
  GeometryPresetId,
  GeometryStyle,
  LightingPresetId,
  LookDevPresetId,
  MaterialPresetId,
  ReferenceAmbientFxId,
  ReferenceClearFxId,
  ReferenceFeedbackFxId,
  ReferencePreviewFxId,
  ReferenceTileFaceSetId,
  ReferenceTileMaterialId,
  RenderBackendId,
  StyleSpec,
} from '../domain/types';
import { copyLookDevPreset } from './lookDev';

export interface NamedPreset<T extends string> {
  id: T;
  label: string;
  description: string;
}


export const RENDERER_OPTIONS: Array<NamedPreset<RenderBackendId>> = [
  {
    id: 'reference-2d',
    label: '真机参考 2D',
    description: '按参考视频拆解布局、彩块、预消除、扫光、评价词与 Combo。',
  },
  {
    id: 'fixed-camera-cinematic',
    label: '固定机位 3D',
    description: '锁定 9:16 构图与 Shot Profile，接入 LookDev 诊断和 PBR 运行时。',
  },
  {
    id: 'three-3d',
    label: '实验性 3D',
    description: '保留一期 Three.js 体积化实验，不作为当前复刻基线。',
  },
];

export const REFERENCE_TILE_MATERIAL_OPTIONS: Array<NamedPreset<ReferenceTileMaterialId>> = [
  { id: 'soft-bevel', label: '柔和浮雕材质', description: '渐变、内高光、压暗边缘与柔和投影。' },
  { id: 'flat-matte', label: '平面哑光材质', description: '保留色彩与轮廓，弱化高光和体积。' },
];

export const REFERENCE_TILE_FACE_OPTIONS: Array<NamedPreset<ReferenceTileFaceSetId>> = [
  { id: 'botanical-reference', label: '植物牌面纹样', description: '花朵、叶片与参考视频一致的低对比浮雕图案。' },
  { id: 'none', label: '无牌面纹样', description: '关闭图案，仅保留方块材质。' },
];

export const REFERENCE_PREVIEW_OPTIONS: Array<NamedPreset<ReferencePreviewFxId>> = [
  { id: 'full-line-tint', label: '整行预填充', description: '落子会消除时，对完整行列做半透明染色。' },
  { id: 'cells-only', label: '仅落点预览', description: '只显示即将落下的方块，不染整行。' },
];

export const REFERENCE_CLEAR_OPTIONS: Array<NamedPreset<ReferenceClearFxId>> = [
  { id: 'sweep-score-spark', label: '扫光 + 逐格计分', description: '参考视频的亮带、星屑、逐格数字与消散。' },
  { id: 'sweep-only', label: '简洁扫光', description: '保留行列亮带，弱化数字与粒子。' },
];

export const REFERENCE_FEEDBACK_OPTIONS: Array<NamedPreset<ReferenceFeedbackFxId>> = [
  { id: 'praise-combo', label: '评价词 + Combo', description: '六级评价词、Combo 与高强度反馈；阈值仍待受控标定。' },
  { id: 'score-only', label: '仅积分', description: '不显示大评价词和 Combo 装饰。' },
];

export const REFERENCE_AMBIENT_OPTIONS: Array<NamedPreset<ReferenceAmbientFxId>> = [
  { id: 'garden-petals', label: '花瓣环境粒子', description: '背景花朵脉冲、彩色碎屑与微光。' },
  { id: 'none', label: '关闭环境粒子', description: '只保留背景渐变。' },
];

export const DEFAULT_REFERENCE_2D_STYLE: StyleSpec['reference2d'] = {
  profile: 'block-garden-reference-v1',
  tileMaterial: 'soft-bevel',
  tileFaceSet: 'botanical-reference',
  previewFx: 'full-line-tint',
  clearFx: 'sweep-score-spark',
  feedbackFx: 'praise-combo',
  ambientFx: 'garden-petals',
  bestScore: 22634,
};

export const GEOMETRY_PRESETS: Record<GeometryPresetId, GeometryStyle> = {
  'soft-cube': { id: 'soft-cube', depth: 0.44, bevel: 0.14, gap: 0.07 },
  'premium-beveled': { id: 'premium-beveled', depth: 0.58, bevel: 0.1, gap: 0.055 },
  'candy-rounded': { id: 'candy-rounded', depth: 0.52, bevel: 0.2, gap: 0.08 },
};

export const GEOMETRY_OPTIONS: Array<NamedPreset<GeometryPresetId>> = [
  { id: 'soft-cube', label: '柔和方块', description: '圆润、清爽，适合标准试玩。' },
  { id: 'premium-beveled', label: '高级倒角', description: '更厚、更利落，强化 3D 体积。' },
  { id: 'candy-rounded', label: '糖果圆角', description: '更强圆角与高光，适合树脂风格。' },
];

export const MATERIAL_OPTIONS: Array<NamedPreset<MaterialPresetId>> = [
  { id: 'glossy-plastic', label: '亮面塑料', description: '稳定、清晰，适合高频变体。' },
  { id: 'candy-resin', label: '糖果树脂', description: '半透明涂层与柔和内部衰减。' },
  { id: 'crystal-glass', label: '水晶玻璃', description: '高透射、锐利高光和虹彩。' },
];

export const LIGHTING_OPTIONS: Array<NamedPreset<LightingPresetId>> = [
  { id: 'neutral-lookdev', label: '中性材质校准', description: '低反射、低轮廓光，用于判断材质本身而不是影视发光。' },
  { id: 'clean-studio', label: '清洁棚拍', description: '中性商业光，材质识别最稳定。' },
  { id: 'soft-candy', label: '柔和糖果', description: '暖主光、冷补光、粉色轮廓。' },
  { id: 'neon-contrast', label: '霓虹高对比', description: '冷暖对撞，适合爆发型画面。' },
];

export const LOOKDEV_OPTIONS: Array<NamedPreset<LookDevPresetId>> = [
  { id: 'neutral-lookdev', label: '中性 LookDev', description: '关闭 Bloom，降低环境反射，用于材质导入和高光排查。' },
  { id: 'balanced-cinematic', label: '平衡影视', description: '普通高光保持清晰，只有清除能量获得有限 Bloom。' },
  { id: 'high-energy', label: '高能量', description: '增强清除峰值和轮廓光，用于 Hero Event，不作为材质校准基线。' },
];

export const CAMERA_OPTIONS: Array<NamedPreset<CameraPresetId>> = [
  { id: 'flat-gameplay', label: '正视玩法', description: '规则最清楚，接近标准试玩。' },
  { id: 'premium-perspective', label: '高级微透视', description: '轻俯拍，厚度表现更明显。' },
  { id: 'dynamic-clear', label: '动态消除', description: '消除时推近并增强镜头冲击。' },
];

export const DIAGNOSTIC_VIEW_OPTIONS: Array<NamedPreset<import('../domain/types').DiagnosticViewId>> = [
  { id: 'beauty', label: 'Beauty', description: '最终合成。' },
  { id: 'albedo', label: 'Albedo', description: '读取实际底色/贴图，关闭环境反射。' },
  { id: 'world-normal', label: 'World Normal (proxy)', description: 'flatShading 代理，不是 world-normal G-buffer。' },
  { id: 'roughness', label: 'Roughness', description: '粗糙度通道。' },
  { id: 'metalness', label: 'Metalness', description: '金属度通道。' },
  { id: 'emission', label: 'Emission', description: '自发光贡献。' },
  { id: 'bloom-contribution', label: 'Bloom Contribution (proxy)', description: '额外 emissive 代理，不是 bloom 缓冲。' },
  { id: 'highlight-clip', label: 'Highlight Clip (proxy)', description: 'LDR 近白诊断，不是 HDR highlight-clip 缓冲。' },
];

export const FX_OPTIONS: Array<NamedPreset<FxPresetId>> = [
  { id: 'clean-pop', label: '清爽碎裂', description: '少量三维碎片，信息干净。' },
  { id: 'crystal-shatter', label: '水晶爆裂', description: '更多碎片与高光粒子。' },
  { id: 'energy-burst', label: '能量爆发', description: '加强次级粒子与冲击波。' },
];

export const DEFAULT_STYLE: StyleSpec = {
  renderer: 'reference-2d',
  reference2d: { ...DEFAULT_REFERENCE_2D_STYLE },
  geometry: { ...GEOMETRY_PRESETS['premium-beveled'] },
  lookDev: copyLookDevPreset('balanced-cinematic'),
  material: 'candy-resin',
  lighting: 'soft-candy',
  camera: 'premium-perspective',
  fx: 'crystal-shatter',
  background: '#07142d',
  showPointer: true,
};

export function withGeometryPreset(style: StyleSpec, id: GeometryPresetId): StyleSpec {
  return { ...style, geometry: { ...GEOMETRY_PRESETS[id] } };
}

export const GEOMETRY_DEFAULTS = GEOMETRY_PRESETS;
