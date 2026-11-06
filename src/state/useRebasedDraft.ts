import { useEffect, useRef, useState } from 'react';

/** Follow saved values only while this field has no uncommitted local edit. */
export function useRebasedDraft<T>(saved: T) {
  const [draft, setDraft] = useState(saved);
  const previous = useRef(saved);
  useEffect(() => {
    const old = previous.current;
    setDraft((current) => (Object.is(current, old) ? saved : current));
    previous.current = saved;
  }, [saved]);
  return [draft, setDraft] as const;
}
