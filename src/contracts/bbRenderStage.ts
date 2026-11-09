import { BBScene2D } from '../games/block-placement/rendering/BBScene2D';
import { readBBFrame } from '../games/block-placement/planning/timelineFrameSource';
import type { CompiledFrameSource } from '../nativeReference/game-runtime/frameSource';
import type { RuntimeAssetBindings } from '../nativeReference/assets/runtimeAssetBindings';
import type { StyleSpec } from '../nativeReference/domain/types';
import type { BBThreeScene } from '../renderer/BBThreeScene';
import { paintWorkbenchView, type WorkbenchView } from './reference2dView';
import type { prepareCalibratedRenderer } from './calibratedRenderer';

type Scene = BBScene2D | BBThreeScene;
export async function createAuthoredBBStage(args: {
  target: HTMLCanvasElement;
  width: number;
  height: number;
  purpose: 'preview' | 'export';
  initialFrame: number;
  scale: number;
  visualMode: '2d' | '3d';
  solidBackground: string | null;
  assets: RuntimeAssetBindings | null;
  source: CompiledFrameSource;
  style: StyleSpec;
  view: WorkbenchView | null;
}) {
  const {
    target,
    width,
    height,
    purpose,
    initialFrame,
    scale,
    visualMode,
    solidBackground,
    assets,
    source,
    style,
    view,
  } = args;
  target.width = width;
  target.height = height;
  const staging =
    purpose === 'preview' || view || scale !== 1 ? document.createElement('canvas') : target;
  let scene: Scene;
  if (visualMode === '2d')
    scene = new BBScene2D(staging, { quality: 'cinematic', solidBackground });
  else {
    const { BBThreeScene } = await import('../renderer/BBThreeScene');
    scene = new BBThreeScene(staging);
  }
  try {
    scene.resize(width, height, scale);
    if (assets && scene instanceof BBScene2D) scene.setRuntimeAssets(assets);
    await scene.warmup(readBBFrame(source.evaluate(initialFrame)), style);
    return {
      draw(index: number) {
        scene.renderAt(readBBFrame(source.evaluate(index)), style);
        if (view) paintWorkbenchView(staging, target, view, index);
        else if (staging !== target) {
          const context = target.getContext('2d');
          if (!context) throw new Error('无法创建预览画布。');
          context.drawImage(staging, 0, 0, width, height);
        }
      },
      dispose() {
        scene.dispose();
      },
    };
  } catch (error) {
    scene.dispose();
    throw error;
  }
}
export async function createObservedBBStage(
  target: HTMLCanvasElement,
  width: number,
  height: number,
  scale: number,
  prepared: ReturnType<typeof prepareCalibratedRenderer>,
) {
  target.width = width;
  target.height = height;
  const staging = scale === 1 ? target : document.createElement('canvas');
  const stage = prepared.backend.createStage(staging);
  stage.resize(width, height, scale);
  try {
    await stage.warmup();
    return {
      draw(index: number) {
        stage.renderAt(prepared.frameSource.evaluate(index));
        if (staging !== target) {
          const context = target.getContext('2d');
          if (!context) throw new Error('无法创建输出画布。');
          context.clearRect(0, 0, width, height);
          context.drawImage(staging, 0, 0, width, height);
        }
      },
      dispose() {
        stage.dispose();
      },
    };
  } catch (error) {
    stage.dispose();
    throw error;
  }
}
