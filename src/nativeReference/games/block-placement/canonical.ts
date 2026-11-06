import type { AgentAssetExtensionV1 } from '../../agent-assets/contracts';
import { agentAssetExtensionContentIdentity, audioContainerContentIdentity } from '../../agent-assets/canonical';
import type { StudioProjectDocumentV2 } from '../../game-runtime/projectEnvelope';
import { legacyReferenceStyleContentIdentity } from './legacyReferenceSprites';

/**
 * Hash projection that is identical for inline base64 and referenced attachments.
 * Moving bytes with `project externalize` / `inline` must not change identity.
 */
export function canonicalBlockPlacementDocumentForHash(document: StudioProjectDocumentV2): unknown {
  const direction = document.direction;
  if (!direction) return document;
  const style = direction.style && typeof direction.style === 'object' && !Array.isArray(direction.style)
    ? direction.style as Record<string, unknown>
    : undefined;
  const production = direction.production && typeof direction.production === 'object' && !Array.isArray(direction.production)
    ? direction.production as Record<string, unknown>
    : undefined;
  const legacyStyle = style ? legacyReferenceStyleContentIdentity(style) : undefined;
  const nextStyle = legacyStyle?.agentAssets
    ? { ...legacyStyle, agentAssets: agentAssetExtensionContentIdentity(legacyStyle.agentAssets as AgentAssetExtensionV1) }
    : legacyStyle;
  const nextProduction = production?.audio !== undefined
    ? { ...production, audio: audioContainerContentIdentity(production.audio) }
    : production;
  return {
    ...document,
    direction: {
      ...direction,
      ...(nextStyle ? { style: nextStyle } : {}),
      ...(nextProduction ? { production: nextProduction } : {}),
    },
  };
}
