#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import Ajv from 'ajv';
import { createNativeWork, setNativeWorkBoardCell } from '../contracts/nativeWorkAuthor';
import { importBBWorkDocument, openBBWorkPackage } from '../contracts/bbWorkPackage';
import { createBCDemo } from '../games/block-crush/demo';
import { importBCProject } from '../games/block-crush/assets';
import { changeBCAction } from '../games/block-crush/editing';
import { bcCalibration, bcProduction } from '../games/block-crush/document';
import { attachBlockCrushDropRuntimeAssets } from '../nativeReference/games/block-crush-drop/render/clearSequenceRuntime';
import {
  verifyRuntimeAgentImageBindings,
  verifyRuntimeAgentSequenceBindings,
} from '../nativeReference/agent-assets/storage';
import {
  verifyProductionAudioAssets,
  validateProductionAudioAsset,
} from '../nativeReference/agent-director/audioMix';
import { blockPlacementAgentAdapter } from '../nativeReference/games/block-placement/agent';
import { runTake, takeOperations } from './takes';
import { audioOperations, runAudio } from './audio';
import { assetOperations, runAsset } from './assets';
import { readJSON, writeNew } from './files';
import {
  AGENT_RESULT_SCHEMA,
  GameAgentRegistry,
} from '../nativeReference/game-runtime/agentOperations';

