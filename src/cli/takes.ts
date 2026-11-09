import { readFile } from 'node:fs/promises';
import {
  createBBWorkPackage,
  openBBWorkPackage,
  updateBBWorkPackageProject,
  type BBWorkPackage,
} from '../contracts/bbWorkPackage';
import { generateNativeMachineTake } from '../contracts/nativeWorkAuthor';
import { editNativeActionTarget } from '../contracts/editNativeAction';
import { hasReferenceCalibration } from '../contracts/hasReferenceCalibration';
import {
  bcCalibration,
  bcProduction,
  editBCProject,
  readBCProject,
  replayBCTakes,
  type BCProject,
} from '../games/block-crush/document';
import { generateBCTake } from '../games/block-crush/editing';

type Game = 'block-placement' | 'block-crush-drop';
type Options = Record<string, unknown>;
type Work = BBWorkPackage | BCProject;
const takeId = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' };
const index = { type: 'integer', minimum: 0 };
const schema = (required: string[], properties: Record<string, unknown>) => ({
  type: 'object',
  required,
  properties,
  additionalProperties: false,
});
export function takeOperations(game: Game) {
  const make = (id: string, kind: 'query' | 'edit', s: object, description: string) => ({
    id,
    kind,
    schema: s,
    requiresInput: true,
    output: kind === 'edit',
    description,
  });
  const values = [
    make('take list', 'query', schema([], {}), '列出 Take 和关联依赖。'),
    make(
      'take inspect',
      'query',
      schema(['takeId'], { takeId }),
      '查询指定 Take 的动作、交互和依赖。',
    ),
    make(
      'take validate',
      'query',
      schema(['takeId'], { takeId }),
      '验证指定 Take 的原生回放及依赖。',
    ),
    make(
      'take generate',
      'edit',
      schema(['takeId', 'count'], {
        takeId,
        count: { type: 'integer', minimum: 1, maximum: game === 'block-placement' ? 100 : 24 },
      }),
      '添加合法机器 Take。',
    ),
    make(
      'take clone',
      'edit',
      schema(['takeId', 'newTakeId'], { takeId, newTakeId: takeId }),
      '复制无冲突的 Take。',
    ),
    make(
      'take import',
      'edit',
      schema(['file'], { file: { type: 'string', minLength: 1 } }),
      '导入并验证原生 replay JSON。',
    ),
    make('take delete', 'edit', schema(['takeId'], { takeId }), '删除未被引用的 Take。'),
  ];
  if (game === 'block-placement')
    values.push(
      make(
        'action edit',
        'edit',
        schema(['takeId', 'index', 'row', 'column'], { takeId, index, row: index, column: index }),
        '修改 BB 动作目标并重验回放。',
      ),
    );
  return values;
}
function projectOf(game: Game, work: Work): any {
  return game === 'block-placement' ? (work as BBWorkPackage).project : work;
}
function dependencies(project: any, id: string) {
  const clips = (project.direction?.production?.clips ?? [])
    .filter((clip: any) => clip.takeId === id)
    .map((clip: any) => clip.id);
  const effects = (project.direction?.style?.clearEffectLibrary?.bindings ?? [])
    .filter((binding: any) => binding.takeId === id)
    .map((binding: any) => binding.effectId);
  const calibration =
    project.direction?.style?.referenceCalibration ||
    project.game?.config?.data?.presentation?.referenceCalibration?.pieceTracks?.length
      ? ['referenceCalibration']
      : [];
  return { clips, effects, calibration };
}
function item(project: any, id: string) {
  const take = project.takes.find((value: any) => value.takeId === id);
  if (!take) throw new Error(`TAKE_NOT_FOUND: ${id}`);
  return take;
}
function assertSafe(game: Game, work: Work, id?: string) {
  const project = projectOf(game, work);
  if (
    game === 'block-placement' &&
    ((work as BBWorkPackage).source ||
      (work as BBWorkPackage).pointer ||
      hasReferenceCalibration(project))
  )
    throw new Error(
      `TAKE_PROTECTED: ${id ?? 'new'}；来源、指针或校准轨道不能安全修改，请保留原工程。`,
    );
  if (game === 'block-crush-drop' && bcCalibration(project).pieceTracks?.length)
    throw new Error(`TAKE_PROTECTED: ${id ?? 'new'}；工程含共享逐步参考轨迹，请保留原工程。`);
  if (id) {
    const deps = dependencies(project, id);
    if (deps.clips.length || deps.effects.length)
      throw new Error(
        `TAKE_REFERENCED: ${id}；片段 ${deps.clips.join(',') || '无'}；效果 ${deps.effects.join(',') || '无'}，请先处理引用。`,
      );
  }
}
function unique(project: any, id: string) {
  if (project.takes.some((take: any) => take.takeId === id))
    throw new Error(`TAKE_ID_CONFLICT: ${id}`);
}
export async function runTake(game: Game, operation: string, work: Work, options: Options) {
  const project = projectOf(game, work),
    id = options.takeId as string;
  const summarize = (take: any) => ({
    takeId: take.takeId,
    actionCount: take.actions.length,
    interactionCount: take.interactions.length,
    actors: [...new Set(take.actions.map((action: any) => action.actor))],
    dependencies: dependencies(project, take.takeId),
    valid: true,
  });
  if (operation === 'take list') return { report: { takes: project.takes.map(summarize) } };
  if (operation === 'take inspect' || operation === 'take validate') {
    const take = item(project, id);
    if (game === 'block-crush-drop') replayBCTakes(project);
    return {
      report:
        operation === 'take validate'
          ? summarize(take)
          : {
              ...summarize(take),
              initialStateHash: take.initialStateHash,
              actions: take.actions,
              interactions: take.interactions,
              editable: game === 'block-placement' ? ['row', 'column'] : ['column', 'seconds'],
            },
    };
  }
  assertSafe(
    game,
    work,
    operation === 'take delete' || operation === 'action edit' ? id : undefined,
  );
  let result: Work;
  if (operation === 'take generate') {
    unique(project, id);
    if (game === 'block-placement')
      result = await generateNativeMachineTake(work as BBWorkPackage, id, options.count as number);
    else {
      const generated = generateBCTake(work as BCProject, options.count as number);
      result = editBCProject(generated, (draft) => {
        draft.takes.at(-1)!.takeId = id;
      });
    }
  } else if (operation === 'action edit') {
    const take = item(project, id),
      at = options.index as number;
    if (!take.actions[at]) throw new Error(`ACTION_NOT_FOUND: ${id}#${at}`);
    const edited = JSON.parse(
      editNativeActionTarget(
        JSON.stringify(project),
        project.takes.indexOf(take),
        at,
        options.row as number,
        options.column as number,
      ),
    );
    result = await updateBBWorkPackageProject(work as BBWorkPackage, edited);
  } else {
    let imported: any;
    if (operation === 'take clone') {
      imported = structuredClone(item(project, id));
      imported.takeId = options.newTakeId;
      unique(project, imported.takeId);
    } else if (operation === 'take import') {
      imported = JSON.parse(await readFile(options.file as string, 'utf8'));
      if (
        imported.gameId !== project.game.game.id ||
        imported.moduleVersion !== project.game.game.moduleVersion ||
        imported.initialStateHash !== project.game.initialState.stateHash
      )
        throw new Error(
          `TAKE_IMPORT_MISMATCH: ${String(imported.takeId)}；游戏、版本或初始状态不一致。`,
        );
      if (typeof imported.takeId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(imported.takeId))
        throw new Error('TAKE_ID_INVALID');
      unique(project, imported.takeId);
    } else if (operation === 'take delete') item(project, id);
    else throw new Error(`TAKE_OPERATION_UNSUPPORTED: ${operation}`);
    if (game === 'block-placement') {
      const doc = structuredClone(project);
      if (operation === 'take delete')
        doc.takes = doc.takes.filter((take: any) => take.takeId !== id);
      else doc.takes.push(imported);
      result = await updateBBWorkPackageProject(work as BBWorkPackage, doc);
      await openBBWorkPackage(result);
    } else {
      result = editBCProject(work as BCProject, (draft) => {
        if (operation === 'take delete')
          draft.takes = draft.takes.filter((take) => take.takeId !== id);
        else draft.takes.push(imported);
      });
      readBCProject(result);
    }
  }
  return {
    document: result,
    report: {
      changedTakeId:
        operation === 'take clone'
          ? options.newTakeId
          : operation === 'take import'
            ? projectOf(game, result).takes.at(-1).takeId
            : id,
      invalidated: ['compiled-plans', 'render-artifacts'],
    },
  };
}
