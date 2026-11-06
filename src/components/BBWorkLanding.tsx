import { useRef, useState } from 'react';
import { ReferenceVideoNotes } from './ReferenceVideoNotes';
import type { BBWorkSession } from '../state/useBBWorkSession';

export function BBWorkLanding({ studio }: { studio: BBWorkSession }) {
  const input = useRef<HTMLInputElement>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
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
  return (
    <main className="native-document">
      <h1>BB 工作台</h1>
      <p>新建或打开作品；参考视频保留在本机，并在观察时核验身份。</p>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void studio
            .createNativeWork()
            .then(() => setError(''))
            .catch((reason: unknown) =>
              setError(reason instanceof Error ? reason.message : String(reason)),
            )
            .finally(() => setBusy(false));
        }}
      >
        新建 BB 作品
      </button>{' '}
      <button disabled={busy} onClick={() => input.current?.click()}>
        导入项目
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          void open(file);
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
          <button disabled={busy} onClick={() => void open(pending)}>
            重新打开 {pending.name}
          </button>
        )}
      </details>
      <ReferenceVideoNotes
        hasCurrentWork={false}
        onOpenCreated={(work) => {
          try {
            studio.setNativeWork(work, 'bb-observed-work.json', undefined, true);
            setError('');
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        }}
      />
    </main>
  );
}
