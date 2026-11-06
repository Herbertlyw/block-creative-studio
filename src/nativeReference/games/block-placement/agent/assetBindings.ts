import { AGENT_IMAGE_DEFAULT_LIMITS, type AgentAssetGameDeclaration } from '../../../agent-assets';
import { BLOCK_PLACEMENT_GAME_ID } from '../manifest';

export const blockPlacementAgentAssetDeclaration: AgentAssetGameDeclaration = {
  gameId: BLOCK_PLACEMENT_GAME_ID,
  version: '1.0.0',
  slots: [
    {
      slotId: 'background.base', title: 'Stage background image', role: 'background-image',
      acceptedMimeTypes: ['image/png', 'image/jpeg'], defaultFit: 'cover',
      allowedFits: ['cover', 'contain', 'stretch'],
      allowedBlendModes: ['source-over', 'multiply', 'screen', 'overlay', 'soft-light'],
      allowInset: false,
      ...AGENT_IMAGE_DEFAULT_LIMITS,
      consumer: {
        renderer: 'reference-2d | fixed-camera-cinematic | moving-camera-cinematic',
        target: 'Reference2DScene and StudioScene background pass',
        behavior: 'Drawn behind the board and gameplay pieces using the binding fit, opacity, blend mode, and inset.',
        actualPixels: true,
      },
    },
    {
      slotId: 'tile.face', title: 'Tile face image', role: 'tile-face-image',
      acceptedMimeTypes: ['image/png', 'image/jpeg'], defaultFit: 'cover',
      allowedFits: ['cover', 'contain', 'stretch'],
      allowedBlendModes: ['source-over', 'multiply', 'screen', 'overlay', 'soft-light'],
      allowInset: true,
      ...AGENT_IMAGE_DEFAULT_LIMITS,
      consumer: {
        renderer: 'reference-2d | fixed-camera-cinematic | moving-camera-cinematic',
        target: 'Every cell on the board, tray, and in-flight piece in Reference2DScene and StudioScene',
        behavior: 'Stamps the whole image onto each cell. Occupied board cells prefer board.atlas when that slot is bound. Tray and drag never sample the atlas.',
        actualPixels: true,
      },
    },
    {
      slotId: 'board.atlas', title: 'Board picture atlas', role: 'board-atlas-image',
      acceptedMimeTypes: ['image/png', 'image/jpeg'], defaultFit: 'cover',
      allowedFits: ['cover', 'contain', 'stretch'],
      allowedBlendModes: ['source-over', 'multiply', 'screen', 'overlay', 'soft-light'],
      allowInset: true,
      ...AGENT_IMAGE_DEFAULT_LIMITS,
      consumer: {
        renderer: 'reference-2d | fixed-camera-cinematic | moving-camera-cinematic',
        target: 'Occupied board cells in Reference2DScene and StudioScene',
        behavior: 'One image is fitted to the whole 8×8 board, then each occupied cell samples its lattice UV. Empty cells, tray pieces, and in-flight pieces keep color or tile.face.',
        actualPixels: true,
      },
    },
  ],
};
