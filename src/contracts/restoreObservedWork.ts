import { openBBWorkPackage, type BBWorkPackage } from './bbWorkPackage';
import { BB_AUDIO_EVENTS } from './setNativeWorkAudio';

type Identity = { role: string; name: string; sha256: string };
type Embedded = {
  encoding: string;
  data: string;
  sourceName: string;
  mimeType: string;
  sha256: string;
};
type MediaRoles = {
  images: Record<string, File>;
  sounds: Record<string, File>;
  imageSettings: Identity[];
  audioSettings: Identity[];
};

/** Recover an edit template from the CURRENT work, not from a historical asset-name whitelist.
 * The observation editor changes actions/geometry; unrelated assets and mix fields stay in template. */
export async function restoreObservedWork(
  work: BBWorkPackage,
  decode?: (bytes: Uint8Array) => Promise<{ width: number; height: number }>,
) {
  const template = await openBBWorkPackage(work);
  if (!template.source) throw new Error('作品未绑定来源观察记录，无法从观察界面继续编辑。');
  const project = template.project as any,
    observation = template.source.observation as any;
  if (!observation?.measurement?.source) throw new Error('作品缺少测量。');
  const style = project.direction.style,
    cal = style.referenceCalibration,
    extension = style.agentAssets;
  const audio = project.direction.production?.audio,
    entries = extension?.entries ?? {},
    assets = audio?.assets ?? {};
  const result: MediaRoles = { images: {}, sounds: {}, imageSettings: [], audioSettings: [] };
  const sprite = (name: string): string | undefined => {
    const value = cal?.sprites?.[name];
    return typeof value === 'string' && value.startsWith('asset:') ? value.slice(6) : undefined;
  };
  const roles: Record<string, string | undefined> = {
    background: extension?.bindings?.['background.base']?.assetId ?? sprite('background'),
    tile: extension?.bindings?.['tile.face']?.assetId,
  };
  const white = sprite('tileWhite'),
    coral = sprite('tileCoral'),
    cyan = sprite('tileCyan');
  if (white && white === coral && white === cyan) roles.tile ??= white;
  else {
    roles.white = white;
    roles.coral = coral;
    roles.cyan = cyan;
  }
  const file = (entry: Embedded): File => {
    if (entry.encoding !== 'base64' || typeof entry.data !== 'string')
      throw new Error('素材没有可恢复的内嵌数据。');
    const bytes = Uint8Array.from(atob(entry.data), (c) => c.charCodeAt(0));
    return new File([bytes], entry.sourceName, { type: entry.mimeType });
  };
  for (const [role, id] of Object.entries(roles)) {
    if (!id || !entries[id]) continue;
    const entry = entries[id] as Embedded,
      selected = file(entry);
    if (decode) await decode(new Uint8Array(await selected.arrayBuffer()));
    result.images[role] = selected;
    result.imageSettings.push({ role, name: entry.sourceName, sha256: entry.sha256 });
  }
  const audioRoles: Record<string, string | undefined> = { bgm: audio?.bgm?.assetId };
  for (const role of ['placement', 'clear'] as const) {
    const events: readonly string[] = BB_AUDIO_EVENTS[role];
    const ids = [
      ...new Set<string>(
        (audio?.cues ?? [])
          .filter((cue: any) => events.includes(cue.eventType))
          .map((cue: any) => cue.assetId),
      ),
    ];
    // Multiple per-event sounds are preserved in template, never collapsed into one file.
    if (ids.length === 1) audioRoles[role] = ids[0];
  }
  for (const [role, id] of Object.entries(audioRoles)) {
    if (!id || !assets[id]) continue;
    const entry = assets[id] as Embedded;
    result.sounds[role] = file(entry);
    result.audioSettings.push({ role, name: entry.sourceName, sha256: entry.sha256 });
  }
  const bgm = audio?.bgm,
    cues = audio?.cues ?? [];
  const geometry = JSON.parse(observation.geometry);
  geometry.theme = cal.theme;
  geometry.bestScore = cal.bestScore;
  geometry.rackCenters = cal.rackCenters ?? cal.appearance?.rackCenters ?? geometry.rackCenters;
  return {
    ...result,
    template,
    geometry: JSON.stringify(geometry, null, 2),
    audio: {
      bgmStart: bgm?.startSeconds ?? 0,
      bgmOffset: bgm?.sourceOffsetSeconds ?? 0,
      bgmGain: bgm?.gain ?? 0.2,
      bgmLoop: bgm?.loop ?? false,
      cueGain: cues[0]?.gain ?? 0.5,
    },
    legacyClearCue:
      !!result.sounds.clear &&
      !cues.some((cue: any) => cue.eventType === 'block-placement.reference-clear-heavy'),
    pointer: template.pointer,
  };
}
