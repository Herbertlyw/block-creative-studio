import { validReferenceSprite } from './referenceSprites';
import { parseReferenceAppearance, type ReferenceAppearance } from './referenceAppearance';
import { takeFromBlockPlacementReplay } from '../migrations/blockPlacementV1';
import { replayActions } from '../runtime/gameEngine';
import type { StudioProjectDocumentV2 } from '../../../game-runtime/projectEnvelope';
import { stableHash } from '../../../headless/stableHash';
import { parseReferenceEffects, type ReferenceEffects } from './referenceEffects';

export interface ReferenceScorePopup {
  value: number;
  position?: [number,number];
  delaySeconds?: number;
  durationSeconds?: number;
  style?: 'white' | 'gold';
  prefix?: boolean;
}

/** A lifted real rack piece that is never committed as a rule action. */
export interface ReferencePreviewDrag {
  pieceId: string;
  slot: number;
  start: number;
  end: number;
  motion: Array<[number,number,number,number]>;
  /** Defaults to returning to the rack. False is only valid at the end of the scene. */
  returnToRack?: boolean;
}

export interface ReferenceCalibration {
  version: 1;
  theme: 'pink' | 'grey' | 'purple';
  duration: number;
  sourceOffset: number;
  board: [number, number, number];
  rackY: number;
  rackCell: number;
  bestScore: number;
  scoreTrack: Array<[number, number]>;
  previewDrags?: ReferencePreviewDrag[];
  actions: Array<{ actionId: string; start: number; release: number; clear: number; slot: number; clearFace?: number; linePreview?: 'spectrum'|'piece'|'gold-outline'|'spectrum-outline'|'piece-outline'|'piece-glow'; clearTimeScale?: number; rainbowGapSeconds?: number; rainbowReverse?: boolean; rainbowCells?: Array<{row:number;col:number;hide:number;show:number;end:number}>; label?: string; combo?: number; perfect?: boolean; clearStyle?: 'spectrum' | 'spark-strip' | 'fracture' | 'tile-tumble' | 'rapid-tumble' | 'confetti-tumble' | 'ice-shatter' | 'ice-avalanche' | 'jewel-burst' | 'reference-fall' | 'column-rain' | 'material-strip' | 'photo-strip' | 'neon-strip' | 'panel-flip' | 'jelly-wave' | 'rainbow-sweep' | 'stone-burst' | 'fruit-burst' | 'lattice-strip' | 'neon-motes' | 'stone-spray' | 'prism-fracture' | 'shimmer-squares' | 'luminous-squares' | 'luminous-bands' | 'cube-burst' | 'luminous-granules'; motion?: Array<[number,number,number,number]>; scorePopup?: ReferenceScorePopup; like?: 'none'|'pink-cluster'|'blue-badge' }>;
  effects?: ReferenceEffects;
  appearance?: ReferenceAppearance;
  /** Pink-reference material recoloring; one color or a stable multicolor palette. */
  tileColors?: string[];
  tileMaterial?: { kind:'gem-inlay'|'motif-atlas'; decoratedFraction:number; seed:number; atlasRects:Array<[number,number,number,number]> } | { kind:'palette-atlas'; decoratedFraction?:never; seed?:never; atlasRects:Array<[number,number,number,number]> };
  /** Optional themed static backdrop and coordinated board surface colors. */
  backdrop?: { boardFrame: string; boardGrid: string; boardCell: string };
  scoreFeedback?: { enabled: boolean; source: 'native' | 'authored'; durationSeconds: number; risePx: number; fontSize: number; delaySeconds: number };
  /** A static, authored end card; never a gameplay frame sequence. */
  endCardStart?: number;
  trophies?: boolean;
  /** Output seconds and absolute camera translation in 1080 × 1920 design pixels. */
  shakeTrack?: Array<[number, number, number]>;
  takeHash?: string;
  sprites?: Record<string, string>;
  /** Hash-checked attachment IDs used to hydrate sprites for frozen renderers. */
  legacySpriteAssetIds?: Record<string, string>;
}

