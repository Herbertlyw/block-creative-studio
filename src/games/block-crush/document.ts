import { GameRegistry } from '../../nativeReference/game-runtime/gameRegistry';
import { validateStudioProjectDocumentV2 } from '../../nativeReference/game-runtime/projectDocument';
import type { StudioProjectDocumentV2 } from '../../nativeReference/game-runtime/projectEnvelope';
import type { ProductionDirectionV1 } from '../../nativeReference/agent-director/contracts';
import { parseProductionDirection } from '../../nativeReference/agent-director/contracts';
import {
  validateProductionAudioReferences,
  validateProductionVoiceTakes,
} from '../../nativeReference/agent-director/audioMix';
import type { AgentAssetExtensionV1 } from '../../nativeReference/agent-assets/contracts';
import { blockCrushDropDefinition as definition } from '../../nativeReference/games/block-crush-drop/definition';
import type { ClearEffectLibrary } from '../../nativeReference/games/block-crush-drop/presentation/clearEffectLibrary';
import { readClearEffectLibrary } from '../../nativeReference/games/block-crush-drop/presentation/clearEffectLibrary';
import { blockCrushDropDirectorProfileFromProject } from '../../nativeReference/games/block-crush-drop/render/projectRenderDriver';
import type {
  BlockCrushDropConfig,
  BlockCrushDropState,
} from '../../nativeReference/games/block-crush-drop/types';

export type BCProject = StudioProjectDocumentV2 & {
  game: StudioProjectDocumentV2['game'] & {
    config: { schemaId: string; data: BlockCrushDropConfig };
    initialState: { schemaId: string; data: BlockCrushDropState; stateHash: string };
  };
};

export interface BCStyle {
  renderer?: string;
  palette?: string;
  agentAssets?: AgentAssetExtensionV1;
  clearEffectLibrary?: ClearEffectLibrary;
  [key: string]: unknown;
}

const registry = new GameRegistry();
registry.register(definition);

export function bcStyle(project: BCProject): BCStyle {
  const value = project.direction?.style;
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as BCStyle) : {};
}

export function bcProduction(project: BCProject): ProductionDirectionV1 {
  return project.direction?.production === undefined
    ? { version: '1.0.0' }
    : parseProductionDirection(project.direction.production);
}

export function bcCalibration(project: BCProject) {
  const calibration = project.game.config.data.presentation.referenceCalibration;
  if (!calibration) throw new Error('此展示入口需要 BC 的 referenceCalibration，原工程没有改动。');
  return calibration;
}

/** Colour identities survive switching between procedural and image-based materials. */
export function bcColours(project: BCProject): string[] {
  const calibration = bcCalibration(project);
  if (calibration.tilePaletteColors?.length) return [...calibration.tilePaletteColors];
  return [
    ...new Set(
      [
        calibration.tileColor,
        ...(calibration.columnColors ?? []),
        ...project.game.config.data.initialCells.map((cell) => cell.kind),
        ...project.game.config.data.pieces.map((piece) => piece.kind),
      ]
        .filter((colour) => /^#[a-f\d]{6}$/i.test(colour))
        .map((colour) => colour.toLowerCase()),
    ),
  ];
}

/** Validate a copy without projecting away authored or unknown document fields. */
export function readBCProject(value: unknown): BCProject {
  const validated = validateStudioProjectDocumentV2(value, registry);
  const project = structuredClone(value) as BCProject;
  if (validated.game.game.id !== 'block-crush-drop') throw new Error('请选择 BC 落消工程。');
  const { width, height, fps } = project.production.output;
  if (
    fps !== 30 ||
    width % 2 ||
    height % 2 ||
    width < 2 ||
    height < 2 ||
    width > 1920 ||
    height > 1920
  )
    throw new Error('BC 展示版支持 30 fps、1920 像素以内的偶数输出尺寸；没有转换原工程。');
  if ((bcStyle(project).renderer ?? 'reference-2d') !== 'reference-2d')
    throw new Error('当前 BC 入口只接入 reference-2d，不会替换工程指定的其他渲染器。');
  const production = bcProduction(project);
  if (production.audio) {
    validateProductionAudioReferences(production.audio);
    validateProductionVoiceTakes(
      production.audio,
      project.takes.map((take) => take.takeId),
    );
  }
  if (production.camera || production.presentation || production.effects)
    throw new Error('此 BC 工程含尚未接入的 production 镜头、额外时序或后期配置，不能静默忽略。');
  bcCalibration(project);
  replayBCTakes(project);
  // Validate effect identities, targets and their merged director plans before
  // this document can become the current session, even without saved clips.
  const library = readClearEffectLibrary(project);
  for (const takeId of new Set(library.bindings.map((binding) => binding.takeId))) {
    const take = project.takes.find((item) => item.takeId === takeId)!;
    try {
      blockCrushDropDirectorProfileFromProject(project, take);
    } catch (error) {
      throw new Error(
        `Take「${takeId}」的消除效果计划无效：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return project;
}

export function replayBCTakes(project: BCProject) {
  return project.takes.map((take) => {
    let state = definition.schemas.state.parse(project.game.initialState.data);
    for (const [index, envelope] of take.actions.entries()) {
      try {
        const action = definition.schemas.action.parse(envelope.action);
        const resolution = definition.runtime.resolve(state, action, {
          seed: take.seed,
          stepIndex: index,
        });
        state = definition.runtime.stateAfter(resolution);
      } catch (error) {
        throw new Error(
          `Take「${take.takeId}」第 ${index + 1} 步无效：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { takeId: take.takeId, actions: take.actions.length, state };
  });
}

/** All edits are transactional and revalidate every Take against the new state. */
export function editBCProject(
  project: BCProject,
  edit: (draft: BCProject) => void,
  resetBoard = false,
): BCProject {
  const draft = structuredClone(project);
  edit(draft);
  const config = definition.schemas.config.parse(draft.game.config.data);
  let state = definition.schemas.state.parse(draft.game.initialState.data);
  if (resetBoard) state = definition.runtime.createInitialState(config, draft.takes[0]?.seed ?? 1);
  else {
    const kinds = new Map(config.initialCells.map((cell) => [cell.id, cell.kind]));
    state = {
      ...state,
      config,
      cells: state.cells.map((cell) => ({ ...cell, kind: kinds.get(cell.id) ?? cell.kind })),
    };
  }
  draft.game.config.data = config;
  draft.game.initialState.data = state;
  draft.game.initialState.stateHash = definition.runtime.hashState(state);
  for (const take of draft.takes) take.initialStateHash = draft.game.initialState.stateHash;
  return readBCProject(draft);
}

export function setBCStyle(project: BCProject, style: BCStyle): void {
  project.direction ??= { rhythm: {} };
  project.direction.style = style;
}

export function setBCProduction(project: BCProject, production: ProductionDirectionV1): void {
  project.direction ??= { rhythm: {} };
  project.direction.production = production;
}
