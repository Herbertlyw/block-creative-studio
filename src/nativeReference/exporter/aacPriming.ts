import {AudioSampleSink,BlobSource,Input,Mp4InputFormat} from 'mediabunny';
import {audioRmsEnvelope,compareAudioEnvelopes} from '../rendering/audioEnvelope';

interface Box {type:string;start:number;end:number;header:number}
const decoder=new TextDecoder(),encoder=new TextEncoder();
function boxes(bytes:Uint8Array,start=0,end=bytes.length):Box[] {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),result:Box[]=[];
  for(let offset=start;offset<end;) {
    if(offset+8>end)throw new Error('MP4_BOX_TRUNCATED');
    let size=view.getUint32(offset),header=8;
    if(size===1){if(offset+16>end)throw new Error('MP4_BOX_TRUNCATED');size=Number(view.getBigUint64(offset+8));header=16;}
    if(size===0)size=end-offset;
    if(!Number.isSafeInteger(size)||size<header||offset+size>end)throw new Error('MP4_BOX_SIZE_INVALID');
    result.push({type:decoder.decode(bytes.subarray(offset+4,offset+8)),start:offset,end:offset+size,header});offset+=size;
  }
  return result;
}
const join=(parts:Uint8Array[])=>{const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;};
function box(type:string,parts:Uint8Array[]):Uint8Array {
  const body=join(parts),out=new Uint8Array(body.length+8);new DataView(out.buffer).setUint32(0,out.length);out.set(encoder.encode(type),4);out.set(body,8);return out;
}
function timescale(bytes:Uint8Array,b:Box) {const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return view.getUint32(b.start+b.header+(bytes[b.start+b.header]===1?20:12));}
function setDuration(bytes:Uint8Array,b:Box,value:number,trackHeader=false) {
  const clone=bytes.slice(b.start,b.end),view=new DataView(clone.buffer),v=clone[b.header];
  const offset=b.header+(trackHeader?(v===1?28:20):(v===1?24:16));
  if(v===1)view.setBigUint64(offset,BigInt(Math.round(value)));else view.setUint32(offset,Math.round(value));
  return clone;
}

/** Keep every AAC packet and tell players to discard measured encoder priming.
 * Relocate moov to EOF, leaving an equal-size free box in its old location, so
 * all existing stco/co64 media offsets remain valid, including fast-start MP4. */
export function trimAacPriming(bytes:Uint8Array,offsetSeconds:number,durationSeconds:number):Uint8Array {
  if(!Number.isFinite(offsetSeconds)||offsetSeconds<0||offsetSeconds>.15||!Number.isFinite(durationSeconds)||durationSeconds<=0)throw new Error('AAC_PRIMING_RANGE_INVALID');
  const roots=boxes(bytes),moov=roots.find(b=>b.type==='moov');if(!moov)throw new Error('MP4_MOOV_MISSING');
  const children=boxes(bytes,moov.start+moov.header,moov.end),mvhd=children.find(b=>b.type==='mvhd');if(!mvhd)throw new Error('MP4_MVHD_MISSING');
  const movieScale=timescale(bytes,mvhd);let audioTracks=0;
  const rebuilt=children.map(child=>{
    if(child.type==='mvhd')return setDuration(bytes,child,durationSeconds*movieScale);
    if(child.type!=='trak')return bytes.slice(child.start,child.end);
    const parts=boxes(bytes,child.start+child.header,child.end),mdia=parts.find(b=>b.type==='mdia');
    if(!mdia)return bytes.slice(child.start,child.end);
    const media=boxes(bytes,mdia.start+mdia.header,mdia.end),hdlr=media.find(b=>b.type==='hdlr');
    if(!hdlr||decoder.decode(bytes.subarray(hdlr.start+hdlr.header+8,hdlr.start+hdlr.header+12))!=='soun')return bytes.slice(child.start,child.end);
    audioTracks++;if(parts.some(b=>b.type==='edts'))throw new Error('AAC_PRIMING_EXISTING_EDIT_LIST');
    const mdhd=media.find(b=>b.type==='mdhd');if(!mdhd)throw new Error('MP4_MDHD_MISSING');
    const payload=new Uint8Array(20),view=new DataView(payload.buffer);
    view.setUint32(4,1);view.setUint32(8,Math.round(durationSeconds*movieScale));view.setInt32(12,Math.round(offsetSeconds*timescale(bytes,mdhd)));view.setInt16(16,1);
    const edts=box('edts',[box('elst',[payload])]);
    return box('trak',[...parts.map(part=>part.type==='tkhd'?setDuration(bytes,part,durationSeconds*movieScale,true):bytes.slice(part.start,part.end)),edts]);
  });
  if(audioTracks!==1)throw new Error('AAC_PRIMING_REQUIRES_ONE_AUDIO_TRACK');
  const original=bytes.slice();original.set(encoder.encode('free'),moov.start+4);
  return join([original,box('moov',rebuilt)]);
}

