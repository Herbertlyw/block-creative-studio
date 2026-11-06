import {parseProgressHud,type ReferenceProgressHud} from './referenceProgressHud';
import { getShape } from '../runtime/shapes';

/** Measured reusable faces, never a sequence of gameplay images. */
export interface ReferenceAppearance {
  /** Clean empty-cell sample in the background plate; replaces baked-in tile remnants. */
  cleanBoardSample?: [number,number,number,number];
  tileGlowEvents?: Array<{start:number;end:number;color:string}>;
  /** Native HUD animation: time, center x/y, diamond diagonal, hue, opacity. */
  hudDiamondTrack?: Array<[number,number,number,number,number,number]>;
  comboDigitScale?: number;
  progressHud?: ReferenceProgressHud[];
  /** Explicit noninteractive celebration; visual tiles never enter gameplay state. */
  boardCelebrations?: Array<{start:number;fillEnd:number;holdEnd:number;end:number;faces:number[][]}>;
  boardGuides?: Array<{start:number;end:number;rect:[number,number,number,number];color:string;width:number;dash:number[]}>;
  atlasRects: Array<[number, number, number, number]>;
  initial: Array<Array<number | null>>;
  pieces: Record<string, Record<string, number>>;
  /** Optional face changes after a legal action; occupied cells must remain exactly native. */
  after?: Record<string, Array<Array<number|null>>>;
  /** Empty decorative scene plates only; gameplay tiles remain native. */
  backdropTimeline?: Array<{at:number;rect:[number,number,number,number]}>;
  boardSurface?: {start:number;end:number;faces:number[][];dragPreview?:boolean};
  textOverlays?: Array<{start:number;end:number;text:string;x:number;y:number;size:number;weight?:number;strokeWidth?:number}>;
  praiseEvents?: Array<{start:number;end:number;label:string;combo:number;x:number;y:number;scale:number;style?:'inset'|'classic'|'red'|'measured';palette?:'blue-gold'|'silver-lime'|'coral-gold'|'rose'|'yellow'|'winged'|'violet'|'blue-sun'|'cyan-rose'|'cream-mint'|'amber'|'purple-banner';spriteRect?:[number,number,number,number];keyframes?:Array<[number,number,number,number,number]>}>;
  /** Timed native UI ornaments measured independently of gameplay changes. */
  decorations?: Array<{start:number;end:number;kind:'hud-diamond'|'hud-heart'|'butterfly-rim'|'iridescent-butterfly-rim'|'heart-rim'|'paired-thumbs'|'flower-pop'|'neon-rim'|'tile-thumbs'|'spark-ring'|'clear-panel'|'hud-panel-glow';rect?:[number,number,number,number];x:number;y:number;size:number;color:string;outline?:boolean;soft?:boolean;rows?:number;cols?:number}>;
  hideDefaultPraise?: boolean;
  linePreview?: 'spectrum'|'piece'|'gold-outline'|'spectrum-outline'|'piece-outline'|'piece-glow';
  initialRevealSeconds?: number;
  cellCounters?: Array<{start:number;end:number;row:number;col:number;value:number;color:string;badge?:'coin'}>;
  linePreviewUntil?: number;
  /** Lifted projection of the moving piece, not its eventual recorded target. */
  landingPreview?: { opacity:number; lift:number; offsetX?:number };
  faceTimeline?: Array<{at:number;map:number[]}>;
  showAllClear?: boolean;
  boardRim?: boolean;
  staticBoard?: boolean;
  /** Include the authored scene plate in the camera transform, rather than only live tiles. */
  shakeBackground?: boolean;
  staticHud?: boolean;
  recolorFlash?: boolean;
  praiseY?: number;
  bestScore?: { x:number; y:number; size:number; color:string; italic:boolean };
  crownRect?: [number,number,number,number];
  rackCenters?: [number, number, number];
  /** Per-piece visual rack metrics; identities must exist in the native supply. */
  rackCellSizes?: Record<string,number>;
  rackPositions?: Record<string,[number,number]>;
  rackRevealTimes?: Record<string,number>;
  rackRevealSeconds?: number;
  score?: { enabled?:boolean; x: number; y: number; size: number; italic: boolean; diamond: boolean; prefix?: string; weight?: number; scaleX?:number };
}

