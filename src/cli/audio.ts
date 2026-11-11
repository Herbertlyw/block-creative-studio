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
  validateProductionVoiceTakes,
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
      'audio voice edit',
      'edit',
      schema(
        ['id'],
        {
          id: string,
          takeId: string,
          assetId: string,
          startSeconds: seconds,
          enabled: { type: 'boolean' },
          gain,
          sourceOffsetSeconds: seconds,
          fadeInSeconds: { type: 'number', minimum: 0, maximum: 30 },
          fadeOutSeconds: { type: 'number', minimum: 0, maximum: 30 },
        },
        2,
      ),
      '添加或局部修改按 Take 秒数定位的人声 cue；新 cue 需要 takeId、assetId 和 startSeconds。',
    ),
    make(
      'audio voice delete',
      'edit',
      schema(['id'], { id: string }),
      '删除指定人声 cue，保留素材和其他声音。',
    ),
    make(
      'audio ducking edit',
      'edit',
      schema(
        [],
        {
          enabled: { type: 'boolean' },
          bgmGain: { type: 'number', minimum: 0, maximum: 1 },
          sfxGain: { type: 'number', minimum: 0, maximum: 1 },
          eventTypes: { type: 'array', maxItems: 100, items: string },
          attackSeconds: { type: 'number', minimum: 0, maximum: 10 },
          releaseSeconds: { type: 'number', minimum: 0, maximum: 10 },
        },
        1,
      ),
      '修改人声压低配置；只压低显式选择的事件模式。',
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
  const originalAudio = project.direction?.production?.audio;
  const audio: any = structuredClone(originalAudio ?? {});
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
          voices: audio.voices ?? null,
          ducking: audio.ducking ?? null,
        },
        effective: {
          selectedPackId: audio.selectedPackId ?? 'arcade-clean-v1',
          bgm: productionBgm(audio) ?? null,
          cues: audio.cues ?? productionDefaultCues(audio.selectedPackId),
          masterGain: audio.masterGain ?? 1,
          sfxGain: audio.sfxGain ?? 1,
          sfxEnabled: audio.sfxEnabled ?? true,
          mastering: audio.mastering ?? 'soft-limit',
          voices: audio.voices ?? [],
          ducking: audio.ducking ?? { enabled: false },
        },
      },
    };
  // Adding an asset or BGM to a previously silent project must not activate
  // the mixer's default SFX. Existing audio keeps its original default semantics.
  if (
    originalAudio === undefined &&
    (operation === 'audio import' ||
      operation === 'audio bgm edit' ||
      operation === 'audio voice edit' ||
      operation === 'audio ducking edit')
  )
    audio.sfxEnabled = false;
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
  } else if (operation === 'audio voice edit') {
    audio.voices ??= [];
    const index = audio.voices.findIndex((voice: any) => voice.id === options.id);
    if (index < 0) audio.voices.push({ ...options });
    else Object.assign(audio.voices[index], options);
    changes = { voiceId: options.id };
  } else if (operation === 'audio voice delete') {
    if (!(audio.voices ?? []).some((voice: any) => voice.id === options.id))
      throw new Error(`AUDIO_VOICE_NOT_FOUND: ${options.id}`);
    audio.voices = audio.voices.filter((voice: any) => voice.id !== options.id);
    changes = { deletedVoiceId: options.id };
  } else if (operation === 'audio ducking edit') {
    audio.ducking = {
      enabled: false,
      bgmGain: 0.35,
      sfxGain: 0.6,
      eventTypes: [],
      attackSeconds: 0.08,
      releaseSeconds: 0.25,
      ...audio.ducking,
      ...options,
    };
    changes = { ducking: true };
  } else if (operation === 'audio edit') {
    Object.assign(audio, options);
    changes = { fields: Object.keys(options) };
  } else throw new Error(`AUDIO_OPERATION_UNSUPPORTED: ${operation}`);
  validateProductionAudioReferences(audio);
  validateProductionVoiceTakes(
    audio,
    project.takes.map((take: any) => take.takeId),
  );
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