/** Tonal BGM can change sub-millisecond phase under AAC. Smooth RMS power,
 * keeping the original 1 ms lag grid and the same correlation threshold. */
export function compareAacPrimingEnvelopes(reference:number[],decoded:number[]){
  let best=compareAudioEnvelopes(reference,decoded,.001);
  const smooth=(values:number[],radius:number)=>values.map((_,i)=>{
    const start=Math.max(0,i-radius),end=Math.min(values.length,i+radius+1);
    let power=0;for(let k=start;k<end;k++)power+=values[k]!*values[k]!;
    return Math.sqrt(power/(end-start));
  });
  for(const radius of [2,5]){
    if(best.correlation>=.94)break;
    const candidate=compareAudioEnvelopes(smooth(reference,radius),smooth(decoded,radius),.001);
    if(candidate.correlation>best.correlation)best=candidate;
  }
  return best;
}

export async function measureAacOffset(blob:Blob,audio:{data:Float32Array;sampleRate:number;numberOfChannels:number},signal?:AbortSignal) {
  signal?.throwIfAborted();
  const {data,sampleRate,numberOfChannels:channels}=audio;
  let first=0;while(first<data.length&&Math.abs(data[first]!)<.0001)first++;
  if(first===data.length)return {offsetSeconds:0,correlation:1,silent:true};
  const frames=Math.min(data.length/channels,Math.ceil((first/channels/sampleRate+2)*sampleRate));
  const decoded=new Float32Array(frames*channels),input=new Input({source:new BlobSource(blob),formats:[new Mp4InputFormat()]});
  const cancel=()=>input.dispose();
  signal?.addEventListener('abort',cancel,{once:true});
  try {
    const track=await input.getPrimaryAudioTrack();if(!track)throw new Error('AAC_PRIMING_TRACK_MISSING');
    signal?.throwIfAborted();
    const sink=new AudioSampleSink(track);
    // An edit list can put AAC priming packets before zero. Decode them too:
    // seeking to zero cold-starts the decoder and can create a false extra delay.
    // The copy below still clips negative samples from the measured timeline.
    for await(const sample of sink.samples(undefined,frames/sampleRate)) {
      try {
        signal?.throwIfAborted();
        if(sample.sampleRate!==sampleRate||sample.numberOfChannels!==channels)throw new Error('AAC_PRIMING_FORMAT_CHANGED');
        const values=new Float32Array(sample.numberOfFrames*channels);sample.copyTo(values,{format:'f32',planeIndex:0});
        const start=Math.round(sample.timestamp*sampleRate)*channels;
        const from=Math.max(0,-start),to=Math.min(values.length,decoded.length-start);
        if(to>from)decoded.set(values.subarray(from,to),Math.max(0,start));
      } finally {sample.close();}
    }
    const match=compareAacPrimingEnvelopes(audioRmsEnvelope(data.subarray(0,frames*channels),sampleRate,channels,.001),audioRmsEnvelope(decoded,sampleRate,channels,.001));
    if(match.correlation<.94)throw new Error(`AAC_PRIMING_CALIBRATION_FAILED: ${match.correlation}`);
    return {offsetSeconds:match.offsetSeconds,correlation:match.correlation,silent:false};
  } finally {signal?.removeEventListener('abort',cancel);input.dispose();}
}

export async function alignAacPriming(blob:Blob,audio:{data:Float32Array;sampleRate:number;numberOfChannels:number},durationSeconds:number,signal?:AbortSignal) {
  const measured=await measureAacOffset(blob,audio,signal);
  signal?.throwIfAborted();
  if(measured.offsetSeconds<-.001)throw new Error('AAC_PRIMING_UNEXPECTED_NEGATIVE_OFFSET');
  const aligned=measured.offsetSeconds>.001?new Blob([trimAacPriming(new Uint8Array(await blob.arrayBuffer()),measured.offsetSeconds,durationSeconds)],{type:'video/mp4'}):blob;
  signal?.throwIfAborted();
  const after=await measureAacOffset(aligned,audio,signal);
  if(Math.abs(after.offsetSeconds)>.01)throw new Error(`AAC_PRIMING_ALIGNMENT_FAILED: ${after.offsetSeconds}`);
  return {blob:aligned,verification:{measuredOffsetSeconds:measured.offsetSeconds,remainingOffsetSeconds:after.offsetSeconds,correlation:after.correlation,method:'measured-aac-edit-list' as const}};
}
