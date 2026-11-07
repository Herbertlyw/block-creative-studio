import { useCallback, useEffect, useRef, useState } from 'react';
import { ReferenceVideoNotes } from './ReferenceVideoNotes';
import type { BBWorkSession } from '../state/useBBWorkSession';
import type { BBWorkPackage } from '../contracts/bbWorkPackage';

type Transition =
  | { kind: 'new' }
  | { kind: 'import'; file: File }
  | { kind: 'bc' }
  | { kind: 'observed'; work: BBWorkPackage };

export function BBWorkLanding({
  studio,
  onOpenBC,
}: {
  studio: BBWorkSession;
  onOpenBC?: () => void;
}) {
  const observation = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [observationDirty, setObservationDirty] = useState(false);
  const [transition, setTransition] = useState<Transition | null>(null);
  const onDraftChange = useCallback((editor: string, dirty: boolean) => {
    if (editor === 'observation') setObservationDirty(dirty);
  }, []);
  useEffect(() => {
    if (!observationDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [observationDirty]);
  const [projectFiles, setProjectFiles] = useState<File[]>([]),
    [casFiles, setCasFiles] = useState<File[]>([]),
    [libraryFiles, setLibraryFiles] = useState<File[]>([]);
  async function open(file: File) {
    setPending(file);
    setBusy(true);
    try {
      await studio.openIfNative(file, {
        project: projectFiles,
        cas: casFiles,
        library: libraryFiles,
      });
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function perform(next: Transition) {
    if (next.kind === 'bc') {
      onOpenBC?.();
      return;
    }
    if (next.kind === 'import') return open(next.file);
    setBusy(true);
    try {
      if (next.kind === 'new') await studio.createNativeWork();
      else studio.setNativeWork(next.work, 'bb-observed-work.json', undefined, true);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  function request(next: Transition) {
    if (observationDirty) setTransition(next);
    else void perform(next);
  }
  function returnToSave() {
    setTransition(null);
    const section = observation.current?.querySelector<HTMLDetailsElement>('#bb-reference-editor');
    if (section) section.open = true;
    requestAnimationFrame(() => {
      const note = section?.querySelector<HTMLInputElement>('input[aria-label="观察内容"]');
      const save = Array.from(section?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
        (button) => button.textContent?.trim() === '保存观察记录 JSON',
      );
      (note?.value.trim() ? note : save)?.focus();
    });
  }
  return (
    <main className="native-document">
      <h1>BB 工作台</h1>
      <p>新建或打开作品；参考视频保留在本机，并在观察时核验身份。</p>
      {transition && (
        <div role="dialog" aria-modal="true" aria-label="未保存的观察草稿">
          <p>
            观察记录有未保存的内容。请返回并将文字添加到记录，再保存观察记录
            JSON；也可明确放弃后继续。
          </p>
          <button onClick={() => setTransition(null)}>取消</button>{' '}
          <button onClick={returnToSave}>返回保存</button>{' '}
          <button
            onClick={() => {
              const next = transition;
              setTransition(null);
              void perform(next);
            }}
          >
            放弃草稿并继续
          </button>
        </div>
      )}
      <button disabled={busy} onClick={() => request({ kind: 'new' })}>
        新建 BB 作品
      </button>{' '}
      <button disabled={busy} onClick={() => input.current?.click()}>
        导入项目
      </button>
      {onOpenBC && (
        <>
          {' '}
          <button disabled={busy} onClick={() => request({ kind: 'bc' })}>
            打开 BC 落消工作台
          </button>
        </>
      )}
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          request({ kind: 'import', file });
        }}
      />
      {error && <p role="alert">{error}</p>}
      <details open={!!error && !!pending}>
        <summary>工程使用外部素材时，选择对应目录</summary>
        <p>
          目录只在本机读取。按引用路径和 SHA-256 查找图片与
          WAV；成功后内嵌到当前作品，保存重开无需再选目录。原 JSON 与素材库保持不变。
        </p>
        {(
          [
            ['工程所在目录', projectFiles, setProjectFiles],
            ['CAS 素材库目录', casFiles, setCasFiles],
            ['元素库缓存目录', libraryFiles, setLibraryFiles],
          ] as const
        ).map(([label, files, set]) => (
          <p key={label}>
            <label>
              {label}{' '}
              <input
                aria-label={`导入${label}`}
                type="file"
                multiple
                disabled={busy}
                {...({ webkitdirectory: '' } as Record<string, string>)}
                onChange={(event) => {
                  set(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
            </label>{' '}
            已选择 {files.length} 个文件
          </p>
        ))}
        {pending && (
          <button disabled={busy} onClick={() => request({ kind: 'import', file: pending })}>
            重新打开 {pending.name}
          </button>
        )}
      </details>
      <div ref={observation} inert={busy || !!transition}>
        <ReferenceVideoNotes
          hasCurrentWork={false}
          onDraftChange={onDraftChange}
          onOpenCreated={(work) => request({ kind: 'observed', work })}
        />
      </div>
    </main>
  );
}
