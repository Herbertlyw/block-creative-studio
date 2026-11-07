import type { RuntimeImageAssetBinding } from '../../../assets/runtimeAssetBindings';
import type { BlockCrushDropPresentationFrame } from '../presentation/presentationAdapter';
import {
  DROP_ENCOURAGEMENT_GLYPH_ATLAS_MAX_PIXELS,
  DROP_ENCOURAGEMENT_GLYPH_LIMITS,
  dropEncouragementGlyphKeyCost,
  sampleDropEncouragementGlyphKey,
  type DropEncouragementGlyphCue,
  type DropEncouragementGlyphEmission,
} from '../profiles/encouragementGlyphCues';
import { EncouragementGlyphHaloLayer, type GlyphHaloGroup } from './encouragementGlyphHaloLayer';
import {
  drawEncouragementGlyphGlow,
  drawEncouragementGlyphQuad,
  type EncouragementGlyphScratch,
  type EncouragementGlyphScratchFactory,
} from './encouragementGlyphQuad';

export type DropEncouragementGlyphAtlases = Partial<
  Record<string, { binding: RuntimeImageAssetBinding; image: CanvasImageSource }>
>;
export interface DropEncouragementGlyphLayerService {
  draw(
    context: CanvasRenderingContext2D,
    frame: BlockCrushDropPresentationFrame,
    atlases: DropEncouragementGlyphAtlases,
  ): void;
  dispose(): void;
}
function checkedAtlas(cue: DropEncouragementGlyphCue, atlases: DropEncouragementGlyphAtlases) {
  const atlas = atlases[cue.atlasSlot];
  if (!atlas) throw new Error(`DROP_ENCOURAGEMENT_GLYPH_ATLAS_REQUIRED: ${cue.atlasSlot}`);
  const { width, height } = atlas.binding,
    image = atlas.image as {
      width?: number;
      height?: number;
      naturalWidth?: number;
      naturalHeight?: number;
    };
  if (
    !width ||
    !height ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width * height > DROP_ENCOURAGEMENT_GLYPH_ATLAS_MAX_PIXELS
  )
    throw new Error('DROP_ENCOURAGEMENT_GLYPH_ATLAS_PIXEL_BUDGET');
  if (
    (image.naturalWidth ?? image.width) !== width ||
    (image.naturalHeight ?? image.height) !== height
  )
    throw new Error('DROP_ENCOURAGEMENT_GLYPH_ATLAS_DECODE_DIMENSIONS');
  for (const glyph of cue.glyphs)
    if (glyph.sourceX + glyph.sourceWidth > width || glyph.sourceY + glyph.sourceHeight > height)
      throw new Error(`DROP_ENCOURAGEMENT_GLYPH_ATLAS_CROP_OUTSIDE_IMAGE: ${glyph.id}`);
  return { ...atlas, width, height };
}

/** Canvas shadows use device pixels rather than the CTM; atom coordinates stay canonical. */
function emissionOutputScale(context: CanvasRenderingContext2D): number {
  const m = context.getTransform(),
    sx = Math.hypot(m.a, m.b),
    sy = Math.hypot(m.c, m.d);
  if (
    ![m.a, m.b, m.c, m.d, m.e, m.f, sx, sy].every(Number.isFinite) ||
    sx <= 0 ||
    sy <= 0 ||
    Math.abs(sx - sy) > 1e-6 * Math.max(sx, sy) ||
    Math.abs(m.a * m.c + m.b * m.d) > 1e-6 * sx * sy
  )
    throw new Error('DROP_ENCOURAGEMENT_GLYPH_EMISSION_UNIFORM_SCALE_REQUIRED');
  return sx;
}
/** One polygon fill means its opacity is applied once, never once per glyph triangle. */
function drawEmission(
  context: CanvasRenderingContext2D,
  emission: DropEncouragementGlyphEmission,
  outputScale: number,
): void {
  context.save();
  try {
    context.globalAlpha *= emission.opacity;
    context.globalCompositeOperation = 'source-over';
    context.fillStyle = emission.color;
    context.shadowColor = emission.haloColor;
    context.shadowBlur = emission.blurPixels * outputScale;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    context.beginPath();
    context.moveTo(emission.points[0]!.x, emission.points[0]!.y);
    for (const point of emission.points.slice(1)) context.lineTo(point.x, point.y);
    context.closePath();
    context.fill();
  } finally {
    context.restore();
  }
}

