import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createWavAsset } from '../contracts/audioAsset';
import {
  productionSoundLibrary,
  productionAudioCatalog,
  productionDefaultCues,
  productionBgm,
  validateProductionAudioAsset,
  validateProductionAudioReferences,
  verifyProductionAudioAssets,
} from '../nativeReference/agent-director/audioMix';
import { updateBBWorkPackageProject, type BBWorkPackage } from '../contracts/bbWorkPackage';
import { editBCProject, type BCProject } from '../games/block-crush/document';
import { BB_AUDIO_EVENTS } from '../contracts/setNativeWorkAudio';

type Game = 'block-placement' | 'block-crush-drop';
type Work = BBWorkPackage | BCProject;
type Options = Record<string, unknown>;
const string = { type: 'string', minLength: 1, maxLength: 180 };
const gain = { type: 'number', minimum: 0, maximum: 2 };
const seconds = { type: 'number', minimum: 0, maximum: 3600 };
const schema = (required: string[], properties: Record<string, unknown>, minProperties = 0) => ({
  type: 'object',
  required,
  properties,
  additionalProperties: false,
  ...(minProperties ? { minProperties } : {}),
});
export function audioOperations() {
  const make = (id: string, kind: 'query' | 'edit', s: object, description: string) => ({
    id,
    kind,
    schema: s,
    requiresInput: true,
    output: kind === 'edit',
    description,
  });
  return [
    make('audio catalog', 'query', schema([], {}), '查询内置声音、预设、事件和工程素材。'),
    make('audio inspect', 'query', schema([], {}), '查询 BGM、音效及默认值。'),
    make(
      'audio import',
      'edit',
      schema(['id', 'file'], {
        id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$' },
        file: string,
      }),
      '导入 PCM WAV，保留当前声音配置。',
    ),
    make(
      'audio bgm edit',
      'edit',
      schema(
        [],
        {
          assetId: string,
          enabled: { type: 'boolean' },
          gain,
          loop: { type: 'boolean' },
          startSeconds: seconds,
          sourceOffsetSeconds: seconds,
          fadeInSeconds: { type: 'number', minimum: 0, maximum: 30 },
          fadeOutSeconds: { type: 'number', minimum: 0, maximum: 30 },
        },
        1,
      ),
      '修改指定的 BGM 参数。',
    ),
    make(
      'audio sfx edit',
      'edit',
      schema(
        ['index'],
        {
          index: { type: 'integer', minimum: 0 },
          assetId: string,
          gain,
          offsetSeconds: { type: 'number', minimum: -2, maximum: 10 },
        },
        2,
      ),
      '按索引编辑已有或默认 cue。',
    ),
    make(
      'audio edit',
      'edit',
      schema(
        [],
        {
          masterGain: gain,
          sfxGain: gain,
          sfxEnabled: { type: 'boolean' },
          mastering: { enum: ['soft-limit', 'preserve-level'] },
        },
        1,
      ),
      '修改指定的全局声音参数。',
    ),
  ];
}
export async function runAudio(game: Game, operation: string, work: Work, options: Options) {
  const project: any = game === 'block-placement' ? (work as BBWorkPackage).project : work;
  const audio: any = structuredClone(project.direction?.production?.audio ?? {});
  if (operation === 'audio catalog')
    return {
      report: {
        builtins: productionSoundLibrary(),
        presets: productionAudioCatalog(),
        events:
          game === 'block-placement'
            ? BB_AUDIO_EVENTS
            : {
                placement: ['block-crush-drop.piece-committed'],
                clear: ['block-crush-drop.blocks-eliminated'],
              },
        assets: Object.values(audio.assets ?? {}).map((a: any) => ({
          id: a.id,
          sha256: a.sha256,
          mimeType: a.mimeType,
          sourceName: a.sourceName,
        })),
      },
    };
  if (operation === 'audio inspect')
    return {
      report: {
        explicit: {
          selectedPackId: audio.selectedPackId ?? null,
          bgm: audio.bgm ?? null,
          cues: audio.cues ?? null,
          masterGain: audio.masterGain ?? null,
          sfxGain: audio.sfxGain ?? null,
          sfxEnabled: audio.sfxEnabled ?? null,
          mastering: audio.mastering ?? null,
        },
        effective: {
          selectedPackId: audio.selectedPackId ?? 'arcade-clean-v1',
          bgm: productionBgm(audio) ?? null,
          cues: audio.cues ?? productionDefaultCues(audio.selectedPackId),
          masterGain: audio.masterGain ?? 1,
          sfxGain: audio.sfxGain ?? 1,
          sfxEnabled: audio.sfxEnabled ?? true,
          mastering: audio.mastering ?? 'soft-limit',
        },
      },
    };
  let changes: Record<string, unknown> = {};
  if (operation === 'audio import') {
    const bytes = await readFile(options.file as string);
    if (!bytes.length || bytes.length > 16 * 1024 * 1024)
      throw new Error('AUDIO_SIZE_INVALID: WAV 为空或超过 16 MiB。');
    const id = options.id as string;
    const asset = await createWavAsset(bytes, id, basename(options.file as string));
    const old = audio.assets?.[id];
    if (old && (old.sha256 !== asset.sha256 || old.data !== asset.data))
      throw new Error(`AUDIO_ASSET_ID_CONFLICT: ${id}`);
    audio.assets = { ...audio.assets, [id]: old ?? asset };
    changes = { addedAssetIds: old ? [] : [id] };
  } else if (operation === 'audio bgm edit') {
    const currentBgm = audio.bgm ?? productionBgm(audio);
    if (!currentBgm && !options.assetId)
      throw new Error('AUDIO_BGM_ASSET_REQUIRED: 请先指定 BGM assetId。');
    audio.bgm = { ...currentBgm, ...options };
    changes = { bgm: true };
  } else if (operation === 'audio sfx edit') {
    const index = options.index as number,
      cues = structuredClone(audio.cues ?? productionDefaultCues(audio.selectedPackId));
    if (!cues[index]) throw new Error(`AUDIO_CUE_NOT_FOUND: ${index}`);
    const { index: _index, ...patch } = options;
    cues[index] = { ...cues[index], ...patch };
    audio.cues = cues;
    changes = { cueIndex: index, eventType: cues[index].eventType };
  } else if (operation === 'audio edit') {
    Object.assign(audio, options);
    changes = { fields: Object.keys(options) };
  } else throw new Error(`AUDIO_OPERATION_UNSUPPORTED: ${operation}`);
  validateProductionAudioReferences(audio);
  await verifyProductionAudioAssets(audio);
  for (const asset of Object.values(audio.assets ?? {})) validateProductionAudioAsset(asset as any);
  const apply = (draft: any) => {
    draft.direction ??= {};
    draft.direction.production ??= { version: '1.0.0' };
    draft.direction.production.audio = audio;
  };
  let result: Work;
  if (game === 'block-placement') {
    const doc = structuredClone(project);
    apply(doc);
    result = await updateBBWorkPackageProject(work as BBWorkPackage, doc);
  } else result = editBCProject(work as BCProject, apply);
  return {
    document: result,
    report: {
      ...changes,
      invalidated: operation === 'audio import' ? [] : ['audio-mix', 'render-artifacts'],
    },
  };
}
