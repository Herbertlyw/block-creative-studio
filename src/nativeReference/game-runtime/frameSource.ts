import type { GameProjectEnvelope } from './projectEnvelope';
import type { PresentationPacket } from './presentationPacket';
import type { GameReplayEnvelope } from './replayEnvelope';

export interface CompiledFrameSource {
  readonly gameId: string;
  readonly takeId: string;
  readonly fps: number;
  readonly totalFrames: number;
  readonly frameSourceHash: string;
  evaluate(frameIndex: number): PresentationPacket;
}

export interface PresentationCompilerAdapter {
  readonly gameId: string;
  compile(input: {
    project: GameProjectEnvelope;
    replay: GameReplayEnvelope;
    directorProfile: unknown;
    fps: number;
  }): CompiledFrameSource;
}
