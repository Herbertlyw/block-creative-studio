/** A compact reference for detecting mux/decode offsets without storing PCM. */
export function audioRmsEnvelope(data:ArrayLike<number>,sampleRate:number,channels:number,intervalSeconds=.01):number[] {
  const size=Math.max(1,Math.round(sampleRate*channels*intervalSeconds)),result:number[]=[];
  for(let start=0;start<data.length;start+=size) {
    const end=Math.min(start+size,data.length);let squares=0;
    for(let i=start;i<end;i++)squares+=(data[i]??0)**2;
    result.push(Math.sqrt(squares/(end-start)));
  }
  return result;
}

/** Positive offset means the decoded sound arrives later than its reference.
 * Energy correlation tolerates AAC's waveform changes while retaining onsets. */
export function compareAudioEnvelopes(reference:readonly number[],decoded:readonly number[],intervalSeconds=.01) {
  if(!Number.isFinite(intervalSeconds)||intervalSeconds<.001||intervalSeconds>.1)throw new Error('AUDIO_ENVELOPE_INTERVAL_INVALID');
  const maxLag=Math.round(.15/intervalSeconds);let best={lag:0,correlation:-1};
  for(let lag=-maxLag;lag<=maxLag;lag++) {
    let n=0,x=0,y=0,xx=0,yy=0,xy=0;
    for(let i=Math.max(0,-lag);i<Math.min(reference.length,decoded.length-lag);i++) {
      const a=reference[i]!,b=decoded[i+lag]!;if(!Number.isFinite(a)||!Number.isFinite(b))continue;
      n++;x+=a;y+=b;xx+=a*a;yy+=b*b;xy+=a*b;
    }
    const divisor=Math.sqrt(Math.max(0,n*xx-x*x)*Math.max(0,n*yy-y*y));
    const correlation=n>=20&&divisor>1e-12?(n*xy-x*y)/divisor:-1;
    if(correlation>best.correlation)best={lag,correlation};
  }
  const offsetSeconds=best.lag*intervalSeconds;
  return {ok:best.correlation>=.94&&Math.abs(offsetSeconds)<=1/30,offsetSeconds,correlation:best.correlation,resolutionSeconds:intervalSeconds,maximumOffsetSeconds:1/30,minimumCorrelation:.94};
}