/** A two-canvas lease pool; the frozen helper returns both leases in finally. */
export class DropEncouragementGlyphLayer implements DropEncouragementGlyphLayerService {
  private readonly pool: Array<{
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    leased: boolean;
  }> = [];
  private readonly scratch: EncouragementGlyphScratchFactory;
  private halo: EncouragementGlyphHaloLayer | undefined;
  constructor(private readonly owner: Document) {
    this.scratch = (width, height): EncouragementGlyphScratch => {
      let item = this.pool.find((p) => !p.leased);
      if (!item) {
        if (this.pool.length >= 2) throw new Error('DROP_ENCOURAGEMENT_GLYPH_SCRATCH_LEASE_BUDGET');
        const canvas = owner.createElement('canvas'),
          context = canvas.getContext('2d', { alpha: true });
        if (!context) throw new Error('DROP_ENCOURAGEMENT_GLYPH_SCRATCH_CONTEXT_REQUIRED');
        item = { canvas, context, leased: false };
        this.pool.push(item);
      }
      item.leased = true;
      item.canvas.width = width;
      item.canvas.height = height;
      const lease = item;
      return {
        image: item.canvas,
        context: item.context,
        dispose() {
          lease.canvas.width = 1;
          lease.canvas.height = 1;
          lease.leased = false;
        },
      };
    };
  }
  warmup(cues: readonly DropEncouragementGlyphCue[], atlases: DropEncouragementGlyphAtlases) {
    for (const cue of cues) checkedAtlas(cue, atlases);
    const groups: GlyphHaloGroup[] = cues
      .filter((c) => c.frontHalo && c.frontHalo.opacity > 0)
      .map((cue) => ({ cue, key: cue.keys[0]!, atlas: checkedAtlas(cue, atlases) }));
    if (groups.length) (this.halo ??= new EncouragementGlyphHaloLayer(this.owner)).warmup(groups);
  }
  draw(
    context: CanvasRenderingContext2D,
    frame: BlockCrushDropPresentationFrame,
    atlases: DropEncouragementGlyphAtlases,
  ): void {
    const cues = frame.before.config.presentation.referenceCalibration?.encouragementGlyphCues;
    if (!cues?.length || !frame.encouragementGlyphWaves?.length) return;
    const selected = frame.encouragementGlyphWaves.flatMap((wave) => {
      const cue = cues[wave.cueIndex];
      if (!cue) throw new Error('DROP_ENCOURAGEMENT_GLYPH_CUE_INDEX');
      const key = sampleDropEncouragementGlyphKey(cue, wave.elapsedFrames, frame.fps);
      return key
        ? [
            {
              cue,
              key,
              atlas: checkedAtlas(cue, atlases),
              cost: dropEncouragementGlyphKeyCost(cue, key),
            },
          ]
        : [];
    });
    const sum = selected.reduce(
      (s, v) => ({
        drawTriangles: s.drawTriangles + v.cost.drawTriangles,
        scratchPixels: s.scratchPixels + v.cost.scratchPixels,
        glows: s.glows + v.cost.glows,
        emissions: s.emissions + v.cost.emissions,
        emissionAreaPixels: s.emissionAreaPixels + v.cost.emissionAreaPixels,
        emissionBoundsPixels: s.emissionBoundsPixels + v.cost.emissionBoundsPixels,
        emissionBlurBoundsPixels: s.emissionBlurBoundsPixels + v.cost.emissionBlurBoundsPixels,
      }),
      {
        drawTriangles: 0,
        scratchPixels: 0,
        glows: 0,
        emissions: 0,
        emissionAreaPixels: 0,
        emissionBoundsPixels: 0,
        emissionBlurBoundsPixels: 0,
      },
    );
    if (
      sum.drawTriangles > 32768 ||
      sum.scratchPixels > 2097152 ||
      sum.glows > 2 ||
      sum.emissions > 4 ||
      sum.emissionAreaPixels > 65536 ||
      sum.emissionBoundsPixels > 65536 ||
      sum.emissionBlurBoundsPixels > 262144
    )
      throw new Error('DROP_ENCOURAGEMENT_GLYPH_CONCURRENT_BUDGET');
    const haloSelected = selected.filter(
      ({ cue, key }) =>
        cue.frontHalo &&
        cue.frontHalo.opacity > 0 &&
        key.glyphs.some(
          (p) =>
            p.face === 'front' && cue.frontHalo!.glyphIds.includes(p.id) && (p.opacity ?? 1) > 0,
        ),
    );
    if (
      haloSelected.length > 2 ||
      selected.reduce((s, v) => s + (v.cost.haloBoundsPixels ?? 0), 0) > 65536 ||
      selected.reduce((s, v) => s + (v.cost.haloDeviceTiles ?? 0), 0) > 16
    )
      throw new Error('DROP_ENCOURAGEMENT_GLYPH_HALO_CONCURRENT_BUDGET');
    const outputScale = sum.emissions ? emissionOutputScale(context) : undefined;
    // Validate all live atoms/budgets before allocating or painting any of them.
    context.save();
    try {
      context.filter = 'none';
      for (const { key } of selected)
        for (const glow of key.glows ?? []) drawEncouragementGlyphGlow(context, glow);
      if (outputScale !== undefined)
        for (const { key } of selected)
          for (const emission of key.emissions ?? [])
            if (emission.layer === 'behind') drawEmission(context, emission, outputScale);
      if (haloSelected.length)
        (this.halo ??= new EncouragementGlyphHaloLayer(this.owner)).draw(context, haloSelected);
      for (const { cue, key, atlas } of selected)
        for (const pose of key.glyphs) {
          const g = cue.glyphs.find((g) => g.id === pose.id)!,
            texture = {
              image: atlas.image,
              width: atlas.width,
              height: atlas.height,
              sourceRect: {
                x: g.sourceX,
                y: g.sourceY,
                width: g.sourceWidth,
                height: g.sourceHeight,
              },
            };
          // A generated RGBA atom uses its own alpha once. The same isolated alpha
          // tints back/sides; it is not multiplied into the front a second time.
          drawEncouragementGlyphQuad(
            context,
            { glyphId: g.id, front: texture, mask: texture, frontMaskMode: 'source-alpha' },
            pose.quad,
            {
              face: pose.face,
              backColor: cue.backColor,
              sideColor: cue.sideColor,
              ...(pose.opacity === undefined ? {} : { opacity: pose.opacity }),
              ...(pose.extrusion ? { extrusion: pose.extrusion } : {}),
              maxErrorPixels: DROP_ENCOURAGEMENT_GLYPH_LIMITS.maxErrorPixels,
              maxTriangles: DROP_ENCOURAGEMENT_GLYPH_LIMITS.maxMeshTriangles,
            },
            this.scratch,
          );
        }
      if (outputScale !== undefined)
        for (const { key } of selected)
          for (const emission of key.emissions ?? [])
            if (emission.layer === 'front') drawEmission(context, emission, outputScale);
    } finally {
      context.restore();
    }
  }
  dispose(): void {
    this.halo?.dispose();
    this.halo = undefined;
    for (const p of this.pool) {
      p.canvas.width = 1;
      p.canvas.height = 1;
      p.leased = false;
    }
    this.pool.length = 0;
  }
}
