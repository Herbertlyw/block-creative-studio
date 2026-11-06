import { CLEAR_EFFECT_LIBRARY_SCHEMA, type ClearEffectLibrary } from './effectLibrary';
/** Optional presentation-only controls. Missing sections preserve historical output. */
export interface ReferenceEffects {
  /** Optional reusable, transparent fragment atlas crops; physics remain procedural. */
  stoneFragmentRects?: Array<[number,number,number,number]>;
  stoneFragmentScale?: number;
  stoneLiftScale?: number;
  stoneGravityScale?: number;
  stoneLifeScale?: number;
  stoneDustGlow?: boolean;
  clearSweep?: { enabled:boolean; durationSeconds:number; direction:'forward'|'reverse'; color:string };
  screenAtmosphere?: { enabled:boolean; style:'glacial-wings'|'aurora-veil'|'solar-corona'|'glacial-surge'|'star-warp'|'solar-flare'; intensity:number };
  likes?: { enabled:boolean; trigger:'authored'|'combo'; style:'pink-cluster'|'blue-badge'; minCombo:number; scale:number };
  butterflyRim?: { enabled:boolean; minCombo:number; density:number };
  rackGlow?: { enabled:boolean; intensity:number };
  selectionGlow?: { enabled:boolean; intensity:number; haloPx:number; edgePx:number };
  scoreHud?: { enabled:boolean; interpolate:boolean; diamondPulse:boolean };
  perfectCelebration?: { enabled:boolean; density:number };
  comboMotion?: 'legacy'|'layered';
  clearPolish?: boolean;
  library?: ClearEffectLibrary;
}
const number=(min:number,max:number,integer=false)=>({type:integer?'integer':'number',minimum:min,maximum:max});
const section=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const REFERENCE_EFFECTS_SCHEMA=section({
  stoneLiftScale:number(.1,2),stoneGravityScale:number(.1,3),stoneLifeScale:number(.5,2),
  stoneFragmentScale:number(.25,4),stoneDustGlow:{type:'boolean'},
  stoneFragmentRects:{type:'array',minItems:1,maxItems:32,items:{type:'array',minItems:4,maxItems:4,items:number(0,8192,true)}},
  clearSweep:section({enabled:{type:'boolean'},durationSeconds:number(.1,2),direction:{enum:['forward','reverse']},color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'}}),
  screenAtmosphere:section({enabled:{type:'boolean'},style:{enum:['glacial-wings','aurora-veil','solar-corona','glacial-surge','star-warp','solar-flare']},intensity:number(0,1)}),
  likes:section({enabled:{type:'boolean'},trigger:{enum:['authored','combo']},style:{enum:['pink-cluster','blue-badge']},minCombo:number(1,999,true),scale:number(.3,2)}),
  butterflyRim:section({enabled:{type:'boolean'},minCombo:number(1,999,true),density:number(4,64,true)}),
  rackGlow:section({enabled:{type:'boolean'},intensity:number(0,1)}),
  selectionGlow:section({enabled:{type:'boolean'},intensity:number(0,1),haloPx:number(0,40),edgePx:number(.5,6)}),
  scoreHud:section({enabled:{type:'boolean'},interpolate:{type:'boolean'},diamondPulse:{type:'boolean'}}),
  perfectCelebration:section({enabled:{type:'boolean'},density:number(8,120,true)}),
  comboMotion:{enum:['legacy','layered']},clearPolish:{type:'boolean'},
  library:CLEAR_EFFECT_LIBRARY_SCHEMA,
});
REFERENCE_EFFECTS_SCHEMA.required=[];

export function parseReferenceEffects(value:unknown):ReferenceEffects {
  function validate(v:unknown,s:any,path:string){
    if(s.enum){if(!s.enum.includes(v))throw new Error(`REFERENCE_EFFECTS_INVALID:${path}`);return;}
    if(s.type==='object'){
      if(!v||typeof v!=='object'||Array.isArray(v))throw new Error(`REFERENCE_EFFECTS_INVALID:${path}`);
      const o=v as Record<string,unknown>;
      if(Object.keys(o).some(k=>!Object.hasOwn(s.properties,k))||s.required.some((k:string)=>!Object.hasOwn(o,k)))throw new Error(`REFERENCE_EFFECTS_INVALID:${path}`);
      for(const[k,q]of Object.entries(o))validate(q,s.properties[k],`${path}.${k}`);
    }else if(s.type==='array'){
      if(!Array.isArray(v)||v.length<s.minItems||v.length>s.maxItems)throw new Error(`REFERENCE_EFFECTS_INVALID:${path}`);
      v.forEach((q,i)=>validate(q,s.items,`${path}[${i}]`));
    }else if(s.type==='string'){if(typeof v!=='string'||(s.pattern&&!new RegExp(s.pattern).test(v)))throw new Error(`REFERENCE_EFFECTS_INVALID:${path}`);}
    else if(s.type==='boolean') {if(typeof v!=='boolean')throw new Error(`REFERENCE_EFFECTS_INVALID:${path}`);}
    else if(typeof v!=='number'||!Number.isFinite(v)||v<s.minimum||v>s.maximum||(s.type==='integer'&&!Number.isInteger(v)))throw new Error(`REFERENCE_EFFECTS_INVALID:${path}`);
  }
  validate(value,REFERENCE_EFFECTS_SCHEMA,'effects');
  const effects=value as ReferenceEffects;
  if(effects.stoneFragmentRects?.some(([x,y,w,h])=>w<16||h<16||x+w>8192||y+h>8192))throw new Error('REFERENCE_EFFECTS_INVALID:effects.stoneFragmentRects');
  return structuredClone(effects);
}