export function parseReferenceCalibration(raw: unknown, document: StudioProjectDocumentV2): ReferenceCalibration {
  const nativeBoard=(document.game.initialState.data as any)?.board;
  // Standalone style validators historically use partial 8×8 documents.
  const boardRows=nativeBoard?.rows??8,boardCols=nativeBoard?.cols??8;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('REFERENCE_CALIBRATION_REQUIRED');
  const v = structuredClone(raw) as ReferenceCalibration;
  const finite = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;
  if (v.version !== 1 || !['pink','grey','purple'].includes(v.theme) || !finite(v.duration, 1, 600) || !finite(v.sourceOffset,0,3600)) throw new Error('REFERENCE_CALIBRATION_HEADER_INVALID');
  if (!Array.isArray(v.board) || v.board.length !== 3 || !v.board.every(n => finite(n,0,1920)) || !finite(v.board[2],20,200) || !finite(v.rackY,0,1920) || !finite(v.rackCell,10,150) || (!Number.isSafeInteger(v.bestScore)||!finite(v.bestScore,0,Number.MAX_SAFE_INTEGER))) throw new Error('REFERENCE_CALIBRATION_GEOMETRY_INVALID');
  const take = document.takes[0];
  if (!take || !Array.isArray(v.actions) || v.actions.length !== take.actions.length) throw new Error('REFERENCE_CALIBRATION_ACTION_COUNT');
  let previous = -1;
  for (const [i,a] of v.actions.entries()) {
    if (a.actionId !== take.actions[i]!.id || !finite(a.start,0,v.duration) || !finite(a.release,a.start,v.duration) || !finite(a.clear,a.release,v.duration) || a.release <= previous || !Number.isInteger(a.slot) || !finite(a.slot,0,2)) throw new Error(`REFERENCE_CALIBRATION_TIMING_INVALID:${i}`);
    previous = a.release;
    if ((a.label !== undefined && (typeof a.label !== 'string' || a.label.length > 40)) || (a.combo !== undefined && !finite(a.combo,0,999)) || (a.perfect !== undefined && typeof a.perfect !== 'boolean')) throw new Error('REFERENCE_FEEDBACK_INVALID');
    if (a.clearStyle !== undefined && !['spectrum','spark-strip','fracture','tile-tumble','rapid-tumble','confetti-tumble','ice-shatter','ice-avalanche','jewel-burst','reference-fall','column-rain','material-strip','photo-strip','neon-strip','panel-flip','jelly-wave','rainbow-sweep','stone-burst','fruit-burst','lattice-strip','neon-motes','stone-spray','prism-fracture','shimmer-squares','luminous-squares','luminous-bands','cube-burst','luminous-granules'].includes(a.clearStyle)) throw new Error('REFERENCE_CLEAR_STYLE_INVALID');
    if(a.linePreview!==undefined&&!['spectrum','piece','gold-outline','spectrum-outline','piece-outline','piece-glow'].includes(a.linePreview))throw new Error('REFERENCE_ACTION_LINE_PREVIEW_INVALID');
    if(a.clearTimeScale!==undefined&&!finite(a.clearTimeScale,.1,4))throw new Error('REFERENCE_CLEAR_TIME_SCALE_INVALID');
    if(a.clearFace!==undefined&&(!Number.isInteger(a.clearFace)||!v.appearance||a.clearFace<0||a.clearFace>=v.appearance.atlasRects.length))throw new Error('REFERENCE_CLEAR_FACE_INVALID');
    if(a.rainbowCells!==undefined&&(!Array.isArray(a.rainbowCells)||a.rainbowCells.length>boardRows*boardCols||a.rainbowCells.some(c=>!Number.isInteger(c.row)||!Number.isInteger(c.col)||!finite(c.row,0,boardRows-1)||!finite(c.col,0,boardCols-1)||!finite(c.hide,0,2)||!finite(c.show,c.hide,2)||!finite(c.end,c.show+.01,2))))throw new Error('REFERENCE_RAINBOW_CELLS_INVALID');
    if(a.rainbowGapSeconds!==undefined&&!finite(a.rainbowGapSeconds,0,.3))throw new Error('REFERENCE_RAINBOW_GAP_INVALID');
    if(a.rainbowReverse!==undefined&&typeof a.rainbowReverse!=='boolean')throw new Error('REFERENCE_RAINBOW_DIRECTION_INVALID');
    if (a.like!==undefined&&!['none','pink-cluster','blue-badge'].includes(a.like)) throw new Error('REFERENCE_LIKE_STYLE_INVALID');
    if (a.scorePopup !== undefined) {
      const p=a.scorePopup;
      if (!p || typeof p!=='object' || Array.isArray(p) || !Number.isInteger(p.value) || !finite(p.value,1,1e9) || (p.style!==undefined && !['white','gold'].includes(p.style)) || (p.prefix!==undefined && typeof p.prefix!=='boolean') || (p.delaySeconds!==undefined && !finite(p.delaySeconds,0,2))) throw new Error('REFERENCE_SCORE_POPUP_INVALID');
      if (p.position!==undefined && (!Array.isArray(p.position) || p.position.length!==2 || !finite(p.position[0],0,1080) || !finite(p.position[1],0,1920))) throw new Error('REFERENCE_SCORE_POPUP_POSITION_INVALID');
      if(p.durationSeconds!==undefined&&!finite(p.durationSeconds,.12,2))throw new Error('REFERENCE_SCORE_POPUP_INVALID');
    }
    if (a.motion !== undefined) {
      if (!Array.isArray(a.motion) || a.motion.length>300) throw new Error('REFERENCE_MOTION_INVALID');
      let prev=-1;
      for (const p of a.motion) { if (!Array.isArray(p) || p.length!==4 || !finite(p[0],a.start,a.release) || p[0]<=prev || !finite(p[1],-1080,2160) || !finite(p[2],-1920,3840) || !finite(p[3],5,300)) throw new Error('REFERENCE_MOTION_INVALID');prev=p[0]; }
    }
  }
  if (!Array.isArray(v.scoreTrack) || v.scoreTrack.length > 10000) throw new Error('REFERENCE_SCORE_TRACK_INVALID');
  previous = -1;
  for (const item of v.scoreTrack) {
    if (!Array.isArray(item) || item.length !== 2 || !finite(item[0],0,v.duration) || item[0]<previous || !Number.isInteger(item[1]) || !finite(item[1],0,Number.MAX_SAFE_INTEGER)) throw new Error('REFERENCE_SCORE_TRACK_INVALID');
    previous = item[0];
  }
  if (v.endCardStart !== undefined && !finite(v.endCardStart,0,v.duration)) throw new Error('REFERENCE_END_CARD_INVALID');
  if (v.trophies !== undefined && typeof v.trophies !== 'boolean') throw new Error('REFERENCE_TROPHIES_INVALID');
  if (v.appearance!==undefined) {
    if (!v.sprites?.tileMaterialAtlas || v.tileColors || v.tileMaterial) throw new Error('REFERENCE_APPEARANCE_CONFLICT');
    let nativeAfter:Map<string,any[][]>|undefined;
    if(v.appearance.after){
      const native=takeFromBlockPlacementReplay(document.game,take);
      nativeAfter=new Map(replayActions(native.initial,native.actions).map(step=>[step.action.id,step.after.board.cells]));
    }
    v.appearance=parseReferenceAppearance(v.appearance, document.game.initialState.data,nativeAfter);
    if(v.appearance.backdropTimeline&&(!v.sprites.backgroundAtlas||v.appearance.backdropTimeline.some(e=>e.at>v.duration)))throw new Error('REFERENCE_BACKDROP_TIMELINE_INVALID');
  }
  if (v.effects!==undefined) v.effects=parseReferenceEffects(v.effects);
  if(v.tileColors!==undefined && (v.theme!=='pink' || !Array.isArray(v.tileColors) || v.tileColors.length<1 || v.tileColors.length>12 || v.tileColors.some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c)))) throw new Error('REFERENCE_TILE_COLORS_INVALID');
  if(v.tileMaterial!==undefined){
    const m=v.tileMaterial;
    if(!m||!['gem-inlay','motif-atlas','palette-atlas'].includes(m.kind)||v.theme!=='pink'||!v.tileColors||!Array.isArray(m.atlasRects)||m.atlasRects.some(r=>!Array.isArray(r)||r.length!==4||!r.every(Number.isInteger)||!finite(r[0],0,8192)||!finite(r[1],0,8192)||!finite(r[2],16,4096)||!finite(r[3],16,4096)))throw new Error('REFERENCE_TILE_MATERIAL_INVALID');
    if(m.kind==='gem-inlay'&&(v.tileColors.length!==2||!finite(m.decoratedFraction,0,1)||!Number.isSafeInteger(m.seed)||!finite(m.seed,0,0xffffffff)||m.atlasRects.length!==6||!v.sprites?.tileGemAtlas))throw new Error('REFERENCE_TILE_MATERIAL_INVALID');
    if(m.kind==='motif-atlas'&&(!finite(m.decoratedFraction,0,1)||!Number.isSafeInteger(m.seed)||!finite(m.seed,0,0xffffffff)||m.atlasRects.length!==v.tileColors.length*3||!v.sprites?.tileGemAtlas))throw new Error('REFERENCE_TILE_MATERIAL_INVALID');
    if(m.kind==='palette-atlas'&&(m.atlasRects.length!==v.tileColors.length||m.decoratedFraction!==undefined||m.seed!==undefined||!v.sprites?.tileMaterialAtlas))throw new Error('REFERENCE_TILE_MATERIAL_INVALID');
  }
  if(v.backdrop!==undefined){
    const b=v.backdrop;
    if(!b||typeof b!=='object'||Array.isArray(b)||!['boardFrame','boardGrid','boardCell'].every(k=>/^#[0-9a-f]{6}$/i.test((b as any)[k]))||!v.sprites?.background)throw new Error('REFERENCE_BACKDROP_INVALID');
  }
  if (v.scoreFeedback!==undefined) {
    const f=v.scoreFeedback;
    if (!f || typeof f!=='object' || Array.isArray(f) || typeof f.enabled!=='boolean' || !['native','authored'].includes(f.source) || !finite(f.durationSeconds,.2,2) || !finite(f.risePx,0,400) || !finite(f.fontSize,24,160) || !finite(f.delaySeconds,0,2)) throw new Error('REFERENCE_SCORE_FEEDBACK_INVALID');
  }
  if (v.shakeTrack !== undefined) {
    if (!Array.isArray(v.shakeTrack) || v.shakeTrack.length < 2 || v.shakeTrack.length > 10000) throw new Error('REFERENCE_SHAKE_TRACK_INVALID');
    let last = -1;
    for (const point of v.shakeTrack) {
      if (!Array.isArray(point) || point.length !== 3 || !finite(point[0],0,v.duration) || point[0] <= last || !finite(point[1],-24,24) || !finite(point[2],-24,24)) throw new Error('REFERENCE_SHAKE_TRACK_INVALID');
      last = point[0];
    }
    if ([v.shakeTrack[0]!,v.shakeTrack.at(-1)!].some(p => p[1] !== 0 || p[2] !== 0)) throw new Error('REFERENCE_SHAKE_TRACK_UNSETTLED');
  }
  if (v.sprites !== undefined) {
    const names = ['backgroundAtlas','background','tilePink','tilePurple','tileWhite','tileCyan','tileCoral','tileBlue','tileGemAtlas','tileMaterialAtlas','hudLeft','hudGear','hudControls','crown','endCard','praiseGood','praiseGreat','praisePerfect','praiseAtlas','stoneFragments'];
    if (!v.sprites || Array.isArray(v.sprites) || Object.keys(v.sprites).some(k=>!names.includes(k)) || Object.entries(v.sprites).some(([key,data])=>!validReferenceSprite(data,(document.direction?.style as any)?.agentAssets?.entries??{},['background','backgroundAtlas'].includes(key)?16000000:4000000))) throw new Error('REFERENCE_STATIC_SPRITE_INVALID');
  }
  if(v.effects?.stoneFragmentRects&&!v.sprites?.stoneFragments)throw new Error('REFERENCE_STONE_FRAGMENTS_MISSING');
  if(v.sprites?.stoneFragments&&!v.effects?.stoneFragmentRects)throw new Error('REFERENCE_STONE_FRAGMENT_RECTS_MISSING');
  if(v.appearance?.praiseEvents?.some(e=>e.spriteRect)&&!v.sprites?.praiseAtlas)throw new Error('REFERENCE_PRAISE_ATLAS_MISSING');
  if(v.previewDrags!==undefined){
    if(!Array.isArray(v.previewDrags)||v.previewDrags.length>300)throw new Error('REFERENCE_PREVIEW_DRAGS_INVALID');
    const native=takeFromBlockPlacementReplay(document.game,take),steps=replayActions(native.initial,native.actions);
    let lastEnd=-1;
    for(const d of v.previewDrags){
      if(!d||typeof d.pieceId!=='string'||!Number.isInteger(d.slot)||!finite(d.slot,0,2)||!finite(d.start,0,v.duration)||!finite(d.end,d.start,v.duration)||d.end<=d.start||d.start<lastEnd||(d.returnToRack!==undefined&&typeof d.returnToRack!=='boolean'))throw new Error('REFERENCE_PREVIEW_DRAGS_INVALID');
      if(d.returnToRack===false&&d.end!==v.duration&&d.end!==v.endCardStart)throw new Error('REFERENCE_PREVIEW_DRAG_UNSETTLED');
      if(v.actions.some(a=>d.start<a.clear&&d.end>a.start))throw new Error('REFERENCE_PREVIEW_DRAG_ACTION_OVERLAP');
      let state=native.initial;
      for(let i=0;i<steps.length;i++)if(v.actions[i]!.clear<=d.start)state=steps[i]!.after;
      if(!state.pieces.some(p=>p.id===d.pieceId&&p.slotIndex===d.slot&&!p.used))throw new Error('REFERENCE_PREVIEW_DRAG_PIECE_UNAVAILABLE');
      if(!Array.isArray(d.motion)||d.motion.length<1||d.motion.length>1200)throw new Error('REFERENCE_PREVIEW_DRAG_MOTION_INVALID');
      let prev=d.start;
      for(const p of d.motion){if(!Array.isArray(p)||p.length!==4||!finite(p[0],d.start,d.end)||p[0]<=prev||p[0]>=d.end||!finite(p[1],-1080,2160)||!finite(p[2],-1920,3840)||!finite(p[3],5,300))throw new Error('REFERENCE_PREVIEW_DRAG_MOTION_INVALID');prev=p[0];}
      lastEnd=d.end;
    }
  }
  const takeHash = stableHash({ initial: document.game.initialState, take });
  if (v.takeHash && v.takeHash !== takeHash) throw new Error('REFERENCE_CALIBRATION_STALE_TAKE');
  v.takeHash = takeHash;
  return v;
}
