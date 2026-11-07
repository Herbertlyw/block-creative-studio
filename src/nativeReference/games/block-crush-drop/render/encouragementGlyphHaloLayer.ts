import {
  DROP_ENCOURAGEMENT_GLYPH_HALO_LIMITS as LIMITS,
  dropEncouragementGlyphHaloBounds,
  type DropEncouragementGlyphCue,
  type DropEncouragementGlyphKey,
} from '../profiles/encouragementGlyphCues';
import { createEncouragementGlyphQuadMesh } from './encouragementGlyphQuad';

export interface GlyphHaloAtlas {
  readonly image: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}
export interface GlyphHaloGroup {
  readonly cue: DropEncouragementGlyphCue;
  readonly key: DropEncouragementGlyphKey;
  readonly atlas: GlyphHaloAtlas;
}
function fail(reason: string): never {
  throw new Error(`DROP_ENCOURAGEMENT_GLYPH_HALO_${reason}`);
}
type SourceRect = { sourceX: number; sourceY: number; sourceWidth: number; sourceHeight: number };
function sourceRects(width: number, height: number, rects: readonly SourceRect[]) {
  const unique = [
    ...new Map(
      rects.map((r) => [[r.sourceX, r.sourceY, r.sourceWidth, r.sourceHeight].join(':'), r]),
    ).values(),
  ];
  if (unique.length > 8) fail('RECT_BUDGET');
  for (let i = 0; i < unique.length; i++) {
    const r = unique[i]!;
    if (
      ![r.sourceX, r.sourceY, r.sourceWidth, r.sourceHeight].every(Number.isInteger) ||
      r.sourceX < 0 ||
      r.sourceY < 0 ||
      r.sourceWidth < 1 ||
      r.sourceHeight < 1 ||
      r.sourceX + r.sourceWidth > width ||
      r.sourceY + r.sourceHeight > height ||
      r.sourceWidth * r.sourceHeight > 262144
    )
      fail('RECT_PIXELS');
    for (const q of unique.slice(0, i))
      if (
        r.sourceX < q.sourceX + q.sourceWidth &&
        r.sourceX + r.sourceWidth > q.sourceX &&
        r.sourceY < q.sourceY + q.sourceHeight &&
        r.sourceY + r.sourceHeight > q.sourceY
      )
        fail('OVERLAPPING_RECTS');
  }
  return unique;
}
/** Preserve the original eight-bit alpha. Interior zero-alpha components are
 * protected holes, including tiny transparent cavities; RGB is never changed. */
