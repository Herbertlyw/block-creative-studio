// Derived production driver; supplied reference files remain unchanged.
import { createBBTimelineSource, BB_FRAME_SCHEMA } from '../planning/timelineFrameSource';
import { createCalibratedSceneBackend } from './scene';
import { prepareObservedTake } from './prepareObservedTake';

const id = 'bcs.workbench.block-placement.calibrated-state',
  gameId = 'block-placement',
  version = '1.0.0',
  schema = BB_FRAME_SCHEMA;
const renderContract = {
  contract: 'bcs.game-render-contract',
  contractVersion: version,
  id: 'block-placement.calibrated.render',
  version,
  gameId,
  eventCatalog: [],
  backends: {
    [id]: {
      supportedPresentationSchemas: [schema],
      requiredSlots: [],
      passes: [{ id: 'calibrated-native-board', order: 0, required: true }],
      cameraMotion: 'fixed',
    },
  },
};
const renderDriver = {
  id,
  gameId,
  prepare(document: any, options: any) {
    const { replay, calibration, bindings, frameSourceHash, plan } = prepareObservedTake(
      document,
      options,
    );
    const { displayed } = plan;
    const frameSource = createBBTimelineSource(plan, frameSourceHash);
    return {
      document,
      take: replay,
      frameSource,
      timelinePlan: plan,
      backend: createCalibratedSceneBackend(
        calibration,
        displayed.initial,
        bindings,
        plan.geometry,
      ),
      renderContract,
      resourcePolicy: {
        mode: 'bundled-assets',
        bundleId: frameSourceHash,
        reason:
          'Embedded static tile/HUD sprites; native legal board replay and deterministic effects. No gameplay video playback.',
        runtimeAssets: calibration.sprites ?? {},
      },
      warnings: [],
    };
  },
};
export default { id, version, sdkVersion: version, renderDrivers: [renderDriver] };
