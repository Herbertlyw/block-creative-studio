import { ObservationImageInputs } from './ObservationImageInputs';
import { ObservationAudioInputs } from './ObservationAudioInputs';
import { useObservationDraft } from '../state/useObservationDraft';
import { useEffect, useRef, useState } from 'react';
import {
  measuredFrameSeconds,
  validateReferenceMeasurement,
  type ReferenceMeasurement,
} from '../contracts/referenceMeasurement';
import { ObservedAnnotationEditor } from './ObservedAnnotationEditor';
import { ObservedGeometryEditor } from './ObservedGeometryEditor';
import { buildObservedPointer } from '../contracts/observedPointer';
import { sourceDesignMap, type SourceDesignMap } from '../contracts/sourceDesignMap';
import { createObservedSourceLink } from '../contracts/observedSourceLink';
import { invalidateObservedGeometry } from '../contracts/observedGeometryDraft';
import type { BBWorkPackage } from '../contracts/bbWorkPackage';
import { downloadBlob } from '../utils/download';
import {
  invalidateObservedAnnotation,
  observedDraftBlockers,
  observedFramePosition,
} from '../contracts/observedDraftReview';

type Observation = {
  id: string;
  seconds: number;
  kind: string;
  note: string;
  confirmed: boolean;
  origin: 'author';
  confidence: 'author-observation';
  frame?: number;
};

