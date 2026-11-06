import { evaluateCompiledTake } from './presentationCompiler';
import { blastPraiseTier } from '../domain/praise';
import type { CompiledTake, PresentationFrame, RhythmProfile } from '../domain/types';

export interface PlacementSemanticEvent {
  id: string;
  type: string;
  category: 'interaction' | 'commit' | 'resolve' | 'outcome';
  tags: string[];
  entityIds: string[];
  payload?: Record<string, unknown>;
}
/** Derived from the verified legacyPresentationAdapter; events can persist across multiple frames. */
export function semanticEventsForFrame(frame: PresentationFrame): PlacementSemanticEvent[] {
  const events: PlacementSemanticEvent[] = [];
  const action = frame.currentActionId ?? `turn-${frame.snapshot.turn}`;
  if (frame.draggedPiece)
    events.push({
      id: `drag-${action}-${frame.draggedPiece.piece.id}`,
      type: 'block-placement.drag',
      category: 'interaction',
      tags: ['pointer'],
      entityIds: [frame.draggedPiece.piece.id],
    });
  if (frame.placementFeedback)
    events.push({
      id: `commit-${action}`,
      type: 'block-placement.placement-committed',
      category: 'commit',
      tags: ['placement'],
      entityIds: frame.placementFeedback.cells.map((cell) => `${cell.row}:${cell.col}`),
      payload: { placementPoints: frame.placementFeedback.placementPoints },
    });
  const clear = frame.clearing?.clear;
  if (clear && (clear.rows.length || clear.cols.length)) {
    const cross = clear.rows.length > 0 && clear.cols.length > 0;
    events.push({
      id: `${cross ? 'cross' : 'line'}-${action}`,
      type: `block-placement.${cross ? 'cross' : 'line'}-cleared`,
      category: 'resolve',
      tags: cross ? ['clear', 'cross'] : ['clear'],
      entityIds: [
        ...clear.rows.map((row) => `row:${row}`),
        ...clear.cols.map((col) => `col:${col}`),
      ],
    });
    const tier = blastPraiseTier(frame.snapshot.combo, clear.rows.length + clear.cols.length);
    events.push({
      id: `praise-${action}`,
      type: `block-placement.praise-${tier}`,
      category: 'resolve',
      tags: ['clear', 'praise'],
      entityIds: [],
      payload: { tier, combo: frame.snapshot.combo },
    });
  }
  if (frame.snapshot.status === 'game-over')
    events.push({
      id: 'over-terminal',
      type: 'block-placement.game-over',
      category: 'outcome',
      tags: ['terminal'],
      entityIds: [],
    });
  return events;
}
/** Emit each persistent semantic event once, at its first displayed frame. */
export function collectSemanticEvents(
  compiled: CompiledTake,
  rhythm: RhythmProfile,
): Array<PlacementSemanticEvent & { frame: number }> {
  const seen = new Set<string>(),
    result: Array<PlacementSemanticEvent & { frame: number }> = [];
  for (let frame = 0; frame < compiled.totalFrames; frame++)
    for (const event of semanticEventsForFrame(evaluateCompiledTake(compiled, frame, rhythm))) {
      if (!seen.has(event.id)) {
        seen.add(event.id);
        result.push({ ...event, frame });
      }
    }
  return result;
}
