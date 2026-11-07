import type { DropReferenceCalibration } from './referenceCalibration';

/** These controls belong to other pose/partition sources, never the native world. */
export const NATIVE_INERTIAL_CALIBRATION_CONFLICTS = [
  'fragmentPhysics',
  'layeredCurve',
  'fragmentDisplayFps',
  'fragmentDisplayPhaseSeconds',
  'ballisticPrefracture',
  'prefractureRefineSeconds',
  'prefractureSubdivisions',
  'prefractureScale',
  'fragmentPerspectiveCamera',
  'fragmentDepthRenderer',
  'fragmentDepthLayers',
  'fragmentPartitionProfile',
  'fragmentVolumeSeedPattern',
  'fragmentCubeFrontUvMapping',
  'fragmentCubePitchStart',
  'fragmentCubePitchRate',
  'fragmentRotationSpreadRampSeconds',
  'fragmentCubeRotationAgeScale',
  'fragmentRotationSpread',
  'fragmentAgeOffsetSeconds',
  'sheetLiftPixels',
  'sheetLiftFrontFalloffPower',
  'sheetLiftSeconds',
  'sheetThicknessScale',
  'sheetMotionRate',
  'sheetTearSeconds',
  'frontOrigin',
  'frontExponent',
  'fragmentScale',
  'scatterVerticalRatio',
  'scatterHorizontalRatio',
  'fallSpread',
  'sizeSpread',
] as const;

/** Parser and renderer share the rejection boundary, including explicit zeroes. */
export function validateNativeInertialCalibration(calibration: {
  clear?: DropReferenceCalibration['clear'] | undefined;
  observedFragmentMotionCues?: DropReferenceCalibration['observedFragmentMotionCues'] | undefined;
  fieldRiseOffsetKeys?: DropReferenceCalibration['fieldRiseOffsetKeys'] | undefined;
}): void {
  const e = calibration.clear;
  if (!e?.nativeInertial) return;
  if (e.fragmentGeometry !== 'rounded-cube' || e.fragmentSurface !== 'solid')
    throw new Error('DROP_NATIVE_INERTIAL_REQUIRES_SOLID_ROUNDED_CUBE');
  for (const key of NATIVE_INERTIAL_CALIBRATION_CONFLICTS)
    if (e[key] !== undefined)
      throw new Error(`DROP_NATIVE_INERTIAL_CALIBRATION_CONFLICT: clear.${key}`);
  if (e.motionModel !== undefined && e.motionModel !== 'ballistic')
    throw new Error('DROP_NATIVE_INERTIAL_CALIBRATION_CONFLICT: clear.motionModel');
  if (e.fragmentShading === 'legacy' || e.overlap === false)
    throw new Error(
      'DROP_NATIVE_INERTIAL_CALIBRATION_CONFLICT: material shading and overlapping native waves required',
    );
  if (e.prefracture === true)
    throw new Error('DROP_NATIVE_INERTIAL_CALIBRATION_CONFLICT: clear.prefracture');
  if (calibration.observedFragmentMotionCues?.length)
    throw new Error('DROP_NATIVE_INERTIAL_OBSERVED_MOTION_CONFLICT');
  if (calibration.fieldRiseOffsetKeys !== undefined)
    throw new Error('DROP_NATIVE_INERTIAL_VISUAL_RISE_UNSUPPORTED');
}

// Positive alternatives support the platform's structural schema validator.
export const NATIVE_INERTIAL_CALIBRATION_SCHEMA = {
  anyOf: [
    { properties: { clear: { properties: { nativeInertial: { const: false } } } } },
    {
      required: ['clear'],
      properties: {
        fieldRiseOffsetKeys: { type: 'null' },
        observedFragmentMotionCues: { maxItems: 0 },
        clear: {
          required: ['nativeInertial', 'fragmentGeometry', 'fragmentSurface'],
          properties: {
            nativeInertial: { const: true },
            fragmentGeometry: { const: 'rounded-cube' },
            fragmentSurface: { const: 'solid' },
            motionModel: { const: 'ballistic' },
            prefracture: { const: false },
            fragmentShading: { const: 'material' },
            overlap: { const: true },
            ...Object.fromEntries(
              NATIVE_INERTIAL_CALIBRATION_CONFLICTS.map((key) => [key, { type: 'null' }]),
            ),
          },
        },
      },
    },
  ],
};
