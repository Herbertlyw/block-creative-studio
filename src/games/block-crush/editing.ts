import { stableHash } from '../../nativeReference/headless/stableHash';
import { compileBlockCrushDropProjectFrameSource } from '../../nativeReference/games/block-crush-drop/render/projectRenderDriver';
import { blockCrushDropDefinition as definition } from '../../nativeReference/games/block-crush-drop/definition';
import type { BlockCrushDropAction } from '../../nativeReference/games/block-crush-drop/types';
import type { AgentImageAsset } from '../../nativeReference/agent-assets/contracts';
import {
  bcCalibration,
  bcColours,
  bcProduction,
  bcStyle,
  editBCProject,
  setBCProduction,
  type BCProject,
} from './document';
import { bindBCImage, recolourPaletteAsset } from './assets';

export function refreshBCClips(project: BCProject): BCProject {
  const production = bcProduction(project);
  for (const clip of production.clips ?? []) {
    const take = project.takes.find((item) => item.takeId === clip.takeId);
    if (!take) throw new Error(`片段「${clip.id}」引用的 Take 不存在。`);
    const source = compileBlockCrushDropProjectFrameSource(project, take);
    if (clip.startFrame >= source.totalFrames)
      throw new Error('修改后片段起点超出 Take，请先调整选段。');
    clip.endFrame = Math.min(clip.endFrame, source.totalFrames - 1);
    clip.source = { takeHash: stableHash(take), frameSourceHash: source.frameSourceHash };
  }
  if (project.direction?.production !== undefined) setBCProduction(project, production);
  return project;
}

export function changeBCAction(
  project: BCProject,
  takeId: string,
  index: number,
  column: number,
  impactSeconds: number,
) {
  validateBCActionNumbers(column, impactSeconds, project.game.config.data.columns);
  const result = editBCProject(project, (draft) => {
    const take = draft.takes.find((item) => item.takeId === takeId);
    const entry = take?.actions[index];
    if (!entry) throw new Error('动作不存在。');
    const action = definition.schemas.action.parse(entry.action);
    const oldTick = action.impactTick,
      deltaX = column - action.release.x;
    action.release.x = column;
    action.impactTick = Math.round(impactSeconds * 30);
    entry.action = action;
    const calibration = bcCalibration(draft),
      deltaSeconds = (action.impactTick - oldTick) / 30;
    for (const track of calibration.pieceTracks ?? [])
      if (track.actionIndex === index) {
        const first = track.samples[0]!.seconds,
          last = track.samples.at(-1)!.seconds;
        for (const sample of track.samples) {
          sample.x +=
            deltaX *
            calibration.board.cell *
            (last === first ? 1 : (sample.seconds - first) / (last - first));
          sample.seconds += deltaSeconds;
        }
      }
    for (const interaction of take!.interactions)
      if (interaction.committedActionId === entry.id) {
        interaction.startFrame += action.impactTick - oldTick;
        interaction.endFrame += action.impactTick - oldTick;
      }
  });
  return refreshBCClips(result);
}

function validateBCActionNumbers(column: number, seconds: number, columns: number) {
  if (!Number.isInteger(column) || column < 0 || column >= columns)
    throw new Error(`列号必须是 0 到 ${columns - 1} 之间的整数。`);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('落位秒数必须是有限、非负的数字。');
}

/** Keep empty drafts distinct from the valid numeric value zero. */
export function parseBCActionDraft(draft: { column: string; seconds: string }, columns: number) {
  const read = (raw: string, field: string) => {
    const text = raw.trim();
    if (!text) throw new Error(`${field}不能为空，请填写数字。`);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text))
      throw new Error(`${field}必须是有效数字。`);
    const value = Number(text);
    if (!Number.isFinite(value)) throw new Error(`${field}必须是有限数字。`);
    return value;
  };
  const column = read(draft.column, '列号'),
    seconds = read(draft.seconds, '落位秒数');
  validateBCActionNumbers(column, seconds, columns);
  return { column, seconds };
}

