import type { AgentImageMimeType } from './contracts';

export interface InspectedImage {
  mimeType: AgentImageMimeType;
  width: number;
  height: number;
}

/** Chunked so a multi-megabyte asset does not blow the argument limit of fromCharCode. */
export function encodeBase64Bytes(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 16_384) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 16_384));
  }
  return btoa(binary);
}

export function decodeBase64Image(value: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0 || /\s/.test(value)
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('AGENT_ASSET_BASE64_INVALID');
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error('AGENT_ASSET_BASE64_INVALID');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset]! << 24) >>> 0)
    + (bytes[offset + 1]! << 16)
    + (bytes[offset + 2]! << 8)
    + bytes[offset + 3]!) >>> 0;
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index]!;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(bytes: Uint8Array): InspectedImage | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || signature.some((value, index) => bytes[index] !== value)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let chunkIndex = 0;
  let sawIdat = false;
  let sawIend = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('AGENT_ASSET_PNG_TRUNCATED');
    const length = u32be(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    if (length > 0x7fffffff || crcOffset + 4 > bytes.length) throw new Error('AGENT_ASSET_PNG_TRUNCATED');
    const typeBytes = bytes.slice(typeOffset, typeOffset + 4);
    if ([...typeBytes].some((value) => !((value >= 65 && value <= 90) || (value >= 97 && value <= 122)))) {
      throw new Error('AGENT_ASSET_PNG_CHUNK_TYPE_INVALID');
    }
    const type = String.fromCharCode(...typeBytes);
    if (crc32(bytes, typeOffset, crcOffset) !== u32be(bytes, crcOffset)) throw new Error(`AGENT_ASSET_PNG_CRC_MISMATCH: ${type}`);
    if (chunkIndex === 0 && (type !== 'IHDR' || length !== 13)) throw new Error('AGENT_ASSET_PNG_IHDR_INVALID');
    if (type === 'IHDR') {
      if (chunkIndex !== 0 || width !== 0 || length !== 13) throw new Error('AGENT_ASSET_PNG_IHDR_INVALID');
      width = u32be(bytes, dataOffset);
      height = u32be(bytes, dataOffset + 4);
      const bitDepth = bytes[dataOffset + 8]!;
      const colorType = bytes[dataOffset + 9]!;
      const validDepths: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (width === 0 || height === 0) throw new Error('AGENT_ASSET_IMAGE_DIMENSIONS_INVALID');
      if (!validDepths[colorType]?.includes(bitDepth)
        || bytes[dataOffset + 10] !== 0 || bytes[dataOffset + 11] !== 0
        || (bytes[dataOffset + 12] !== 0 && bytes[dataOffset + 12] !== 1)) {
        throw new Error('AGENT_ASSET_PNG_IHDR_INVALID');
      }
    } else if (type === 'IDAT') {
      if (length === 0) throw new Error('AGENT_ASSET_PNG_IDAT_INVALID');
      sawIdat = true;
    } else if (type === 'IEND') {
      if (length !== 0 || !sawIdat) throw new Error('AGENT_ASSET_PNG_IEND_INVALID');
      sawIend = true;
      offset = crcOffset + 4;
      if (offset !== bytes.length) throw new Error('AGENT_ASSET_PNG_TRAILING_DATA');
      break;
    }
    offset = crcOffset + 4;
    chunkIndex += 1;
  }
  if (!width || !height || !sawIdat || !sawIend) throw new Error('AGENT_ASSET_PNG_STRUCTURE_INCOMPLETE');
  return { mimeType: 'image/png', width, height };
}

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function inspectJpeg(bytes: Uint8Array): InspectedImage | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let width = 0;
  let height = 0;
  let sawSos = false;
  let sawEntropyData = false;
  let sawEoi = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('AGENT_ASSET_JPEG_MARKER_INVALID');
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) throw new Error('AGENT_ASSET_JPEG_TRUNCATED');
    const marker = bytes[offset++]!;
    if (marker === 0x00 || marker === 0xd8) throw new Error('AGENT_ASSET_JPEG_MARKER_INVALID');
    if (marker === 0xd9) {
      sawEoi = true;
      if (offset !== bytes.length) throw new Error('AGENT_ASSET_JPEG_TRAILING_DATA');
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw new Error('AGENT_ASSET_JPEG_TRUNCATED');
    const length = bytes[offset]! * 256 + bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) throw new Error('AGENT_ASSET_JPEG_TRUNCATED');
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 8) throw new Error('AGENT_ASSET_JPEG_SOF_INVALID');
      height = bytes[offset + 3]! * 256 + bytes[offset + 4]!;
      width = bytes[offset + 5]! * 256 + bytes[offset + 6]!;
      const components = bytes[offset + 7]!;
      if (length !== 8 + components * 3) throw new Error('AGENT_ASSET_JPEG_SOF_INVALID');
      if (width === 0 || height === 0) throw new Error('AGENT_ASSET_IMAGE_DIMENSIONS_INVALID');
    }
    if (marker === 0xda) {
      const components = bytes[offset + 2]!;
      if (length !== 6 + components * 2) throw new Error('AGENT_ASSET_JPEG_SOS_INVALID');
      sawSos = true;
      offset += length;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { sawEntropyData = true; offset += 1; continue; }
        if (offset + 1 >= bytes.length) throw new Error('AGENT_ASSET_JPEG_TRUNCATED');
        const next = bytes[offset + 1]!;
        if (next === 0x00) { sawEntropyData = true; offset += 2; continue; }
        if (next === 0xff) { offset += 1; continue; }
        if (next >= 0xd0 && next <= 0xd7) { offset += 2; continue; }
        break;
      }
      continue;
    }
    offset += length;
  }
  if (!width || !height) throw new Error('AGENT_ASSET_JPEG_DIMENSIONS_MISSING');
  if (!sawSos || !sawEntropyData || !sawEoi) throw new Error('AGENT_ASSET_JPEG_STRUCTURE_INCOMPLETE');
  return { mimeType: 'image/jpeg', width, height };
}

export function inspectImageBytes(bytes: Uint8Array): InspectedImage {
  const png = inspectPng(bytes);
  if (png) return png;
  const jpeg = inspectJpeg(bytes);
  if (jpeg) return jpeg;
  throw new Error('AGENT_ASSET_IMAGE_FORMAT_UNSUPPORTED');
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
