import { GameRegistry } from '../nativeReference/game-runtime/gameRegistry';
import { validateStudioProjectDocumentV2 } from '../nativeReference/game-runtime/projectDocument';
import { blockPlacementDefinition } from '../nativeReference/games/block-placement/definition';
import {
  parseBlockPlacementAction,
  type BlockPlacementSemanticAction,
} from '../nativeReference/games/block-placement/schemas';
import { compileTake } from '../nativeReference/games/block-placement/presentation/presentationCompiler';
import type {
  GameSnapshot,
  RhythmProfile,
  Take,
  CompiledTake,
  StyleSpec,
} from '../nativeReference/domain/types';
import type { CompiledFrameSource } from '../nativeReference/game-runtime/frameSource';
import { isValidPlacementContract } from './validateContract';
import {
  normalizeAuthoredTake,
  type AuthoredTakePlan,
} from '../games/block-placement/planning/normalizeAuthoredTake';
import { createBBTimelineSource } from '../games/block-placement/planning/timelineFrameSource';

/** Reference timing compiler over an isolated, checked V2 subset; never modifies the document. */
export function compileNativeTake(
  document: unknown,
  takeId: string,
  styleOverride?: StyleSpec,
): {
  compiled: CompiledTake;
  rhythm: RhythmProfile;
  frameSource: CompiledFrameSource;
  timelinePlan: AuthoredTakePlan;
} {
  if (!isValidPlacementContract(document)) throw new Error('V2 Schema 未通过，无法编译时间。');
  const games = new GameRegistry();
  games.register(blockPlacementDefinition);
  const checked = validateStudioProjectDocumentV2(document, games);
  const found = checked.parsed.takes.find(({ replay }) => replay.takeId === takeId);
  if (!found) throw new Error(`找不到 Take ${takeId}。`);
  const rhythm = checked.direction?.rhythm as RhythmProfile | undefined;
  if (!rhythm) throw new Error('缺少 direction.rhythm，无法编译时间。');
  const take: Take = {
    id: takeId,
    name: takeId,
    createdAt: '1970-01-01T00:00:00.000Z',
    initial: structuredClone(checked.parsed.initialState) as GameSnapshot,
    actions: found.actions.map((item, index) => {
      const semantic = item as BlockPlacementSemanticAction;
      const envelope = found.replay.actions[index]!;
      const interactions = found.replay.interactions.filter(
        (entry) => entry.committedActionId === envelope.id,
      );
      if (interactions.length !== 1)
        throw new Error(`第 ${index + 1} 步（${envelope.id}）需要且只能有一个提交交互。`);
      const interaction = interactions[0]!;
      return parseBlockPlacementAction({
        id: envelope.id,
        actor: envelope.actor,
        pieceId: semantic.pieceId,
        anchor: semantic.anchor,
        durationFrames: interaction.endFrame - interaction.startFrame,
        pointerPath: interaction.samples ?? [],
      });
    }),
  };
  const fps = checked.production.output.fps;
  const compiled = compileTake(take, rhythm, fps);
  const style = styleOverride ?? (checked.direction?.style as StyleSpec | undefined);
  const plan = normalizeAuthoredTake(takeId, compiled, rhythm, style?.reference2d?.cellGapPx);
  // The live source identity includes all normalized geometry and tracks. Saved
  // variant contracts retain their separate historical plan identity.
  const frameSource = createBBTimelineSource(plan);
  return { compiled, rhythm, frameSource, timelinePlan: plan };
}
