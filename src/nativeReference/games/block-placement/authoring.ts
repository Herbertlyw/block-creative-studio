import type { GameAuthoringAdapter, GameAuthoringResult } from '../../game-runtime/authoringRegistry';
import type { AgentOperationResult } from '../../game-runtime/agentOperations';
import type { StudioProjectDocumentV2 } from '../../game-runtime/projectEnvelope';
import { externalizeStudioDocumentAssets, inlineStudioDocumentAssets } from '../../agent-assets/payloadRefs';
import { readAgentAssetExtension } from '../../agent-assets/storage';
import { parseProductionDirection } from '../../agent-director/contracts';
import { stableHash } from '../../headless/stableHash';
import { blockPlacementAgentAdapter } from './agent';
import { canonicalBlockPlacementDocumentForHash } from './canonical';
import { hydrateLegacyReferenceSprites, legacyReferenceStyleContentIdentity } from './legacyReferenceSprites';

function call(id: string, project?: unknown, recipe?: unknown): AgentOperationResult {
  const result = blockPlacementAgentAdapter.operations.find(operation => operation.id === id)!.execute({
    ...(project === undefined ? {} : { project }),
    ...(recipe === undefined ? {} : { recipe }),
  });
  if (result instanceof Promise) throw new Error('BLOCK_PLACEMENT_AUTHORING_REQUIRES_SYNC_ATOM');
  return result;
}

function readDocument(source: unknown): StudioProjectDocumentV2 {
  const result = call('project inspect', source);
  if (!result.ok || !result.document) throw new Error(JSON.stringify(result.report));
  readAgentAssetExtension(result.document);
  if (result.document.direction?.production) parseProductionDirection(result.document.direction.production);
  return result.document;
}

function assetResult(document: StudioProjectDocumentV2, before: string, report: Record<string, unknown>): GameAuthoringResult {
  const validated = readDocument(document);
  const after = stableHash(canonicalBlockPlacementDocumentForHash(validated));
  if (after !== before) throw new Error('ASSET_REF_IDENTITY_CHANGED');
  return { ok: true, document: validated, report: {
    ...report, contentIdentityVersion: 1, projectHash: after, identityUnchanged: true,
    gameUnchanged: true, takesUnchanged: true,
  } };
}

/** Reuse the platform attachment protocol; runtime rendering still consumes resolved bytes. */
export const blockPlacementAuthoring: GameAuthoringAdapter = {
  gameId: 'block-placement',
  catalog: () => call('catalog get').report,
  generate: recipe => call('project create', undefined, recipe),
  inspect: project => call('project inspect', project),
  evaluate: project => call('production validate', project),
  validate: project => call('project validate', project),
  validateTake: (project, options) => call('take validate', project, options),
  retime: (project, options) => call('director retime', project, options),
  async externalizeAssets(source, write) {
    const document = readDocument(source);
    const before = stableHash(canonicalBlockPlacementDocumentForHash(document));
    // Reopened historical projects contain the exact inline URI required by their
    // frozen renderer. Restore only matching declared aliases before moving the
    // corresponding entry bytes; otherwise the URI loses its identity projection
    // once that entry becomes a ref. Keep the caller's hydrated document intact.
    const storageDocument = structuredClone(document);
    if (storageDocument.direction?.style) {
      storageDocument.direction.style = legacyReferenceStyleContentIdentity(storageDocument.direction.style as Record<string, unknown>);
    }
    const result = await externalizeStudioDocumentAssets(storageDocument, write);
    return assetResult(result.document, before, { operation: 'project externalize', ...result.report });
  },
  async inlineAssets(source, read) {
    const document = readDocument(source);
    const before = stableHash(canonicalBlockPlacementDocumentForHash(document));
    const result = await inlineStudioDocumentAssets(document, read);
    const legacySpritesHydrated = await hydrateLegacyReferenceSprites(result.document);
    return assetResult(result.document, before, { operation: 'project inline', ...result.report,
      ...(legacySpritesHydrated ? { legacySpritesHydrated } : {}) });
  },
};
