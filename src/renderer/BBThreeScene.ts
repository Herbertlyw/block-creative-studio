import { StudioScene, type ThreeSceneStyle } from './StudioScene';
import { authoredPacketFrame } from '../games/block-placement/presentation/evaluateAuthoredFrame';
import type { BBTimelineFrame } from '../games/block-placement/planning/bbTimelinePlan';
import type { StyleSpec } from '../nativeReference/domain/types';

function threeStyle(style: StyleSpec): ThreeSceneStyle {
  if (style.lighting === 'neutral-lookdev')
    throw new Error('3D 暂不支持 neutral-lookdev 灯光，未替换原工程配置。');
  return {
    material: style.material,
    lighting: style.lighting,
    camera: style.camera,
    fx: style.fx,
    geometry: style.geometry,
    background: style.background,
    showPointer: style.showPointer,
  };
}

/** 3D projection of a sampled BB frame. It owns neither game replay nor a clock. */
export class BBThreeScene {
  readonly canvas: HTMLCanvasElement;
  private readonly scene: StudioScene;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new StudioScene(canvas, { quality: 'cinematic' });
  }
  resize(width: number, height: number, scale = 1): void {
    this.scene.resize(width, height, scale);
  }
  async warmup(frame: BBTimelineFrame, style: StyleSpec): Promise<void> {
    await this.scene.warmup(
      authoredPacketFrame(frame, frame.fps, frame.totalFrames),
      threeStyle(style),
    );
  }
  renderAt(frame: BBTimelineFrame, style: StyleSpec): void {
    this.scene.renderAt(
      authoredPacketFrame(frame, frame.fps, frame.totalFrames),
      threeStyle(style),
    );
  }
  dispose(): void {
    this.scene.dispose();
  }
}
