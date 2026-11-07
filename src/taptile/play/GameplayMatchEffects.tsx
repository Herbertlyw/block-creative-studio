import type { CSSProperties, ReactNode } from 'react';
import { tapTileTraySlotRect } from '../trayLayout';

export interface GameplayMatchEffect {
  id: string;
  tileIds: string[];
  slotIndexes: number[];
}

type MatchVfxStyle = CSSProperties & Record<`--${string}`, string | number>;

const SHARDS_PER_TILE = 10;

function shardStyle(tileIndex: number, shardIndex: number): MatchVfxStyle {
  const angleDeg = -155 + shardIndex * 34 + tileIndex * 11;
  const angle = angleDeg * Math.PI / 180;
  const distance = 94 + ((shardIndex * 29 + tileIndex * 17) % 82);
  const gravity = 44 + ((shardIndex * 13 + tileIndex * 7) % 58);
  return {
    '--match-shard-x': `${Math.cos(angle) * distance}%`,
    '--match-shard-y': `${Math.sin(angle) * distance + gravity}%`,
    '--match-shard-rotation': `${angleDeg * 2.7 + shardIndex * 37}deg`,
    '--match-shard-scale': 0.62 + ((shardIndex * 7 + tileIndex * 3) % 6) * 0.1,
    '--match-shard-delay': `${105 + ((shardIndex + tileIndex * 2) % 4) * 13}ms`,
  };
}

export function GameplayMatchEffects({
  effects,
  stageWidth,
  stageHeight,
  renderTile,
}: {
  effects: readonly GameplayMatchEffect[];
  stageWidth: number;
  stageHeight: number;
  renderTile(tileId: string): ReactNode;
}) {
  if (effects.length === 0) return null;
  return (
    <div className="tpt-live-match-layer" data-match-vfx-count={effects.length} aria-hidden="true">
      {effects.flatMap((effect) => effect.tileIds.map((tileId, tileIndex) => {
        const slotIndex = effect.slotIndexes[tileIndex] ?? tileIndex;
        const slot = tapTileTraySlotRect(slotIndex);
        return (
          <span
            key={`${effect.id}:${tileId}`}
            className="tpt-live-match-unit"
            data-match-effect-id={effect.id}
            data-match-tile-id={tileId}
            data-match-slot-index={slotIndex}
            style={{
              left: `${(slot.left / stageWidth) * 100}%`,
              top: `${(slot.top / stageHeight) * 100}%`,
              width: `${(slot.width / stageWidth) * 100}%`,
              height: `${(slot.height / stageHeight) * 100}%`,
            }}
          >
            <span className="tpt-live-match-halo" />
            <span className="tpt-live-match-tile">{renderTile(tileId)}</span>
            {Array.from({ length: SHARDS_PER_TILE }, (_, shardIndex) => (
              <i
                key={shardIndex}
                className="tpt-live-match-shard"
                style={shardStyle(tileIndex, shardIndex)}
              />
            ))}
          </span>
        );
      }))}
    </div>
  );
}
