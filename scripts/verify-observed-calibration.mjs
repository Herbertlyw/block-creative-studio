import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const [projectPath, video] = process.argv.slice(2);
if (!projectPath || !video) throw new Error('Expected PROJECT VIDEO');
const doc = JSON.parse(await readFile(projectPath, 'utf8'));
const server = await createServer({
  server: { middlewareMode: true, ws: false },
  appType: 'custom',
});
try {
  const { prepareCalibratedRenderer } = await server.ssrLoadModule(
    '/src/contracts/calibratedRenderer.ts',
  );
  const { makeCalibratedTestPcm } = await server.ssrLoadModule(
    '/src/exporter/calibratedTestAudio.ts',
  );
  const source = prepareCalibratedRenderer(doc, 'observed-take').frameSource,
    pcm = makeCalibratedTestPcm(source, 48000);
  const info = JSON.parse(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-count_frames',
      '-show_streams',
      '-of',
      'json',
      video,
    ]),
  );
  const picture = info.streams.find((x) => x.codec_type === 'video'),
    sound = info.streams.find((x) => x.codec_type === 'audio');
  assert.equal(picture.codec_name, 'h264');
  assert.equal(Number(picture.nb_read_frames), source.totalFrames);
  assert.equal(picture.r_frame_rate, `${source.fps}/1`);
  assert.equal(sound.codec_name, 'aac');
  assert.equal(sound.sample_rate, '48000');
  assert.equal(sound.channels, 1);
  execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-map', '0:v:0', '-f', 'null', '-']);
  const decoded = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', video, '-map', '0:a:0', '-f', 'f32le', '-acodec', 'pcm_f32le', '-'],
    { maxBuffer: 32_000_000 },
  );
  const events = [];
  for (let f = 0; f < source.totalFrames; f++)
    for (const event of source.evaluate(f).semanticEvents) {
      if (
        !['block-placement.placement-committed', 'block-placement.reference-clear-body'].includes(
          event.type,
        )
      )
        continue;
      const start = Math.round((f * 48000) / source.fps),
        count = 1680;
      let best = -Infinity,
        shift = 0;
      for (let d = -150; d <= 150; d++) {
        let dot = 0;
        for (let i = 0; i < count; i += 4)
          dot += pcm[start + i] * decoded.readFloatLE((start + i + d) * 4);
        if (dot > best) {
          best = dot;
          shift = d;
        }
      }
      let xx = 0,
        yy = 0,
        xy = 0;
      for (let i = 0; i < count; i += 4) {
        let x = pcm[start + i],
          y = decoded.readFloatLE((start + i + shift) * 4);
        xx += x * x;
        yy += y * y;
        xy += x * y;
      }
      const correlation = xy / Math.sqrt(xx * yy);
      assert.ok(
        Math.abs(shift) <= 1 && correlation > 0.95,
        `${event.id} shift ${shift} corr ${correlation}`,
      );
      events.push({
        id: event.id,
        frame: f,
        expectedSeconds: f / source.fps,
        shiftSamples: shift,
        correlation,
      });
    }
  assert.ok(events.length >= 2);
  console.log(
    JSON.stringify(
      { picture, sound, decodedAudioFrames: decoded.length / 4, pcmFrames: pcm.length, events },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