export function parseReferenceAppearance(raw: ReferenceAppearance, initial: any, nativeAfter?: Map<string, any[][]>): ReferenceAppearance {
  const fail = () => { throw new Error('REFERENCE_APPEARANCE_INVALID'); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
  if(raw.progressHud!==undefined)parseProgressHud(raw.progressHud);
  if(raw.boardGuides!==undefined&&(!Array.isArray(raw.boardGuides)||raw.boardGuides.length>512||raw.boardGuides.some(g=>!g||!Number.isFinite(g.start)||!Number.isFinite(g.end)||g.start<0||g.end<=g.start||g.end>600||!Array.isArray(g.rect)||g.rect.length!==4||g.rect.some(v=>!Number.isFinite(v))||g.rect[0]<0||g.rect[1]<0||g.rect[2]<=0||g.rect[3]<=0||g.rect[0]+g.rect[2]>1080||g.rect[1]+g.rect[3]>1920||!/^#[0-9a-f]{6}$/i.test(g.color)||!Number.isFinite(g.width)||g.width<=0||g.width>30||!Array.isArray(g.dash)||g.dash.length>8||g.dash.some(v=>!Number.isFinite(v)||v<=0||v>200))))return fail();
  const cells = initial?.board?.cells, rows = cells?.length, cols = cells?.[0]?.length;
  if (!Array.isArray(cells) || ![6,8].includes(rows) || cols !== rows || cells.some((row:any) => !Array.isArray(row) || row.length !== cols)) return fail();
  if(raw.comboDigitScale!==undefined&&(!Number.isFinite(raw.comboDigitScale)||raw.comboDigitScale<.3||raw.comboDigitScale>1.5))return fail();
  if(raw.cleanBoardSample!==undefined&&(!Array.isArray(raw.cleanBoardSample)||raw.cleanBoardSample.length!==4||raw.cleanBoardSample.some(n=>!Number.isFinite(n)||n<0)||raw.cleanBoardSample[2]<16||raw.cleanBoardSample[3]<16||raw.cleanBoardSample[0]+raw.cleanBoardSample[2]>1080||raw.cleanBoardSample[1]+raw.cleanBoardSample[3]>1920))return fail();
  if(raw.tileGlowEvents!==undefined&&(!Array.isArray(raw.tileGlowEvents)||raw.tileGlowEvents.length>256||raw.tileGlowEvents.some(e=>!e||!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.start<0||e.end<=e.start||e.end>600||!/^#[0-9a-f]{6}$/i.test(e.color))))return fail();
  if(raw.hudDiamondTrack!==undefined){
   if(!Array.isArray(raw.hudDiamondTrack)||raw.hudDiamondTrack.length<2||raw.hudDiamondTrack.length>18000)return fail();
   let previous=-1;for(const k of raw.hudDiamondTrack){if(!Array.isArray(k)||k.length!==6||k.some(n=>!Number.isFinite(n))||k[0]<=previous||k[0]<0||k[0]>600||k[1]<0||k[1]>1080||k[2]<0||k[2]>1920||k[3]<0||k[3]>600||k[4]<0||k[4]>360||k[5]<0||k[5]>1)return fail();previous=k[0];}
  }
  const rects = raw.atlasRects;
  if (!Array.isArray(rects) || rects.length < 1 || rects.length > 96 || rects.some(r => !Array.isArray(r) || r.length !== 4 || r.some(n => !Number.isInteger(n)) || r[0] < 0 || r[1] < 0 || r[2] < 16 || r[3] < 16 || r[0] + r[2] > 8192 || r[1] + r[3] > 8192)) return fail();
  if(raw.backdropTimeline!==undefined){
    if(!Array.isArray(raw.backdropTimeline)||raw.backdropTimeline.length<1||raw.backdropTimeline.length>16)return fail();
    let last=-1;
    for(const e of raw.backdropTimeline){if(!e||!Number.isFinite(e.at)||e.at<0||e.at>600||e.at<=last||!Array.isArray(e.rect)||e.rect.length!==4||e.rect.some(n=>!Number.isInteger(n)||n<0)||e.rect[2]<1||e.rect[3]<1||e.rect[0]+e.rect[2]>8192||e.rect[1]+e.rect[3]>8192)return fail();last=e.at;}
    if(raw.backdropTimeline[0]!.at!==0)return fail();
  }
  const face = (n: unknown) => Number.isInteger(n) && Number(n) >= 0 && Number(n) < rects.length;
  if (raw.boardCelebrations !== undefined) {
    if (!raw.staticBoard || !Array.isArray(raw.boardCelebrations) || raw.boardCelebrations.length > 8) return fail();
    for (const event of raw.boardCelebrations) {
      if (!event || ![event.start, event.fillEnd, event.holdEnd, event.end].every(Number.isFinite)
        || event.start < 0 || event.fillEnd <= event.start || event.holdEnd < event.fillEnd
        || event.end <= event.holdEnd || event.end > 600
        || !Array.isArray(event.faces) || event.faces.length !== rows
        || event.faces.some(row => !Array.isArray(row) || row.length !== cols || row.some(value => !face(value)))) return fail();
    }
  }
  if(raw.faceTimeline!==undefined){
    if(!Array.isArray(raw.faceTimeline)||!raw.faceTimeline.length||raw.faceTimeline.length>32)return fail();
    let previous=-1;for(const e of raw.faceTimeline){if(!e||!Number.isFinite(e.at)||e.at<0||e.at>600||e.at<=previous||!Array.isArray(e.map)||e.map.length!==rects.length||e.map.some(n=>!face(n)))return fail();previous=e.at;}
    if(raw.faceTimeline[0]!.at!==0)return fail();
  }
  if(raw.boardSurface){const m=raw.boardSurface;if(!Number.isFinite(m.start)||!Number.isFinite(m.end)||m.start<0||m.end<=m.start||m.end>600||!Array.isArray(m.faces)||m.faces.length!==rows||m.faces.some(row=>!Array.isArray(row)||row.length!==cols||row.some(n=>!face(n)))||(m.dragPreview!==undefined&&typeof m.dragPreview!=='boolean'))return fail();}
  if (!Array.isArray(raw.initial) || raw.initial.length !== rows || raw.initial.some((row, r) => !Array.isArray(row) || row.length !== cols || row.some((n,c) => (n === null) !== (initial.board.cells[r][c] === null) || (n !== null && !face(n))))) return fail();
  if (!raw.pieces || typeof raw.pieces !== 'object' || Array.isArray(raw.pieces)) return fail();
  const pieces = new Map<string, any>();
  for (const p of [...initial.pieces, ...(initial.fixedPieceSupply ?? []).flat()]) pieces.set(p.id, p);
  if (Object.keys(raw.pieces).some(id => !pieces.has(id))) return fail();
  if(raw.rackCellSizes!==undefined&&(!raw.rackCellSizes||typeof raw.rackCellSizes!=='object'||Array.isArray(raw.rackCellSizes)||Object.entries(raw.rackCellSizes).some(([id,size])=>!pieces.has(id)||!Number.isFinite(size)||size<12||size>240)))return fail();
  if(raw.rackPositions!==undefined&&(!raw.rackPositions||typeof raw.rackPositions!=='object'||Array.isArray(raw.rackPositions)||Object.entries(raw.rackPositions).some(([id,p])=>!pieces.has(id)||!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n))||p[0]<0||p[0]>1080||p[1]<0||p[1]>1920)))return fail();
  if(raw.rackRevealTimes!==undefined&&(!raw.rackRevealTimes||typeof raw.rackRevealTimes!=='object'||Array.isArray(raw.rackRevealTimes)||Object.entries(raw.rackRevealTimes).some(([id,t])=>!pieces.has(id)||!Number.isFinite(t)||t<0||t>600)))return fail();
  if(raw.rackRevealSeconds!==undefined&&(!Number.isFinite(raw.rackRevealSeconds)||raw.rackRevealSeconds<0||raw.rackRevealSeconds>1))return fail();
  for (const [id,p] of pieces) {
    const cells = raw.pieces[id], keys = getShape(p.shapeId).cells.map(([r,c]) => `${r},${c}`);
    if (!cells || typeof cells !== 'object' || Array.isArray(cells) || Object.keys(cells).length !== keys.length || keys.some(k => !face(cells[k]))) return fail();
  }
  if(raw.after!==undefined){
    if(!raw.after||typeof raw.after!=='object'||Array.isArray(raw.after)||!nativeAfter)return fail();
    for(const [id,grid]of Object.entries(raw.after)){
      const native=nativeAfter.get(id);
      if(!native||!Array.isArray(grid)||grid.length!==rows||grid.some((row,r)=>!Array.isArray(row)||row.length!==cols||row.some((n,c)=>(n===null)!==(native[r]![c]===null)||(n!==null&&!face(n)))))return fail();
    }
  }
  if (raw.rackCenters && (!Array.isArray(raw.rackCenters) || raw.rackCenters.length !== 3 || raw.rackCenters.some(n => !Number.isFinite(n) || n < 0 || n > 1080))) return fail();
  if (raw.boardRim!==undefined && typeof raw.boardRim!=='boolean') return fail();
  for(const key of ['staticBoard','staticHud','shakeBackground','recolorFlash','showAllClear','hideDefaultPraise'] as const)if(raw[key]!==undefined&&typeof raw[key]!=='boolean')return fail();
  if (raw.praiseY!==undefined && (!Number.isFinite(raw.praiseY)||raw.praiseY<0||raw.praiseY>1920)) return fail();
  if(raw.textOverlays!==undefined){
   if(!Array.isArray(raw.textOverlays)||raw.textOverlays.length>128||raw.textOverlays.some(e=>!e||!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.start<0||e.end<=e.start||e.end>600||typeof e.text!=='string'||e.text.length>300||!Number.isFinite(e.x)||e.x<0||e.x>1080||!Number.isFinite(e.y)||e.y<0||e.y>1920||!Number.isFinite(e.size)||e.size<12||e.size>150))return fail();
  }
  if(raw.textOverlays?.some(e=>(e.weight!==undefined&&(!Number.isInteger(e.weight)||e.weight<100||e.weight>900))||(e.strokeWidth!==undefined&&(!Number.isFinite(e.strokeWidth)||e.strokeWidth<0||e.strokeWidth>30))))return fail();
  if(raw.praiseEvents!==undefined){
   if(!Array.isArray(raw.praiseEvents))return fail();
   if(raw.praiseEvents.some(e=>e?.style!==undefined&&!['inset','classic','red','measured'].includes(e.style)))return fail();
   for(const e of raw.praiseEvents){
    if(!e)return fail();
    if(e.spriteRect!==undefined){const r=e.spriteRect;if(!Array.isArray(r)||r.length!==4||r.some(n=>!Number.isInteger(n))||r[0]<0||r[1]<0||r[2]<1||r[3]<1||r[0]+r[2]>8192||r[1]+r[3]>8192)return fail();}
    if(e.palette!==undefined&&!['blue-gold','silver-lime','coral-gold','rose','yellow','winged','violet','blue-sun','cyan-rose','cream-mint','amber','purple-banner'].includes(e.palette))return fail();
    if(e.keyframes!==undefined){
     if(!Array.isArray(e.keyframes)||!e.keyframes.length||e.keyframes.length>256)return fail();
     let previous=-1;for(const k of e.keyframes){if(!Array.isArray(k)||k.length!==5||k.some(n=>!Number.isFinite(n))||k[0]<e.start||k[0]>e.end||k[0]<=previous||k[1]<0||k[1]>1080||k[2]<0||k[2]>1920||k[3]<1||k[3]>2000||k[4]<1||k[4]>1000)return fail();previous=k[0];}
    }
   }
    if(!Array.isArray(raw.praiseEvents)||raw.praiseEvents.length>2048||raw.praiseEvents.some(e=>!e||!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.start<0||e.end<=e.start||e.end>600||typeof e.label!=='string'||e.label.length>60||!Number.isInteger(e.combo)||e.combo<0||e.combo>999||!Number.isFinite(e.x)||e.x<0||e.x>1080||!Number.isFinite(e.y)||e.y<0||e.y>1920||!Number.isFinite(e.scale)||e.scale<.1||e.scale>3))return fail();
  }
  if(raw.decorations!==undefined){
   if(!Array.isArray(raw.decorations)||raw.decorations.length>2048||raw.decorations.some(e=>!e||!['hud-diamond','hud-heart','butterfly-rim','iridescent-butterfly-rim','heart-rim','paired-thumbs','flower-pop','neon-rim','tile-thumbs','spark-ring','clear-panel','hud-panel-glow'].includes(e.kind)||!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.start<0||e.end<=e.start||e.end>600||!Number.isFinite(e.x)||e.x<0||e.x>1080||!Number.isFinite(e.y)||e.y<0||e.y>1920||!Number.isFinite(e.size)||e.size<10||e.size>1200||!/^#[0-9a-f]{6}$/i.test(e.color)||(e.outline!==undefined&&typeof e.outline!=='boolean')||(e.soft!==undefined&&typeof e.soft!=='boolean')||[e.rows,e.cols].some(n=>n!==undefined&&(!Number.isInteger(n)||n<1||n>8))))return fail();
  }
  if(raw.decorations?.some(e=>e.kind==='hud-panel-glow'&&(!Array.isArray(e.rect)||e.rect.length!==4||e.rect.some(n=>!Number.isFinite(n))||e.rect[0]<0||e.rect[1]<0||e.rect[2]<=0||e.rect[3]<=0||e.rect[0]+e.rect[2]>1080||e.rect[1]+e.rect[3]>1920)))return fail();
  if(raw.linePreview!==undefined&&!['spectrum','piece','gold-outline','spectrum-outline','piece-outline','piece-glow'].includes(raw.linePreview))return fail();
  if(raw.initialRevealSeconds!==undefined&&(!Number.isFinite(raw.initialRevealSeconds)||raw.initialRevealSeconds<=0||raw.initialRevealSeconds>2))return fail();
  if(raw.cellCounters!==undefined&&(!Array.isArray(raw.cellCounters)||raw.cellCounters.length>3000||raw.cellCounters.some(e=>!e||!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.start<0||e.end<=e.start||e.end-e.start>2||e.end>600||!Number.isInteger(e.row)||e.row<0||e.row>=rows||!Number.isInteger(e.col)||e.col<0||e.col>=cols||!Number.isInteger(e.value)||e.value<1||e.value>999||!/^#[0-9a-f]{6}$/i.test(e.color)||(e.badge!==undefined&&e.badge!=='coin'))))return fail();
  if(raw.linePreviewUntil!==undefined&&(!Number.isFinite(raw.linePreviewUntil)||raw.linePreviewUntil<0||raw.linePreviewUntil>600))return fail();
  if(raw.landingPreview){const p=raw.landingPreview;if(!Number.isFinite(p.opacity)||p.opacity<0||p.opacity>1||!Number.isFinite(p.lift)||p.lift< -120||p.lift>120||(p.offsetX!==undefined&&(!Number.isFinite(p.offsetX)||p.offsetX< -120||p.offsetX>120)))return fail();}
  const best=raw.bestScore;
  if(best&&(!Number.isFinite(best.x)||best.x<0||best.x>1080||!Number.isFinite(best.y)||best.y<0||best.y>1920||!Number.isFinite(best.size)||best.size<16||best.size>200||!/^#[0-9a-f]{6}$/i.test(best.color)||typeof best.italic!=='boolean'))return fail();
  if(raw.crownRect&&(!Array.isArray(raw.crownRect)||raw.crownRect.length!==4||raw.crownRect.some(n=>!Number.isFinite(n)||n<0||n>1920)||raw.crownRect[2]<1||raw.crownRect[3]<1))return fail();
  const s = raw.score;
  if(s?.enabled!==undefined&&typeof s.enabled!=='boolean')return fail();
  if (s && (!Number.isFinite(s.x) || s.x<0 || s.x>1080 || !Number.isFinite(s.y) || s.y<0 || s.y>1920 || !Number.isFinite(s.size) || s.size<16 || s.size>200 || typeof s.italic!=='boolean' || typeof s.diamond!=='boolean' || (s.prefix!==undefined && (typeof s.prefix!=='string' || s.prefix.length>30)))) return fail();
  if(s?.scaleX!==undefined&&(!Number.isFinite(s.scaleX)||s.scaleX<.5||s.scaleX>2))return fail();
  if(s?.weight!==undefined&&(!Number.isInteger(s.weight)||s.weight<100||s.weight>900))return fail();
  return structuredClone(raw);
}

export function measuredCellColor(a: ReferenceAppearance | undefined, color: string, r: number, c: number): string {
  if (!a || !color.startsWith('observed-piece:')) return color;
  const id = color.slice('observed-piece:'.length), index = a.pieces[id]?.[`${r},${c}`];
  if (index === undefined) throw new Error('REFERENCE_APPEARANCE_CELL_MISSING');
  return `observed-face:${index}`;
}

/** Carry visual identities through the *validated* replay without editing rule state. */
export function measuredReplay(initial: any, steps: any[], a?: ReferenceAppearance) {
  if (!a) return { initial, steps };
  const piece = (p: any) => ({ ...p, color: `observed-piece:${p.id}` });
  const state = (s: any, board: any[][]) => ({ ...s, board: { ...s.board, cells: board.map(r=>[...r]) }, pieces: s.pieces.map(piece) });
  let board = a.initial.map(row=>row.map(n=>n===null?null:`observed-face:${n}`));
  const first = state(initial,board);
  const result = steps.map(st=>{
    const before = state(st.before,board), p = piece(st.piece), placedColors: Record<string,string> = {};
    board=board.map(row=>[...row]);
    for (const cell of st.placedCells) {
      const color=measuredCellColor(a,p.color,cell.row-st.action.anchor.row,cell.col-st.action.anchor.col);
      board[cell.row]![cell.col]=color; placedColors[`${cell.row},${cell.col}`]=color;
    }
    for (const cell of st.clear.cells) board[cell.row]![cell.col]=null;
    const observed=a.after?.[st.action.id];
    if(observed)board=observed.map(row=>row.map(n=>n===null?null:`observed-face:${n}`));
    return { ...st, before, after:state(st.after,board), piece:p, placedColors };
  });
  return { initial:first, steps:result };
}

export function referenceFaceAt(a: ReferenceAppearance, index:number, time:number):number {
 let mapped=index;for(const e of a.faceTimeline??[]){if(e.at>time)break;mapped=e.map[index]!;}return mapped;
}
