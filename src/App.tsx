import { lazy, Suspense, useState } from 'react';
import { useBBWorkSession } from './state/useBBWorkSession';
import { NativeWorkbench } from './components/NativeWorkbench';
import { BBWorkLanding } from './components/BBWorkLanding';

const BCWorkbench = lazy(() =>
  import('./games/block-crush/BCWorkbench').then((module) => ({ default: module.BCWorkbench })),
);

export default function App() {
  const session = useBBWorkSession();
  const [game, setGame] = useState<'bb' | 'bc'>(() =>
    window.location.hash === '#bc' ? 'bc' : 'bb',
  );
  const switchGame = (next: 'bb' | 'bc') => {
    const url = new URL(window.location.href);
    url.hash = next === 'bc' ? 'bc' : '';
    window.history.replaceState(null, '', url);
    setGame(next);
  };
  if (game === 'bc')
    return (
      <Suspense fallback={<main className="native-document">正在打开 BC 落消工作台…</main>}>
        <BCWorkbench onExit={() => switchGame('bb')} />
      </Suspense>
    );
  return session.nativeDocument ? (
    <NativeWorkbench studio={session} />
  ) : (
    <BBWorkLanding studio={session} onOpenBC={() => switchGame('bc')} />
  );
}
