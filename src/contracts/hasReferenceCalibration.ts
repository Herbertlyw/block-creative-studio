/** Detect the opt-in without loading the calibrated rendering extension. */
export function hasReferenceCalibration(document: unknown): boolean {
  const doc = document as {
    direction?: { style?: { referenceCalibration?: unknown; workbenchCalibrationV2?: unknown } };
  } | null;
  return (
    doc?.direction?.style?.referenceCalibration !== undefined ||
    doc?.direction?.style?.workbenchCalibrationV2 !== undefined
  );
}
