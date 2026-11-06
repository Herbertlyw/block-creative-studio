import type { AgentAssetSlotDeclaration, AgentImageBinding, AgentImageTransform } from './contracts';

export const AGENT_IMAGE_TRANSFORM_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    x: { type: 'number', minimum: -1, maximum: 2 }, y: { type: 'number', minimum: -1, maximum: 2 },
    width: { type: 'number', exclusiveMinimum: 0, maximum: 16 }, height: { type: 'number', exclusiveMinimum: 0, maximum: 16 },
    anchorX: { type: 'number', minimum: 0, maximum: 1 }, anchorY: { type: 'number', minimum: 0, maximum: 1 },
    clipRadius: { type: 'number', minimum: 0, maximum: .5 },
    rotationDeg: { type: 'number', minimum: -360, maximum: 360 },
    layer: { type: 'integer', minimum: 0, maximum: 100 }, visible: { type: 'boolean' },
  },
} as const;

export function parseAgentImageTransform(value: unknown): AgentImageTransform | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AGENT_ASSET_TRANSFORM_INVALID');
  const source = value as Record<string, unknown>;
  for (const [key, raw] of Object.entries(source)) {
    if (!Object.hasOwn(AGENT_IMAGE_TRANSFORM_SCHEMA.properties, key)) throw new Error(`AGENT_ASSET_TRANSFORM_FIELD_UNKNOWN: ${key}`);
    if (key === 'visible') { if (typeof raw !== 'boolean') throw new Error('AGENT_ASSET_TRANSFORM_VISIBLE_INVALID'); continue; }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`AGENT_ASSET_TRANSFORM_NUMBER_INVALID: ${key}`);
    const schema = AGENT_IMAGE_TRANSFORM_SCHEMA.properties[key as Exclude<keyof AgentImageTransform, 'visible'>];
    if (('minimum' in schema && raw < schema.minimum) || ('exclusiveMinimum' in schema && raw <= schema.exclusiveMinimum)
      || raw > schema.maximum || (key === 'layer' && !Number.isInteger(raw))) throw new Error(`AGENT_ASSET_TRANSFORM_RANGE_INVALID: ${key}`);
  }
  return { ...source } as AgentImageTransform;
}

/** Used both at mutation and render resolution, so hand-edited projects cannot bypass slot limits. */
export function validateAgentImageBinding(binding: AgentImageBinding, slot: AgentAssetSlotDeclaration): void {
  if (!slot.allowedFits.includes(binding.fit)) throw new Error(`AGENT_ASSET_FIT_UNSUPPORTED_FOR_SLOT: ${slot.slotId}`);
  if (!slot.allowedBlendModes.includes(binding.blendMode)) throw new Error(`AGENT_ASSET_BLEND_UNSUPPORTED_FOR_SLOT: ${slot.slotId}`);
  if (!Number.isFinite(binding.opacity) || binding.opacity < 0 || binding.opacity > 1) throw new Error('AGENT_ASSET_OPACITY_INVALID');
  if (!Number.isFinite(binding.inset) || binding.inset < 0 || binding.inset > 0.45) throw new Error('AGENT_ASSET_INSET_INVALID');
  if (!slot.allowInset && binding.inset !== 0) throw new Error(`AGENT_ASSET_INSET_UNSUPPORTED_FOR_SLOT: ${slot.slotId}`);
  const transform = parseAgentImageTransform(binding.transform);
  for (const key of Object.keys(transform ?? {})) if (!slot.transform?.allowed.includes(key as keyof AgentImageTransform)) {
    throw new Error(`AGENT_ASSET_TRANSFORM_UNSUPPORTED_FOR_SLOT: ${slot.slotId}.${key}`);
  }
}
