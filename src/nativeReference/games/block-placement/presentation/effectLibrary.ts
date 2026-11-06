/** Independent, deterministic presentation layers. IDs are shared by CLI and renderer. */
export const CLEAR_EFFECT_LIBRARY = {
 preClear: [
  ['crafted-lattice-preClear','晶格亮边'],
  ['crafted-satin-preClear','柔边蓄光'],
  ['crafted-crystal-preClear','晶面蓄光'],
  ['crafted-spectrum-preClear','色谱蓄光'],
  ['center-sweep','中心双向扫亮'],['cell-lantern','晶格内透光'],['line-charge','整行蓄能'],
  ['edge-trace','轮廓描光'],['prism-scan','斜向棱镜扫光'],['iris-focus','光环收束'],
 ],
 beam: [
  ['crafted-lattice-beam','中心扩散光脉'],
  ['crafted-satin-beam','丝绒光脉'],
  ['crafted-crystal-beam','晶体闪核'],
  ['crafted-spectrum-beam','色谱光锋'],
  ['rose-laser','粉白激光'],['dual-aurora','青紫双波'],['silk-core','柔光亮芯'],
  ['split-comet','双向彗星'],['electric-filament','电弧光丝'],['prism-ribbon','虹彩光绸'],
 ],
 vanish: [
  ['crafted-lattice-vanish','晶格向外裂解'],
  ['crafted-satin-vanish','柔光压缩'],
  ['crafted-crystal-vanish','径向晶裂'],
  ['crafted-spectrum-vanish','逐色光解'],
  ['crystal-fracture','紫晶切面碎裂'],['star-collapse','收缩星爆'],['domino-dissolve','逐格光蚀'],
  ['twin-eject','双向喷散'],['petal-fold','四瓣折叠'],['vortex-pull','旋涡收束'],
 ],
 particles: [
  ['crafted-lattice-particles','晶格柔光碎粒'],
  ['crafted-satin-particles','柔光细粒'],
  ['crafted-crystal-particles','切面碎屑'],
  ['crafted-spectrum-particles','色谱方粒'],
  ['glass-flakes','透明晶片'],['light-dust','细长光尘'],['fourpoint-stars','四角星簇'],
  ['comet-trails','流星短尾'],['pearl-bubbles','珍珠光泡'],['butterfly-motes','蝶翼光屑'],
 ],
 rim: [
  ['aurora-circuit','青紫环绕流光'],['corner-nova','四角星芒'],['butterfly-garden','粉紫蝶光'],
  ['cyan-lightning','青蓝电光边框'],['gold-comet','香槟彗星边框'],['prism-racetrack','虹彩跑马流光'],
 ],
 celebration: [
  ['crafted-confetti','翻转彩纸与卷曲彩带'],
  ['orbital-stars','环绕数字星芒'],['silk-cannons','双侧丝带礼炮'],['confetti-fountain','彩纸喷泉'],
  ['radial-rays','放射光冕'],['chromatic-fireworks','三簇彩色烟花'],['jewel-corona','宝石弧冠'],
 ],
 impact: [
  ['soft-tap','短促轻点'],['vertical-kick','纵向轻冲'],['horizontal-snap','横向脆震'],
  ['diagonal-recoil','斜向回弹'],['micro-zoom','微距冲击'],['elastic-settle','弹性回稳'],
 ],
} as const;
export type EffectLayer = keyof typeof CLEAR_EFFECT_LIBRARY;
type Variant<K extends EffectLayer> = typeof CLEAR_EFFECT_LIBRARY[K][number][0];
export type ClearEffectLibrary = { [K in Exclude<EffectLayer,'vanish'>]?: Variant<K> | 'off' } & {vanish?:Variant<'vanish'>|'off'|'soft-fade'};
export const CLEAR_EFFECT_LIBRARY_SCHEMA = {
 type:'object',additionalProperties:false,
 properties:Object.fromEntries(Object.entries(CLEAR_EFFECT_LIBRARY).map(([key,items])=>[key,{enum:['off',...(key==='vanish'?['soft-fade']:[]),...items.map(item=>item[0])]}])),
 required:[] as string[],
};
