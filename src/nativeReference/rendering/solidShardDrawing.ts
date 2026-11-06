import { solidShardOpacity } from './shardOpacity';
import { drawPerspectiveShards } from './perspectiveShardDrawing';
export interface SolidShardSpec {style:string;particleFrames?:number;fadeOutFrames?:number;fragmentCount?:number;thicknessPx?:number;burstLiftPx?:number;fragmentScale?:number;spinScale?:number;perspectiveDepthPx?:number;bevelRatio?:number;textureZoom?:number;textureMapping?:'surface'|'fragment';doubleSidedTexture?:boolean;spreadPx:number;gravityPx:number;edgeColor?:string;faceColor?:string}
export interface ShardPoint {x:number;y:number}
export interface SolidShard {points:ShardPoint[];x:number;y:number}
const random=(seed:number,n:number)=>{const v=Math.sin(seed*12.9898+n*78.233)*43758.5453;return v-Math.floor(v);};
function clip(poly:ShardPoint[],nx:number,ny:number,d:number):ShardPoint[]{
  const out:ShardPoint[]=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i]!,b=poly[(i+1)%poly.length]!,da=a.x*nx+a.y*ny-d,db=b.x*nx+b.y*ny-d;
    if(da<=0)out.push(a);
    if((da<=0)!==(db<=0)){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}
  }
  return out;
}
/** Convex cells partition a rounded tile; shared edges never overlap or leave strips. */
export function solidShardMesh(width:number,height:number,count:number,seed:number):SolidShard[]{
  const radius=Math.min(width,height)*.12,outline:ShardPoint[]=[];
  for(let corner=0;corner<4;corner++)for(let step=0;step<=5;step++){
    const angle=(-Math.PI/2+corner*Math.PI/2)+step*Math.PI/10;
    outline.push({x:(corner===0||corner===1?1:-1)*(width/2-radius)+Math.cos(angle)*radius,y:(corner<2?corner===0?-1:1:corner===2?1:-1)*(height/2-radius)+Math.sin(angle)*radius});
  }
  const cols=Math.ceil(Math.sqrt(count*width/height)),rows=Math.ceil(count/cols);
  const sites=Array.from({length:count},(_,i)=>({x:((i%cols+.18+random(seed,i*2)*.64)/cols-.5)*width,y:((Math.floor(i/cols)+.18+random(seed,i*2+1)*.64)/rows-.5)*height}));
  return sites.map((site,i)=>{
    let points=outline;
    for(let j=0;j<sites.length&&points.length;j++)if(i!==j){const other=sites[j]!;points=clip(points,other.x-site.x,other.y-site.y,(other.x**2+other.y**2-site.x**2-site.y**2)/2);}
    return {points,x:points.reduce((n,p)=>n+p.x,0)/points.length,y:points.reduce((n,p)=>n+p.y,0)/points.length};
  }).filter(s=>s.points.length>=3);
}
export function solidShardTravel(spec:SolidShardSpec,p:number,seed:number,i:number,x:number,width:number){
  const stone=spec.style==='stone-crumble';
  const lift=spec.burstLiftPx??(stone?0:spec.spreadPx*2.8);
  return {x:(x/width*1.4+(random(seed,i+131)-.5)*.5)*spec.spreadPx*p,
    y:-lift*(.65+random(seed,i+71)*.55)*p+(stone?25+random(seed,i+27)*75:0)*p+spec.gravityPx*p*p};
}
function color(hex:string,factor:number){const n=parseInt(hex.slice(1),16);return `rgb(${[n>>16,n>>8&255,n&255].map(v=>Math.round(Math.min(255,v*factor))).join(',')})`;}
const caches=new WeakMap<HTMLCanvasElement,Map<string,{mesh:SolidShard[];cx:number;cy:number}>>();
function spriteMesh(sprite:HTMLCanvasElement,width:number,height:number,count:number,seed:number){
  let cache=caches.get(sprite);if(!cache){cache=new Map();caches.set(sprite,cache);}const key=[width,height,count,seed].join(':');const old=cache.get(key);if(old)return old;
  const pixels=sprite.getContext('2d')!.getImageData(0,0,sprite.width,sprite.height).data;
  let x0=sprite.width,y0=sprite.height,x1=0,y1=0;
  for(let y=0;y<sprite.height;y++)for(let x=0;x<sprite.width;x++)if(pixels[(y*sprite.width+x)*4+3]!>96){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
  const w=(x1-x0+1)/sprite.width*width,h=(y1-y0+1)/sprite.height*height,cx=(x0+x1+1)/2/sprite.width*width-width/2,cy=(y0+y1+1)/2/sprite.height*height-height/2;
  const result={mesh:w>0&&h>0?solidShardMesh(w,h,count,seed):[],cx,cy};cache.set(key,result);return result;
}
/** Orthographic projection of actual extruded polygons; front UVs follow the current tile artwork. */
export function drawSolidShards(ctx:CanvasRenderingContext2D,sprite:HTMLCanvasElement,width:number,height:number,spec:SolidShardSpec,p:number,seed:number,origin={x:0,y:0}){
  const stone=spec.style==='stone-crumble',count=spec.fragmentCount??(stone?56:28);
  const {mesh,cx,cy}=spriteMesh(sprite,width,height,count,seed);
  if(spec.perspectiveDepthPx!==undefined){drawPerspectiveShards(ctx,sprite,width,height,spec,p,seed,mesh,cx,cy,origin);return;}
  const edge=spec.edgeColor??(stone?'#8a8173':'#8ba6de'),back=spec.faceColor??(stone?'#b6aa94':'#eaf1ff');
  const fade=solidShardOpacity(spec,p,.18);
  const shards=mesh.map((shard,i)=>({shard,i,z:Math.sin(p*(3+random(seed,i+5)*5))*20})).sort((a,b)=>a.z-b.z);
  for(const {shard,i} of shards){
    const spin=p*(spec.spinScale??1);
    const dx=solidShardTravel(spec,p,seed,i,shard.x,width),rx=spin*(2.8+random(seed,i+151)*5)*(random(seed,i+81)>.5?1:-1),ry=spin*(2+random(seed,i+191)*6),rz=(random(seed,i+83)-.5)*6*spin;
    const sx=Math.sin(rx),cxr=Math.cos(rx),sy=Math.sin(ry),cyr=Math.cos(ry),sz=Math.sin(rz),cz=Math.cos(rz);
    const rotate=(x:number,y:number,z:number)=>{const y1=y*cxr-z*sx,z1=y*sx+z*cxr,x2=x*cyr+z1*sy,z2=-x*sy+z1*cyr;return {x:x2*cz-y1*sz,y:x2*sz+y1*cz,z:z2};};
    const thick=(spec.thicknessPx??(stone?5:9))*(.7+random(seed,i+113)*.6)*Math.min(1,p*18),half=thick/2;
    const top=shard.points.map(v=>rotate(v.x-shard.x,v.y-shard.y,half)),bottom=shard.points.map(v=>rotate(v.x-shard.x,v.y-shard.y,-half));
    ctx.save();ctx.globalAlpha*=fade;ctx.translate(cx+shard.x+dx.x,cy+shard.y+dx.y);
    const opening=1+Math.min(1,p*10)*(spec.fragmentScale===undefined?(stone?.06:.2):spec.fragmentScale-1);ctx.scale(opening,opening);
    const path=(points:ShardPoint[])=>{ctx.beginPath();points.forEach((v,n)=>n?ctx.lineTo(v.x,v.y):ctx.moveTo(v.x,v.y));ctx.closePath();};
    const walls=top.map((v,n)=>{const j=(n+1)%top.length;return {points:[v,top[j]!,bottom[j]!,bottom[n]!],depth:(v.z+top[j]!.z+bottom[j]!.z+bottom[n]!.z)/4,n};}).sort((a,b)=>a.depth-b.depth);
    for(const wall of walls){path(wall.points);ctx.fillStyle=color(edge,.68+random(seed,wall.n+i*13)*.42);ctx.fill();}
    const normal=rotate(0,0,1),face=normal.z>=0?top:bottom;
    path(face);ctx.save();ctx.clip();
    if(normal.z>=0){
      const a=rotate(1,0,0),b=rotate(0,1,0),o=rotate(0,0,half);
      ctx.transform(a.x,a.y,b.x,b.y,o.x,o.y);ctx.drawImage(sprite,-width/2-cx-shard.x,-height/2-cy-shard.y,width,height);
      ctx.globalCompositeOperation='source-atop'; // Facet shading is restrained to retain printed detail.
      ctx.fillStyle=`rgba(20,35,62,${Math.max(0,(1-normal.z)*.12)})`;ctx.fillRect(-width,-height,width*2,height*2);
    }else{ctx.fillStyle=color(back,.77+Math.abs(normal.z)*.2);ctx.fill();}
    ctx.restore();
    path(face);ctx.strokeStyle=color(edge,1.18);ctx.lineWidth=.55;ctx.globalAlpha*=Math.min(1,p*12)*.5;ctx.stroke();ctx.restore();
  }
}
export function drawStarlight(ctx:CanvasRenderingContext2D,width:number,height:number,age:number,exitFrames:number,particleFrames:number,seed:number){
  const p=Math.max(0,Math.min(1,age/(exitFrames+particleFrames))),intensity=Math.sin(Math.PI*p)**.8;
  ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha*=intensity;
  const radius=Math.min(width,height)*(.21+.1*p),cy=height*.10;
  const glow=ctx.createRadialGradient(0,cy,0,0,cy,radius);glow.addColorStop(0,'rgba(216,255,247,.5)');glow.addColorStop(.35,'rgba(155,238,226,.22)');glow.addColorStop(1,'rgba(130,210,225,0)');
  ctx.fillStyle=glow;ctx.fillRect(-radius,cy-radius,radius*2,radius*2);
  for(let i=0;i<9;i++){
    const angle=i*2.4+seed,dist=radius*(.25+random(seed,i)*.85)*(0.65+p*.45),x=Math.cos(angle)*dist,y=cy+Math.sin(angle)*dist-p*12;
    const blink=Math.sin(Math.min(1,Math.max(0,(p-random(seed,i+21)*.18)/.75))*Math.PI),size=(2+random(seed,i+31)*4)*Math.max(0,blink);
    ctx.fillStyle='#eaffff';ctx.shadowColor='#a6efdd';ctx.shadowBlur=5;ctx.beginPath();ctx.moveTo(x,y-size*1.8);ctx.quadraticCurveTo(x,y,x+size,y);ctx.quadraticCurveTo(x,y,x,y+size*1.8);ctx.quadraticCurveTo(x,y,x-size,y);ctx.quadraticCurveTo(x,y,x,y-size*1.8);ctx.fill();
  }
  ctx.restore();
}
