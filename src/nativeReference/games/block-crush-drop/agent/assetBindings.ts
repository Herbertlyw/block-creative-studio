import {
  AGENT_SEQUENCE_DEFAULT_PLAYBACK,
  AGENT_IMAGE_DEFAULT_LIMITS,
  type AgentAssetGameDeclaration,
} from '../../../agent-assets';
import { DROP_UI_ATLAS_SLOTS } from '../profiles/referenceCalibration';
import { BLOCK_CRUSH_DROP_GAME_ID } from '../manifest';

export const blockCrushDropAgentAssetDeclaration: AgentAssetGameDeclaration = {
  gameId: BLOCK_CRUSH_DROP_GAME_ID,
  version: '1.0.0',
  slots: [
    {
      slotId: 'effect.clear.sequence',
      title: 'Full-stage transparent clear PNG sequence',
      role: 'effect-sequence',
      assetKind: 'sequence',
      acceptedMimeTypes: ['image/png'],
      defaultFit: 'stretch',
      allowedFits: ['stretch'],
      allowedBlendModes: ['source-over'],
      allowInset: false,
      maxBytes: 96 * 1024 * 1024,
      maxWidth: 1080,
      maxHeight: 1920,
      maxPixels: 1080 * 1920,
      sequence: {
        maxFrames: 240,
        minFps: 4,
        maxFps: 60,
        anchor: 'fixed1080x1920 stage; rise already baked',
        playbackDefaults: AGENT_SEQUENCE_DEFAULT_PLAYBACK,
      },
      consumer: {
        renderer: 'reference-2d | fixed-camera-cinematic',
        target: 'effect library take/action/cycle binding',
        behavior:
          'RGBA8 straight-alpha, exact1080x1920. Import then effect create with sequence.assetId and effect bind. Slot binding alone never activates any cue. Nonloop speed1, clipped to native cue window; native fragments never reappear after sequence ends. No camera motion or additional exposure.',
        actualPixels: true,
      },
    },
    {
      slotId: 'world.background',
      title: 'World background image',
      role: 'background-image',
      acceptedMimeTypes: ['image/png', 'image/jpeg'],
      defaultFit: 'cover',
      allowedFits: ['cover', 'contain', 'stretch'],
      allowedBlendModes: ['source-over', 'multiply', 'screen', 'overlay', 'soft-light'],
      allowInset: false,
      ...AGENT_IMAGE_DEFAULT_LIMITS,
      consumer: {
        renderer: 'reference-2d | fixed-camera-cinematic | moving-camera-cinematic',
        target: 'drawBlockCrushDropStage world background pass',
        behavior:
          'Drawn after the procedural fallback background and before HUD, grid, tray, settled pieces, and effects.',
        actualPixels: true,
      },
    },
    ...[
      ['board.surface', 'Clean board and HUD chrome', 'background-image'],
      ['board.clear-surface', 'Clean board during a clear', 'background-image'],
      ['piece.face', 'Complete block face texture', 'tile-face-image'],
      ['piece.atlas', 'Screen-position block appearance atlas', 'board-atlas-image'],
      ['hud.queue.face', 'Queue thumbnail texture', 'tile-face-image'],
    ].map(([slotId, title, role]): AgentAssetGameDeclaration['slots'][number] => ({
      slotId: slotId!,
      title: title!,
      role: role as 'background-image' | 'tile-face-image' | 'board-atlas-image',
      acceptedMimeTypes: ['image/png', 'image/jpeg'],
      defaultFit: 'stretch',
      allowedFits: ['stretch'],
      allowedBlendModes: ['source-over'],
      allowInset: false,
      ...AGENT_IMAGE_DEFAULT_LIMITS,
      consumer: {
        renderer: 'reference-2d | fixed-camera-cinematic | moving-camera-cinematic',
        target: `BlockCrushDrop ${slotId}`,
        behavior:
          slotId === 'piece.atlas'
            ? 'One appearance patch per configured board row/column; occupancy and transforms remain replay-driven.'
            : 'Optional attached appearance asset. Never supplies occupancy, rules, or a source video frame stream.',
        actualPixels: true,
      },
    })),
    {
      slotId: 'effect.fragment-surfaces',
      title: 'Fragment exterior and fracture surface atlas',
      role: 'texture-map',
      acceptedMimeTypes: ['image/png', 'image/jpeg'],
      defaultFit: 'stretch',
      allowedFits: ['stretch'],
      allowedBlendModes: ['source-over'],
      allowInset: false,
      ...AGENT_IMAGE_DEFAULT_LIMITS,
      consumer: {
        renderer: 'fixed-camera-cinematic | moving-camera-cinematic | native RGBA export',
        target: 'BlockCrushDropTexturedTiles fragment cube faces and motion trails',
        behavior:
          'One horizontal strip of seven equal square patches (+X,-X,+Y,-Y,+Z,-Z,fresh fracture). Requires piece.face at render warmup. Original front artwork blends separately with its alpha. Static surface pixels only; no occupancy, trajectory or source frame playback. Atlas aspect is checked during render warmup. Canvas reference renderer does not consume this 3D surface atlas.',
        actualPixels: true,
      },
    },
    {
      slotId: 'tile.palette',
      title: 'Reusable tile-face palette strip',
      role: 'tile-face-image',
      acceptedMimeTypes: ['image/png'],
      defaultFit: 'stretch',
      allowedFits: ['stretch'],
      allowedBlendModes: ['source-over'],
      allowInset: false,
      ...AGENT_IMAGE_DEFAULT_LIMITS,
      consumer: {
        renderer: 'reference-2d',
        target: 'Calibrated board, falling piece and queue cell faces',
        behavior:
          'A horizontal strip of individual square tile faces, optionally with rows of spatial lighting variants; referenceCalibration.tilePaletteColors selects the nearest color. Not a board frame or gameplay overlay.',
        actualPixels: true,
      },
    },
    ...DROP_UI_ATLAS_SLOTS.map((slotId): AgentAssetGameDeclaration['slots'][number] => ({
      slotId,
      title: `Reusable sprite atlas (${slotId})`,
      role: 'tile-face-image',
      acceptedMimeTypes: ['image/png'],
      defaultFit: 'stretch',
      allowedFits: ['stretch'],
      allowedBlendModes: ['source-over'],
      allowInset: false,
      ...AGENT_IMAGE_DEFAULT_LIMITS,
      consumer: {
        renderer: 'reference-2d',
        target:
          slotId === 'ui.atlas.6'
            ? 'Calibrated bounded sprites and native cue-bound independent encouragement glyphs'
            : 'Calibrated bounded praise and guidance sprites',
        behavior:
          slotId === 'ui.atlas.6'
            ? 'Individual transparent UI graphics and isolated glyph atoms addressed by source rectangles. encouragementGlyphCues requires an atlas no larger than 4MP and bounded canonical30 quad keys; unknown keys remain transparent. No gameplay video or full-board frames.'
            : 'Individual transparent UI graphics addressed by source rectangles and timed cues; no gameplay video or full-board frames.',
        actualPixels: true,
      },
    })),
  ],
};
