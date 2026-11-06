import { useCallback, useEffect, useState } from 'react';
import { NativeReplayPreview } from './NativeReplayPreview';
import { NativeV2Editor } from './NativeV2Editor';
import { NativeActionEditor } from './NativeActionEditor';
import { NativeTimedPreview } from './NativeTimedPreview';
import { NativeWorkAuthor } from './NativeWorkAuthor';
import { ReferenceVideoNotes } from './ReferenceVideoNotes';
import type { BBWorkSession } from '../state/useBBWorkSession';
import type { BBWorkPackage } from '../contracts/bbWorkPackage';

export function NativeWorkbench({ studio }: { studio: BBWorkSession }) {
  const [nativeName, setNativeName] = useState<string | null>(null);
  const [nativeError, setNativeError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, boolean>>({});
  const setEditorDraft = useCallback((editor: string, dirty: boolean) => {
    setDrafts((previous) =>
      previous[editor] === dirty ? previous : { ...previous, [editor]: dirty },
    );
  }, []);
  const [pendingLeave, setPendingLeave] = useState<
    ((expected: BBWorkPackage | null) => void) | null
  >(null);
  const nameDraft = nativeName !== null && nativeName !== studio.nativeDocument?.name;
  const editorDraft = Object.values(drafts).some(Boolean);
  useEffect(() => {
    if (!nameDraft && !editorDraft) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [nameDraft, editorDraft]);
  const requestLeave = (action: (expected: BBWorkPackage | null) => void) => {
    if (studio.dirty || nameDraft || editorDraft) setPendingLeave(() => action);
    else action(studio.nativeDocument?.work ?? null);
  };
  const saveAndLeave = async () => {
    try {
      let expected = studio.nativeDocument?.work ?? null;
      if (nameDraft && nativeName !== null)
        expected = (await studio.saveEditedNativeDocument(nativeName)) ?? null;
      else studio.saveNativeDocument();
      const action = pendingLeave;
      setPendingLeave(null);
      action?.(expected);
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : String(error));
    }
  };
  if (!studio.nativeDocument) return null;
  const current = studio.nativeDocument;
  return (
    <main className="native-document">
      <h1>BB 工作台</h1>
      {pendingLeave && (
        <div role="dialog" aria-label="未保存的修改">
          <p>作品有未保存的修改，是否先发起保存？</p>
          {editorDraft && <p>还有未应用的表单草稿，请先在相应区域应用，或放弃草稿后离开。</p>}
          <button disabled={editorDraft} onClick={() => void saveAndLeave()}>
            保存后离开
          </button>
          <button
            onClick={() => {
              const action = pendingLeave;
              setPendingLeave(null);
              action(current?.work ?? null);
            }}
          >
            放弃修改
          </button>
          <button onClick={() => setPendingLeave(null)}>取消</button>
        </div>
      )}
      <p>
        {current.file.name} {studio.dirty ? '（有未保存修改）' : ''}
        {editorDraft ? '（有未应用的表单草稿）' : ''}
      </p>
      {current.work && (
        <p>
          作品包已核验；指针和来源以作品实际保存的内容为准。
          {current.work.source?.provenance ? '这是派生作品；声明的父作品哈希未单独核验。' : ''}
          编辑另存会重新核验关联，无法安全保留时会拒绝并保留原作品。
        </p>
      )}
      <p>编辑、预览并保存当前作品；浏览器会提示保存尚未提交的修改。</p>
      <label>
        工程名称{' '}
        <input
          aria-label="V2 工程名称"
          value={nativeName ?? current.name}
          onChange={(event) => setNativeName(event.target.value)}
        />
      </label>{' '}
      <button
        className="button-secondary"
        onClick={async () => {
          try {
            await studio.saveEditedNativeDocument(nativeName ?? current.name);
            setNativeName(null);
            setNativeError('');
          } catch (error) {
            setNativeError(error instanceof Error ? error.message : '名称未保存。');
          }
        }}
      >
        保存作品名称
      </button>
      {nativeError && <p role="alert">{nativeError}</p>}
      <ReferenceVideoNotes
        currentWork={current.work}
        onDraftChange={setEditorDraft}
        onOpenCreated={(work) =>
          requestLeave((expected) => {
            try {
              studio.setNativeWork(work, 'bb-observed-work.json', expected ?? undefined, true);
              setNativeName(null);
              setNativeError('');
            } catch (error) {
              setNativeError(error instanceof Error ? error.message : String(error));
            }
          })
        }
      />
      {current.work && (
        <NativeWorkAuthor
          onDraftChange={setEditorDraft}
          work={current.work}
          selected={studio.selectedTake}
          onSelect={studio.selectTake}
          onChange={(work) =>
            studio.setNativeWork(work, current.file.name, current.work ?? undefined)
          }
        />
      )}
      {current.runtimeAudit?.validated && (
        <>
          <NativeV2Editor
            onDraftChange={setEditorDraft}
            onWorkSaved={studio.markWorkSaved}
            selectedTake={studio.selectedTake}
            onSelectTake={studio.selectTake}
            key={`v2edit-${current.file.name}`}
            document={current.document}
            text={current.text}
            fileName={current.file.name}
            work={current.work}
            onWorkChange={(work) =>
              studio.setNativeWork(work, current.file.name, current.work ?? undefined)
            }
          />
          <NativeActionEditor
            onDraftChange={setEditorDraft}
            onWorkSaved={studio.markWorkSaved}
            selectedTake={studio.selectedTake}
            onSelectTake={studio.selectTake}
            key={`action-${current.file.name}`}
            document={current.document}
            text={current.text}
            fileName={current.file.name}
            work={current.work}
            onWorkChange={(work) =>
              studio.setNativeWork(work, current.file.name, current.work ?? undefined)
            }
          />
          <NativeReplayPreview key={current.file.name} audit={current.runtimeAudit} />
        </>
      )}
      {current.runtimeAudit && (
        <NativeTimedPreview
          key="timed-preview"
          document={current.document}
          audit={current.runtimeAudit}
          work={current.work}
          selected={studio.selectedTake}
          onSelect={studio.selectTake}
        />
      )}
      <details>
        <summary>诊断信息</summary>
        <p>{current.detail}</p>
        <p>{current.schemaNote}</p>
        <h2>参考运行时校验</h2>
        {current.runtimeAudit === null ? (
          <p>非 BB 拖消工程，未运行参考校验。</p>
        ) : (
          <>
            <p>{current.runtimeAudit.message}</p>
            {current.runtimeAudit.validated && (
              <>
                <p>玩法检查不代表画面、音频和资源已验证。</p>
                {current.runtimeAudit.takes.length === 0 ? (
                  <p>没有 Take，未进行动作合法性检查。</p>
                ) : (
                  <ul>
                    {current.runtimeAudit.takes.map((take) => (
                      <li key={take.takeId}>
                        {take.takeId}：{take.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
        <h2>回放关联检查</h2>
        {current.replayIssues === null ? (
          <p>非 BB 拖消游戏，未检查回放关联。</p>
        ) : current.replayIssues.length ? (
          <ul>
            {current.replayIssues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
        ) : (
          <p>没有发现已检查的关联问题；这不代表资源或播放已验证。</p>
        )}
        <h2>已识别的依赖引用</h2>
        {current.dependencies.length === 0 ? (
          <p>未识别到资料中列出的配置引用；这不代表没有其他依赖。</p>
        ) : (
          <ul>
            {current.dependencies.map((item, index) => (
              <li key={`${item.path}-${index}`}>
                <strong>{item.path}</strong>：{item.id} — {item.detail}
              </li>
            ))}
          </ul>
        )}
        <p>
          此列表检查原工程中的引用声明，不随本次目录解析动态更新；素材实际解析结果见上方，其他扩展与素材未全部检查。
        </p>
      </details>
      <button className="button-primary" onClick={studio.saveNativeDocument}>
        保存作品
      </button>{' '}
      <button
        className="button-secondary"
        onClick={() =>
          requestLeave(() => {
            setNativeName(null);
            setNativeError('');
            studio.closeNativeDocument();
          })
        }
      >
        返回工作台
      </button>
    </main>
  );
}
