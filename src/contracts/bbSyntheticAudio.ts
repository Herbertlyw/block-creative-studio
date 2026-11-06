import Ajv from 'ajv/dist/2020';
import schema from '../../contracts/bb/workbench-extensions/synthetic-audio-v1.schema.json';
import type { BBWorkPackage } from './bbWorkPackage';

export type BBTestCueKind = 'place' | 'line-cleared' | 'cross-cleared' | 'praise' | 'game-over';
export interface BBTestAudio {
  contract: 'bcs.workbench.synthetic-audio';
  version: '1.0.0';
  sfxGain: number;
  bgmGain: number;
  bgmStartSeconds: number;
  bgmSourceOffsetSeconds: number;
  bgmLoop: boolean;
  bgmPattern: 'tone' | 'melody-v1';
  cueOverrides: Array<{
    kind: BBTestCueKind;
    eventId?: string;
    gain: number;
    offsetSeconds: number;
  }>;
}
export const DEFAULT_BB_TEST_AUDIO: BBTestAudio = {
  contract: 'bcs.workbench.synthetic-audio',
  version: '1.0.0',
  sfxGain: 0.5,
  bgmGain: 0.2,
  bgmStartSeconds: 0,
  bgmSourceOffsetSeconds: 0,
  bgmLoop: true,
  bgmPattern: 'melody-v1',
  cueOverrides: [],
};
const validate = new Ajv({ strict: false }).compile(schema);
export function readBBTestAudio(document: unknown): BBTestAudio | null {
  const value = (document as any)?.direction?.style?.workbenchSyntheticAudioV1;
  if (value === undefined) return null;
  if (!validate(value)) throw new Error('合成测试音合同无效或版本不支持。');
  const config = value as unknown as BBTestAudio,
    ids = new Set<string>();
  for (const cue of config.cueOverrides) {
    const id = JSON.stringify([cue.kind, cue.eventId ?? null]);
    if (ids.has(id)) throw new Error('合成测试音包含重复的事件覆盖。');
    ids.add(id);
  }
  return config;
}
export async function setBBTestAudio(
  work: BBWorkPackage,
  value: BBTestAudio | null,
): Promise<BBWorkPackage> {
  const { openBBWorkPackage, updateBBWorkPackageProject } = await import('./bbWorkPackage');
  const original = await openBBWorkPackage(work),
    project = structuredClone(original.project) as any,
    style = project.direction?.style;
  if (!style) throw new Error('作品缺少外观设置。');
  if (value === null) delete style.workbenchSyntheticAudioV1;
  else style.workbenchSyntheticAudioV1 = structuredClone(value);
  readBBTestAudio(project);
  return updateBBWorkPackageProject(original, project);
}
