import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const [projectPath, video, takeId] = process.argv.slice(2);
if (!projectPath || !video || !takeId) throw new Error('Expected WORK VIDEO TAKE_ID');
const work = JSON.parse(await readFile(projectPath, 'utf8'));
const doc = work.format === 'bcs-bb-work' ? work.project : work;
const server = await createServer({
  server: { middlewareMode: true, ws: false },
  appType: 'custom',
});
try {
  const { compileNativeTake } = await server.ssrLoadModule('/src/contracts/compileNativeTake.ts');
  const { makeNativeTestAudio } = await server.ssrLoadModule('/src/exporter/nativeTestAudio.ts');
  const compiled = compileNativeTake(doc, takeId).compiled,
    { pcm, cues } = makeNativeTestAudio(compiled, 48000);
  const run = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 32_000_000 });
  const streams = JSON.parse(
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
  ).streams;
  const picture = streams.find((s) => s.codec_type === 'video'),
    audio = streams.find((s) => s.codec_type === 'audio');
  assert.equal(picture.codec_name, 'h264');
  assert.equal(Number(picture.nb_read_frames), compiled.totalFrames);
  assert.equal(picture.r_frame_rate, `${compiled.fps}/1`);
  assert.equal(audio.codec_name, 'aac');
  assert.equal(audio.sample_rate, '48000');
  assert.equal(audio.channels, 1);
  run('ffmpeg', ['-v', 'error', '-i', video, '-map', '0:v:0', '-f', 'null', '-']);
  const decoded = run('ffmpeg', [
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
  assert.ok(decoded.length / 4 >= pcm.length);
  assert.ok(cues.length >= 2);
  const events = cues.map((cue) => {
    let best = -Infinity,
      shift = 0;
    for (let offset = -150; offset <= 150; offset++) {
      let dot = 0;
      for (let n = 0; n < 1680; n += 3) {
        const sample = cue.sample + n + offset;
        if (sample >= 0 && sample < decoded.length / 4)
          dot += pcm[cue.sample + n] * decoded.readFloatLE(sample * 4);
      }
      if (dot > best) {
        best = dot;
        shift = offset;
      }
    }
    let xx = 0,
      yy = 0,
      xy = 0;
    for (let n = 0; n < 1680; n += 3) {
      const x = pcm[cue.sample + n],
        y = decoded.readFloatLE((cue.sample + n + shift) * 4);
      xx += x * x;
      yy += y * y;
      xy += x * y;
    }
    const correlation = xy / Math.sqrt(xx * yy);
    assert.ok(Math.abs(shift) <= 1 && correlation > 0.95);
    return {
      actionId: cue.actionId,
      kind: cue.kind,
      expectedFrame: cue.frame,
      expectedSeconds: cue.frame / compiled.fps,
      offsetSamples: shift,
      correlation,
    };
  });
  let tailPeak = 0;
  for (let i = Math.max(0, pcm.length - 480); i < pcm.length; i++)
    tailPeak = Math.max(tailPeak, Math.abs(decoded.readFloatLE(i * 4)));
  console.log(
    JSON.stringify(
      {
        takeId,
        video: picture,
        audio,
        expectedPcmSamples: pcm.length,
        decodedSamples: decoded.length / 4,
        tailPeak,
        events,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