export function changeBCBoard(project: BCProject, rows: readonly string[]) {
  return refreshBCClips(
    editBCProject(
      project,
      (draft) => {
        const config = draft.game.config.data;
        if (
          rows.length !== config.rows ||
          rows.some((row) => row.length !== config.columns || /[^.#]/.test(row))
        )
          throw new Error(
            `棋盘需要 ${config.rows} 行、每行 ${config.columns} 列，用 # 表示方块、. 表示空位。`,
          );
        const existing = new Map(config.initialCells.map((cell) => [`${cell.x}:${cell.y}`, cell]));
        const desired = rows.flatMap((row, screenY) =>
          [...row].flatMap((value, x) => {
            if (value === '.') return [];
            const y = config.rows - 1 - screenY;
            return [
              existing.get(`${x}:${y}`) ?? {
                id: `edited-${x}-${y}`,
                kind: bcCalibration(draft).tileColor,
                x,
                y,
              },
            ];
          }),
        );
        const wanted = new Set(desired.map((cell) => cell.id));
        config.initialCells = [
          ...config.initialCells.filter((cell) => wanted.has(cell.id)),
          ...desired.filter((cell) => !existing.has(`${cell.x}:${cell.y}`)),
        ];
      },
      true,
    ),
  );
}

export function bcBoardText(project: BCProject) {
  const { columns, rows, initialCells } = project.game.config.data;
  const cells = new Set(initialCells.map((cell) => `${cell.x}:${cell.y}`));
  return Array.from({ length: rows }, (_, screenY) =>
    Array.from({ length: columns }, (_, x) =>
      cells.has(`${x}:${rows - screenY - 1}`) ? '#' : '.',
    ).join(''),
  ).join('\n');
}

export async function changeBCColours(project: BCProject, colours: readonly string[]) {
  const before = bcColours(project);
  if (colours.length !== before.length || colours.some((colour) => !/^#[a-f\d]{6}$/i.test(colour)))
    throw new Error('颜色数量或颜色格式无效。');
  const replacements = new Map(before.map((colour, i) => [colour.toLowerCase(), colours[i]!]));
  const replace = (colour: string) => replacements.get(colour.toLowerCase()) ?? colour;
  const style = bcStyle(project),
    paletteBinding = style.agentAssets?.bindings['tile.palette'];
  const palette = paletteBinding ? style.agentAssets?.entries[paletteBinding.assetId] : undefined;
  const image =
    palette?.kind === 'image' && palette.encoding === 'base64'
      ? await recolourPaletteAsset(palette, before, colours)
      : undefined;
  const result = editBCProject(project, (draft) => {
    const calibration = bcCalibration(draft),
      config = draft.game.config.data;
    calibration.tileColor = replace(calibration.tileColor);
    if (calibration.tilePaletteColors) calibration.tilePaletteColors = [...colours];
    if (calibration.columnColors) calibration.columnColors = calibration.columnColors.map(replace);
    if (calibration.incomingRowColors)
      calibration.incomingRowColors = calibration.incomingRowColors.map(replace);
    if (calibration.incomingCellColors)
      calibration.incomingCellColors = calibration.incomingCellColors.map((row) =>
        row.map(replace),
      );
    for (const key of calibration.cellColorKeys ?? []) key.color = replace(key.color);
    for (const key of calibration.boardColorKeys ?? []) key.color = replace(key.color);
    for (const cell of config.initialCells) cell.kind = replace(cell.kind);
    for (const piece of config.pieces) piece.kind = replace(piece.kind);
    const clear = calibration.clear;
    if (clear?.fragmentColor) clear.fragmentColor = replace(clear.fragmentColor);
    if (clear?.fragmentPalette) clear.fragmentPalette = clear.fragmentPalette.map(replace);
    if (clear?.colorByAction)
      clear.colorByAction = clear.colorByAction.map((row) => row.map(replace));
    if (image) bindBCImage(draft, 'tile.palette', image);
  });
  return refreshBCClips(result);
}

export function changeBCImage(
  project: BCProject,
  slot: 'world.background' | 'tile.palette',
  asset: AgentImageAsset,
) {
  return refreshBCClips(
    editBCProject(project, (draft) => {
      bindBCImage(draft, slot, asset);
      if (slot === 'tile.palette') {
        const calibration = bcCalibration(draft);
        calibration.tilePaletteColors ??= bcColours(draft);
        delete calibration.tilePaletteLighting;
        delete calibration.tilePaletteCropPixels;
        const clear = calibration.clear;
        if (clear) {
          clear.fragmentSurface = 'tile';
          if (
            ['faceted-chip', 'faceted-rock', 'rounded-rock'].includes(clear.fragmentGeometry ?? '')
          )
            clear.fragmentMaterialTexture = true;
        }
      }
    }),
  );
}

export function changeBCMaterial(
  project: BCProject,
  material: ReturnType<typeof bcCalibration>['material'],
) {
  return refreshBCClips(
    editBCProject(project, (draft) => {
      const calibration = bcCalibration(draft),
        style = bcStyle(draft);
      calibration.material = material;
      delete calibration.tilePaletteColors;
      delete calibration.tilePaletteLighting;
      delete calibration.tilePaletteCropPixels;
      if (calibration.clear) calibration.clear.fragmentMaterialTexture = false;
      if (style.agentAssets) delete style.agentAssets.bindings['tile.palette'];
      // The source asset remains in the document; selecting a procedural face is explicit.
    }),
  );
}

export const BC_CLEAR_GEOMETRIES = {
  'faceted-chip': '细碎晶片',
  'faceted-rock': '棱面碎石',
  'rounded-rock': '圆润碎石',
  'rounded-cube': '圆角积木',
  'textured-cube': '纹理立方体',
  'textured-chip': '纹理薄片',
} as const;

export function changeBCClearGeometry(
  project: BCProject,
  geometry: keyof typeof BC_CLEAR_GEOMETRIES,
) {
  if (!(geometry in BC_CLEAR_GEOMETRIES)) throw new Error('不支持的碎片形状。');
  return refreshBCClips(
    editBCProject(project, (draft) => {
      const clear = bcCalibration(draft).clear;
      if (!clear) throw new Error('此工程没有原生碎片配置，请保留已有特效。');
      clear.fragmentGeometry = geometry;
      clear.fragmentMaterialTexture =
        !!bcStyle(draft).agentAssets?.bindings['tile.palette'] &&
        ['faceted-chip', 'faceted-rock', 'rounded-rock'].includes(geometry);
    }),
  );
}

/** Bounded legal route generation for an editable showcase, without production batch logic. */
export function generateBCTake(project: BCProject, count = 6) {
  if (bcCalibration(project).pieceTracks?.length)
    throw new Error(
      '此工程保存了逐步参考轨迹。请在新建作品中生成新路线；已有作品可逐步编辑目标和轨迹。',
    );
  return editBCProject(project, (draft) => {
    let state = definition.schemas.state.parse(draft.game.initialState.data);
    const actions = [];
    for (let i = 0; i < Math.max(1, Math.min(24, count)); i++) {
      const candidates = definition.runtime.listLegalActions?.(state) ?? [];
      const scored = candidates
        .flatMap((candidate) => {
          try {
            const action: BlockCrushDropAction = { ...candidate, impactTick: state.tick + 45 };
            const result = definition.runtime.resolve(state, action, { seed: 1, stepIndex: i });
            return [{ action, state: result.after, score: result.after.score - state.score }];
          } catch {
            return [];
          }
        })
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (!best) break;
      actions.push({
        id: `generated-${i + 1}`,
        actor: 'agent' as const,
        schemaId: definition.schemas.action.id,
        action: best.action,
      });
      state = best.state;
      if (state.status !== 'playing') break;
    }
    if (!actions.length) throw new Error('当前局面没有找到合法动作。');
    let serial = draft.takes.length + 1;
    while (draft.takes.some((take) => take.takeId === `generated-${serial}`)) serial++;
    draft.takes.push({
      contract: 'bcs.game-replay',
      contractVersion: '1.0.0',
      gameId: 'block-crush-drop',
      moduleVersion: '0.4.0',
      takeId: `generated-${serial}`,
      initialStateHash: draft.game.initialState.stateHash,
      seed: 1,
      actions,
      interactions: [],
    });
  });
}
