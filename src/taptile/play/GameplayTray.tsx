import type { CSSProperties, ReactNode } from 'react';
import type { TapTileGameplayStatus } from '../gameplay';
import {
  TAPTILE_REFERENCE_TRAY_BOUNDS,
  TAPTILE_TRAY_CAPACITY,
  tapTileTraySlotRect,
} from '../trayLayout';

function slotStyle(index: number): CSSProperties {
  const tray = TAPTILE_REFERENCE_TRAY_BOUNDS;
  const slot = tapTileTraySlotRect(index, tray);
  return {
    left: `${((slot.left - tray.left) / tray.width) * 100}%`,
    top: `${((slot.top - tray.top) / tray.height) * 100}%`,
    width: `${(slot.width / tray.width) * 100}%`,
    height: `${(slot.height / tray.height) * 100}%`,
  };
}

export function GameplayTray({
  trayIds,
  status,
  renderTile,
}: {
  trayIds: readonly string[];
  status: TapTileGameplayStatus;
  renderTile(tileId: string): ReactNode;
}) {
  return (
    <div className={`tpt-tray tpt-gameplay-tray status-${status}`} data-occupied={trayIds.length}>
      {Array.from({ length: TAPTILE_TRAY_CAPACITY }, (_, index) => {
        const tileId = trayIds[index];
        return (
          <i
            key={index}
            className={tileId ? 'is-occupied' : ''}
            data-tray-index={index}
            data-tile-id={tileId}
            style={slotStyle(index)}
          >
            {tileId ? renderTile(tileId) : null}
          </i>
        );
      })}
    </div>
  );
}
