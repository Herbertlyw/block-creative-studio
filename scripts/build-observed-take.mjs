// Experimental gameplay-only builder. It does not synchronize the renderer to reference timings.
import { createServer } from 'vite';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const [video, annotationPath, measurementPath, out] = process.argv.slice(2);
if (!video || !annotationPath || !measurementPath || !out)
  throw new Error('Usage: node build-observed-take.mjs VIDEO ANNOTATION MEASUREMENT NEW_OUTPUT');
const digest = createHash('sha256');
for await (const chunk of createReadStream(video)) digest.update(chunk);
const sourceHash = digest.digest('hex');
const annotation = JSON.parse(await readFile(annotationPath, 'utf8'));
const measurement = JSON.parse(await readFile(measurementPath, 'utf8'));
const server = await createServer({
  server: { middlewareMode: true, ws: false },
  appType: 'custom',
});
try {
  const { buildObservedTake } = await server.ssrLoadModule('/src/contracts/buildObservedTake.ts');
  const result = await buildObservedTake(
    annotation,
    measurement,
    sourceHash,
    measurement.source.width,
    measurement.source.height,
  );
  await writeFile(out, JSON.stringify(result.document, null, 2) + '\n', { flag: 'wx' });
  console.log(
    JSON.stringify(
      {
        status: 'gameplay-draft',
        sourceSha256: sourceHash,
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
