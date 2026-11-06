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
  const { compileNativeProductionAudio } = await server.ssrLoadModule(
    '/src/contracts/nativeProductionAudio.ts',
  );
  const source = prepareCalibratedRenderer(doc, 'observed-take').frameSource,
    mix = await compileNativeProductionAudio(doc, source);
  const run = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 16_000_000 });
  const info = JSON.parse(
    run('ffprobe', [
      '-v',
      'error',
      '-count_frames',
      '-show_entries',
      'stream=codec_type,codec_name,width,height,r_frame_rate,nb_read_frames,duration,sample_rate,channels',
      '-of',
      'json',
      video,
    ]),
  );
  const pic = info.streams.find((s) => s.codec_type === 'video'),
    aud = info.streams.find((s) => s.codec_type === 'audio');
  assert.equal(pic.codec_name, 'h264');
  assert.equal(Number(pic.nb_read_frames), source.totalFrames);
  assert.equal(pic.r_frame_rate, `${source.fps}/1`);
  assert.equal(aud.codec_name, 'aac');
  assert.equal(aud.sample_rate, '48000');
  assert.equal(aud.channels, 2);
  run('ffmpeg', ['-v', 'error', '-i', video, '-map', '0:v:0', '-f', 'null', '-']);
  const bytes = run('ffmpeg', [
    '-v',
    'error',
    '-i',
    video,
    '-map',
    '0:a:0',
    '-f',
    'f32le',
    '-acodec',
    'pcm_f32le',
    '-',
  ]);
  const pcm = mix.track.data,
    events = [];
  for (const cue of mix.scheduledCues) {
    let best = -Infinity,
      offset = 0;
    for (let shift = -150; shift <= 150; shift++) {
      let dot = 0;
      for (let i = 0; i < cue.durationSamples; i += 6)
        dot +=
          pcm[(cue.startSample + i) * 2] * bytes.readFloatLE((cue.startSample + i + shift) * 8);
      if (dot > best) {
        best = dot;
        offset = shift;
      }
    }
    let xx = 0,
      yy = 0,
      xy = 0;
    for (let i = 0; i < cue.durationSamples; i += 6) {
      const x = pcm[(cue.startSample + i) * 2],
        y = bytes.readFloatLE((cue.startSample + i + offset) * 8);
      xx += x * x;
      yy += y * y;
      xy += x * y;
    }
    const correlation = xy / Math.sqrt(xx * yy);
    assert.ok(Math.abs(offset) <= 1 && correlation > 0.95 && !cue.truncated);
    events.push({
      id: cue.eventId,
      time: cue.startSample / 48000,
      offsetSamples: offset,
      correlation,
    });
  }
  assert.ok(events.length >= 2);
  console.log(
    JSON.stringify(
      {
        video: pic,
        audio: aud,
        pcmFrames: pcm.length / 2,
        decodedFrames: bytes.length / 8,
        events,
        warnings: mix.diagnostics,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
