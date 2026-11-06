/// <reference types="vite/client" />

// Layer implementations are checked with tsconfig.calibrated.json; the
// common scene and its frame contract are checked by the main TypeScript build.
declare module '@bb/observed-layers' {
  import type { BBTimelineFrame } from './games/block-placement/planning/bbTimelinePlan';
  import type { ObservedLayerConfig } from './games/block-placement/planning/observedLayerConfig';
  export class ObservedLayers {
    constructor(
      canvas: HTMLCanvasElement,
      ctx: CanvasRenderingContext2D,
      config: ObservedLayerConfig,
    );
    warmup(): Promise<void>;
    begin(frame: BBTimelineFrame): { early: boolean; bg: string; sourceTime: number };
    hud(frame: BBTimelineFrame, early: boolean, bg: string): void;
    boardLayer(frame: BBTimelineFrame, early: boolean, sourceTime: number): void;
    pieces(frame: BBTimelineFrame, sourceTime: number): void;
    rack(frame: BBTimelineFrame, sourceTime: number): void;
    clear(frame: BBTimelineFrame, sourceTime: number): void;
    overlays(frame: BBTimelineFrame, sourceTime: number): void;
    finish(frame: BBTimelineFrame): void;
  }
}

// The implementation is checked separately by tsconfig.calibrated.json.
declare module '@bb/calibrated' {
  import type { CompiledFrameSource } from './nativeReference/game-runtime/frameSource';
  import type { VerifiedPointerOverlay } from './contracts/observedPointer';
  import type { BBTimelinePlan } from './games/block-placement/planning/bbTimelinePlan';
  interface CalibratedStage {
    resize(width: number, height: number, scale?: number): void;
    warmup(): Promise<void>;
    renderAt(packet: unknown): void;
    dispose(): void;
  }
  interface CalibratedPrepared {
    frameSource: CompiledFrameSource;
    timelinePlan: BBTimelinePlan;
    backend: { createStage(canvas: HTMLCanvasElement): CalibratedStage };
  }
  const extension: {
    id: string;
    version: string;
    renderDrivers: Array<{
      id: string;
      gameId: string;
      prepare(
        document: unknown,
        options: { takeId: string; pointer?: VerifiedPointerOverlay | null; calibration?: unknown },
      ): CalibratedPrepared;
    }>;
  };
  export default extension;
}
