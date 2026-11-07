const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BINARY_CHUNK_TYPE = 0x004e4942;

export interface GlbInspectionLimits {
  maximumBytes: number;
  maximumNodes: number;
  maximumMeshes: number;
  maximumPrimitives: number;
  maximumMaterials: number;
  maximumTextures: number;
  maximumAnimations: number;
  maximumTriangles: number;
}

export const DEFAULT_GLB_INSPECTION_LIMITS: GlbInspectionLimits = {
  maximumBytes: 64 * 1024 * 1024,
  maximumNodes: 2_048,
  maximumMeshes: 256,
  maximumPrimitives: 1_024,
  maximumMaterials: 128,
  maximumTextures: 128,
  maximumAnimations: 512,
  maximumTriangles: 250_000,
};

export interface GlbTimeline {
  frameStart: number;
  frameEnd: number;
  frameCount: number;
  fps: number;
}

export interface GlbInspection {
  byteLength: number;
  jsonByteLength: number;
  binaryByteLength: number;
  generator?: string;
  sceneCount: number;
  nodeCount: number;
  meshCount: number;
  primitiveCount: number;
  materialCount: number;
  textureCount: number;
  imageCount: number;
  animationCount: number;
  cameraCount: number;
  uniqueTriangleCount: number;
  triangleCount: number;
  extensionsUsed: string[];
  semanticRoles: string[];
  semanticRoleCounts: Record<string, number>;
  vfxStyleCounts: Record<string, number>;
  vfxFragmentCount: number;
  entityIds: string[];
  entityIdsByRole: Record<string, string[]>;
  timeline?: GlbTimeline;
}

