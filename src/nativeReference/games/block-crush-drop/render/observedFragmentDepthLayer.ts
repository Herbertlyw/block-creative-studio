import {
  nativeCalibratedWorldVertex,
  type NativeCalibratedFragmentPacket,
} from './calibratedNativeFragments';
/** Explicit opaque native-fragment depth layer. It consumes already sampled V2
 * poses and reusable mother artwork; it never owns motion, gameplay or audio. */
import * as THREE from 'three';
import {
  createPyramidQuarterFragmentGeometry,
  projectPyramidQuarterFragment,
  type PyramidQuarterPerspectiveCamera,
} from '../../../rendering/pyramidQuarterFragment';
import {
  createRoundedCubeDepthPrototype,
  quantizeRoundedCubeDepthRadius,
  roundedCubeDepthPosition,
  roundedCubeDepthProjectedHull,
} from '../../../rendering/roundedFragmentCubeDepthGeometry';
import type { DropObservedFragmentPose } from '../profiles/observedFragmentMotion';
import type { DropReferenceCalibration } from '../profiles/referenceCalibration';

export const OBSERVED_FRAGMENT_DEPTH_MAX_PARTICLES = 8192;
export const OBSERVED_FRAGMENT_DEPTH_MAX_TEXTURES = 64;
const STAGE_WIDTH = 1080,
  STAGE_HEIGHT = 1920,
  TILE_PIXELS = 64,
  GUTTER = 1,
  SLOT_PIXELS = TILE_PIXELS + 2 * GUTTER,
  ATLAS_PIXELS = SLOT_PIXELS * 8;
