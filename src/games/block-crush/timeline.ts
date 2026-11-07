import type { CompiledFrameSource } from '../../nativeReference/game-runtime/frameSource';
import { compileBlockCrushDropProjectFrameSource } from '../../nativeReference/games/block-crush-drop/render/projectRenderDriver';
import { attachBlockCrushDropRuntimeAssets } from '../../nativeReference/games/block-crush-drop/render/clearSequenceRuntime';
import { BlockCrushDropReferenceScene } from '../../nativeReference/games/block-crush-drop/render/BlockCrushDropReferenceScene';
import { blockCrushDropFrameFromPacket } from '../../nativeReference/games/block-crush-drop/presentation/presentationAdapter';
import {
  compileProductionAudio,
  verifyProductionAudioAssets,
} from '../../nativeReference/agent-director/audioMix';
import { verifyRuntimeAgentImageBindings } from '../../nativeReference/agent-assets/storage';
import { bcProduction, type BCProject } from './document';

export interface BCPlayback {
  project: BCProject;
  takeId: string;
  source: CompiledFrameSource;
  start: number;
  end: number;
  totalFrames: number;
}

export function compileBCPlayback(project: BCProject, takeId: string, full = false): BCPlayback {
  const take = project.takes.find((item) => item.takeId === takeId);
  if (!take || !take.actions.length) throw new Error('请先选择有动作的 Take。');
  const source = compileBlockCrushDropProjectFrameSource(project, take);
  const production = bcProduction(project);
  const clip = full
    ? undefined
    : production.clips?.find((item) => item.id === production.selectedClipId);
  if (!full && production.selectedClipId && !clip) throw new Error('工程选择的片段不存在。');
  if (clip && clip.takeId !== takeId)
    throw new Error('当前片段属于另一个 Take，请切换到全程或对应 Take。');
  const start = clip?.startFrame ?? 0;
  const end = clip?.endFrame ?? source.totalFrames - 1;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end >= source.totalFrames
  )
    throw new Error('保存的片段范围超出当前 Take；请明确调整片段或选择全程。');
  return { project, takeId, source, start, end, totalFrames: end - start + 1 };
}

export async function prepareBCScene(canvas: HTMLCanvasElement, playback: BCPlayback) {
  const { project } = playback;
  const assets = attachBlockCrushDropRuntimeAssets(undefined, project, playback.takeId);
  await verifyRuntimeAgentImageBindings(assets);
  const scene = new BlockCrushDropReferenceScene(canvas, 'classic-wood', assets);
  const frameAt = (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= playback.totalFrames)
      throw new Error('预览帧越界。');
    return blockCrushDropFrameFromPacket(playback.source.evaluate(playback.start + index));
  };
  try {
    scene.resize(project.production.output.width, project.production.output.height, 1);
    await scene.warmup(frameAt(0));
  } catch (error) {
    scene.dispose();
    throw error;
  }
  return {
    render: (index: number) => scene.renderAt(frameAt(index)),
    dispose: () => scene.dispose(),
  };
}

export async function mixBCAudio(playback: BCPlayback) {
  const audio = bcProduction(playback.project).audio;
  if (!audio) return null;
  await verifyProductionAudioAssets(audio);
  const mix = compileProductionAudio(playback.source, audio, 48_000, {
    startFrame: playback.start,
    endFrame: playback.end,
  });
  if (mix.track.numberOfChannels !== 2) throw new Error('BC 混音声道与编码器不匹配。');
  return { ...mix, track: { ...mix.track, numberOfChannels: 2 as const } };
}
