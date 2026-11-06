import type { AgentAssetProvenance } from './contracts';

export const AGENT_ASSET_PROVENANCE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: Object.fromEntries(['sourcePath', 'assetRef', 'sourceRef', 'originalSha256', 'originalMimeType', 'conversion'].map(key => [key, { type: 'string', minLength: 1, maxLength: 2048 }])),
};
export function parseAgentAssetProvenance(value: unknown): AgentAssetProvenance | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AGENT_ASSET_PROVENANCE_INVALID');
  for (const [key, raw] of Object.entries(value)) {
    if (!Object.hasOwn(AGENT_ASSET_PROVENANCE_SCHEMA.properties, key) || typeof raw !== 'string' || !raw.length || raw.length > 2048) throw new Error(`AGENT_ASSET_PROVENANCE_FIELD_INVALID: ${key}`);
    if (key === 'originalSha256' && !/^[a-f0-9]{64}$/.test(raw)) throw new Error('AGENT_ASSET_PROVENANCE_SHA256_INVALID');
  }
  return { ...value } as AgentAssetProvenance;
}
