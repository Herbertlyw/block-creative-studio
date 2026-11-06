/** Measured UI-only meter. Values do not affect the game's score or rules. */
export interface ReferenceProgressHud {
 start:number;end:number;rect:[number,number,number,number];kind:'bar'|'bubble';
 fill:string;background:string;border:string;max:number;labelSize:number;goalLabel?:string;
 track:Array<{at:number;value:number;label?:string;suffix?:string}>;
}
export function parseProgressHud(raw:unknown):ReferenceProgressHud[]{
 const bad=()=>{throw new Error('REFERENCE_PROGRESS_HUD_INVALID');};
 if(!Array.isArray(raw)||raw.length>32)return bad();
 return raw.map(e=>{
  if(!e||!['bar','bubble'].includes(e.kind)||!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.start<0||e.end<=e.start||e.end>600||!Array.isArray(e.rect)||e.rect.length!==4||e.rect.some((n:unknown)=>typeof n!=='number'||!Number.isFinite(n))||e.rect[0]<0||e.rect[1]<0||e.rect[2]<=0||e.rect[3]<=0||e.rect[0]+e.rect[2]>1080||e.rect[1]+e.rect[3]>1920||[e.fill,e.background,e.border].some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c))||!Number.isFinite(e.max)||e.max<=0||e.max>Number.MAX_SAFE_INTEGER||!Number.isFinite(e.labelSize)||e.labelSize<12||e.labelSize>150||(e.goalLabel!==undefined&&(typeof e.goalLabel!=='string'||e.goalLabel.length>24))||!Array.isArray(e.track)||!e.track.length||e.track.length>18000)return bad();
  let last=-1;for(const k of e.track){if(!k||!Number.isFinite(k.at)||k.at<e.start||k.at>e.end||k.at<=last||!Number.isFinite(k.value)||k.value<0||k.value>e.max||[k.label,k.suffix].some(v=>v!==undefined&&(typeof v!=='string'||v.length>32)))return bad();last=k.at;}if(e.track[0].at!==e.start)return bad();
  return structuredClone(e) as ReferenceProgressHud;
 });
}
export function progressHudAt(m:ReferenceProgressHud,t:number){
 const prev=[...m.track].reverse().find(e=>e.at<=t)??m.track[0]!;
 return {fraction:Math.max(0,Math.min(1,prev.value/m.max)),value:prev.value,label:prev.label??String(Math.round(prev.value)),suffix:prev.suffix??''};
}
