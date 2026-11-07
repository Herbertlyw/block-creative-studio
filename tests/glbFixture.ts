function pad4(length: number): number {
  return (length + 3) & ~3;
}

export function createMinimalGlb(options: {
  externalBufferUri?: string;
  triangleCount?: number;
  semanticExtras?: boolean;
  nodeInstances?: number;
  fixedCamera?: boolean;
  vfxStyle?: 'burst' | 'shatter' | 'pulse';
  semanticRoles?: string[];
  semanticIds?: string[];
  vfxFragmentCount?: number;
  timeline?: { frameStart: number; frameEnd: number; frameCount: number; fps: number };
} = {}): ArrayBuffer {
  const triangleCount = options.triangleCount ?? 1;
  const vertexCount = triangleCount * 3;
  const positions = new Float32Array(vertexCount * 3);
  for (let index = 0; index < vertexCount; index += 1) {
    positions[index * 3] = index % 3 === 1 ? 1 : 0;
    positions[index * 3 + 1] = index % 3 === 2 ? 1 : 0;
    positions[index * 3 + 2] = Math.floor(index / 3) * 0.01;
  }
  const indices = new Uint32Array(vertexCount);
  for (let index = 0; index < indices.length; index += 1) indices[index] = index;
  const positionsBytes = new Uint8Array(positions.buffer);
  const indicesBytes = new Uint8Array(indices.buffer);
  const binaryLength = positionsBytes.byteLength + indicesBytes.byteLength;
  const binaryPaddedLength = pad4(binaryLength);
  const nodeInstances = options.nodeInstances ?? 1;
  const nodes: Array<Record<string, unknown>> = Array.from({ length: nodeInstances }, (_, index) => ({
    mesh: 0,
    translation: [index, 0, 0],
    ...(options.semanticExtras ? { extras: {
      bcs_id: options.semanticIds?.[index] ?? (options.semanticRoles ? `test-entity-${index}` : `test-tile-${index}`),
      bcs_role: options.semanticRoles?.[index] ?? 'tile',
      ...(options.vfxStyle ? { bcs_vfx_style: options.vfxStyle } : {}),
      ...(options.vfxFragmentCount !== undefined && (options.semanticRoles?.[index] ?? 'tile') === 'match-fragment'
        ? { bcs_fragment_count: options.vfxFragmentCount }
        : {}),
    } } : {}),
  }));
  if (options.fixedCamera) nodes.push({
    camera: 0,
    translation: [0, -10, 0],
    extras: {
      bcs_id: 'fixed-camera',
      bcs_role: 'fixed-camera',
      ...(options.timeline ? {
        bcs_frame_start: options.timeline.frameStart,
        bcs_frame_end: options.timeline.frameEnd,
        bcs_frame_count: options.timeline.frameCount,
        bcs_fps: options.timeline.fps,
      } : {}),
    },
  });
  const document = {
    asset: { version: '2.0', generator: 'BCS test fixture' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, index) => index) }],
    nodes,
    ...(options.fixedCamera ? {
      cameras: [{ type: 'orthographic', orthographic: { xmag: 5, ymag: 8, znear: 0.01, zfar: 100 } }],
    } : {}),
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3' },
      { bufferView: 1, componentType: 5125, count: vertexCount, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionsBytes.byteLength },
      { buffer: 0, byteOffset: positionsBytes.byteLength, byteLength: indicesBytes.byteLength },
    ],
    buffers: [{
      byteLength: binaryLength,
      ...(options.externalBufferUri ? { uri: options.externalBufferUri } : {}),
    }],
  };
  const encodedJson = new TextEncoder().encode(JSON.stringify(document));
  const jsonPaddedLength = pad4(encodedJson.byteLength);
  const totalLength = 12 + 8 + jsonPaddedLength + 8 + binaryPaddedLength;
  const result = new Uint8Array(totalLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonPaddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  result.fill(0x20, 20, 20 + jsonPaddedLength);
  result.set(encodedJson, 20);
  const binaryChunkOffset = 20 + jsonPaddedLength;
  view.setUint32(binaryChunkOffset, binaryPaddedLength, true);
  view.setUint32(binaryChunkOffset + 4, 0x004e4942, true);
  result.set(positionsBytes, binaryChunkOffset + 8);
  result.set(indicesBytes, binaryChunkOffset + 8 + positionsBytes.byteLength);
  return result.buffer;
}
