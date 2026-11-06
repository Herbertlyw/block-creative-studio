export type SemanticEventCategory =
  | 'interaction'
  | 'commit'
  | 'detect'
  | 'resolve'
  | 'reconfigure'
  | 'settle'
  | 'outcome';

export interface SemanticGameEvent {
  id: string;
  type: string;
  category: SemanticEventCategory;
  tags: string[];
  entityIds: string[];
  payload?: unknown;
}

export const PRESENTATION_PACKET_CONTRACT = 'bcs.presentation-packet' as const;
export const PRESENTATION_PACKET_CONTRACT_VERSION = '1.0.0' as const;

export interface PresentationPacketIdentity {
  gameId: string;
  moduleVersion: string;
  takeId: string;
  frameIndex: number;
  fps: number;
  totalFrames: number;
  stateHash: string;
  presentationHash: string;
}

export interface PresentationPacketFeedback {
  cameraPunch: number;
  screenShake?: { x: number; y: number };
  exposurePulse?: number;
}

export interface PresentationPacket {
  contract: typeof PRESENTATION_PACKET_CONTRACT;
  contractVersion: typeof PRESENTATION_PACKET_CONTRACT_VERSION;
  identity: PresentationPacketIdentity;
  semanticEvents: SemanticGameEvent[];
  feedback: PresentationPacketFeedback;
  payloadSchemaId: string;
  payload: unknown;
}

export function presentationHashIdentity(input: {
  frameIndex: number;
  fps: number;
  totalFrames: number;
  payload: unknown;
  semanticEvents: SemanticGameEvent[];
  cameraPunch: number;
}): unknown {
  return {
    frameIndex: input.frameIndex,
    fps: input.fps,
    totalFrames: input.totalFrames,
    payload: input.payload,
    semanticEvents: input.semanticEvents,
    cameraPunch: input.cameraPunch,
  };
}
