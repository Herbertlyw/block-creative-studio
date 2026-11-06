import { useEffect, useRef, useState } from 'react';

/** Track an observation separately from the current work revision. */
export function useObservationDraft(
  fingerprint: string,
  hasContent: boolean,
  report?: (editor: string, dirty: boolean) => void,
) {
  const [saved, markSaved] = useState('');
  const rebase = useRef(false),
    latest = useRef(fingerprint);
  latest.current = fingerprint;
  const dirty = hasContent && fingerprint !== saved;
  useEffect(() => {
    if (rebase.current) {
      rebase.current = false;
      markSaved(fingerprint);
      report?.('observation', false);
    } else report?.('observation', dirty);
  }, [fingerprint, dirty, report]);
  useEffect(() => () => report?.('observation', false), [report]);
  return { dirty, rebase, latest, markSaved };
}
