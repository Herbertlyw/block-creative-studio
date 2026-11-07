import { lazy, Suspense, useState } from 'react';

const BlockCreativeWorkspace = lazy(async () => {
  const module = await import('./BlockCreativeWorkspace');
  return { default: module.BlockCreativeWorkspace };
});

const TapTileStackStudio = lazy(async () => {
  const module = await import('./taptile/TapTileStackStudio');
  return { default: module.TapTileStackStudio };
});

function WorkspaceFallback() {
  return (
    <div className="workspace-loading" role="status" aria-live="polite">
      <span className="workspace-loading__pulse" />
      <span>正在载入工作台…</span>
    </div>
  );
}

export default function App() {
  const [workspace, setWorkspace] = useState<'taptile' | 'block'>(() =>
    window.location.hash === '#block' ? 'block' : 'taptile',
  );

  return (
    <Suspense fallback={<WorkspaceFallback />}>
      {workspace === 'block' ? (
        <BlockCreativeWorkspace onOpenTapTile={() => {
          window.location.hash = 'taptile';
          setWorkspace('taptile');
        }} />
      ) : (
        <TapTileStackStudio onOpenBlockStudio={() => {
          window.location.hash = 'block';
          setWorkspace('block');
        }} />
      )}
    </Suspense>
  );
}
