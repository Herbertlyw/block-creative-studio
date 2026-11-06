import type { StudioProjectDocumentV2 } from './projectEnvelope';

interface SourceProject { direction?: { production?: unknown; style?: { agentAssets?: unknown } } }

/**
 * Carry the separate platform namespaces across a game-native round trip.
 *
 * Native authoring bridges rebuild `direction` from their own project model, so
 * imported asset bytes and shared production controls would silently disappear.
 * Restoring them here keeps every entry point — composed agent operations and the
 * legacy game CLI — on one behaviour instead of one path quietly losing data.
 * Clips keep their old source bindings and still fail stale checks after edits.
 */
export function restorePreservedNamespaces(
  original: unknown,
  document: StudioProjectDocumentV2 | undefined,
  options: { invalidates?: readonly string[]; nativeBridge?: boolean } = {},
): { document: StudioProjectDocumentV2 | undefined; restored: string[] } {
  const invalidates = options.invalidates ?? [];
  const source = original as SourceProject | undefined;
  const restored: string[] = [];
  let next = document;
  const controls = source?.direction?.production;
  if (next && controls !== undefined && (next.direction?.production === undefined || options.nativeBridge === true) && !invalidates.includes('direction.production')) {
    next = { ...next, direction: { ...(next.direction ?? { rhythm: {} }), production: { ...structuredClone(controls as Record<string, unknown>), ...(next.direction?.production as Record<string, unknown> ?? {}) } } };
    restored.push('direction.production');
  }
  const assets = source?.direction?.style?.agentAssets;
  const style = next?.direction?.style as Record<string, unknown> | undefined;
  if (next && assets !== undefined && style?.agentAssets === undefined && !invalidates.includes('direction.style.agentAssets')) {
    next = { ...next, direction: { ...(next.direction ?? { rhythm: {} }), style: { ...(style ?? {}), agentAssets: structuredClone(assets) } } };
    restored.push('direction.style.agentAssets');
  }
  return { document: next, restored };
}