type Game = 'block-placement' | 'block-crush-drop';
type Options = Record<string, unknown>;
type Operation = {
  id: string;
  kind: 'query' | 'edit';
  schema: object;
  requiresInput: boolean;
  output: boolean;
  description: string;
};
const noOptions = { type: 'object', additionalProperties: false };
const sourceRegistry = new GameAgentRegistry();
sourceRegistry.register(blockPlacementAgentAdapter);
const ops: Record<Game, Operation[]> = {
  'block-placement': [
    {
      id: 'project create',
      kind: 'edit',
      schema: noOptions,
      requiresInput: false,
      output: true,
      description: '创建可编辑 BB 作品包。',
    },
    {
      id: 'project inspect',
      kind: 'query',
      schema: noOptions,
      requiresInput: true,
      output: false,
      description: '验证并汇总工程或作品包。',
    },
    {
      id: 'project validate',
      kind: 'query',
      schema: noOptions,
      requiresInput: true,
      output: false,
      description: '校验工程、素材、来源和指针。',
    },
    {
      id: 'board edit',
      kind: 'edit',
      schema: {
        type: 'object',
        required: ['row', 'column', 'color'],
        properties: {
          row: { type: 'integer', minimum: 0 },
          column: { type: 'integer', minimum: 0 },
          color: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
        },
        additionalProperties: false,
      },
      requiresInput: true,
      output: true,
      description: '通过工作台服务修改初始棋盘单格。',
    },
  ],
  'block-crush-drop': [
    {
      id: 'project create',
      kind: 'edit',
      schema: noOptions,
      requiresInput: false,
      output: true,
      description: '创建可编辑 BC 原生示例。',
    },
    {
      id: 'project inspect',
      kind: 'query',
      schema: noOptions,
      requiresInput: true,
      output: false,
      description: '验证并汇总 BC 工程。',
    },
    {
      id: 'project validate',
      kind: 'query',
      schema: noOptions,
      requiresInput: true,
      output: false,
      description: '校验 BC 工程、回放和效果绑定。',
    },
    {
      id: 'action edit',
      kind: 'edit',
      schema: {
        type: 'object',
        required: ['takeId', 'index', 'column', 'seconds'],
        properties: {
          takeId: { type: 'string', minLength: 1 },
          index: { type: 'integer', minimum: 0 },
          column: { type: 'integer', minimum: 0 },
          seconds: { type: 'number', minimum: 0 },
        },
        additionalProperties: false,
      },
      requiresInput: true,
      output: true,
      description: '通过工作台服务修改动作落点和时间。',
    },
  ],
};
ops['block-placement'].push(...takeOperations('block-placement'));
ops['block-crush-drop'].push(...takeOperations('block-crush-drop'));
ops['block-placement'].push(...audioOperations());
ops['block-crush-drop'].push(...audioOperations());
ops['block-placement'].push(...assetOperations());
ops['block-crush-drop'].push(...assetOperations());
class UsageError extends Error {
  constructor(
    message: string,
    readonly issues?: Array<{ field: string; keyword: string; message: string }>,
  ) {
    super(message);
  }
}
const ajv = new Ajv({ allErrors: true, strict: false });
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
function parseFlags(args: string[]) {
  const result: Record<string, string | boolean> = {};
  while (args.length) {
    const flag = args.shift()!;
    if (!['--input', '--out', '--options-file', '--json'].includes(flag) || flag in result)
      throw new UsageError(`未知或重复参数：${flag}`);
    if (flag === '--json') result[flag] = true;
    else {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new UsageError(`${flag} 需要路径。`);
      result[flag] = value;
    }
  }
  return result;
}
async function main(args: string[]) {
  if (!args.length || (args.length === 1 && args[0] === '--help'))
    return {
      ok: true,
      report: {
        usage: [
          'games list',
          'games describe <game>',
          'game <game> <operation> [--input path] [--options-file path] [--out path]',
        ],
        note: '结果为 JSON；编辑必须另存到不存在的路径。',
      },
    };
  const [family, action, ...remaining] = args;
  if (family === 'games') {
    if (action === 'list') {
      const flags = parseFlags(remaining);
      if (Object.keys(flags).some((key) => key !== '--json'))
        throw new UsageError('此命令仅接受 --json。');
      return { ok: true, report: { games: Object.keys(ops) } };
    }
    if (action === 'describe') {
      const id = remaining.shift() as Game;
      const flags = parseFlags(remaining);
      if (Object.keys(flags).some((key) => key !== '--json'))
        throw new UsageError('此命令仅接受 --json。');
      if (!Object.hasOwn(ops, id)) throw new UsageError(`未知游戏：${id}`);
      const unavailable =
        id === 'block-placement'
          ? sourceRegistry
              .require(id)
              .operations.filter((item) => !ops[id].some((op) => op.id === item.id))
              .map((item) => ({
                id: item.id,
                status: 'not-exposed',
                invalidates: item.invalidates,
              }))
          : [];
      return {
        ok: true,
        report: {
          gameId: id,
          runtime: 'node',
          operations: ops[id].map((op) => ({
            ...op,
            version: '1.0.0',
            inputSchema: {
              type: 'object',
              required: [
                ...(op.requiresInput ? ['project'] : []),
                ...('required' in op.schema &&
                Array.isArray(op.schema.required) &&
                op.schema.required.length
                  ? ['options']
                  : 'minProperties' in op.schema &&
                      typeof op.schema.minProperties === 'number' &&
                      op.schema.minProperties > 0
                    ? ['options']
                    : []),
              ],
              properties: { project: { type: 'object' }, options: op.schema },
              additionalProperties: false,
            },
            outputSchema: AGENT_RESULT_SCHEMA,
            formats:
              id === 'block-placement'
                ? ['bcs-bb-work', 'bcs-studio-project']
                : ['bcs-studio-project'],
            status: 'available',
            runtime:
              op.id === 'asset import' ||
              op.id === 'asset bind' ||
              (id === 'block-placement' && op.id === 'asset unbind')
                ? 'node+chrome'
                : 'node',
            restrictions:
              op.id === 'board edit'
                ? ['source, pointer, calibrated tracks and saved clips are rejected']
                : op.id === 'action edit' && id === 'block-crush-drop'
                  ? ['saved clips and shared reference tracks across multiple Takes are rejected']
                  : op.kind === 'edit' && (op.id.startsWith('take ') || op.id === 'action edit')
                    ? [
                        'gameplay changes reject protected source, pointer, calibrated tracks and referenced targets',
                      ]
                    : [],
          })),
          unavailable,
        },
      };
    }
    throw new UsageError('用法：games list | games describe <game>');
  }
  if (family !== 'game')
    throw new UsageError(
      '用法：game <game> <operation> [--input path] [--options-file path] [--out path] [--json]',
    );
  const game = action as Game,
    id = remaining.shift();
  if (!Object.hasOwn(ops, game)) throw new UsageError(`未知游戏：${game}`);
  const op = ops[game].find((item) => item.id === id);
  if (!op) throw new UsageError(`未接入的操作：${id}`);
  const flags = parseFlags(remaining);
  if (op.requiresInput !== (typeof flags['--input'] === 'string'))
    throw new UsageError(op.requiresInput ? '需要 --input。' : '此操作不接受 --input。');
  if (op.output !== (typeof flags['--out'] === 'string'))
    throw new UsageError(op.output ? '需要 --out。' : '查询操作不接受 --out。');
  const options: Options = flags['--options-file']
    ? await readJSON(flags['--options-file'] as string)
    : {};
  const check = ajv.compile(op.schema);
  if (!check(options))
    throw new UsageError(
      `操作参数无效：${ajv.errorsText(check.errors)}`,
      (check.errors ?? []).map((issue) => ({
        field: issue.instancePath || String(issue.params.missingProperty ?? ''),
        keyword: issue.keyword,
        message: issue.message ?? '',
      })),
    );
  const inputPath = flags['--input'] as string | undefined;
  if (id === 'take import' || id === 'audio import' || id === 'asset import')
    options.file = resolve(
      dirname(resolve(flags['--options-file'] as string)),
      options.file as string,
    );
  let original = inputPath ? await readJSON(inputPath) : undefined;
  let result: unknown;
  let extraReport: Record<string, unknown> = {};
  if (game === 'block-placement') {
    if (id === 'project create') result = await createNativeWork();
    else {
      const isPackage = original?.format === 'bcs-bb-work';
      const work = isPackage
        ? await openBBWorkPackage(original)
        : await importBBWorkDocument(original);
      if (id === 'board edit') {
        if ((work.project as any).direction?.production?.clips?.length)
          throw new Error('工程含已保存片段；棋盘修改尚不能安全同步片段来源，请保留原工程。');
        const edited = await setNativeWorkBoardCell(
          work,
          options.row as number,
          options.column as number,
          options.color as string | null,
        );
        result = isPackage ? edited : edited.project;
      } else if (
        id!.startsWith('take ') ||
        id === 'action edit' ||
        id!.startsWith('audio ') ||
        id!.startsWith('asset ')
      ) {
        const executed = id!.startsWith('audio ')
          ? await runAudio(game, id!, work, options)
          : id!.startsWith('asset ')
            ? await runAsset(game, id!, work, options)
            : await runTake(game, id!, work, options);
        extraReport = executed.report;
        result = executed.document
          ? isPackage
            ? executed.document
            : (executed.document as any).project
          : work;
      } else result = work;
    }
  } else {
    if (id === 'project create') result = createBCDemo();
    else {
      const project = await importBCProject(original);
      if (id === 'action edit' && bcProduction(project).clips?.length)
        throw new Error('工程含已保存片段；动作修改尚不能确认片段来源，请保留原工程。');
      if (
        id === 'action edit' &&
        project.takes.length > 1 &&
        bcCalibration(project).pieceTracks?.length
      )
        throw new Error(
          '工程有多条 Take 和共享参考轨迹；动作修改无法安全区分轨迹归属，请保留原工程。',
        );
      for (const take of project.takes) {
        const assets = attachBlockCrushDropRuntimeAssets(undefined, project, take.takeId);
        await verifyRuntimeAgentImageBindings(assets);
        await verifyRuntimeAgentSequenceBindings(assets);
      }
      const audio = bcProduction(project).audio;
      if (audio) {
        await verifyProductionAudioAssets(audio);
        for (const asset of Object.values(audio.assets ?? {})) validateProductionAudioAsset(asset);
      }
      if (id!.startsWith('take ') || id!.startsWith('audio ') || id!.startsWith('asset ')) {
        const executed = id!.startsWith('audio ')
          ? await runAudio(game, id!, project, options)
          : id!.startsWith('asset ')
            ? await runAsset(game, id!, project, options)
            : await runTake(game, id!, project, options);
        extraReport = executed.report;
        result = executed.document ?? project;
      } else
        result =
          id === 'action edit'
            ? changeBCAction(
                project,
                options.takeId as string,
                options.index as number,
                options.column as number,
                options.seconds as number,
              )
            : project;
    }
  }
  if (op.output) await writeNew(flags['--out'] as string, result, inputPath);
  const project =
    game === 'block-placement' && (result as any).format === 'bcs-bb-work'
      ? (result as any).project
      : (result as any);
  return {
    ok: true,
    report: {
      gameId: game,
      operation: id,
      output: flags['--out'] ?? null,
      format: !op.output && original ? original.format : (result as any).format,
      name: project.name,
      takes: project.takes.map((take: any) => take.takeId),
      ...extraReport,
      ...(op.output && (id!.startsWith('asset ') || id!.startsWith('audio '))
        ? { affectedTakeIds: project.takes.map((take: any) => take.takeId) }
        : {}),
      ...(op.output && id!.startsWith('take ')
        ? { affectedTakeIds: [extraReport.changedTakeId] }
        : {}),
      ...(id === 'board edit'
        ? {
            changed: { row: options.row, column: options.column },
            affectedTakeIds: project.takes.map((take: any) => take.takeId),
            invalidated: ['compiled-plans', 'render-artifacts'],
          }
        : {}),
      ...(id === 'action edit'
        ? {
            changed: { takeId: options.takeId, actionIndex: options.index },
            affectedTakeIds: [options.takeId],
            invalidated: ['compiled-plans', 'render-artifacts'],
          }
        : {}),
    },
  };
}
main(process.argv.slice(2))
  .then((result) => {
    process.stdout.write(JSON.stringify(result) + '\n');
  })
  .catch((error) => {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        report: {
          error: {
            code:
              error instanceof UsageError
                ? 'INVALID_ARGUMENT'
                : (message(error).match(/\b[A-Z][A-Z0-9_]{3,}(?=:)/)?.[0] ?? 'OPERATION_FAILED'),
            message: message(error),
            ...(error instanceof UsageError && error.issues ? { issues: error.issues } : {}),
          },
        },
      }) + '\n',
    );
    process.exitCode = error instanceof UsageError ? 2 : 1;
  });
