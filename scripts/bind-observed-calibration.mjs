import { createServer } from 'vite';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const [video, annotationFile, measurementFile, geometryFile, output] = process.argv.slice(2);
if (!video || !annotationFile || !measurementFile || !geometryFile || !output)
  throw new Error('Expected VIDEO ANNOTATION MEASUREMENT GEOMETRY NEW_OUTPUT');
const hash = createHash('sha256');
for await (const bytes of createReadStream(video)) hash.update(bytes);
const digest = hash.digest('hex');
const read = async (file) => JSON.parse(await readFile(file, 'utf8'));
const [annotation, measurement, geometry] = await Promise.all([
  read(annotationFile),
  read(measurementFile),
  read(geometryFile),
]);
const server = await createServer({
  server: { middlewareMode: true, ws: false },
  appType: 'custom',
});
try {
  const { bindObservedCalibration } = await server.ssrLoadModule(
    '/src/contracts/bindObservedCalibration.ts',
  );
  const result = await bindObservedCalibration(
    annotation,
    measurement,
    digest,
    measurement.source.width,
    measurement.source.height,
    geometry,
  );
  await writeFile(output, JSON.stringify(result.document, null, 2) + '\n', { flag: 'wx' });
  console.log(
    JSON.stringify(
      {
        status: 'calibrated-procedural',
        fps: result.frameSource.fps,
        frames: result.frameSource.totalFrames,
        timing: result.timing,
        limitations: result.limitations,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
