import { useBBWorkSession } from './state/useBBWorkSession';
import { NativeWorkbench } from './components/NativeWorkbench';
import { BBWorkLanding } from './components/BBWorkLanding';

export default function App() {
  const session = useBBWorkSession();
  return session.nativeDocument ? (
    <NativeWorkbench studio={session} />
  ) : (
    <BBWorkLanding studio={session} />
  );
}