export function createGlyphHaloAlphaMasks(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  rects: readonly SourceRect[],
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 4194304 ||
    rgba.length !== width * height * 4
  )
    fail('ATLAS_PIXELS');
  const unique = sourceRects(width, height, rects);
  const alpha = new Uint8Array(width * height),
    holes = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]!;
  const maximum = Math.max(1, ...unique.map((r) => r.sourceWidth * r.sourceHeight)),
    visited = new Uint8Array(maximum),
    queue = new Uint32Array(maximum);
  for (const r of unique) {
    const w = r.sourceWidth,
      h = r.sourceHeight,
      count = w * h;
    visited.fill(0, 0, count);
    const at = (i: number) => (r.sourceY + Math.floor(i / w)) * width + r.sourceX + (i % w);
    for (let start = 0; start < count; start++) {
      if (visited[start] || alpha[at(start)] !== 0) continue;
      let head = 0,
        tail = 1,
        border = false;
      queue[0] = start;
      visited[start] = 1;
      while (head < tail) {
        const i = queue[head++]!,
          x = i % w,
          y = Math.floor(i / w);
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
        const add = (j: number) => {
          if (!visited[j] && alpha[at(j)] === 0) {
            visited[j] = 1;
            queue[tail++] = j;
          }
        };
        if (x) add(i - 1);
        if (x < w - 1) add(i + 1);
        if (y) add(i - w);
        if (y < h - 1) add(i + w);
      }
      if (!border) for (let i = 0; i < tail; i++) holes[at(queue[i]!)] = 255;
    }
  }
  return {
    alpha,
    holes,
    uniqueRects: unique.length,
    transientWorkBytes: visited.byteLength + queue.byteLength,
  };
}
const VERTEX = `#version 300 es
in vec2 p;in vec2 uv;uniform vec2 size;out vec2 v;
void main(){gl_Position=vec4(p.x/size.x*2.-1.,1.-p.y/size.y*2.,0.,1.);v=uv;}`;
const MASK = `#version 300 es
precision highp float;in vec2 v;uniform sampler2D atlasAlpha;uniform sampler2D atlasHoles;uniform vec4 crop;uniform vec2 atlasSize;uniform float opacity;
layout(location=0) out vec4 raw;layout(location=1) out vec4 weighted;layout(location=2) out vec4 hole;
void main(){vec2 q=(crop.xy+clamp(v,vec2(0.),vec2(1.))*crop.zw)/atlasSize;vec2 lo=(crop.xy+.5)/atlasSize,hi=(crop.xy+crop.zw-.5)/atlasSize;q=clamp(q,lo,hi);float a=texture(atlasAlpha,q).r;raw=vec4(a,0.,0.,1.);weighted=vec4(a*opacity,0.,0.,1.);hole=vec4(texture(atlasHoles,q).r,0.,0.,1.);}`;
const FULL_VERTEX = `#version 300 es
in vec2 p;out vec2 v;void main(){gl_Position=vec4(p,0.,1.);v=(p+1.)*.5;}`;
const DILATE = `#version 300 es
precision highp float;in vec2 v;uniform sampler2D image;uniform float radius;uniform vec2 size;out vec4 color;
float sampleAt(vec2 q){if(any(lessThan(q,vec2(0.)))||any(greaterThan(q,vec2(1.))))return 0.;return texture(image,q).r;}
void main(){float a=0.;for(int y=-8;y<=8;y++)for(int x=-8;x<=8;x++){vec2 d=vec2(float(x),float(y));if(dot(d,d)<=radius*radius+.001)a=max(a,sampleAt(v+d/size));}color=vec4(a,0.,0.,1.);}`;
const BLUR = `#version 300 es
precision highp float;in vec2 v;uniform sampler2D image;uniform float sigma;uniform vec2 direction;uniform vec2 size;out vec4 color;
void main(){float a=0.,sum=0.;if(sigma<.001){color=vec4(texture(image,v).r,0.,0.,1.);return;}for(int i=-24;i<=24;i++){float t=float(i);if(abs(t)>ceil(3.*sigma))continue;float w=exp(-.5*t*t/(sigma*sigma));vec2 q=v+direction*t/size;sum+=w;if(all(greaterThanEqual(q,vec2(0.)))&&all(lessThanEqual(q,vec2(1.))))a+=texture(image,q).r*w;}color=vec4(a/sum,0.,0.,1.);}`;
const COLOR = `#version 300 es
precision highp float;in vec2 v;uniform sampler2D image;uniform sampler2D raw;uniform sampler2D hole;uniform vec3 rgb;uniform float opacity;out vec4 color;
void main(){float a=texture(image,v).r*opacity;if(texture(raw,v).r>0.||texture(hole,v).r>.001)a=0.;color=vec4(rgb*a,a);}`;
function program(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const shaders: WebGLShader[] = [];
  let p: WebGLProgram | undefined;
  try {
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const) {
      const s = gl.createShader(type) ?? fail('SHADER_ALLOC');
      shaders.push(s);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        fail('SHADER_COMPILE: ' + gl.getShaderInfoLog(s));
    }
    p = gl.createProgram() ?? fail('PROGRAM_ALLOC');
    for (const s of shaders) gl.attachShader(p, s);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      fail('PROGRAM_LINK: ' + gl.getProgramInfoLog(p));
    return p;
  } catch (e) {
    if (p) gl.deleteProgram(p);
    throw e;
  } finally {
    for (const s of shaders) gl.deleteShader(s);
  }
}
interface Gpu {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  programs: WebGLProgram[];
  textures: WebGLTexture[];
  framebuffers: WebGLFramebuffer[];
  buffer: WebGLBuffer;
  alpha?: WebGLTexture;
  holes?: WebGLTexture;
  atlasImage?: CanvasImageSource;
  rectKey?: string;
  contextLost: boolean;
  lost: (event: Event) => void;
}
export class EncouragementGlyphHaloLayer {
  private gpu: Gpu | undefined;
  private disposed = false;
  constructor(private readonly owner: Document) {}
  private create(): Gpu {
    if (this.disposed) fail('DISPOSED');
    if (this.gpu) {
      if (this.gpu.contextLost || this.gpu.gl.isContextLost()) fail('CONTEXT_LOST');
      return this.gpu;
    }
    const canvas = this.owner.createElement('canvas');
    canvas.width = canvas.height = LIMITS.tileSide;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
      depth: false,
      stencil: false,
    });
    if (!gl) fail('WEBGL2_REQUIRED');
    const buffer = gl.createBuffer();
    if (!buffer) {
      canvas.width = canvas.height = 1;
      fail('BUFFER_ALLOC');
    }
    const gpu: Gpu = {
      canvas,
      gl,
      programs: [],
      textures: [],
      framebuffers: [],
      buffer,
      contextLost: false,
      lost: () => {},
    };
    this.gpu = gpu;
    gpu.lost = (event: Event) => {
      event.preventDefault();
      gpu.contextLost = true;
    };
    canvas.addEventListener('webglcontextlost', gpu.lost);
    try {
      if (gl.isContextLost()) fail('CONTEXT_LOST');
      if (
        gl.getParameter(gl.MAX_TEXTURE_SIZE) < LIMITS.tileSide ||
        gl.getParameter(gl.MAX_DRAW_BUFFERS) < 3
      )
        fail('GPU_LIMITS');
      for (const [v, f] of [
        [VERTEX, MASK],
        [FULL_VERTEX, DILATE],
        [FULL_VERTEX, BLUR],
        [FULL_VERTEX, COLOR],
      ])
        gpu.programs.push(program(gl, v!, f!));
      for (let i = 0; i < 5; i++) gpu.textures.push(this.texture(LIMITS.tileSide, LIMITS.tileSide));
      for (let i = 0; i < 3; i++) {
        const f = gl.createFramebuffer() ?? fail('FRAMEBUFFER_ALLOC');
        gpu.framebuffers.push(f);
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        const ids = i === 0 ? [0, 1, 2] : [i === 1 ? 3 : 4];
        ids.forEach((id, j) =>
          gl.framebufferTexture2D(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0 + j,
            gl.TEXTURE_2D,
            gpu.textures[id]!,
            0,
          ),
        );
        gl.drawBuffers(ids.map((_, j) => gl.COLOR_ATTACHMENT0 + j));
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
          fail('FRAMEBUFFER_INCOMPLETE');
      }
      gl.disable(gl.DITHER);
      return gpu;
    } catch (e) {
      this.releaseGpu();
      throw e;
    }
  }
  private texture(width: number, height: number, data?: Uint8Array) {
    const { gl } = this.gpu!,
      t = gl.createTexture() ?? fail('TEXTURE_ALLOC');
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      width,
      height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      data ?? null,
    );
    if (gl.getError() !== gl.NO_ERROR) {
      gl.deleteTexture(t);
      fail('TEXTURE_UPLOAD');
    }
    return t;
  }
  private atlas(groups: readonly GlyphHaloGroup[]) {
    const atlas = groups[0]!.atlas;
    if (
      groups.some(
        (g) =>
          g.atlas.image !== atlas.image ||
          g.atlas.width !== atlas.width ||
          g.atlas.height !== atlas.height,
      )
    )
      fail('ONE_ATLAS_REQUIRED');
    if (
      !Number.isInteger(atlas.width) ||
      !Number.isInteger(atlas.height) ||
      atlas.width * atlas.height > 4194304 ||
      atlas.width < 1 ||
      atlas.height < 1
    )
      fail('ATLAS_PIXELS');
    const rects = groups.flatMap(({ cue }) =>
        cue.glyphs.filter((g) => cue.frontHalo!.glyphIds.includes(g.id)),
      ),
      key = [
        ...new Set(
          rects.map((g) => [g.sourceX, g.sourceY, g.sourceWidth, g.sourceHeight].join(':')),
        ),
      ]
        .sort()
        .join('|');
    const gpu = this.create();
    if (gpu.atlasImage === atlas.image && gpu.rectKey === key) return;
    const { gl } = gpu;
    if (
      atlas.width > gl.getParameter(gl.MAX_TEXTURE_SIZE) ||
      atlas.height > gl.getParameter(gl.MAX_TEXTURE_SIZE)
    )
      fail('ATLAS_GPU_SIZE');
    // Release the previous atlas before reading/uploading its replacement.
    if (gpu.alpha) gl.deleteTexture(gpu.alpha);
    if (gpu.holes) gl.deleteTexture(gpu.holes);
    delete gpu.alpha;
    delete gpu.holes;
    delete gpu.atlasImage;
    delete gpu.rectKey;
    const unique = sourceRects(atlas.width, atlas.height, rects),
      canvas = this.owner.createElement('canvas');
    try {
      const c = canvas.getContext('2d', { willReadFrequently: true });
      if (!c) fail('ALPHA_READ_REQUIRED');
      const alpha = new Uint8Array(atlas.width * atlas.height),
        holes = new Uint8Array(alpha.length);
      // A crop-sized readback avoids an additional full-atlas RGBA canvas backing.
      // Every crop retains its actual alpha; no glyph RGB or core image is replaced.
      for (const r of unique) {
        canvas.width = r.sourceWidth;
        canvas.height = r.sourceHeight;
        c.drawImage(
          atlas.image,
          r.sourceX,
          r.sourceY,
          r.sourceWidth,
          r.sourceHeight,
          0,
          0,
          r.sourceWidth,
          r.sourceHeight,
        );
        const rgba = c.getImageData(0, 0, r.sourceWidth, r.sourceHeight).data,
          masks = createGlyphHaloAlphaMasks(rgba, r.sourceWidth, r.sourceHeight, [
            { ...r, sourceX: 0, sourceY: 0 },
          ]);
        for (let y = 0; y < r.sourceHeight; y++) {
          const row = y * r.sourceWidth,
            to = (r.sourceY + y) * atlas.width + r.sourceX;
          alpha.set(masks.alpha.subarray(row, row + r.sourceWidth), to);
          holes.set(masks.holes.subarray(row, row + r.sourceWidth), to);
        }
      }
      gpu.alpha = this.texture(atlas.width, atlas.height, alpha);
      gpu.holes = this.texture(atlas.width, atlas.height, holes);
      gpu.atlasImage = atlas.image;
      gpu.rectKey = key;
    } catch (e) {
      if (gpu.alpha) gl.deleteTexture(gpu.alpha);
      if (gpu.holes) gl.deleteTexture(gpu.holes);
      delete gpu.alpha;
      delete gpu.holes;
      throw e;
    } finally {
      canvas.width = canvas.height = 1;
    }
  }
  warmup(groups: readonly GlyphHaloGroup[]) {
    try {
      if (groups.length) this.atlas(groups);
    } catch (e) {
      this.releaseGpu();
      throw e;
    }
  }
  private sampler(p: WebGLProgram, name: string, unit: number, texture: WebGLTexture) {
    const { gl } = this.gpu!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(p, name), unit);
  }
  private quad(p: WebGLProgram) {
    const { gl, buffer, programs } = this.gpu!;
    const unused = gl.getAttribLocation(programs[0]!, 'uv');
    if (unused >= 0) gl.disableVertexAttribArray(unused);
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STREAM_DRAW);
    const pos = gl.getAttribLocation(p, 'p');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 8, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  draw(context: CanvasRenderingContext2D, groups: readonly GlyphHaloGroup[]) {
    try {
      this.drawValidated(context, groups);
    } catch (e) {
      this.releaseGpu();
      throw e;
    }
  }
  private drawValidated(context: CanvasRenderingContext2D, groups: readonly GlyphHaloGroup[]) {
    if (!groups.length) return;
    if (groups.length > 2) fail('GROUP_BUDGET');
    let stageArea = 0;
    for (const { cue, key } of groups) {
      const h = cue.frontHalo;
      if (
        !h ||
        !/^#[\da-f]{6}$/i.test(h.color) ||
        ![h.radiusPixels, h.blurPixels, h.opacity].every(Number.isFinite) ||
        h.radiusPixels < 0 ||
        h.radiusPixels > 4 ||
        h.blurPixels < 0 ||
        h.blurPixels > 4 ||
        h.opacity < 0 ||
        h.opacity > 1 ||
        h.radiusPixels + 3 * h.blurPixels > 16 ||
        (h.opacity > 0 && h.radiusPixels + h.blurPixels === 0)
      )
        fail('PARAMETERS');
      for (const p of key.glyphs)
        if (h.glyphIds.includes(p.id))
          createEncouragementGlyphQuadMesh(p.quad, { maxErrorPixels: 0.25, maxTriangles: 2048 });
      stageArea += dropEncouragementGlyphHaloBounds(cue, key)?.areaPixels ?? 0;
    }
    if (stageArea > 65536) fail('STAGE_BOUNDS_BUDGET');
    const m = context.getTransform(),
      scale = Math.hypot(m.a, m.b),
      sy = Math.hypot(m.c, m.d);
    if (
      ![m.a, m.b, m.c, m.d, m.e, m.f, scale, sy].every(Number.isFinite) ||
      scale <= 0 ||
      scale > 2 ||
      Math.abs(scale - sy) > 1e-6 * scale ||
      Math.abs(m.a * m.c + m.b * m.d) > 1e-6 * scale * sy
    )
      fail('UNIFORM_SCALE_REQUIRED');
    const plans = groups.map((group) => {
      const halo = group.cue.frontHalo!,
        poses = group.key.glyphs.filter(
          (p) => p.face === 'front' && halo.glyphIds.includes(p.id) && (p.opacity ?? 1) > 0,
        ),
        support = Math.ceil((halo.radiusPixels + 3 * halo.blurPixels) * scale) + 1;
      if (support > 33) fail('SUPPORT_BUDGET');
      const points = poses
        .flatMap((p) => p.quad)
        .map((p) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }));
      const left = Math.max(0, Math.floor(Math.min(...points.map((p) => p.x)) - support)),
        right = Math.min(
          context.canvas.width,
          Math.ceil(Math.max(...points.map((p) => p.x)) + support),
        ),
        top = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y)) - support)),
        bottom = Math.min(
          context.canvas.height,
          Math.ceil(Math.max(...points.map((p) => p.y)) + support),
        );
      return {
        group,
        poses,
        support,
        left,
        right,
        top,
        bottom,
        tiles:
          left < right && top < bottom
            ? Math.ceil((right - left) / 128) * Math.ceil((bottom - top) / 128)
            : 0,
      };
    });
    if (plans.reduce((s, p) => s + p.tiles, 0) > 16) fail('TILE_BUDGET');
    if (!plans.some((p) => p.tiles)) return;
    this.atlas(groups);
    const gpu = this.gpu!,
      { gl } = gpu,
      side = LIMITS.tileSide;
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = 'source-over';
      context.filter = 'none';
      context.imageSmoothingEnabled = false;
      context.shadowBlur = 0;
      context.shadowColor = 'rgba(0,0,0,0)';
      context.shadowOffsetX = context.shadowOffsetY = 0;
      for (const plan of plans) {
        const { group, poses, support } = plan,
          halo = group.cue.frontHalo!;
        for (let y = plan.top; y < plan.bottom; y += 128)
          for (let x = plan.left; x < plan.right; x += 128) {
            gl.viewport(0, 0, side, side);
            gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.framebuffers[0]!);
            gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.enable(gl.BLEND);
            gl.blendEquation(gl.MAX);
            gl.blendFunc(gl.ONE, gl.ONE);
            const mask = gpu.programs[0]!;
            gl.useProgram(mask);
            this.sampler(mask, 'atlasAlpha', 0, gpu.alpha!);
            this.sampler(mask, 'atlasHoles', 1, gpu.holes!);
            gl.uniform2f(gl.getUniformLocation(mask, 'size'), side, side);
            gl.uniform2f(
              gl.getUniformLocation(mask, 'atlasSize'),
              group.atlas.width,
              group.atlas.height,
            );
            for (const pose of poses) {
              const g = group.cue.glyphs.find((g) => g.id === pose.id)!,
                mesh = createEncouragementGlyphQuadMesh(pose.quad, {
                  maxErrorPixels: 0.25,
                  maxTriangles: 2048,
                }),
                data = new Float32Array(mesh.triangles.length * 12);
              let at = 0;
              for (const tri of mesh.triangles)
                for (const p of tri) {
                  data[at++] = m.a * p.x + m.c * p.y + m.e - x + support;
                  data[at++] = m.b * p.x + m.d * p.y + m.f - y + support;
                  data[at++] = p.u;
                  data[at++] = p.v;
                }
              gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffer);
              gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
              for (const [name, offset] of [
                ['p', 0],
                ['uv', 8],
              ] as const) {
                const loc = gl.getAttribLocation(mask, name);
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 16, offset);
              }
              gl.uniform4f(
                gl.getUniformLocation(mask, 'crop'),
                g.sourceX,
                g.sourceY,
                g.sourceWidth,
                g.sourceHeight,
              );
              gl.uniform1f(gl.getUniformLocation(mask, 'opacity'), pose.opacity ?? 1);
              gl.drawArrays(gl.TRIANGLES, 0, data.length / 4);
            }
            gl.disable(gl.BLEND);
            const dilate = gpu.programs[1]!;
            gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.framebuffers[1]!);
            gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
            gl.useProgram(dilate);
            this.sampler(dilate, 'image', 0, gpu.textures[1]!);
            gl.uniform2f(gl.getUniformLocation(dilate, 'size'), side, side);
            gl.uniform1f(gl.getUniformLocation(dilate, 'radius'), halo.radiusPixels * scale);
            this.quad(dilate);
            const blur = gpu.programs[2]!;
            gl.useProgram(blur);
            gl.uniform2f(gl.getUniformLocation(blur, 'size'), side, side);
            gl.uniform1f(gl.getUniformLocation(blur, 'sigma'), halo.blurPixels * scale);
            gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.framebuffers[2]!);
            this.sampler(blur, 'image', 0, gpu.textures[3]!);
            gl.uniform2f(gl.getUniformLocation(blur, 'direction'), 1, 0);
            this.quad(blur);
            gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.framebuffers[1]!);
            this.sampler(blur, 'image', 0, gpu.textures[4]!);
            gl.uniform2f(gl.getUniformLocation(blur, 'direction'), 0, 1);
            this.quad(blur);
            const color = gpu.programs[3]!;
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.drawBuffers([gl.BACK]);
            gl.useProgram(color);
            this.sampler(color, 'image', 0, gpu.textures[3]!);
            this.sampler(color, 'raw', 1, gpu.textures[0]!);
            this.sampler(color, 'hole', 2, gpu.textures[2]!);
            const rgb = parseInt(halo.color.slice(1), 16);
            gl.uniform3f(
              gl.getUniformLocation(color, 'rgb'),
              (rgb >>> 16) / 255,
              ((rgb >>> 8) & 255) / 255,
              (rgb & 255) / 255,
            );
            gl.uniform1f(gl.getUniformLocation(color, 'opacity'), halo.opacity);
            this.quad(color);
            const width = Math.min(128, plan.right - x),
              height = Math.min(128, plan.bottom - y);
            context.drawImage(gpu.canvas, support, support, width, height, x, y, width, height);
          }
      }
    } finally {
      context.restore();
    }
  }
  private releaseGpu() {
    const g = this.gpu;
    if (!g) return;
    const { gl } = g;
    for (const t of [...g.textures, ...(g.alpha ? [g.alpha] : []), ...(g.holes ? [g.holes] : [])])
      gl.deleteTexture(t);
    for (const f of g.framebuffers) gl.deleteFramebuffer(f);
    for (const p of g.programs) gl.deleteProgram(p);
    gl.deleteBuffer(g.buffer);
    g.canvas.removeEventListener('webglcontextlost', g.lost);
    g.canvas.width = g.canvas.height = 1;
    this.gpu = undefined;
  }
  dispose() {
    this.releaseGpu();
    this.disposed = true;
  }
}
