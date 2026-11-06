// Derived production module; supplied reference files remain unchanged.
import type { ReferenceCalibration } from './parseCalibration';
/** One source of truth for resting pieces and both kinds of drag launch. */
export function referenceRackPose(
  spec: Pick<ReferenceCalibration, 'rackCell' | 'rackY' | 'appearance' | 'rackCenters'>,
  piece: { id: string; slotIndex: number },
  cells: readonly (readonly number[])[],
) {
  const rows = Math.max(...cells.map((c) => c[0]!)) + 1,
    cols = Math.max(...cells.map((c) => c[1]!)) + 1;
  const size = spec.appearance?.rackCellSizes?.[piece.id] ?? spec.rackCell;
  const center = spec.appearance?.rackPositions?.[piece.id] ?? [
    (spec.rackCenters ?? spec.appearance?.rackCenters ?? [236, 540, 844])[piece.slotIndex]!,
    spec.rackY,
  ];
  return { x: center[0]! - (cols * size) / 2, y: center[1]! - (rows * size) / 2, size, rows, cols };
}