export function ReferenceVideoNotes({
  onOpenCreated,
  hasCurrentWork = true,
  currentWork,
  onDraftChange,
}: {
  onOpenCreated?: (work: BBWorkPackage) => void;
  hasCurrentWork?: boolean;
  currentWork?: BBWorkPackage | null;
  onDraftChange?: (editor: string, dirty: boolean) => void;
} = {}) {
  const [file, setFile] = useState<File | null>(null),
    [url, setUrl] = useState(''),
    [hash, setHash] = useState('');
  const [metadata, setMetadata] = useState(''),
    [error, setError] = useState(''),
    [kind, setKind] = useState('初始棋盘');
  const [note, setNote] = useState(''),
    [observations, setObservations] = useState<Observation[]>([]);
  const [measurement, setMeasurement] = useState<ReferenceMeasurement | null>(null),
    [frame, setFrame] = useState(0);
  const [sourceTime, setSourceTime] = useState(0);
  const [structured, setStructured] = useState(''),
    [geometry, setGeometry] = useState(''),
    [buildStatus, setBuildStatus] = useState('');
  const [bgm, setBgm] = useState<File | null>(null),
    [placement, setPlacement] = useState<File | null>(null),
    [clearCue, setClearCue] = useState<File | null>(null);
  const [bgmStart, setBgmStart] = useState(0),
    [bgmOffset, setBgmOffset] = useState(0),
    [bgmGain, setBgmGain] = useState(0.2),
    [cueGain, setCueGain] = useState(0.5),
    [bgmLoop, setBgmLoop] = useState(false);
  const [savedAudio, setSavedAudio] = useState<
    Array<{ role: string; name: string; sha256: string }>
  >([]);
  const [background, setBackground] = useState<File | null>(null),
    [tile, setTile] = useState<File | null>(null);
  const [imageMode, setImageMode] = useState<'shared' | 'grouped'>('shared');
  const [white, setWhite] = useState<File | null>(null),
    [coral, setCoral] = useState<File | null>(null),
    [cyan, setCyan] = useState<File | null>(null);
  const [pointerConfirmed, setPointerConfirmed] = useState(false),
    [pointerRadius, setPointerRadius] = useState(20),
    [pointerLink, setPointerLink] = useState<unknown>(null);
  const [mapping, setMapping] = useState<SourceDesignMap | null>(null);
  const [sourceLink, setSourceLink] = useState<unknown>(null);
  const [createdWork, setCreatedWork] = useState<BBWorkPackage | null>(null);
  const [editTemplate, setEditTemplate] = useState<BBWorkPackage | null>(null),
    [building, setBuilding] = useState(false);
  const [savedImages, setSavedImages] = useState<
    Array<{ role: string; name: string; sha256: string }>
  >([]);
  const video = useRef<HTMLVideoElement>(null),
    structuredEditor = useRef<HTMLDetailsElement>(null);
  const generation = useRef(0);
  const fileIdentity = (item: File | null) => item && [item.name, item.size, item.lastModified];
  const observationFingerprint = JSON.stringify({
    hash,
    sourceName: file?.name,
    metadata,
    observations,
    structured,
    geometry,
    mapping,
    note,
    bgmStart,
    bgmOffset,
    bgmGain,
    cueGain,
    bgmLoop,
    savedAudio,
    savedImages,
    imageMode,
    files: [bgm, placement, clearCue, background, tile, white, coral, cyan].map(fileIdentity),
    pointerConfirmed,
    pointerRadius,
  });
  const hasObservationDraft =
    observations.length > 0 ||
    !!structured ||
    !!geometry ||
    !!note ||
    !!bgm ||
    !!placement ||
    !!clearCue ||
    !!background ||
    !!tile ||
    !!white ||
    !!coral ||
    !!cyan ||
    !!mapping ||
    pointerConfirmed ||
    pointerRadius !== 20 ||
    bgmStart !== 0 ||
    bgmOffset !== 0 ||
    bgmGain !== 0.2 ||
    cueGain !== 0.5 ||
    bgmLoop;
  const {
    dirty: observationDirty,
    rebase: rebaseObservation,
    latest: latestObservation,
    markSaved: setSavedObservation,
  } = useObservationDraft(observationFingerprint, hasObservationDraft, onDraftChange);
  const blockers = observedDraftBlockers(structured, geometry, measurement, hash);
  if (mapping && !mapping.confirmed)
    blockers.push({ scope: 'calibration', message: '源画面映射待确认。' });
  let frameRelation = '导入同源 CFR 测量后才能换算源帧与输出事件帧。';
  try {
    if (measurement) {
      const fps = JSON.parse(structured).output.fps;
      const position = observedFramePosition(measurement, frame, fps);
      frameRelation = `源帧 ${frame} → 测量相对时间 ${position.seconds.toFixed(6)} 秒 → 校准事件输出帧 ${position.outputFrame}（${fps} fps，${position.outputSeconds.toFixed(6)} 秒）。普通玩法草稿尚不对齐绝对源时间。`;
    }
  } catch {
    frameRelation = '所选源帧或标注输出帧率无效；请修正后再记录时间。';
  }
  useEffect(() => {
    setCreatedWork(null);
    setSourceLink(null);
    setPointerLink(null);
  }, [observationFingerprint]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (!observationDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [observationDirty]);
  useEffect(() => {
    if (!file) {
      setUrl('');
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  async function select(next: File | undefined) {
    if (
      observationDirty &&
      !window.confirm('当前观察记录有未保存的修改。更换视频会放弃这些修改，是否继续？')
    )
      return;
    rebaseObservation.current = true;
    const current = ++generation.current;
    setCreatedWork(null);
    setEditTemplate(null);
    setFile(null);
    setHash('');
    setMetadata('');
    setObservations([]);
    setMeasurement(null);
    setFrame(0);
    setStructured('');
    setGeometry('');
    setBgm(null);
    setPlacement(null);
    setClearCue(null);
    setSavedAudio([]);
    setBackground(null);
    setTile(null);
    setWhite(null);
    setCoral(null);
    setCyan(null);
    setImageMode('shared');
    setSavedImages([]);
    setMapping(null);
    setPointerConfirmed(false);
    setPointerLink(null);
    setSourceLink(null);
    setBgmStart(0);
    setBgmOffset(0);
    setBgmGain(0.2);
    setCueGain(0.5);
    setBgmLoop(false);
    setBuildStatus('');
    setError('');
    if (!next) return;
    if (next.size > 512 * 1024 * 1024) {
      setError('视频超过 512 MiB，请先使用本地测量工具。');
      return;
    }
    try {
      const bytes = await next.arrayBuffer(),
        digest = await crypto.subtle.digest('SHA-256', bytes);
      if (current !== generation.current) return;
      setHash(Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join(''));
      setFile(next);
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : String(e));
    }
  }
  function add() {
    if (!video.current || !Number.isFinite(video.current.currentTime) || !note.trim()) return;
    setObservations((old) => [
      ...old,
      {
        id: crypto.randomUUID(),
        seconds: video.current!.currentTime,
        kind,
        note: note.trim(),
        confirmed: false,
        origin: 'author',
        confidence: 'author-observation',
      },
    ]);
    setNote('');
  }
  function addFrame() {
    if (!measurement || !note.trim()) return;
    const seconds = measuredFrameSeconds(measurement, frame);
    setObservations((old) => [
      ...old,
      {
        id: crypto.randomUUID(),
        seconds,
        frame,
        kind,
        note: note.trim(),
        confirmed: false,
        origin: 'author',
        confidence: 'author-observation',
      },
    ]);
    setNote('');
  }
  async function loadMeasurement(input: File | undefined) {
    if (!input || !video.current) return;
    const ticket = ++generation.current;
    const width = video.current.videoWidth,
      height = video.current.videoHeight;
    try {
      const measured = validateReferenceMeasurement(
        JSON.parse(await input.text()),
        hash,
        width,
        height,
      );
      if (ticket !== generation.current) return;
      setMeasurement(measured);
      setFrame(0);
      setError('');
    } catch (e) {
      if (ticket === generation.current) setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function reopen(input: File | undefined) {
    if (!input) return;
    if (observationDirty && !window.confirm('重开记录会替换当前未保存的观察草稿，是否继续？'))
      return;
    const ticket = ++generation.current;
    try {
      const raw = JSON.parse(await input.text());
      let data = raw;
      let restored: Awaited<
        ReturnType<typeof import('../contracts/restoreObservedWork').restoreObservedWork>
      > | null = null;
      if (raw?.format === 'bcs-bb-work') {
        const { openBBWorkPackage } = await import('../contracts/bbWorkPackage');
        const work = await openBBWorkPackage(raw);
        if (!work.source || !video.current) throw new Error('作品没有来源记录或视频尚未加载。');
        const { verifyObservedSourceLink } = await import('../contracts/observedSourceLink');
        const obs = work.source.observation as any;
        await verifyObservedSourceLink(
          work.source.link,
          work.project,
          obs,
          obs.measurement,
          hash,
          video.current.videoWidth,
          video.current.videoHeight,
        );
        const { restoreObservedWork } = await import('../contracts/restoreObservedWork');
        restored = await restoreObservedWork(work);
        data = obs;
      }
      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        Object.keys(data).some(
          (k) =>
            ![
              'version',
              'source',
              'frameRate',
              'measurement',
              'observations',
              'structured',
              'geometry',
              'mapping',
              'imageSettings',
              'audioSettings',
            ].includes(k),
        )
      )
        throw new Error('观察记录包含未知字段，不能安全编辑；原记录保留。');
      if (
        data.version !== '1.0.0' ||
        data.source?.sha256 !== hash ||
        !Array.isArray(data.observations)
      )
        throw new Error('记录版本无效或视频 SHA-256 不匹配。');
      const measured = data.measurement
        ? validateReferenceMeasurement(
            data.measurement,
            hash,
            video.current!.videoWidth,
            video.current!.videoHeight,
          )
        : null;
      const ids = new Set<string>();
      for (const o of data.observations) {
        if (
          typeof o.id !== 'string' ||
          ids.has(o.id) ||
          !Number.isFinite(o.seconds) ||
          o.seconds < 0 ||
          o.seconds > (video.current?.duration ?? 0) ||
          !['初始棋盘', '候选与供给', '拾取', '轨迹', '释放', '回撤', '消除', '其他'].includes(
            o.kind,
          ) ||
          typeof o.note !== 'string' ||
          typeof o.confirmed !== 'boolean' ||
          o.origin !== 'author' ||
          o.confidence !== 'author-observation' ||
          (o.frame !== undefined &&
            (!measured || Math.abs(measuredFrameSeconds(measured, o.frame) - o.seconds) > 1e-8))
        )
          throw new Error('观察记录无效，原有记录未修改。');
        ids.add(o.id);
      }
      if (
        (data.structured !== undefined && typeof data.structured !== 'string') ||
        (data.geometry !== undefined && typeof data.geometry !== 'string')
      )
        throw new Error('标注草稿无效，原有记录未修改。');
      if (data.mapping !== undefined && data.mapping !== null) {
        sourceDesignMap(data.mapping, video.current!.videoWidth, video.current!.videoHeight);
      }
      const audio = data.audioSettings;
      if (
        audio !== undefined &&
        (!audio ||
          ![audio.bgmStart, audio.bgmOffset, audio.bgmGain, audio.cueGain].every(Number.isFinite) ||
          audio.bgmStart < 0 ||
          audio.bgmOffset < 0 ||
          audio.bgmGain < 0 ||
          audio.bgmGain > 1 ||
          audio.cueGain < 0 ||
          audio.cueGain > 1 ||
          typeof audio.bgmLoop !== 'boolean' ||
          !Array.isArray(audio.assets) ||
          audio.assets.some(
            (x: any) =>
              !x ||
              !['bgm', 'placement', 'clear'].includes(x.role) ||
              typeof x.name !== 'string' ||
              !/^([a-f0-9]{64})$/.test(x.sha256),
          ) ||
          new Set(audio.assets.map((x: any) => x.role)).size !== audio.assets.length)
      )
        throw new Error('保存的音频设置无效，原有记录未修改。');
      const images = data.imageSettings;
      if (
        images !== undefined &&
        (!Array.isArray(images) ||
          images.some(
            (x: any) =>
              !x ||
              !['background', 'tile', 'white', 'coral', 'cyan'].includes(x.role) ||
              typeof x.name !== 'string' ||
              !/^([a-f0-9]{64})$/.test(x.sha256),
          ) ||
          new Set(images.map((x: any) => x.role)).size !== images.length)
      )
        throw new Error('保存的图片身份无效，原有记录未修改。');
      if (ticket !== generation.current) return;
      rebaseObservation.current = true;
      setBgm(restored?.sounds.bgm ?? null);
      setPlacement(restored?.sounds.placement ?? null);
      setClearCue(restored?.sounds.clear ?? null);
      setBackground(restored?.images.background ?? null);
      setTile(restored?.images.tile ?? null);
      setWhite(restored?.images.white ?? null);
      setCoral(restored?.images.coral ?? null);
      setCyan(restored?.images.cyan ?? null);
      if (data.mapping) setMapping(data.mapping);
      if (images) {
        setSavedImages(images);
        setImageMode(
          images.some((x: any) => ['white', 'coral', 'cyan'].includes(x.role))
            ? 'grouped'
            : 'shared',
        );
      }
      if (audio) {
        setBgmStart(audio.bgmStart);
        setBgmOffset(audio.bgmOffset);
        setBgmGain(audio.bgmGain);
        setCueGain(audio.cueGain);
        setBgmLoop(audio.bgmLoop);
        setSavedAudio(audio.assets);
      }
      setEditTemplate(restored?.template ?? null);
      if (restored) {
        setBackground(restored.images.background ?? null);
        setTile(restored.images.tile ?? null);
        setWhite(restored.images.white ?? null);
        setCoral(restored.images.coral ?? null);
        setCyan(restored.images.cyan ?? null);
        setImageMode(
          restored.images.tile ? 'shared' : restored.images.white ? 'grouped' : 'shared',
        );
        setSavedImages(restored.imageSettings);
        setBgm(restored.sounds.bgm ?? null);
        setPlacement(restored.sounds.placement ?? null);
        setClearCue(restored.sounds.clear ?? null);
        setSavedAudio(restored.audioSettings);
        setBgmStart(restored.audio.bgmStart);
        setBgmOffset(restored.audio.bgmOffset);
        setBgmGain(restored.audio.bgmGain);
        setBgmLoop(restored.audio.bgmLoop);
        setCueGain(restored.audio.cueGain);
        setPointerConfirmed(!!restored.pointer);
        if (restored.pointer) setPointerRadius(restored.pointer.style.radius);
        setBuildStatus(
          '已恢复当前作品。名称、全部素材和完整混音会保留；本页修改动作与几何，素材可回作品页面修改。',
        );
      }
      setMeasurement(measured);
      setObservations(data.observations);
      setStructured(data.structured ?? '');
      setGeometry(restored?.geometry ?? data.geometry ?? '');
      if (structuredEditor.current) structuredEditor.current.open = true;
      setError('');
    } catch (e) {
      if (ticket === generation.current) setError(e instanceof Error ? e.message : String(e));
    }
  }
  function updateStructured(value: string) {
    if (value !== structured) {
      setPointerConfirmed(false);
      if (geometry) setGeometry(invalidateObservedGeometry(geometry));
    }
    setStructured(invalidateObservedAnnotation(structured, value));
  }
  async function verifySource(next: File | undefined) {
    if (!next || !hash) return;
    const ticket = ++generation.current;
    try {
      if (next.size > 512 * 1024 * 1024) throw new Error('视频超过 512 MiB。');
      const digest = await crypto.subtle.digest('SHA-256', await next.arrayBuffer());
      const actual = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      if (ticket !== generation.current) return;
      if (actual !== hash) throw new Error('源视频 SHA-256 不匹配；已有视频、标注与草稿均保留。');
      setFile(next);
      setError('');
      setBuildStatus('已重新核验同一源视频 SHA-256，观察记录保留。');
    } catch (reason) {
      if (ticket === generation.current)
        setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  async function audioIdentity(file: File) {
    if (file.size > 16 * 1024 * 1024) throw new Error('音频文件超过 16 MiB。');
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
  }
  async function observationPayload() {
    if (
      ![bgmStart, bgmOffset, bgmGain, cueGain].every(Number.isFinite) ||
      bgmStart < 0 ||
      bgmOffset < 0 ||
      bgmGain < 0 ||
      bgmGain > 1 ||
      cueGain < 0 ||
      cueGain > 1
    )
      throw new Error('音频起点、偏移或增益无效，记录未保存。');
    const selected = [
      ['bgm', bgm],
      ['placement', placement],
      ['clear', clearCue],
    ] as const;
    const assets = [...savedAudio];
    for (const [role, file] of selected) {
      if (!file) continue;
      const sha256 = await audioIdentity(file),
        old = assets.find((x) => x.role === role);
      if (old && old.sha256 !== sha256)
        throw new Error(`${role} 音频与已保存哈希不一致；如需更换请先清除旧音频记录。`);
      if (!old) assets.push({ role, name: file.name, sha256 });
    }
    const images = [...savedImages];
    const imageFiles =
      imageMode === 'shared'
        ? ([
            ['background', background],
            ['tile', tile],
          ] as const)
        : ([
            ['background', background],
            ['white', white],
            ['coral', coral],
            ['cyan', cyan],
          ] as const);
    for (const [role, file] of imageFiles) {
      if (!file) continue;
      const sha256 = await audioIdentity(file),
        old = images.find((x) => x.role === role);
      if (old && old.sha256 !== sha256)
        throw new Error(`${role} 图片与已保存哈希不一致；请先清除旧图片记录。`);
      if (!old) images.push({ role, name: file.name, sha256 });
    }
    return {
      version: '1.0.0',
      source: { name: file?.name, sha256: hash, metadata },
      frameRate: measurement ? 'measured-cfr' : 'unverified',
      measurement,
      observations,
      structured,
      geometry,
      ...(mapping ? { mapping } : {}),
      imageSettings: images,
      audioSettings: { bgmStart, bgmOffset, bgmGain, cueGain, bgmLoop, assets },
    };
  }
  async function save() {
    const fingerprint = observationFingerprint;
    try {
      const payload = await observationPayload();
      downloadBlob(
        new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
        'reference-observations.json',
      );
      if (!note.trim() && !pointerConfirmed && pointerRadius === 20)
        setSavedObservation(fingerprint);
      else setBuildStatus('观察记录已发起下载；未添加的文字笔记或指针设置仍需另行保存到作品。');
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function build() {
    const revision = generation.current,
      fingerprint = observationFingerprint;
    try {
      if (!measurement || !video.current) throw new Error('请先导入同源测量。');
      const pending = blockers.filter((item) => item.scope === 'gameplay');
      if (pending.length)
        throw new Error(`生成受阻：${pending.map((item) => item.message).join('；')}`);
      const { buildObservedTake } = await import('../contracts/buildObservedTake');
      const result = await buildObservedTake(
        JSON.parse(structured),
        measurement,
        hash,
        video.current.videoWidth,
        video.current.videoHeight,
      );
      if (revision !== generation.current || fingerprint !== latestObservation.current)
        throw new Error('观察草稿在生成期间已变化；旧玩法草稿未发布，请重新检查并生成。');
      downloadBlob(
        new Blob([JSON.stringify(result.document, null, 2)], { type: 'application/json' }),
        'observed-gameplay-draft.json',
      );
      setBuildStatus(`玩法草稿下载已发起；${result.limitations.join('；')}`);
    } catch (e) {
      setBuildStatus(e instanceof Error ? e.message : String(e));
    }
  }
  async function calibrate() {
    if (building) return;
    setBuilding(true);
    setCreatedWork(null);
    setSourceLink(null);
    setPointerLink(null);
    const revision = generation.current,
      fingerprint = observationFingerprint;
    try {
      if (!measurement || !video.current) throw new Error('请先导入同源测量。');
      if (blockers.length)
        throw new Error(`生成受阻：${blockers.map((item) => item.message).join('；')}`);
      if (mapping) {
        sourceDesignMap(mapping, video.current.videoWidth, video.current.videoHeight);
        if (!mapping.confirmed) throw new Error('请先确认源画面映射。');
      }
      if (!editTemplate) {
        for (const asset of savedAudio) {
          const selected =
            asset.role === 'bgm' ? bgm : asset.role === 'placement' ? placement : clearCue;
          if (!selected) throw new Error(`请重新选择 ${asset.role} 音频：${asset.name}。`);
          if ((await audioIdentity(selected)) !== asset.sha256)
            throw new Error(`${asset.role} 音频 SHA-256 不一致。`);
        }
        for (const asset of savedImages) {
          const selected =
            asset.role === 'background'
              ? background
              : asset.role === 'tile'
                ? tile
                : asset.role === 'white'
                  ? white
                  : asset.role === 'coral'
                    ? coral
                    : cyan;
          if (!selected) throw new Error(`请重新选择 ${asset.role} 图片：${asset.name}。`);
          if ((await audioIdentity(selected)) !== asset.sha256)
            throw new Error(`${asset.role} 图片 SHA-256 不一致。`);
        }
      }
      const { bindObservedCalibration } = await import('../contracts/bindObservedCalibration');
      const result = await bindObservedCalibration(
        JSON.parse(structured),
        measurement,
        hash,
        video.current.videoWidth,
        video.current.videoHeight,
        JSON.parse(geometry),
      );
      let doc: unknown = result.document,
        warning = '';
      if (editTemplate) {
        const { mergeObservedEdit } = await import('../contracts/mergeObservedEdit');
        doc = mergeObservedEdit(editTemplate, doc);
      } else {
        if (imageMode === 'grouped') {
          if (savedImages.some((a) => a.role === 'tile'))
            throw new Error('请先清除旧的共用牌面绑定。');
          if (!white || !coral || !cyan)
            throw new Error('分槽模式需要 white、coral、cyan 三张 PNG。');
          const { attachObservedGroupedImages } = await import('../contracts/attachObservedImages');
          doc = (
            await attachObservedGroupedImages(doc, {
              ...(background ? { background } : {}),
              white,
              coral,
              cyan,
            })
          ).document;
        } else if (background || tile) {
          if (savedImages.some((a) => ['white', 'coral', 'cyan'].includes(a.role)))
            throw new Error('请先清除旧的分槽牌面绑定。');
          const { attachObservedImages } = await import('../contracts/attachObservedImages');
          doc = (
            await attachObservedImages(doc, {
              ...(background ? { background } : {}),
              ...(tile ? { tile } : {}),
            })
          ).document;
        }
        if (bgm || placement || clearCue) {
          const { attachObservedAudio } = await import('../contracts/attachObservedAudio');
          const mixed = await attachObservedAudio(doc, {
            ...(bgm ? { bgm } : {}),
            ...(placement ? { placement } : {}),
            ...(clearCue ? { clear: clearCue } : {}),
            bgmStart,
            bgmOffset,
            bgmGain,
            bgmLoop,
            cueGain,
          });
          doc = mixed.document;
          warning = mixed.warning;
        }
      }
      const observation = await observationPayload();
      const link = await createObservedSourceLink(
        doc,
        observation,
        hash,
        video.current.videoWidth,
        video.current.videoHeight,
      );
      if (pointerConfirmed && !mapping) throw new Error('指针扩展需要确认的源画面映射。');
      const pointer = pointerConfirmed
        ? await buildObservedPointer(
            doc,
            JSON.parse(structured),
            measurement,
            hash,
            video.current.videoWidth,
            video.current.videoHeight,
            mapping!,
            pointerRadius,
          )
        : null;
      const { createBBWorkPackage } = await import('../contracts/bbWorkPackage');
      const { projectContentHash } = await import('../contracts/observedSourceLink');
      const source = {
        link,
        observation,
        ...(editTemplate
          ? {
              provenance: {
                relation: 'derived' as const,
                parentProjectSha256: await projectContentHash(editTemplate.project),
              },
            }
          : {}),
      };
      const work = await createBBWorkPackage(doc, pointer, source);
      if (revision !== generation.current) return;
      if (fingerprint !== latestObservation.current)
        throw new Error('观察草稿在生成期间已变化；较早的生成结果已取消，请重新确认并生成。');
      setCreatedWork(work);
      setSourceLink(link);
      setPointerLink(pointer);
      downloadBlob(
        new Blob([JSON.stringify(work, null, 2)], { type: 'application/json' }),
        'bb-work.json',
      );
      if (!note.trim()) setSavedObservation(fingerprint);
      setBuildStatus(
        `完整作品包下载已发起，包含工程、素材、声音、来源记录与${pointerConfirmed ? '圆环指针' : '无指针设置'}。${editTemplate ? '保留了当前作品名称和完整素材、混音配置。' : ''}${warning}请检查下载是否完成；参考视频仍需单独保管，可打开此作品继续预览、编辑和导出。`,
      );
    } catch (e) {
      setBuildStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  }
  return (
    <details id="bb-reference-editor" className="native-preview">
      <summary>参考视频观察记录</summary>
      <p>
        视频仅在本机读取。播放器时间用于近似定位；同源恒帧率测量提供源帧编号和时间，浏览器画面仍需用独立解码提帧核对。文字观察与结构化标注分别保存；生成使用当前结构化标注和经作者确认的几何。
      </p>
      <label>
        选择参考视频{' '}
        <input
          aria-label="选择参考视频"
          type="file"
          accept="video/*"
          disabled={observations.length > 0 || structured.length > 0 || geometry.length > 0}
          onChange={(e) => void select(e.target.files?.[0])}
        />
      </label>
      {(observations.length > 0 || structured.length > 0 || geometry.length > 0) && (
        <p>如需切换视频，请先保存并清空当前观察及标注。</p>
      )}
      {error && <p role="alert">{error}</p>}
      {file && (
        <>
          <p>
            {file.name}；SHA-256：{hash}
          </p>
          <p>{metadata}</p>
          <label>
            重新核验源视频{' '}
            <input
              aria-label="重新核验源视频"
              type="file"
              accept="video/*"
              onChange={(e) => {
                void verifySource(e.currentTarget.files?.[0]);
                e.currentTarget.value = '';
              }}
            />
          </label>
          {url && (
            <video
              ref={video}
              src={url}
              controls
              style={{ maxWidth: '100%', maxHeight: 420 }}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                setMetadata(
                  `${v.videoWidth}×${v.videoHeight}，${v.duration.toFixed(3)} 秒；帧率及音轨需独立检查。`,
                );
              }}
              onError={() => setError('浏览器不能解码此视频。')}
              onTimeUpdate={(e) => setSourceTime(e.currentTarget.currentTime)}
            />
          )}
          <p role="status" aria-label="参考时间关系">
            播放器近似时间 {sourceTime.toFixed(3)} 秒。{frameRelation}
          </p>
          <p>
            <label>
              导入帧测量 JSON{' '}
              <input
                aria-label="导入帧测量"
                type="file"
                accept="application/json,.json"
                disabled={!metadata || observations.length > 0}
                onChange={(e) => {
                  void loadMeasurement(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </p>
          {measurement && (
            <p>
              <label>
                源帧{' '}
                <input
                  aria-label="参考源帧"
                  type="number"
                  min={0}
                  max={measurement.source.frameCount - 1}
                  value={frame}
                  onChange={(e) => setFrame(e.target.valueAsNumber)}
                />
              </label>{' '}
              <button
                disabled={!Number.isInteger(frame) || frame <= 0}
                onClick={() => {
                  const next = frame - 1;
                  setFrame(next);
                  video.current!.currentTime = measuredFrameSeconds(measurement, next);
                }}
              >
                上一测量帧
              </button>{' '}
              <button
                disabled={!Number.isInteger(frame) || frame >= measurement.source.frameCount - 1}
                onClick={() => {
                  const next = frame + 1;
                  setFrame(next);
                  video.current!.currentTime = measuredFrameSeconds(measurement, next);
                }}
              >
                下一测量帧
              </button>{' '}
              <button
                onClick={() => {
                  try {
                    video.current!.currentTime = measuredFrameSeconds(measurement, frame);
                    setError('');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                定位帧时间
              </button>{' '}
              帧定位使用浏览器播放时钟；精确帧图像请使用独立提取结果。 源帧率{' '}
              {measurement.source.fps}；时间基 {measurement.source.timeBase}；首个时间戳{' '}
              {measurement.source.firstTimestamp}。
            </p>
          )}
          <p>
            <label>
              重开观察记录或作品包{' '}
              <input
                aria-label="重开观察记录"
                type="file"
                accept="application/json,.json"
                disabled={
                  observations.length > 0 ||
                  structured.length > 0 ||
                  geometry.length > 0 ||
                  !metadata
                }
                onChange={(e) => {
                  void reopen(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </p>
          {currentWork?.source && (
            <p>
              <button
                disabled={!metadata || structured.length > 0 || building}
                onClick={() =>
                  void reopen(
                    new File([JSON.stringify(currentWork)], 'current-work.json', {
                      type: 'application/json',
                    }),
                  )
                }
              >
                继续编辑当前复刻作品
              </button>
              先选择同一参考视频；恢复后保留当前名称、素材和完整混音。
            </p>
          )}
          {editTemplate && (
            <p>
              正在修改当前作品的观察记录。图片与音频沿用作品当前配置，可在主工作台中添加或替换；此处不会重置其他素材或混音。
            </p>
          )}
          <p>
            <label>
              观察类型{' '}
              <select aria-label="观察类型" value={kind} onChange={(e) => setKind(e.target.value)}>
                {['初始棋盘', '候选与供给', '拾取', '轨迹', '释放', '回撤', '消除', '其他'].map(
                  (x) => (
                    <option key={x}>{x}</option>
                  ),
                )}
              </select>
            </label>{' '}
            <label>
              内容{' '}
              <input aria-label="观察内容" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>{' '}
            <button onClick={add}>记录当前时间</button>{' '}
            {measurement && (
              <button
                onClick={() => {
                  try {
                    addFrame();
                    setError('');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                记录所选测量帧
              </button>
            )}
          </p>
          <ul>
            {observations.map((item) => (
              <li key={item.id}>
                {item.frame === undefined ? '播放器时间' : `源帧 ${item.frame}`} ·{' '}
                {item.seconds.toFixed(3)} 秒 · {item.kind} · {item.note} ·{' '}
                {item.confirmed ? '作者已确认' : '待确认'}{' '}
                <label>
                  更正{item.frame === undefined ? '秒数' : '源帧'}{' '}
                  <input
                    aria-label={`观察 ${item.id} 时间`}
                    type="number"
                    step={item.frame === undefined ? 'any' : 1}
                    value={item.frame ?? item.seconds}
                    onChange={(e) => {
                      const value = e.target.valueAsNumber;
                      try {
                        const seconds =
                          item.frame === undefined
                            ? value
                            : measuredFrameSeconds(measurement!, value);
                        if (
                          !Number.isFinite(seconds) ||
                          seconds < 0 ||
                          seconds > (video.current?.duration ?? 0)
                        )
                          throw new Error('观察时间超出视频范围；原记录保留。');
                        setObservations((old) =>
                          old.map((entry) =>
                            entry.id === item.id
                              ? {
                                  ...entry,
                                  seconds,
                                  ...(item.frame === undefined ? {} : { frame: value }),
                                  confirmed: false,
                                }
                              : entry,
                          ),
                        );
                        setError('');
                      } catch (reason) {
                        setError(reason instanceof Error ? reason.message : String(reason));
                      }
                    }}
                  />
                </label>{' '}
                <button
                  onClick={() => {
                    if (video.current) video.current.currentTime = item.seconds;
                    if (item.frame !== undefined) setFrame(item.frame);
                  }}
                >
                  定位此记录（近似）
                </button>{' '}
                <button
                  onClick={() =>
                    setObservations((old) =>
                      old.map((x) => (x.id === item.id ? { ...x, confirmed: !x.confirmed } : x)),
                    )
                  }
                >
                  切换确认
                </button>{' '}
                <button
                  onClick={() => setObservations((old) => old.filter((x) => x.id !== item.id))}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
          <button onClick={() => void save()}>保存观察记录 JSON</button>
          <details ref={structuredEditor}>
            <summary>结构化玩法标注（实验）</summary>
            <p>
              确认初盘、固定供给、动作、测量帧和轨迹。玩法草稿与校准工程是两个独立入口；校准需要额外确认方块几何与轨迹。文字观察不会自动转成结构化标注，请核对并另存。
            </p>
            <div aria-label="观察生成检查">
              <strong>
                {blockers.length
                  ? `生成前还有 ${blockers.length} 项待处理`
                  : '确认检查已通过；生成时仍会验证玩法、轨迹和来源。'}
              </strong>
              <ul>
                {blockers.map((item, index) => (
                  <li key={index}>
                    {item.scope === 'gameplay' ? '玩法' : '校准'}：{item.message}
                  </li>
                ))}
              </ul>
              <p>
                文字笔记的确认不会代替结构化数据确认；非法放置、供给耗尽和消除不一致会由生成校验指出。
              </p>
            </div>
            <ObservedAnnotationEditor
              text={structured}
              setText={updateStructured}
              hash={hash}
              width={video.current?.videoWidth ?? 0}
              height={video.current?.videoHeight ?? 0}
              frame={frame}
              hasMeasurement={!!measurement}
              measurement={measurement}
            />
            <p>
              顶层字段：version、sourceSha256、seed、board、supply、output、actions。board 包含
              confirmed 和 8×8 cells；supply 包含 confirmed、initialUsedSlots 和每轮三个候选的
              rounds；每个候选包含 shapeId、color。output 包含 width、height、fps。每步包含
              id、confirmed、slot、row、col、pickupFrame、releaseFrame、clearFrame、clearRows、clearCols
              和 path；path 至少两点，每点包含 frame、x、y，坐标使用 0 至 1。初盘 null
              代表确认空格，未知格子不能当作空格。
            </p>
            <textarea
              aria-label="结构化玩法标注 JSON"
              value={structured}
              onChange={(e) => updateStructured(e.target.value)}
              rows={12}
            />{' '}
            <button
              onClick={() => {
                const blob = URL.createObjectURL(
                  new Blob([structured], { type: 'application/json' }),
                );
                const a = document.createElement('a');
                a.href = blob;
                a.download = 'observed-annotation-draft.json';
                a.click();
                setTimeout(() => URL.revokeObjectURL(blob), 1000);
              }}
            >
              保存标注草稿
            </button>{' '}
            <button onClick={() => void build()} disabled={!measurement}>
              检查并生成玩法草稿
            </button>
            <p>
              可选校准几何 JSON：confirmed 为 true，coordinateSystem 必须为
              design-1080x1920-piece-top-left；board 是棋盘左上 x、y 及单格尺寸，rackY、rackCell 和
              rackCenters 为候选区数据（三个横坐标可分别调整，单位为设计像素），theme 和 bestScore
              由作者指定。motions 逐动作提供 actionId、confirmed 及 points，每点包含源
              frame、方块包围盒左上角 x、y 和 cellSize，均为 1080×1920
              设计坐标。释放位置必须与目标格一致。没有消除的动作，清除帧填释放帧。
            </p>
            <label>
              校准几何与方块轨迹 JSON{' '}
              <textarea
                aria-label="校准几何与方块轨迹 JSON"
                value={geometry}
                onChange={(e) => setGeometry(invalidateObservedGeometry(e.target.value))}
                rows={10}
              />
            </label>{' '}
            <ObservationImageInputs
              disabled={!!editTemplate || building}
              savedImages={savedImages}
              onClearSaved={() => setSavedImages([])}
              imageMode={imageMode}
              onImageModeChange={setImageMode}
              onBackgroundChange={setBackground}
              onTileChange={setTile}
              onWhiteChange={setWhite}
              onCoralChange={setCoral}
              onCyanChange={setCyan}
            />
            <ObservedGeometryEditor
              mapping={mapping}
              setMapping={(value) => {
                setMapping(value);
                setPointerConfirmed(false);
                setGeometry(invalidateObservedGeometry(geometry));
              }}
              text={geometry}
              setText={setGeometry}
              annotation={structured}
              setAnnotation={updateStructured}
              url={url}
              measurement={measurement}
              frame={frame}
              width={video.current?.videoWidth ?? 0}
              height={video.current?.videoHeight ?? 0}
              onSelectFrame={setFrame}
            />
            <p>
              <label>
                <input
                  aria-label="确认圆环指针轨迹"
                  type="checkbox"
                  checked={pointerConfirmed}
                  onChange={(e) => setPointerConfirmed(e.target.checked)}
                />
                确认各动作指针路径，并使用工作台圆环标记（中心为用户标注的指针锚点；不是原生手指素材）
              </label>{' '}
              <label>
                圆环半径{' '}
                <input
                  aria-label="指针圆环半径"
                  type="number"
                  min={4}
                  max={100}
                  value={pointerRadius}
                  onChange={(e) => {
                    setPointerRadius(e.target.valueAsNumber);
                    setPointerConfirmed(false);
                  }}
                />
              </label>
              。启用需要已确认的源画面映射；生成旁车后在校准预览中载入，未载入时不会显示。
            </p>
            <ObservationAudioInputs
              disabled={!!editTemplate || building}
              savedAudio={savedAudio}
              onClearSaved={() => setSavedAudio([])}
              bgmStart={bgmStart}
              bgmOffset={bgmOffset}
              bgmGain={bgmGain}
              cueGain={cueGain}
              bgmLoop={bgmLoop}
              onBgmChange={setBgm}
              onPlacementChange={setPlacement}
              onClearCueChange={setClearCue}
              onBgmStartChange={setBgmStart}
              onBgmOffsetChange={setBgmOffset}
              onBgmGainChange={setBgmGain}
              onCueGainChange={setCueGain}
              onBgmLoopChange={setBgmLoop}
            />
            <button onClick={() => void calibrate()} disabled={!measurement || building}>
              校验并另存校准工程
            </button>
            {createdWork && onOpenCreated && (
              <button onClick={() => onOpenCreated(createdWork)}>打开刚生成的观察作品</button>
            )}
            {createdWork && onOpenCreated && (
              <p>
                打开的是上一次校验并另存的作品快照；后续标注修改需重新生成。
                {hasCurrentWork ? '当前作品有未保存修改时，切换前会提示保存。' : ''}
              </p>
            )}
            {pointerLink !== null && (
              <button
                onClick={() => {
                  const u = URL.createObjectURL(
                    new Blob([JSON.stringify(pointerLink, null, 2)], { type: 'application/json' }),
                  );
                  const a = document.createElement('a');
                  a.href = u;
                  a.download = 'observed-pointer-overlay.json';
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(u), 1000);
                }}
              >
                保存刚生成的指针旁车
              </button>
            )}
            {sourceLink !== null && (
              <button
                onClick={() => {
                  const u = URL.createObjectURL(
                    new Blob([JSON.stringify(sourceLink, null, 2)], { type: 'application/json' }),
                  );
                  const a = document.createElement('a');
                  a.href = u;
                  a.download = 'observed-source-link.json';
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(u), 1000);
                }}
              >
                保存刚生成工程的来源旁车
              </button>
            )}
            {buildStatus && <p role="status">{buildStatus}</p>}
          </details>
        </>
      )}
    </details>
  );
}