const FACE_IDS = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
type Vector = { x: number; y: number; z: number };
export interface ObservedFragmentDepthPacket {
  readonly waveId: string;
  readonly pose: DropObservedFragmentPose;
  readonly color: string;
  readonly frontTexture?: CanvasImageSource;
}
export interface ObservedFragmentDepthLayerService {
  draw(
    context: CanvasRenderingContext2D,
    packets: readonly ObservedFragmentDepthPacket[],
    clear: NonNullable<DropReferenceCalibration['clear']>,
  ): void;
  drawNative?(
    context: CanvasRenderingContext2D,
    packets: readonly NativeCalibratedFragmentPacket[],
    clear: NonNullable<DropReferenceCalibration['clear']>,
  ): void;
  dispose(): void;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const rgb = (color: string): [number, number, number] => {
  const n = parseInt(color.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255].map((v) => v / 255) as [number, number, number];
};

/** Same X → Y → Z rotation as the existing native Canvas projector. */
export function observedDepthRotate(
  p: Vector,
  pose: Pick<DropObservedFragmentPose, 'rotationX' | 'rotationY' | 'rotationZ'>,
): Vector {
  const rx = pose.rotationX % (2 * Math.PI),
    ry = pose.rotationY % (2 * Math.PI),
    rz = pose.rotationZ % (2 * Math.PI);
  const cx = Math.cos(rx),
    sx = Math.sin(rx),
    cy = Math.cos(ry),
    sy = Math.sin(ry),
    cz = Math.cos(rz),
    sz = Math.sin(rz);
  const y = p.y * cx - p.z * sx,
    z = p.y * sx + p.z * cx,
    x = p.x * cy + z * sy,
    depth = -p.x * sy + z * cy;
  return { x: x * cz - y * sz, y: x * sz + y * cz, z: depth };
}
export function observedDepthWorldVertex(p: Vector, pose: DropObservedFragmentPose): Vector {
  const q = observedDepthRotate(p, pose),
    s = pose.sizePixels * pose.scale;
  return { x: pose.x + q.x * s, y: pose.y + q.y * s, z: pose.z + q.z * s };
}
/** Explicit clip-space pinhole, independent of viewport/output scale. */
export function observedDepthClipVertex(
  p: Vector,
  camera: PyramidQuarterPerspectiveCamera,
  near: number,
  far: number,
): readonly [number, number, number, number] {
  const f = camera.focalLengthPixels,
    d = f + camera.referencePlaneDepthPixels - p.z;
  if (!(d > 1e-6) || !Number.isFinite(d)) throw new Error('OBSERVED_FRAGMENT_DEPTH_CAMERA_PLANE');
  return [
    ((2 * camera.centerX) / STAGE_WIDTH - 1) * d + ((2 * f) / STAGE_WIDTH) * (p.x - camera.centerX),
    (1 - (2 * camera.centerY) / STAGE_HEIGHT) * d -
      ((2 * f) / STAGE_HEIGHT) * (p.y - camera.centerY),
    ((far + near) / (far - near)) * d - (2 * far * near) / (far - near),
    d,
  ];
}
export function observedDepthAtlasUv(
  slot: number,
  u: number,
  v: number,
): readonly [number, number] {
  return [
    ((slot % 8) * SLOT_PIXELS + GUTTER + u * TILE_PIXELS) / ATLAS_PIXELS,
    (Math.floor(slot / 8) * SLOT_PIXELS + GUTTER + v * TILE_PIXELS) / ATLAS_PIXELS,
  ];
}
/** Checks the complete batch before uploading frame resources or painting. */
export function validateObservedDepthPackets(
  packets: readonly ObservedFragmentDepthPacket[],
  clear: NonNullable<DropReferenceCalibration['clear']>,
): { near: number; far: number; textures: readonly CanvasImageSource[] } {
  if (
    clear.fragmentDepthRenderer !== 'webgl-opaque' ||
    !['pyramid-quarter', 'rounded-cube'].includes(clear.fragmentGeometry ?? '') ||
    (clear.fragmentGeometry === 'rounded-cube' &&
      clear.fragmentCubeFrontUvMapping !== 'mother-plane') ||
    !clear.fragmentPerspectiveCamera ||
    clear.subdivisions !== 2 ||
    (clear.fragmentDepthLayers ?? 1) !== 1
  )
    throw new Error('OBSERVED_FRAGMENT_DEPTH_CONFIGURATION');
  if (packets.length > OBSERVED_FRAGMENT_DEPTH_MAX_PARTICLES)
    throw new Error('OBSERVED_FRAGMENT_DEPTH_PARTICLE_BUDGET');
  const textures = [...new Set(packets.flatMap((p) => (p.frontTexture ? [p.frontTexture] : [])))];
  if (textures.length > OBSERVED_FRAGMENT_DEPTH_MAX_TEXTURES)
    throw new Error('OBSERVED_FRAGMENT_DEPTH_TEXTURE_BUDGET');
  let min = Infinity,
    max = 0;
  for (const { pose } of packets) {
    if (pose.opacity !== 1) throw new Error('OBSERVED_FRAGMENT_DEPTH_REQUIRES_OPAQUE');
    if (
      pose.depthIndex !== 0 ||
      !Number.isFinite(pose.sizePixels * pose.scale) ||
      pose.sizePixels * pose.scale <= 0
    )
      throw new Error('OBSERVED_FRAGMENT_DEPTH_PARTITION');
    const rounded = clear.fragmentGeometry === 'rounded-cube',
      radius = rounded
        ? quantizeRoundedCubeDepthRadius(
            pose.cornerRadius ?? clear.fragmentCubeCornerRadius ?? 0.065,
          )
        : 0;
    if (
      !Number.isInteger(pose.ix) ||
      !Number.isInteger(pose.iy) ||
      pose.ix < 0 ||
      pose.ix > 1 ||
      pose.iy < 0 ||
      pose.iy > 1
    )
      throw new Error('OBSERVED_FRAGMENT_DEPTH_PARTITION');
    const positions = rounded
      ? createRoundedCubeDepthPrototype(radius === 0).vertices.map((v) =>
          roundedCubeDepthPosition(v, radius),
        )
      : createPyramidQuarterFragmentGeometry({ ix: pose.ix, iy: pose.iy }).vertices.map(
          (v) => v.position,
        );
    for (const position of positions) {
      const world = observedDepthWorldVertex(position, pose),
        d =
          clear.fragmentPerspectiveCamera.focalLengthPixels +
          clear.fragmentPerspectiveCamera.referencePlaneDepthPixels -
          world.z;
      if (!(d > 1e-6) || ![world.x, world.y, world.z, d].every(Number.isFinite))
        throw new Error('OBSERVED_FRAGMENT_DEPTH_CAMERA_PLANE');
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
  }
  return {
    near: min === Infinity ? 1 : min / 2,
    far: max === 0 ? 2 : Math.max(min / 2 + 1, max * 1.5),
    textures,
  };
}

// Raw shaders deliberately operate on displayed channel values, like Canvas.
// No Three lighting, tone mapping or implicit sRGB conversion is applied.
const VERTEX = `precision highp float;
attribute vec3 position; attribute vec3 normal; attribute vec2 uv; attribute float face; attribute vec3 coreSigns; attribute float frontEligible;
attribute vec3 instanceOrigin; attribute vec3 instanceRotation; attribute float instanceSize; attribute vec3 instanceColor; attribute float instanceTexture; attribute float instanceRadius;
uniform vec4 pinhole; uniform vec2 depthRange; uniform float geometryKind;
varying vec2 vUv; varying vec3 vNormal; varying vec3 vObjectNormal; varying vec3 vColor; varying float vFace; varying float vTexture; varying float vFrontEligible;
vec3 rotateNative(vec3 p) {
 vec3 c=cos(instanceRotation),s=sin(instanceRotation);
 float y=p.y*c.x-p.z*s.x,z=p.y*s.x+p.z*c.x;
 float x=p.x*c.y+z*s.y,d=-p.x*s.y+z*c.y;
 return vec3(x*c.z-y*s.z,x*s.z+y*c.z,d);
}
void main() {
 vec3 local=geometryKind>0.5?(0.5-instanceRadius)*coreSigns+instanceRadius*normal:position;
 vec3 p=instanceOrigin+rotateNative(local)*instanceSize;
 float d=pinhole.x+pinhole.w-p.z,n=depthRange.x,f=depthRange.y;
 gl_Position=vec4((2.0*pinhole.y/1080.0-1.0)*d+(2.0*pinhole.x/1080.0)*(p.x-pinhole.y),
  (1.0-2.0*pinhole.z/1920.0)*d-(2.0*pinhole.x/1920.0)*(p.y-pinhole.z),
  (f+n)/(f-n)*d-2.0*f*n/(f-n),d);
 vNormal=rotateNative(normal);vObjectNormal=normal;vUv=geometryKind>0.5?local.xy+vec2(0.5):uv;vColor=instanceColor;vFace=face;vTexture=instanceTexture;vFrontEligible=frontEligible;
}`;
const FRAGMENT = `precision highp float;
uniform sampler2D artwork; uniform vec3 lightDirection; uniform vec3 lightColor;
uniform vec4 lighting; uniform float specularPower; uniform float mixLimit;
uniform vec3 faceColors[6]; uniform float faceOverrides[6]; uniform float geometryKind;
varying vec2 vUv; varying vec3 vNormal; varying vec3 vObjectNormal; varying vec3 vColor; varying float vFace; varying float vTexture; varying float vFrontEligible;
vec3 nativeUnit(vec3 p){float d=length(p);return d>0.000000000001?p/d:vec3(0.0,0.0,1.0);}
void main() {
 vec3 n=nativeUnit(vNormal),l=nativeUnit(lightDirection),h=nativeUnit(l+vec3(0.0,0.0,1.0));
 float brightness=lighting.x+lighting.y*max(0.0,dot(n,l));
 float spec=lighting.z*lighting.w*pow(max(0.0,dot(n,h)),specularPower);
 float mixValue=clamp(spec+max(0.0,brightness-1.0)*0.35,0.0,mixLimit);
 vec3 base=vColor;
 if(geometryKind>0.5){
  vec3 on=vObjectNormal,w=on*on;w/=dot(on,on);
  vec3 xColor=on.x<0.0?(faceOverrides[2]>0.5?faceColors[2]:vColor):(faceOverrides[3]>0.5?faceColors[3]:vColor);
  vec3 yColor=on.y<0.0?(faceOverrides[4]>0.5?faceColors[4]:vColor):(faceOverrides[5]>0.5?faceColors[5]:vColor);
  vec3 zColor=on.z<0.0?(faceOverrides[1]>0.5?faceColors[1]:vColor):(faceOverrides[0]>0.5?faceColors[0]:vColor);
  base=xColor*w.x+yColor*w.y+zColor*w.z;
 }else{for(int i=0;i<6;i++){if(abs(vFace-float(i))<0.25&&faceOverrides[i]>0.5)base=faceColors[i];}}
 vec3 col=floor(clamp(base*min(1.0,brightness)*(1.0-mixValue)+lightColor*mixValue,0.0,1.0)*255.0+0.5)/255.0;
 if(vFrontEligible>0.5&&vTexture>=0.0){
  vec2 slot=vec2(mod(vTexture,8.0),floor(vTexture/8.0));
  vec4 tex=texture2D(artwork,(slot*66.0+vec2(1.0)+vUv*64.0)/528.0);
  col=mix(col,tex.rgb,tex.a)*min(1.0,brightness);
  col=mix(col,lightColor,mixValue);
 }
 gl_FragColor=vec4(col,1.0);
}`;

/** Validate before resource upload; this is a separate protocol from observed V2. */
export function validateNativeDepthPackets(
  packets: readonly NativeCalibratedFragmentPacket[],
  clear: NonNullable<DropReferenceCalibration['clear']>,
): { near: number; far: number } {
  if (
    !clear.nativeInertial ||
    clear.fragmentGeometry !== 'rounded-cube' ||
    clear.fragmentSurface !== 'solid'
  )
    throw new Error('DROP_NATIVE_INERTIAL_DEPTH_CONFIGURATION');
  if (packets.length > OBSERVED_FRAGMENT_DEPTH_MAX_PARTICLES)
    throw new Error('DROP_NATIVE_INERTIAL_PARTICLE_BUDGET');
  let min = Infinity,
    max = -Infinity;
  const ids = new Set<string>();
  for (const packet of packets) {
    if (
      packet.kind !== 'native-inertial' ||
      packet.materialIdentity !== 'solid-calibrated' ||
      ids.has(packet.id) ||
      ![0, 1].includes(packet.depthIndex) ||
      ![0, 1].includes(packet.fx) ||
      ![0, 1].includes(packet.fy)
    )
      throw new Error('DROP_NATIVE_INERTIAL_PACKET_INVALID');
    ids.add(packet.id);
    const values = [
      ...Object.values(packet.centerPixels),
      ...packet.quaternion,
      ...packet.dimensionsPixels,
      ...packet.basis.flatMap(Object.values),
      ...packet.normalBasis.flatMap(Object.values),
      packet.opacity,
      packet.cornerRadius,
      packet.cutFaceAmbient,
      packet.topFaceAmbient,
      packet.cutFaceTint,
    ];
    if (
      !values.every(Number.isFinite) ||
      packet.opacity < 0 ||
      packet.opacity > 1 ||
      packet.dimensionsPixels.some((d) => d <= 0) ||
      !Number.isInteger(packet.cutFaceTint) ||
      packet.cutFaceTint < 0 ||
      packet.cutFaceTint > 0xffffff ||
      !/^#[0-9a-f]{6}$/i.test(packet.color)
    )
      throw new Error('DROP_NATIVE_INERTIAL_PACKET_INVALID');
    quantizeRoundedCubeDepthRadius(packet.cornerRadius);
    const reach = packet.basis.reduce((n, v) => n + Math.abs(v.z) * 0.5, 0);
    min = Math.min(min, packet.centerPixels.z - reach);
    max = Math.max(max, packet.centerPixels.z + reach);
  }
  return {
    near: min === Infinity ? -1 : min - 1,
    far: max === -Infinity ? 1 : Math.max(min + 1, max + 1),
  };
}
const NATIVE_VERTEX = `precision highp float;
attribute vec3 normal; attribute vec3 coreSigns;
attribute vec3 instanceOrigin; attribute vec3 basisX; attribute vec3 basisY; attribute vec3 basisZ;
attribute vec3 normalX; attribute vec3 normalY; attribute vec3 normalZ;
attribute vec3 instanceColor; attribute float instanceRadius; attribute float instanceOpacity;
attribute vec3 instanceIdentity; attribute vec3 instanceSurface; attribute vec3 instanceTint;
uniform vec2 depthRange;
varying vec2 vUv; varying vec3 vNormal; varying vec3 vObjectNormal; varying vec3 vColor; varying float vFace; varying float vTexture; varying float vFrontEligible;
varying float vOpacity; varying vec3 vIdentity; varying vec3 vSurface; varying vec3 vTint;
void main(){
 vec3 local=(0.5-instanceRadius)*coreSigns+instanceRadius*normal;
 vec3 p=instanceOrigin+mat3(basisX,basisY,basisZ)*local;
 gl_Position=vec4(2.0*p.x/1080.0-1.0,1.0-2.0*p.y/1920.0,1.0-2.0*(p.z-depthRange.x)/(depthRange.y-depthRange.x),1.0);
 vNormal=mat3(normalX,normalY,normalZ)*normal;vObjectNormal=normal;vColor=instanceColor;
 vOpacity=instanceOpacity;vIdentity=instanceIdentity;vSurface=instanceSurface;vTint=instanceTint;
 vUv=vec2(0.0);vFace=0.0;vTexture=-1.0;vFrontEligible=0.0;
}`;
const NATIVE_FRAGMENT = FRAGMENT.replace(
  'void main() {',
  'varying float vOpacity; varying vec3 vIdentity; varying vec3 vSurface; varying vec3 vTint;\nvoid main() {',
)
  .replace(
    'float brightness=lighting.x+lighting.y*max(0.0,dot(n,l));',
    `vec3 objectWeight=vObjectNormal*vObjectNormal;objectWeight/=dot(vObjectNormal,vObjectNormal);
 float cutWeight=objectWeight.x*(vObjectNormal.x<0.0?vIdentity.x:1.0-vIdentity.x)+objectWeight.y*(vObjectNormal.y<0.0?1.0-vIdentity.y:vIdentity.y)+objectWeight.z*(vObjectNormal.z<0.0?1.0-vIdentity.z:vIdentity.z);
 float materialAmbient=mix(1.0,vSurface.x,cutWeight)*mix(1.0,vSurface.y,vObjectNormal.y<0.0?objectWeight.y:0.0);
 float brightness=lighting.x*materialAmbient+lighting.y*max(0.0,dot(n,l));`,
  )
  .replace('vec3 col=floor', 'base*=mix(vec3(1.0),vTint,cutWeight);\n vec3 col=floor')
  .replace('gl_FragColor=vec4(col,1.0);', 'gl_FragColor=vec4(col,vOpacity);');
type NativePrototype = {
  geometry: THREE.InstancedBufferGeometry;
  mesh: THREE.Mesh;
  attributes: Record<string, THREE.InstancedBufferAttribute>;
};

type Prototype = {
  geometry: THREE.InstancedBufferGeometry;
  mesh: THREE.Mesh;
  attributes: Record<
    | 'instanceOrigin'
    | 'instanceRotation'
    | 'instanceSize'
    | 'instanceColor'
    | 'instanceTexture'
    | 'instanceRadius',
    THREE.InstancedBufferAttribute
  >;
};
/** Scene-owned lazy resource. Only the explicit mode constructs this class. */
export class ObservedFragmentDepthLayer implements ObservedFragmentDepthLayerService {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly atlas: HTMLCanvasElement;
  private readonly atlasContext: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.RawShaderMaterial;
  private readonly prototypes: Prototype[] = [];
  private pyramidPrototypes: Prototype[] | undefined;
  private roundedPrototypes: Prototype[] | undefined;
  private nativePrototype: NativePrototype | undefined;
  private nativeMaterial: THREE.RawShaderMaterial | undefined;
  private disposed = false;

  constructor(
    owner: Document,
    initialGeometry: 'pyramid-quarter' | 'rounded-cube' | 'native-inertial' = 'pyramid-quarter',
  ) {
    this.canvas = owner.createElement('canvas');
    this.atlas = owner.createElement('canvas');
    this.atlas.width = this.atlas.height = ATLAS_PIXELS;
    const atlasContext = this.atlas.getContext('2d');
    if (!atlasContext) throw new Error('OBSERVED_FRAGMENT_DEPTH_ATLAS_CONTEXT_UNAVAILABLE');
    this.atlasContext = atlasContext;
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
      });
    } catch (error) {
      throw new Error(`OBSERVED_FRAGMENT_DEPTH_WEBGL_UNAVAILABLE: ${String(error)}`);
    }
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.debug.onShaderError = (gl, _program, vertex, fragment) => {
      throw new Error(
        `OBSERVED_FRAGMENT_DEPTH_SHADER_FAILED: ${gl.getShaderInfoLog(vertex)} / ${gl.getShaderInfoLog(fragment)}`,
      );
    };
    this.renderer.setClearColor(0, 0);
    this.renderer.autoClear = false;
    this.texture = new THREE.CanvasTexture(this.atlas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.flipY = false;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.material = new THREE.RawShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.FrontSide,
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.LessEqualDepth,
      transparent: false,
      blending: THREE.NoBlending,
      uniforms: {
        geometryKind: { value: 0 },
        artwork: { value: this.texture },
        pinhole: { value: new THREE.Vector4() },
        depthRange: { value: new THREE.Vector2() },
        lightDirection: { value: new THREE.Vector3() },
        lightColor: { value: new THREE.Vector3() },
        lighting: { value: new THREE.Vector4() },
        specularPower: { value: 10 },
        mixLimit: { value: 0.4 },
        faceColors: { value: FACE_IDS.map(() => new THREE.Vector3()) },
        faceOverrides: { value: FACE_IDS.map(() => 0) },
      },
    });
    if (initialGeometry === 'native-inertial') this.ensureNativePrototype();
    else this.ensurePrototypes(initialGeometry);
  }

  private makePrototype(
    positions: number[],
    normals: number[],
    uvs: number[],
    faces: number[],
    cores: number[],
    eligible: number[],
  ): Prototype {
    const geometry = new THREE.InstancedBufferGeometry();
    for (const [name, array, count] of [
      ['position', positions, 3],
      ['normal', normals, 3],
      ['uv', uvs, 2],
      ['face', faces, 1],
      ['coreSigns', cores, 3],
      ['frontEligible', eligible, 1],
    ] as const)
      geometry.setAttribute(name, new THREE.Float32BufferAttribute(array, count));
    const attributes = {} as Prototype['attributes'];
    for (const [name, components] of [
      ['instanceOrigin', 3],
      ['instanceRotation', 3],
      ['instanceSize', 1],
      ['instanceColor', 3],
      ['instanceTexture', 1],
      ['instanceRadius', 1],
    ] as const) {
      const attribute = new THREE.InstancedBufferAttribute(
        new Float32Array(OBSERVED_FRAGMENT_DEPTH_MAX_PARTICLES * components),
        components,
      );
      attribute.setUsage(THREE.DynamicDrawUsage);
      attributes[name] = attribute;
      geometry.setAttribute(name, attribute);
    }
    geometry.instanceCount = 0;
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    const prototype = { geometry, mesh, attributes };
    this.prototypes.push(prototype);
    return prototype;
  }

  private ensurePrototypes(kind: 'pyramid-quarter' | 'rounded-cube'): Prototype[] {
    if (kind === 'pyramid-quarter') {
      if (this.pyramidPrototypes) return this.pyramidPrototypes;
      const prototypes: Prototype[] = [];
      for (let iy = 0; iy < 2; iy++)
        for (let ix = 0; ix < 2; ix++) {
          const source = createPyramidQuarterFragmentGeometry({ ix, iy }),
            positions: number[] = [],
            normals: number[] = [],
            uvs: number[] = [],
            faces: number[] = [],
            cores: number[] = [],
            eligible: number[] = [];
          for (const triangle of source.triangles)
            for (const index of [...triangle.indices].reverse()) {
              const vertex = source.vertices[index]!;
              positions.push(vertex.position.x, vertex.position.y, vertex.position.z);
              normals.push(triangle.normal.x, triangle.normal.y, triangle.normal.z);
              uvs.push(vertex.motherUv.x, vertex.motherUv.y);
              faces.push(FACE_IDS.indexOf(triangle.faceId));
              cores.push(0, 0, 0);
              eligible.push(triangle.kind === 'front' ? 1 : 0);
            }
          prototypes.push(this.makePrototype(positions, normals, uvs, faces, cores, eligible));
        }
      this.pyramidPrototypes = prototypes;
      return prototypes;
    }
    if (this.roundedPrototypes) return this.roundedPrototypes;
    const prototypes: Prototype[] = [];
    for (const zero of [true, false]) {
      const source = createRoundedCubeDepthPrototype(zero),
        positions: number[] = [],
        normals: number[] = [],
        uvs: number[] = [],
        faces: number[] = [],
        cores: number[] = [],
        eligible: number[] = [];
      for (const triangle of source.triangles)
        for (const index of [...triangle.indices].reverse()) {
          const vertex = source.vertices[index]!;
          positions.push(0, 0, 0);
          normals.push(vertex.normal.x, vertex.normal.y, vertex.normal.z);
          uvs.push(0, 0);
          faces.push(triangle.faceId ? FACE_IDS.indexOf(triangle.faceId) : -1);
          cores.push(vertex.coreSigns.x, vertex.coreSigns.y, vertex.coreSigns.z);
          eligible.push(triangle.frontUvEligible ? 1 : 0);
        }
      prototypes.push(this.makePrototype(positions, normals, uvs, faces, cores, eligible));
    }
    this.roundedPrototypes = prototypes;
    return prototypes;
  }

  draw(
    context: CanvasRenderingContext2D,
    packets: readonly ObservedFragmentDepthPacket[],
    clear: NonNullable<DropReferenceCalibration['clear']>,
  ): void {
    if (this.disposed) throw new Error('OBSERVED_FRAGMENT_DEPTH_DISPOSED');
    const { near, far, textures } = validateObservedDepthPackets(packets, clear),
      camera = clear.fragmentPerspectiveCamera!;
    if (this.renderer.getContext().isContextLost())
      throw new Error('OBSERVED_FRAGMENT_DEPTH_CONTEXT_LOST');
    const transform = context.getTransform(),
      scaleX = Math.hypot(transform.a, transform.b),
      scaleY = Math.hypot(transform.c, transform.d);
    const width = Math.max(1, Math.round(STAGE_WIDTH * scaleX)),
      height = Math.max(1, Math.round(STAGE_HEIGHT * scaleY));
    if (width > 4320 || height > 7680 || width * height > 2160 * 3840)
      throw new Error('OBSERVED_FRAGMENT_DEPTH_VIEWPORT_BUDGET');
    if (this.canvas.width !== width || this.canvas.height !== height)
      this.renderer.setSize(width, height, false);
    const gl = this.renderer.getContext();
    if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height)
      throw new Error('OBSERVED_FRAGMENT_DEPTH_FRAMEBUFFER_SIZE_UNSUPPORTED');
    this.atlasContext.clearRect(0, 0, ATLAS_PIXELS, ATLAS_PIXELS);
    textures.forEach((image, slot) => {
      const x = (slot % 8) * SLOT_PIXELS,
        y = Math.floor(slot / 8) * SLOT_PIXELS,
        c = this.atlasContext;
      c.drawImage(image, x + GUTTER, y + GUTTER, TILE_PIXELS, TILE_PIXELS);
      // Edge extrusion protects mother UV at 0/1 from neighboring atlas slots.
      c.drawImage(this.atlas, x + 1, y + 1, TILE_PIXELS, 1, x + 1, y, TILE_PIXELS, 1);
      c.drawImage(
        this.atlas,
        x + 1,
        y + TILE_PIXELS,
        TILE_PIXELS,
        1,
        x + 1,
        y + TILE_PIXELS + 1,
        TILE_PIXELS,
        1,
      );
      c.drawImage(this.atlas, x + 1, y, 1, SLOT_PIXELS, x, y, 1, SLOT_PIXELS);
      c.drawImage(
        this.atlas,
        x + TILE_PIXELS,
        y,
        1,
        SLOT_PIXELS,
        x + TILE_PIXELS + 1,
        y,
        1,
        SLOT_PIXELS,
      );
    });
    this.texture.needsUpdate = true;
    this.releaseNativePrototype();
    const rounded = clear.fragmentGeometry === 'rounded-cube',
      prototypes = this.ensurePrototypes(rounded ? 'rounded-cube' : 'pyramid-quarter'),
      counts = prototypes.map(() => 0);
    this.prototypes.forEach((p) => {
      p.geometry.instanceCount = 0;
    });
    if (this.nativePrototype) this.nativePrototype.geometry.instanceCount = 0;
    for (const packet of packets) {
      const p = packet.pose,
        radius = rounded
          ? quantizeRoundedCubeDepthRadius(
              p.cornerRadius ?? clear.fragmentCubeCornerRadius ?? 0.065,
            )
          : 0,
        slot = rounded ? (radius === 0 ? 0 : 1) : p.iy * 2 + p.ix,
        i = counts[slot]!,
        attrs = prototypes[slot]!.attributes;
      attrs.instanceOrigin.setXYZ(i, p.x, p.y, p.z);
      attrs.instanceRotation.setXYZ(
        i,
        p.rotationX % (2 * Math.PI),
        p.rotationY % (2 * Math.PI),
        p.rotationZ % (2 * Math.PI),
      );
      attrs.instanceSize.setX(i, p.sizePixels * p.scale);
      attrs.instanceColor.setXYZ(i, ...rgb(packet.color));
      attrs.instanceTexture.setX(
        i,
        packet.frontTexture ? textures.indexOf(packet.frontTexture) : -1,
      );
      attrs.instanceRadius.setX(i, radius);
      counts[slot] = i + 1;
    }
    prototypes.forEach((p, i) => {
      p.geometry.instanceCount = counts[i]!;
      Object.values(p.attributes).forEach((a) => {
        a.needsUpdate = true;
      });
    });
    const uniforms = this.material.uniforms;
    uniforms.geometryKind!.value = rounded ? 1 : 0;
    uniforms.pinhole!.value.set(
      camera.focalLengthPixels,
      camera.centerX,
      camera.centerY,
      camera.referencePlaneDepthPixels,
    );
    uniforms.depthRange!.value.set(near, far);
    const direction = clear.fragmentLightDirection ?? { x: -0.2, y: -1, z: 0.35 };
    uniforms.lightDirection!.value.set(direction.x, direction.y, direction.z);
    uniforms.lightColor!.value.set(...rgb(clear.fragmentLightColor ?? '#fff8e8'));
    uniforms.lighting!.value.set(
      clamp(clear.fragmentAmbient ?? 0.78, clamp(clear.fragmentAmbientFloor ?? 0.55, 0, 0.55), 1),
      clamp(clear.fragmentDiffuse ?? 0.65, 0, 0.8),
      clamp(clear.highlight ?? 1, 0, 1),
      clamp(clear.fragmentSpecularStrength ?? 0.32, 0, 2),
    );
    uniforms.specularPower!.value = clamp(clear.fragmentSpecularPower ?? 10, 4, 128);
    uniforms.mixLimit!.value =
      clear.fragmentSpecularStrength === undefined
        ? 0.4
        : clamp(clear.fragmentSpecularStrength, 0.4, 0.95);
    FACE_IDS.forEach((face, i) => {
      const color = clear.fragmentFaceColors?.[face];
      uniforms.faceOverrides!.value[i] = color ? 1 : 0;
      uniforms.faceColors!.value[i].set(...rgb(color ?? '#000000'));
    });
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, this.camera);
    // Authored screen-space shadows are a separate layer below ALL opaque
    // fragments; no late object's shadow can repaint a nearer front roof.
    const strength = clamp(clear.shadow ?? 0, 0, 1),
      cast = clear.fragmentCastShadow;
    if (strength > 0 && (cast?.opacity ?? 0.2) > 0)
      for (const { pose } of packets) {
        const size = pose.sizePixels * pose.scale;
        const hull = rounded
          ? roundedCubeDepthProjectedHull(
              pose.cornerRadius ?? clear.fragmentCubeCornerRadius ?? 0.065,
              (local) => {
                const clip = observedDepthClipVertex(
                  observedDepthWorldVertex(local, pose),
                  camera,
                  near,
                  far,
                );
                return {
                  x: ((clip[0] / clip[3] + 1) * STAGE_WIDTH) / 2,
                  y: ((1 - clip[1] / clip[3]) * STAGE_HEIGHT) / 2,
                };
              },
            )
          : undefined;
        const projection = rounded
          ? undefined
          : projectPyramidQuarterFragment({
              size,
              ix: pose.ix,
              iy: pose.iy,
              rotationX: pose.rotationX,
              rotationY: pose.rotationY,
              rotationZ: pose.rotationZ,
              worldOrigin: pose,
              perspectiveCamera: camera,
            });
        context.save();
        try {
          context.translate(
            (rounded ? 0 : pose.x) + size * clamp(cast?.offsetX ?? (rounded ? 0.09 : 0.12), -2, 2),
            (rounded ? 0 : pose.y) + size * clamp(cast?.offsetY ?? (rounded ? 0.14 : 0.18), -2, 2),
          );
          context.globalAlpha *= strength * clamp(cast?.opacity ?? 0.2, 0, 1);
          context.fillStyle = cast?.color ?? (rounded ? '#795735' : '#704653');
          context.shadowColor =
            rounded && cast === undefined ? 'rgba(72,43,18,.2)' : context.fillStyle;
          context.shadowBlur = size * clamp(cast?.blur ?? (rounded ? 0.12 : 0.15), 0, 2);
          context.shadowOffsetX = context.shadowOffsetY = 0;
          context.beginPath();
          if (hull) {
            hull.forEach((p, i) => (i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)));
            context.closePath();
          } else
            for (const triangle of projection!.triangles) {
              const [a, b, c] = triangle.points;
              context.moveTo(a.x, a.y);
              context.lineTo(b.x, b.y);
              context.lineTo(c.x, c.y);
              context.closePath();
            }
          context.fill();
        } finally {
          context.restore();
        }
      }
    context.drawImage(this.canvas, 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  }

  private releaseNativePrototype(): void {
    if (this.nativePrototype) {
      this.nativePrototype.geometry.dispose();
      this.scene.remove(this.nativePrototype.mesh);
    }
    this.nativeMaterial?.dispose();
    this.nativePrototype = undefined;
    this.nativeMaterial = undefined;
  }

  private ensureNativePrototype(): NativePrototype {
    if (this.nativePrototype) return this.nativePrototype;
    // Modes retain at most the existing six prototypes. Moving to native frees
    // observed buffers; moving back frees the native geometry/material below.
    for (const p of this.prototypes) {
      p.geometry.dispose();
      this.scene.remove(p.mesh);
    }
    this.prototypes.length = 0;
    this.pyramidPrototypes = undefined;
    this.roundedPrototypes = undefined;
    this.nativeMaterial = new THREE.RawShaderMaterial({
      vertexShader: NATIVE_VERTEX,
      fragmentShader: NATIVE_FRAGMENT,
      side: THREE.FrontSide,
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.LessEqualDepth,
      transparent: true,
      blending: THREE.NormalBlending,
      uniforms: THREE.UniformsUtils.clone({ ...this.material.uniforms, artwork: { value: null } }),
    });
    this.nativeMaterial.uniforms.artwork!.value = this.texture;
    // A single prototype preserves one global far-to-near body ordering. Radius
    // zero degenerates only edge triangles, without a second draw batch.
    const source = createRoundedCubeDepthPrototype(false),
      normals: number[] = [],
      cores: number[] = [];
    for (const triangle of source.triangles)
      for (const index of [...triangle.indices].reverse()) {
        const vertex = source.vertices[index]!;
        normals.push(vertex.normal.x, vertex.normal.y, vertex.normal.z);
        cores.push(vertex.coreSigns.x, vertex.coreSigns.y, vertex.coreSigns.z);
      }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('coreSigns', new THREE.Float32BufferAttribute(cores, 3));
    // Three uses position.count to determine the non-indexed vertex count; actual
    // positions are procedurally generated from coreSigns and normal in shader.
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(normals.length), 3),
    );
    const attributes: NativePrototype['attributes'] = {};
    for (const [name, count] of [
      ['instanceOrigin', 3],
      ['basisX', 3],
      ['basisY', 3],
      ['basisZ', 3],
      ['normalX', 3],
      ['normalY', 3],
      ['normalZ', 3],
      ['instanceColor', 3],
      ['instanceRadius', 1],
      ['instanceOpacity', 1],
      ['instanceIdentity', 3],
      ['instanceSurface', 3],
      ['instanceTint', 3],
    ] as const) {
      const attribute = new THREE.InstancedBufferAttribute(
        new Float32Array(OBSERVED_FRAGMENT_DEPTH_MAX_PARTICLES * count),
        count,
      );
      attribute.setUsage(THREE.DynamicDrawUsage);
      attributes[name] = attribute;
      geometry.setAttribute(name, attribute);
    }
    geometry.instanceCount = 0;
    const mesh = new THREE.Mesh(geometry, this.nativeMaterial);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return (this.nativePrototype = { geometry, mesh, attributes });
  }

  drawNative(
    context: CanvasRenderingContext2D,
    packets: readonly NativeCalibratedFragmentPacket[],
    clear: NonNullable<DropReferenceCalibration['clear']>,
  ): void {
    if (this.disposed) throw new Error('OBSERVED_FRAGMENT_DEPTH_DISPOSED');
    const { near, far } = validateNativeDepthPackets(packets, clear);
    if (this.renderer.getContext().isContextLost())
      throw new Error('OBSERVED_FRAGMENT_DEPTH_CONTEXT_LOST');
    const transform = context.getTransform(),
      width = Math.max(1, Math.round(STAGE_WIDTH * Math.hypot(transform.a, transform.b))),
      height = Math.max(1, Math.round(STAGE_HEIGHT * Math.hypot(transform.c, transform.d)));
    if (width > 4320 || height > 7680 || width * height > 2160 * 3840)
      throw new Error('OBSERVED_FRAGMENT_DEPTH_VIEWPORT_BUDGET');
    if (this.canvas.width !== width || this.canvas.height !== height)
      this.renderer.setSize(width, height, false);
    const gl = this.renderer.getContext();
    if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height)
      throw new Error('OBSERVED_FRAGMENT_DEPTH_FRAMEBUFFER_SIZE_UNSUPPORTED');
    const prototype = this.ensureNativePrototype(),
      attrs = prototype.attributes;
    this.prototypes.forEach((p) => {
      p.geometry.instanceCount = 0;
    });
    // Stage Z points toward the viewer. Alpha is individual, never batch-global.
    const ordered = [...packets].sort(
      (a, b) => a.centerPixels.z - b.centerPixels.z || a.id.localeCompare(b.id),
    );
    ordered.forEach((p, i) => {
      attrs.instanceOrigin!.setXYZ(i, p.centerPixels.x, p.centerPixels.y, p.centerPixels.z);
      for (const [j, name] of ['basisX', 'basisY', 'basisZ'].entries()) {
        const v = p.basis[j]!;
        attrs[name]!.setXYZ(i, v.x, v.y, v.z);
      }
      for (const [j, name] of ['normalX', 'normalY', 'normalZ'].entries()) {
        const v = p.normalBasis[j]!;
        attrs[name]!.setXYZ(i, v.x, v.y, v.z);
      }
      attrs.instanceColor!.setXYZ(i, ...rgb(p.color));
      attrs.instanceRadius!.setX(i, quantizeRoundedCubeDepthRadius(p.cornerRadius));
      attrs.instanceOpacity!.setX(i, p.opacity);
      attrs.instanceIdentity!.setXYZ(i, p.fx, p.fy, p.depthIndex);
      attrs.instanceSurface!.setXYZ(i, p.cutFaceAmbient, p.topFaceAmbient, 0);
      attrs.instanceTint!.setXYZ(
        i,
        (p.cutFaceTint >> 16) / 255,
        ((p.cutFaceTint >> 8) & 255) / 255,
        (p.cutFaceTint & 255) / 255,
      );
    });
    prototype.geometry.instanceCount = ordered.length;
    Object.values(attrs).forEach((a) => {
      a.needsUpdate = true;
    });
    const uniforms = this.nativeMaterial!.uniforms;
    uniforms.geometryKind!.value = 1;
    uniforms.depthRange!.value.set(near, far);
    const direction = clear.fragmentLightDirection ?? { x: -0.2, y: -1, z: 0.35 };
    uniforms.lightDirection!.value.set(direction.x, direction.y, direction.z);
    uniforms.lightColor!.value.set(...rgb(clear.fragmentLightColor ?? '#fff8e8'));
    uniforms.lighting!.value.set(
      clamp(clear.fragmentAmbient ?? 0.78, clamp(clear.fragmentAmbientFloor ?? 0.55, 0, 0.55), 1),
      clamp(clear.fragmentDiffuse ?? 0.65, 0, 0.8),
      clamp(clear.highlight ?? 1, 0, 1),
      clamp(clear.fragmentSpecularStrength ?? 0.32, 0, 2),
    );
    uniforms.specularPower!.value = clamp(clear.fragmentSpecularPower ?? 10, 4, 128);
    uniforms.mixLimit!.value =
      clear.fragmentSpecularStrength === undefined
        ? 0.4
        : clamp(clear.fragmentSpecularStrength, 0.4, 0.95);
    FACE_IDS.forEach((face, i) => {
      const color = clear.fragmentFaceColors?.[face];
      uniforms.faceOverrides!.value[i] = color ? 1 : 0;
      uniforms.faceColors!.value[i].set(...rgb(color ?? '#000000'));
    });
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, this.camera);
    // Shadows use the same affine vertices and sit below the complete depth batch.
    const strength = clamp(clear.shadow ?? 0, 0, 1),
      cast = clear.fragmentCastShadow;
    if (strength > 0 && (cast?.opacity ?? 0.2) > 0)
      for (const p of packets) {
        const size = p.dimensionsPixels[0],
          hull = roundedCubeDepthProjectedHull(p.cornerRadius, (local) =>
            nativeCalibratedWorldVertex(local, p),
          );
        context.save();
        try {
          context.translate(
            size * clamp(cast?.offsetX ?? 0.09, -2, 2),
            size * clamp(cast?.offsetY ?? 0.14, -2, 2),
          );
          context.globalAlpha *= p.opacity * strength * clamp(cast?.opacity ?? 0.2, 0, 1);
          context.fillStyle = cast?.color ?? '#795735';
          context.shadowColor = context.fillStyle;
          context.shadowBlur = size * clamp(cast?.blur ?? 0.12, 0, 2);
          context.shadowOffsetX = context.shadowOffsetY = 0;
          context.beginPath();
          hull.forEach((v, i) => (i ? context.lineTo(v.x, v.y) : context.moveTo(v.x, v.y)));
          context.closePath();
          context.fill();
        } finally {
          context.restore();
        }
      }
    context.drawImage(this.canvas, 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseNativePrototype();
    this.prototypes.forEach((p) => p.geometry.dispose());
    this.material.dispose();
    this.texture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.scene.clear();
  }
}
