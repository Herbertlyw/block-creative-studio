import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadBlob } from '../../utils/download';
import type { BCProject } from './document';

/** One document, bounded undo history, and explicit save/leave ownership. */
export function useBCSession() {
  const [project, setProject] = useState<BCProject | null>(null);
  const current = useRef(project),
    generation = useRef(0);
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState<BCProject[]>([]);
  const update = useCallback((next: BCProject, expected?: BCProject, opened = false) => {
    if (expected && current.current !== expected)
      throw new Error('作品已更新，较早的编辑未覆盖当前内容。');
    generation.current++;
    const previous = current.current;
    current.current = next;
    setProject(next);
    setHistory((items) => (opened ? [] : previous ? [...items.slice(-4), previous] : items));
    setDirty(!opened);
  }, []);
  const perform = useCallback(
    async (operation: (project: BCProject) => BCProject | Promise<BCProject>) => {
      const base = current.current;
      if (!base) throw new Error('请先打开工程。');
      const ticket = ++generation.current;
      const next = await operation(base);
      if (ticket !== generation.current) throw new Error('作品已更新，已取消较早的编辑。');
      update(next, base);
    },
    [update],
  );
  const save = useCallback(() => {
    if (!current.current) return;
    const name = current.current.name.replace(/[\\/:*?"<>|]/g, '-');
    downloadBlob(
      new Blob([JSON.stringify(current.current, null, 2)], { type: 'application/json' }),
      `${name || 'bc-project'}.json`,
    );
    setDirty(false);
  }, []);
  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    generation.current++;
    current.current = previous;
    setProject(previous);
    setHistory((items) => items.slice(0, -1));
    setDirty(true);
  }, [history]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  return {
    project,
    current,
    generation,
    dirty,
    update,
    perform,
    save,
    undo,
    canUndo: history.length > 0,
  };
}
