import type { CSSProperties } from 'react';
import type { ResolvedTileVisual } from './types';

type VisualStyle = CSSProperties & Record<`--${string}`, string | number>;

export function TileVisual({ visual }: { visual: ResolvedTileVisual }) {
  const style: VisualStyle = {
    '--tile-visual-fill': visual.bodyStyle.fill ?? '#fff7e7',
    '--tile-visual-radius': `${visual.bodyStyle.cornerRadiusPx}px`,
    '--tile-visual-border': `${visual.bodyStyle.borderWidthPx}px`,
    '--tile-role-scale': visual.roleScale,
    ...(visual.bodyAsset?.uri ? { '--tile-body-image': `url("${visual.bodyAsset.uri}")` } : {}),
  };
  return (
    <span
      className={`tpt-tile-visual mode-${visual.renderedFace.mode} material-${visual.material}`}
      data-presentation-role={visual.role}
      data-tile-material={visual.material}
      data-visual-archetype={visual.archetype.id}
      data-visual-identity={visual.identityHash}
      data-face-assembly={visual.faceAssembly.id}
      data-body-style={visual.bodyStyle.id}
      style={style}
    >
      {visual.renderedFace.parts.map((part) => {
        const partStyle: CSSProperties = {
          left: `${part.transform.x * 100}%`,
          top: `${part.transform.y * 100}%`,
          width: `${Math.abs(part.transform.scaleX) * 100}%`,
          height: `${Math.abs(part.transform.scaleY) * 100}%`,
          opacity: part.transform.opacity,
          transform: `translate(-50%, -50%) rotate(${part.transform.rotationDeg}deg)`,
        };
        return (
          <span key={part.id} className="tpt-face-part" style={partStyle}>
            {part.source.kind === 'glyph'
              ? <span className="tpt-face-glyph">{part.source.value}</span>
              : part.source.asset.uri
                ? <img src={part.source.asset.uri} alt="" draggable={false} />
                : <span className="tpt-face-missing" title={`IndexedDB asset ${part.source.assetId} 尚未加载`}>!</span>}
          </span>
        );
      })}
    </span>
  );
}
