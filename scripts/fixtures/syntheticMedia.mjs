import { deflateSync } from 'node:zlib';
import jpeg from 'jpeg-js';

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type, 'ascii'),
    out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  tag.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([tag, data])), 8 + data.length);
  return out;
}
export function syntheticPng(color, width = 16, height = 16) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = y * (1 + width * 4) + 1 + x * 4,
        shade = (x + y) % 2 ? 18 : 0;
      for (let c = 0; c < 3; c++) raw[at + c] = Math.min(255, color[c] + shade);
      raw[at + 3] = 255;
    }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export function syntheticJpeg(color, width = 64, height = 64) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let channel = 0; channel < 3; channel++) data[i * 4 + channel] = color[channel];
    data[i * 4 + 3] = 255;
  }
  return jpeg.encode({ data, width, height }, 80).data;
}
export function syntheticWav(frequency, seconds = 0.25) {
  const count = Math.round(48000 * seconds),
    bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(48000, 24);
  bytes.writeUInt32LE(96000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++)
    bytes.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * frequency) / 48000) * 6000 * (1 - i / count)),
      44 + i * 2,
    );
  return bytes;
}
