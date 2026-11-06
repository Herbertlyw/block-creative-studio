import type { SemanticEventCategory } from './presentationPacket';

export const GAME_RENDER_CONTRACT = 'bcs.game-render-contract' as const;
export const GAME_RENDER_CONTRACT_VERSION = '1.0.0' as const;

export type GameRenderRepresentationKind =
  | 'screen-2d'
  | 'procedural-2d'
  | 'shallow-3d'
  | 'full-3d'
  | 'baked-render';

export interface GameRenderRepresentationSpec {
  kind: GameRenderRepresentationKind;
  /** Gameplay supplies semantic endpoints; a renderer may only interpolate between them. */
  motionSource: 'semantic-endpoints' | 'static';
  fallbackSlotId?: string;
}

export interface GameRenderResourceBudget {
  maxInstances?: number;
  maxFragmentsPerEvent?: number;
  maxParticlesPerEvent?: number;
  maxShadowCasters?: number;
}

export interface GameRenderSlotRequirement {
  slotId: string;
  acceptedKinds: string[];
  required: boolean;
  role?: string;
  /** Stable meaning shared by games even when their concrete slot ids differ. */
  semanticRole?: string;
  replaceable?: boolean;
  representation?: GameRenderRepresentationSpec;
  eventBindings?: GameEventBinding[];
  budget?: GameRenderResourceBudget;
}

export interface GameRenderPassSpec {
  id: string;
  order: number;
  required: boolean;
}

export interface GameRenderBackendSpec {
  supportedPresentationSchemas: string[];
  requiredSlots: GameRenderSlotRequirement[];
  passes: GameRenderPassSpec[];
  /** Camera capability belongs to the backend contract, never gameplay truth. */
  cameraMotion?: 'none' | 'fixed' | 'moving';
}

export interface GameEventBinding {
  eventType?: string;
  category?: SemanticEventCategory;
  tags?: string[];
  legacyAliases?: string[];
}

export interface GameRenderEventSpec {
  type: string;
  category: SemanticEventCategory;
  tags: string[];
  legacyAliases?: string[];
}

export interface GameRenderContract {
  contract: typeof GAME_RENDER_CONTRACT;
  contractVersion: typeof GAME_RENDER_CONTRACT_VERSION;
  id: string;
  version: string;
  gameId: string;
  eventCatalog: GameRenderEventSpec[];
  backends: Record<string, GameRenderBackendSpec>;
}

export function requiredSlotIds(contract: GameRenderContract, renderer: string): string[] {
  const backend = contract.backends[renderer];
  if (!backend) return [];
  return backend.requiredSlots.filter((slot) => slot.required).map((slot) => slot.slotId);
}

export function slotRequirement(
  contract: GameRenderContract,
  renderer: string,
  slotId: string,
): GameRenderSlotRequirement | undefined {
  return contract.backends[renderer]?.requiredSlots.find((slot) => slot.slotId === slotId);
}

export function catalogAcceptsEvent(contract: GameRenderContract, event: string): boolean {
  return contract.eventCatalog.some((item) => {
    if (item.type === event) return true;
    return (item.legacyAliases ?? []).includes(event);
  });
}

export function bindingEventType(binding: GameEventBinding, fallback: string): string {
  return binding.eventType ?? fallback;
}
