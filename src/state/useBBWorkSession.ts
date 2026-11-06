import { useEffect, useRef, useState } from 'react';
import type { BrowserAssetSources } from '../contracts/browserAssetReferences';
import type { BBWorkPackage } from '../contracts/bbWorkPackage';
import { explainContractDocument } from '../contracts/validateContract';
import { editNativeName } from '../contracts/editNativeName';
import { inspectNativeReplay } from '../contracts/inspectNativeReplay';
import { inspectNativeRuntime, type NativeRuntimeAudit } from '../contracts/inspectNativeRuntime';
import {
  inspectNativeDependencies,
  type NativeDependency,
} from '../contracts/inspectNativeDependencies';
import { identifyCreativeDocument } from '../domain/projectIdentity';
import { downloadBlob } from '../utils/download';

export interface NativeDocumentState {
  file: File;
  text: string;
  document: unknown;
  work: BBWorkPackage | null;
  name: string;
  detail: string;
  schemaNote: string;
  dependencies: NativeDependency[];
  replayIssues: string[] | null;
  runtimeAudit: NativeRuntimeAudit | null;
}

/** One current BB work, independently of the legacy workbench's live state. */
export function useBBWorkSession() {
  const [nativeDocument, setNativeDocument] = useState<NativeDocumentState | null>(null);
  const [selectedTake, setSelectedTake] = useState('');
  const currentWork = useRef<BBWorkPackage | null>(null);
  const revision = useRef(0);
  const workRevision = useRef(0);
  const savedRevision = useRef(0);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const setNativeWork = (
    work: BBWorkPackage,
    fileName = 'bb-work.json',
    expected?: BBWorkPackage,
    saved = false,
  ) => {
    if (expected && currentWork.current !== expected)
      throw new Error('作品已被其他操作更新；请基于当前作品重新编辑，未覆盖新修改。');
    const document = work.project,
      text = JSON.stringify(document, null, 2),
      identity = identifyCreativeDocument(document);
    if (identity.kind !== 'placement-v2') throw new Error('仅支持 BB 作品。');
    const file = new File([JSON.stringify(work, null, 2)], fileName, { type: 'application/json' });
    const next: NativeDocumentState = {
      file,
      text,
      document,
      work,
      name:
        typeof (document as { name?: unknown }).name === 'string'
          ? (document as { name: string }).name
          : '',
      detail: identity.detail,
      schemaNote: explainContractDocument(document, identity),
      dependencies: inspectNativeDependencies(document),
      replayIssues: inspectNativeReplay(document),
      runtimeAudit: inspectNativeRuntime(document),
    };
    const ids = ((document as { takes?: Array<{ takeId: string }> }).takes ?? []).map(
      (take) => take.takeId,
    );
    setSelectedTake((current) => (ids.includes(current) ? current : (ids[0] ?? '')));
    revision.current++;
    currentWork.current = work;
    setNativeDocument(next);
    workRevision.current++;
    if (saved) savedRevision.current = workRevision.current;
    setDirty(workRevision.current !== savedRevision.current);
  };
  const openIfNative = async (file: File, sources: BrowserAssetSources = {}): Promise<boolean> => {
    const request = ++revision.current;
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      await file.arrayBuffer(),
    );
    const input = JSON.parse(text.startsWith('\ufeff') ? text.slice(1) : text) as unknown;
    const packaged = (input as { format?: unknown })?.format === 'bcs-bb-work';
    const identity = identifyCreativeDocument(packaged ? (input as BBWorkPackage).project : input);
    if (identity.kind === 'public-studio-v1')
      throw new Error('此展示版本不支持旧格式 block-creative-studio-project；原文件没有修改。');
    if (identity.kind !== 'placement-v2')
      throw new Error('此工作台只能打开 BB 作品包或可核验的 BB 工程。');
    const { importBBWorkDocument } = await import('../contracts/bbWorkPackage');
    const work = await importBBWorkDocument(input, sources);
    if (revision.current !== request) throw new Error('作品会话已更新；较早的打开操作已取消。');
    setNativeWork(
      work,
      packaged ? file.name : file.name.replace(/(\.json)?$/i, '-work.json'),
      undefined,
      packaged && JSON.stringify(input) === JSON.stringify(work),
    );
    return true;
  };
  return {
    nativeDocument,
    dirty,
    markWorkSaved: (work: BBWorkPackage) => {
      if (currentWork.current === work) {
        savedRevision.current = workRevision.current;
        setDirty(false);
      }
    },
    selectedTake,
    selectTake: (takeId: string) => {
      const ids = (
        (currentWork.current?.project as { takes?: Array<{ takeId: string }> } | undefined)
          ?.takes ?? []
      ).map((take) => take.takeId);
      if (takeId && !ids.includes(takeId)) throw new Error(`找不到 Take ${takeId}。`);
      setSelectedTake(takeId);
    },
    setNativeWork,
    openIfNative,
    createNativeWork: async () => {
      const request = ++revision.current;
      const work = await (await import('../contracts/nativeWorkAuthor')).createNativeWork();
      if (revision.current !== request) throw new Error('作品会话已更新；较早的新建操作已取消。');
      setNativeWork(work);
    },
    closeNativeDocument: () => {
      revision.current++;
      currentWork.current = null;
      setNativeDocument(null);
      setSelectedTake('');
      savedRevision.current = workRevision.current;
      setDirty(false);
    },
    saveNativeDocument: () => {
      if (nativeDocument) {
        if (currentWork.current !== nativeDocument.work)
          throw new Error('作品已更新，请重新保存。');
        downloadBlob(nativeDocument.file, nativeDocument.file.name);
        savedRevision.current = workRevision.current;
        setDirty(false);
      }
    },
    saveEditedNativeDocument: async (name: string) => {
      if (!nativeDocument) return;
      let text = editNativeName(nativeDocument.text, name);
      let savedWork = nativeDocument.work;
      if (nativeDocument.work) {
        const next = await (
          await import('../contracts/bbWorkPackage')
        ).updateBBWorkPackageProject(nativeDocument.work, JSON.parse(text));
        setNativeWork(next, nativeDocument.file.name, nativeDocument.work);
        savedWork = next;
        text = JSON.stringify(next, null, 2);
      }
      downloadBlob(
        new Blob([text], { type: 'application/json' }),
        nativeDocument.file.name.replace(/(\.json)?$/i, '-renamed.json'),
      );
      if (currentWork.current === savedWork) {
        savedRevision.current = workRevision.current;
        setDirty(false);
      }
      return savedWork;
    },
  };
}
export type BBWorkSession = ReturnType<typeof useBBWorkSession>;
