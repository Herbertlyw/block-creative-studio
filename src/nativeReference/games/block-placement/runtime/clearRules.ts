import type {GameSnapshot} from '../../../domain/types';
/** Reference-authored rule exceptions are turn-bound; they never inject or delete arbitrary cells. */
export function parseReferenceClearRules(value:unknown):NonNullable<GameSnapshot['referenceClearRules']>{
 if(!Array.isArray(value)||value.length>500)throw new Error('REFERENCE_CLEAR_RULES_INVALID');
 let last=-1;return value.map(e=>{if(!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).some(k=>!['turn','axes','trigger'].includes(k))||!Number.isInteger(e.turn)||e.turn<0||e.turn>499||e.turn<=last||(e.axes===undefined&&e.trigger===undefined)||(e.axes!==undefined&&!['rows','columns','both'].includes(e.axes))||(e.trigger!==undefined&&!['line-complete','board-full'].includes(e.trigger)))throw new Error('REFERENCE_CLEAR_RULES_INVALID');last=e.turn;return {...e};});
}
export function clearRuleAt(snapshot:Pick<GameSnapshot,'turn'|'clearAxes'|'clearTrigger'|'referenceClearRules'>){
 const override=snapshot.referenceClearRules?.find(e=>e.turn===snapshot.turn);
 return {axes:override?.axes??snapshot.clearAxes??'both',trigger:override?.trigger??snapshot.clearTrigger??'line-complete'};
}