interface GlbDocument extends Record<string, unknown> {
  asset?: unknown;
  scene?: unknown;
  scenes?: unknown;
  nodes?: unknown;
  meshes?: unknown;
  accessors?: unknown;
  buffers?: unknown;
  bufferViews?: unknown;
  materials?: unknown;
  textures?: unknown;
  images?: unknown;
  animations?: unknown;
  cameras?: unknown;
  extensionsUsed?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(document: GlbDocument, key: keyof GlbDocument): unknown[] {
  const value = document[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`GLB JSON 的 ${String(key)} 必须是数组。`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${label} 必须是非负整数。`);
  return Number(value);
}

function timelineFromExtras(extras: Record<string, unknown>): GlbTimeline | undefined {
  const keys = ['bcs_frame_start', 'bcs_frame_end', 'bcs_frame_count', 'bcs_fps'] as const;
  if (!keys.some((key) => extras[key] !== undefined)) return undefined;
  const integer = (key: typeof keys[number]): number => {
    const value = extras[key];
    if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`GLB ${key} 必须是正整数。`);
    return Number(value);
  };
  const frameStart = integer('bcs_frame_start');
  const frameEnd = integer('bcs_frame_end');
  const frameCount = integer('bcs_frame_count');
  const fps = integer('bcs_fps');
  if (frameEnd < frameStart) throw new Error('GLB bcs_frame_end 不得早于 bcs_frame_start。');
  if (frameCount !== frameEnd - frameStart + 1) throw new Error('GLB bcs_frame_count 与首尾帧不一致。');
  if (fps > 240) throw new Error('GLB bcs_fps 超过 240fps 安全上限。');
  return { frameStart, frameEnd, frameCount, fps };
}

function requireIndex(value: unknown, length: number, label: string): number {
  const index = nonNegativeInteger(value, label);
  if (index >= length) throw new Error(`${label}=${index} 超出范围 0..${Math.max(0, length - 1)}。`);
  return index;
}

function parseDocument(bytes: Uint8Array): { document: GlbDocument; jsonByteLength: number; binaryByteLength: number } {
  if (bytes.byteLength < 12) throw new Error('GLB 文件过小，缺少 12 字节文件头。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const declaredLength = view.getUint32(8, true);
  if (magic !== GLB_MAGIC) throw new Error('文件不是有效的 GLB：magic 必须为 glTF。');
  if (version !== GLB_VERSION) throw new Error(`仅支持 GLB 2.0，当前版本为 ${version}。`);
  if (declaredLength !== bytes.byteLength) {
    throw new Error(`GLB 文件头长度 ${declaredLength} 与实际大小 ${bytes.byteLength} 不一致。`);
  }
  if (bytes.byteLength < 20) throw new Error('GLB 文件过小，缺少 JSON Chunk。');

  let offset = 12;
  let document: GlbDocument | null = null;
  let jsonByteLength = 0;
  let binaryByteLength = 0;
  let chunkIndex = 0;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new Error('GLB Chunk Header 被截断。');
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    offset += 8;
    if (chunkLength % 4 !== 0) throw new Error(`GLB Chunk ${chunkIndex} 长度必须按 4 字节对齐。`);
    if (offset + chunkLength > bytes.byteLength) throw new Error(`GLB Chunk ${chunkIndex} 超出文件边界。`);
    const chunk = bytes.subarray(offset, offset + chunkLength);
    if (chunkIndex === 0 && chunkType !== JSON_CHUNK_TYPE) {
      throw new Error('GLB 的第一个 Chunk 必须是 JSON。');
    }
    if (chunkType === JSON_CHUNK_TYPE) {
      if (document) throw new Error('GLB 只能包含一个 JSON Chunk。');
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(chunk).replace(/[\u0000\u0020]+$/u, '');
      } catch {
        throw new Error('GLB JSON Chunk 不是有效的 UTF-8。');
      }
      try {
        const parsed = JSON.parse(text) as unknown;
        if (!isRecord(parsed)) throw new Error('not an object');
        document = parsed;
      } catch {
        throw new Error('GLB JSON Chunk 无法解析。');
      }
      jsonByteLength = chunkLength;
    } else if (chunkType === BINARY_CHUNK_TYPE) {
      if (binaryByteLength > 0) throw new Error('GLB v2 只能包含一个 BIN Chunk。');
      binaryByteLength = chunkLength;
    }
    offset += chunkLength;
    chunkIndex += 1;
  }
  if (!document) throw new Error('GLB 缺少 JSON Chunk。');
  return { document, jsonByteLength, binaryByteLength };
}

function countTriangles(
  meshes: unknown[],
  accessors: unknown[],
): { trianglesByMesh: number[]; uniqueTriangleCount: number; primitiveCount: number } {
  const trianglesByMesh: number[] = [];
  let uniqueTriangleCount = 0;
  let primitiveCount = 0;
  const accessorCount = (index: unknown, label: string): number => {
    const accessor = accessors[requireIndex(index, accessors.length, label)];
    if (!isRecord(accessor)) throw new Error(`${label} 指向无效 Accessor。`);
    return nonNegativeInteger(accessor.count, `${label}.count`);
  };
  for (const [meshIndex, rawMesh] of meshes.entries()) {
    let meshTriangles = 0;
    if (!isRecord(rawMesh) || !Array.isArray(rawMesh.primitives) || rawMesh.primitives.length === 0) {
      throw new Error(`meshes[${meshIndex}].primitives 必须是非空数组。`);
    }
    for (const [primitiveIndex, rawPrimitive] of rawMesh.primitives.entries()) {
      const label = `meshes[${meshIndex}].primitives[${primitiveIndex}]`;
      if (!isRecord(rawPrimitive) || !isRecord(rawPrimitive.attributes)) {
        throw new Error(`${label} 缺少 attributes。`);
      }
      if (rawPrimitive.attributes.POSITION === undefined) throw new Error(`${label} 缺少 POSITION。`);
      const vertexCount = accessorCount(rawPrimitive.attributes.POSITION, `${label}.attributes.POSITION`);
      const elementCount = rawPrimitive.indices === undefined
        ? vertexCount
        : accessorCount(rawPrimitive.indices, `${label}.indices`);
      const mode = rawPrimitive.mode === undefined ? 4 : nonNegativeInteger(rawPrimitive.mode, `${label}.mode`);
      if (mode === 4) meshTriangles += Math.floor(elementCount / 3);
      else if (mode === 5 || mode === 6) meshTriangles += Math.max(0, elementCount - 2);
      primitiveCount += 1;
    }
    trianglesByMesh.push(meshTriangles);
    uniqueTriangleCount += meshTriangles;
  }
  return { trianglesByMesh, uniqueTriangleCount, primitiveCount };
}

function assertLimit(value: number, maximum: number, label: string): void {
  if (value > maximum) throw new Error(`GLB ${label} ${value.toLocaleString()} 超过预算 ${maximum.toLocaleString()}。`);
}

/**
 * Parses a complete GLB instead of trusting only its 12-byte header. The v1
 * browser boundary deliberately rejects external buffers and images so a
 * content-addressed GLB can never become incomplete after import.
 */
export function inspectGlbArrayBuffer(
  input: ArrayBuffer | Uint8Array,
  limits: GlbInspectionLimits = DEFAULT_GLB_INSPECTION_LIMITS,
): GlbInspection {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  assertLimit(bytes.byteLength, limits.maximumBytes, '文件字节数');
  const { document, jsonByteLength, binaryByteLength } = parseDocument(bytes);
  if (!isRecord(document.asset) || document.asset.version !== '2.0') {
    throw new Error('GLB asset.version 必须为 2.0。');
  }

  const scenes = asArray(document, 'scenes');
  const nodes = asArray(document, 'nodes');
  const meshes = asArray(document, 'meshes');
  const accessors = asArray(document, 'accessors');
  const buffers = asArray(document, 'buffers');
  const bufferViews = asArray(document, 'bufferViews');
  const materials = asArray(document, 'materials');
  const textures = asArray(document, 'textures');
  const images = asArray(document, 'images');
  const animations = asArray(document, 'animations');
  const cameras = asArray(document, 'cameras');
  if (scenes.length === 0 || nodes.length === 0 || meshes.length === 0) {
    throw new Error('3D 几何 GLB 必须至少包含一个 Scene、Node 和 Mesh。');
  }
  if (document.scene !== undefined) requireIndex(document.scene, scenes.length, 'scene');

  if (buffers.length > 1) throw new Error('自包含 GLB v1 只允许一个内嵌 Buffer。');
  if (buffers.length === 1) {
    const buffer = buffers[0];
    if (!isRecord(buffer)) throw new Error('buffers[0] 必须是对象。');
    if (buffer.uri !== undefined) throw new Error('自包含 GLB 不允许外部或 data URI Buffer。');
    const byteLength = nonNegativeInteger(buffer.byteLength, 'buffers[0].byteLength');
    if (binaryByteLength === 0 || byteLength > binaryByteLength) {
      throw new Error('GLB BIN Chunk 缺失或短于 buffers[0].byteLength。');
    }
  } else if (bufferViews.length > 0 || accessors.length > 0) {
    throw new Error('GLB Accessor/BufferView 存在，但没有内嵌 Buffer。');
  }
  for (const [index, raw] of bufferViews.entries()) {
    if (!isRecord(raw)) throw new Error(`bufferViews[${index}] 必须是对象。`);
    requireIndex(raw.buffer, buffers.length, `bufferViews[${index}].buffer`);
    nonNegativeInteger(raw.byteLength, `bufferViews[${index}].byteLength`);
  }
  for (const [index, raw] of images.entries()) {
    if (!isRecord(raw)) throw new Error(`images[${index}] 必须是对象。`);
    if (raw.uri !== undefined) throw new Error(`自包含 GLB 不允许 images[${index}].uri。`);
    if (raw.bufferView === undefined) throw new Error(`images[${index}] 必须引用内嵌 bufferView。`);
    requireIndex(raw.bufferView, bufferViews.length, `images[${index}].bufferView`);
  }
  const { trianglesByMesh, uniqueTriangleCount, primitiveCount } = countTriangles(meshes, accessors);
  let triangleCount = 0;
  for (const [index, raw] of nodes.entries()) {
    if (!isRecord(raw)) throw new Error(`nodes[${index}] 必须是对象。`);
    if (raw.mesh !== undefined) {
      const meshIndex = requireIndex(raw.mesh, meshes.length, `nodes[${index}].mesh`);
      triangleCount += trianglesByMesh[meshIndex] ?? 0;
    }
    if (raw.camera !== undefined) requireIndex(raw.camera, cameras.length, `nodes[${index}].camera`);
    if (raw.children !== undefined) {
      if (!Array.isArray(raw.children)) throw new Error(`nodes[${index}].children 必须是数组。`);
      for (const [childIndex, child] of raw.children.entries()) {
        requireIndex(child, nodes.length, `nodes[${index}].children[${childIndex}]`);
      }
    }
  }

  assertLimit(nodes.length, limits.maximumNodes, 'Node 数');
  assertLimit(meshes.length, limits.maximumMeshes, 'Mesh 数');
  assertLimit(primitiveCount, limits.maximumPrimitives, 'Primitive 数');
  assertLimit(materials.length, limits.maximumMaterials, '材质数');
  assertLimit(textures.length, limits.maximumTextures, '纹理数');
  assertLimit(animations.length, limits.maximumAnimations, '动画数');
  assertLimit(triangleCount, limits.maximumTriangles, '三角面数');

  const semanticRoles = new Set<string>();
  const semanticRoleCounts = new Map<string, number>();
  const vfxStyleCounts = new Map<string, number>();
  const entityIds = new Set<string>();
  const entityIdsByRole = new Map<string, Set<string>>();
  let vfxFragmentCount = 0;
  let timeline: GlbTimeline | undefined;
  for (const raw of nodes) {
    if (!isRecord(raw) || !isRecord(raw.extras)) continue;
    const role = typeof raw.extras.bcs_role === 'string' ? raw.extras.bcs_role : undefined;
    const id = typeof raw.extras.bcs_id === 'string' ? raw.extras.bcs_id : undefined;
    const vfxStyle = typeof raw.extras.bcs_vfx_style === 'string' ? raw.extras.bcs_vfx_style : undefined;
    if (role) {
      semanticRoles.add(role);
      semanticRoleCounts.set(role, (semanticRoleCounts.get(role) ?? 0) + 1);
    }
    if (id) entityIds.add(id);
    if (vfxStyle) vfxStyleCounts.set(vfxStyle, (vfxStyleCounts.get(vfxStyle) ?? 0) + 1);
    if (role === 'match-fragment') {
      const rawCount = raw.extras.bcs_fragment_count;
      if (rawCount === undefined) vfxFragmentCount += 1;
      else {
        if (!Number.isInteger(rawCount) || Number(rawCount) < 1 || Number(rawCount) > 4_096) {
          throw new Error('GLB bcs_fragment_count 必须是 1..4096 的整数。');
        }
        vfxFragmentCount += Number(rawCount);
      }
    }
    if (role && id) {
      const ids = entityIdsByRole.get(role) ?? new Set<string>();
      ids.add(id);
      entityIdsByRole.set(role, ids);
    }
    if (role === 'fixed-camera') {
      const candidateTimeline = timelineFromExtras(raw.extras);
      if (candidateTimeline) {
        if (timeline && JSON.stringify(timeline) !== JSON.stringify(candidateTimeline)) {
          throw new Error('GLB 包含互相冲突的固定相机时间轴元数据。');
        }
        timeline = candidateTimeline;
      }
    }
  }
  const extensionsUsed = Array.isArray(document.extensionsUsed)
    ? document.extensionsUsed.filter((value): value is string => typeof value === 'string').sort()
    : [];
  const generator = isRecord(document.asset) && typeof document.asset.generator === 'string'
    ? document.asset.generator
    : undefined;
  return {
    byteLength: bytes.byteLength,
    jsonByteLength,
    binaryByteLength,
    ...(generator !== undefined ? { generator } : {}),
    sceneCount: scenes.length,
    nodeCount: nodes.length,
    meshCount: meshes.length,
    primitiveCount,
    materialCount: materials.length,
    textureCount: textures.length,
    imageCount: images.length,
    animationCount: animations.length,
    cameraCount: cameras.length,
    uniqueTriangleCount,
    triangleCount,
    extensionsUsed,
    semanticRoles: [...semanticRoles].sort(),
    semanticRoleCounts: Object.fromEntries([...semanticRoleCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    vfxStyleCounts: Object.fromEntries([...vfxStyleCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    vfxFragmentCount,
    entityIds: [...entityIds].sort(),
    entityIdsByRole: Object.fromEntries([...entityIdsByRole.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([role, ids]) => [role, [...ids].sort()])),
    ...(timeline ? { timeline } : {}),
  };
}
