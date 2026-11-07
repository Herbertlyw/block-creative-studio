import {
  DEFAULT_GLB_INSPECTION_LIMITS,
  inspectGlbArrayBuffer,
  type GlbInspection,
  type GlbInspectionLimits,
} from '../../assets/glbInspector';

export interface TapTileBlenderGlbValidation {
  inspection: GlbInspection;
  hasFixedCamera: boolean;
  tileEntityCount: number;
  effectNodeCount: number;
  effectFragmentCount: number;
}

export function validateTapTileBlenderGlb(
  source: ArrayBuffer | Uint8Array,
  limits: GlbInspectionLimits = DEFAULT_GLB_INSPECTION_LIMITS,
): TapTileBlenderGlbValidation {
  const inspection = inspectGlbArrayBuffer(source, limits);
  const hasFixedCamera = inspection.semanticRoles.includes('fixed-camera') && inspection.cameraCount > 0;
  const tileEntityCount = inspection.entityIdsByRole.tile?.length ?? 0;
  const effectNodeCount = (inspection.semanticRoleCounts['match-fragment'] ?? 0)
    + (inspection.semanticRoleCounts['match-shockwave'] ?? 0);
  if (!inspection.semanticRoles.includes('tile') || tileEntityCount === 0) {
    throw new Error('BLENDER_GLB_TAPTILE_SEMANTICS_MISSING: 缺少 tile 角色或稳定牌块 ID。');
  }
  if (!hasFixedCamera) {
    throw new Error('BLENDER_GLB_FIXED_CAMERA_MISSING: 缺少可复现导演构图的固定相机。');
  }
  return { inspection, hasFixedCamera, tileEntityCount, effectNodeCount, effectFragmentCount: inspection.vfxFragmentCount };
}

export function validateTapTileBlenderVfxGlb(
  source: ArrayBuffer | Uint8Array,
  limits: GlbInspectionLimits = DEFAULT_GLB_INSPECTION_LIMITS,
): TapTileBlenderGlbValidation {
  const inspection = inspectGlbArrayBuffer(source, limits);
  const hasFixedCamera = inspection.semanticRoles.includes('fixed-camera') && inspection.cameraCount > 0;
  const tileEntityCount = inspection.entityIdsByRole.tile?.length ?? 0;
  const effectNodeCount = (inspection.semanticRoleCounts['match-fragment'] ?? 0)
    + (inspection.semanticRoleCounts['match-shockwave'] ?? 0);
  if (!hasFixedCamera) throw new Error('BLENDER_GLB_FIXED_CAMERA_MISSING: 缺少可复现导演构图的固定相机。');
  if (effectNodeCount <= 0 || !inspection.semanticRoles.includes('match-core')) {
    throw new Error('BLENDER_VFX_OBJECTS_MISSING: GLB 不包含可叠加的三消特效对象。');
  }
  const stableRoles = ['fixed-camera', 'match-core', 'match-fragment', 'match-shockwave'];
  for (const role of stableRoles) {
    const count = inspection.semanticRoleCounts[role] ?? 0;
    const uniqueIds = inspection.entityIdsByRole[role]?.length ?? 0;
    if (count !== uniqueIds) {
      throw new Error(`BLENDER_VFX_STABLE_ID_INVALID: ${role} 的 ${count} 个节点必须各自携带唯一 bcs_id。`);
    }
  }
  const vfxIds = stableRoles.flatMap((role) => inspection.entityIdsByRole[role] ?? []);
  if (new Set(vfxIds).size !== vfxIds.length) {
    throw new Error('BLENDER_VFX_STABLE_ID_INVALID: 固定相机与特效节点的 bcs_id 不得跨角色重复。');
  }
  return { inspection, hasFixedCamera, tileEntityCount, effectNodeCount, effectFragmentCount: inspection.vfxFragmentCount };
}
