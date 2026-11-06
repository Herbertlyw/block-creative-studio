import type { SolidShard, SolidShardSpec } from './solidShardDrawing';
import { solidShardOpacity } from './shardOpacity';

export interface FracturePoint { x:number; y:number; z:number }
interface Vertex extends FracturePoint { u:number; v:number }
interface Surface { vertices:Vertex[]; textured:boolean; normal:FracturePoint; depth:number }
export const FRACTURE_FOCAL_LENGTH = 1800;
const noise=(seed:number,n:number)=>{const t=Math.sin(seed*12.9898+n*78.233)*43758.5453;return t-Math.floor(t);};
/** Every tray slot supplies the same stage-space principal point, expressed locally. */
export function projectFracturePoint(point:FracturePoint,origin:{x:number;y:number}) {
  const scale=FRACTURE_FOCAL_LENGTH/(FRACTURE_FOCAL_LENGTH-point.z);
  return {x:origin.x+(point.x-origin.x)*scale,y:origin.y+(point.y-origin.y)*scale};
}
function normal(vertices:Vertex[]):FracturePoint {
  const a=vertices[0]!,b=vertices[1]!,c=vertices[2]!;
  const u={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},v={x:c.x-a.x,y:c.y-a.y,z:c.z-a.z};
  const n={x:u.y*v.z-u.z*v.y,y:u.z*v.x-u.x*v.z,z:u.x*v.y-u.y*v.x},length=Math.hypot(n.x,n.y,n.z)||1;
  return {x:n.x/length,y:n.y/length,z:n.z/length};
}
function shade(hex:string,intensity:number){const value=parseInt(hex.slice(1),16);return `rgb(${[value>>16,value>>8&255,value&255].map(x=>Math.round(Math.min(255,x*intensity))).join(',')})`;}
/** Convex, bevelled fragments: each surface has a real normal, depth and UV coordinates. */
export function perspectiveShardSurfaces(shard:SolidShard,spec:SolidShardSpec,p:number,seed:number,i:number,width:number,cx:number,cy:number):Surface[] {
  const spin=p*(spec.spinScale??1),rx=spin*(2.8+noise(seed,i+151)*5)*(noise(seed,i+81)>.5?1:-1),ry=spin*(2+noise(seed,i+191)*6),rz=(noise(seed,i+83)-.5)*6*spin;
  const rotate=(x:number,y:number,z:number)=>{const y1=y*Math.cos(rx)-z*Math.sin(rx),z1=y*Math.sin(rx)+z*Math.cos(rx),x2=x*Math.cos(ry)+z1*Math.sin(ry),z2=-x*Math.sin(ry)+z1*Math.cos(ry);return {x:x2*Math.cos(rz)-y1*Math.sin(rz),y:x2*Math.sin(rz)+y1*Math.cos(rz),z:z2};};
  const age=Math.min(1,p*10),scale=1+age*((spec.fragmentScale??1)-1),thickness=(spec.thicknessPx??12)*(.75+noise(seed,i+113)*.5)*Math.min(1,p*18),bevel=(spec.bevelRatio??.13)*age;
  const dx=(shard.x/width*1.4+(noise(seed,i+131)-.5)*.5)*spec.spreadPx*p;
  const dy=-(spec.burstLiftPx??500)*(.65+noise(seed,i+71)*.55)*p+spec.gravityPx*p*p;
  const dz=(spec.perspectiveDepthPx??0)*Math.sin(Math.min(1,p/.85)*Math.PI/2)*(.8+noise(seed,i+201)*.2);
  const bounds={x0:Math.min(...shard.points.map(v=>v.x)),x1:Math.max(...shard.points.map(v=>v.x)),y0:Math.min(...shard.points.map(v=>v.y)),y1:Math.max(...shard.points.map(v=>v.y))};
  const uv=(x:number,y:number)=>{const zoom=1+age*((spec.textureZoom??1)-1);if(spec.textureMapping!=='fragment')return {u:cx+x/zoom,v:cy+y/zoom};const mix=Math.min(1,p*12);return {u:cx+x*(1-mix)+(shard.x*.5+((x-bounds.x0)/(bounds.x1-bounds.x0)-.5)*width*.68/zoom)*mix,v:cy+y*(1-mix)+(shard.y*.5+((y-bounds.y0)/(bounds.y1-bounds.y0)-.5)*width*.68/zoom)*mix};};
  const ring=(inset:number,z:number)=>shard.points.map(v=>{
    const x=shard.x+(v.x-shard.x)*inset,y=shard.y+(v.y-shard.y)*inset;
    const rotated=rotate((x-shard.x)*scale,(y-shard.y)*scale,z*scale);
    return {...rotated,x:rotated.x+cx+shard.x+dx,y:rotated.y+cy+shard.y+dy,z:rotated.z+dz,...uv(x,y)};
  });
  // At p=0 the upper polygon exactly reconstructs the source plane.
  const top=ring(1-bevel,0),shoulder=ring(1,-thickness*.23),bottom=ring(1-bevel*.65,-thickness);
  const faces:{vertices:Vertex[];textured:boolean}[]=[{vertices:top,textured:true},{vertices:[...bottom].reverse(),textured:spec.doubleSidedTexture??false}];
  for(let n=0;n<top.length;n++){const j=(n+1)%top.length;faces.push({vertices:[top[n]!,shoulder[n]!,shoulder[j]!,top[j]!],textured:false},{vertices:[shoulder[n]!,bottom[n]!,bottom[j]!,shoulder[j]!],textured:false});}
  return faces.map(face=>({...face,normal:normal(face.vertices),depth:face.vertices.reduce((s,v)=>s+v.z,0)/face.vertices.length}));
}
function path(ctx:CanvasRenderingContext2D,points:{x:number;y:number}[]) {ctx.beginPath();points.forEach((v,i)=>i?ctx.lineTo(v.x,v.y):ctx.moveTo(v.x,v.y));ctx.closePath();}
function textureTriangle(ctx:CanvasRenderingContext2D,sprite:HTMLCanvasElement,vertices:Vertex[],width:number,height:number,origin:{x:number;y:number}) {
  const a=vertices[0]!,b=vertices[1]!,c=vertices[2]!,p=vertices.map(v=>projectFracturePoint(v,origin));
  const ux=b.u-a.u,uy=b.v-a.v,vx=c.u-a.u,vy=c.v-a.v,det=ux*vy-vx*uy;
  if(Math.abs(det)<1e-8)return;
  const ex=p[1]!.x-p[0]!.x,ey=p[1]!.y-p[0]!.y,fx=p[2]!.x-p[0]!.x,fy=p[2]!.y-p[0]!.y;
  const m0=(ex*vy-fx*uy)/det,m1=(ey*vy-fy*uy)/det,m2=(fx*ux-ex*vx)/det,m3=(fy*ux-ey*vx)/det;
  const center={x:(p[0]!.x+p[1]!.x+p[2]!.x)/3,y:(p[0]!.y+p[1]!.y+p[2]!.y)/3};
  const expanded=p.map(v=>{const dx=v.x-center.x,dy=v.y-center.y,length=Math.hypot(dx,dy)||1;return {x:v.x+dx/length*.45,y:v.y+dy/length*.45};});
  ctx.save();path(ctx,expanded);ctx.clip();ctx.transform(m0,m1,m2,m3,p[0]!.x-m0*a.u-m2*a.v,p[0]!.y-m1*a.u-m3*a.v);ctx.drawImage(sprite,-width/2,-height/2,width,height);ctx.restore();
}
export function drawPerspectiveShards(ctx:CanvasRenderingContext2D,sprite:HTMLCanvasElement,width:number,height:number,spec:SolidShardSpec,p:number,seed:number,mesh:SolidShard[],cx:number,cy:number,origin:{x:number;y:number}) {
  const surfaces=mesh.flatMap((shard,i)=>perspectiveShardSurfaces(shard,spec,p,seed,i,width,cx,cy)).sort((a,b)=>a.depth-b.depth);
  ctx.save();ctx.globalAlpha*=solidShardOpacity(spec,p,.12);
  for(const surface of surfaces){
    const {vertices,normal:n}=surface,center=vertices.reduce((s,v)=>({x:s.x+v.x/vertices.length,y:s.y+v.y/vertices.length,z:s.z+v.z/vertices.length}),{x:0,y:0,z:0});
    // Back-face culling uses the shared camera, rather than a per-particle facing test.
    if(n.x*(origin.x-center.x)+n.y*(origin.y-center.y)+n.z*(FRACTURE_FOCAL_LENGTH-center.z)<=0)continue;
    const points=vertices.map(v=>projectFracturePoint(v,origin));
    const light=Math.max(0,(-n.x*.36-n.y*.5+n.z*.79));
    if(surface.textured){
      ctx.save();path(ctx,points);ctx.clip();
      for(let j=1;j<vertices.length-1;j++)textureTriangle(ctx,sprite,[vertices[0]!,vertices[j]!,vertices[j+1]!],width,height,origin);
      ctx.restore();path(ctx,points);ctx.fillStyle=`rgba(22,35,57,${(1-light)*.12})`;ctx.fill();
      if(light>.82){ctx.fillStyle=`rgba(255,255,255,${(light-.82)*.35})`;ctx.fill();}
    }else{path(ctx,points);ctx.fillStyle=shade(spec.edgeColor??'#c8d4e1',.56+light*.48);ctx.fill();}
  }
  ctx.restore();
}
