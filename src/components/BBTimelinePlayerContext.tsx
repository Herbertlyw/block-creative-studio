import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useBBTimelinePlayer, type BBPreviewConfiguration } from './useBBTimelinePlayer';

type Player = ReturnType<typeof useBBTimelinePlayer>;
const Context = createContext<{
  player: Player;
  setConfiguration: (value: BBPreviewConfiguration | null) => void;
} | null>(null);

/** A work preview owns one player even when its input preparation differs. */
export function BBTimelinePlayerProvider({ children }: { children: ReactNode }) {
  const [configuration, setConfiguration] = useState<BBPreviewConfiguration | null>(null);
  const player = useBBTimelinePlayer(configuration);
  const context = useMemo(() => ({ player, setConfiguration }), [player]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

/** Register data and assets with the shared player; no second clock is created. */
export function useBBPlayerConfiguration(configuration: BBPreviewConfiguration | null): Player {
  const context = useContext(Context);
  if (!context) throw new Error('BB 播放器未初始化。');
  const { setConfiguration, player } = context;
  useEffect(() => {
    setConfiguration(configuration);
    return () => setConfiguration(null);
  }, [configuration, setConfiguration]);
  return player;
}
