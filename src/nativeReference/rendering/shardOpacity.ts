import type { SolidShardSpec } from './solidShardDrawing';

/** An explicit zero holds opaque debris until it leaves the frame. Omission preserves the old envelope. */
export function solidShardOpacity(spec:SolidShardSpec,p:number,legacyFadeFraction:number):number {
  if(spec.fadeOutFrames===0)return 1;
  const fadeFraction=spec.fadeOutFrames===undefined?legacyFadeFraction:Math.min(1,spec.fadeOutFrames/Math.max(1,spec.particleFrames??28));
  return Math.max(0,Math.min(1,(1-p)/fadeFraction));
}
