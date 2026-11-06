import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const [workPath, video, takeId] = process.argv.slice(2);
if (!workPath || !video || !takeId) throw new Error('Expected WORK VIDEO TAKE_ID');
const work = JSON.parse(await readFile(workPath, 'utf8')),
  doc = work.format === 'bcs-bb-work' ? work.project : work;
const server = await createServer({
  logLevel: 'silent',
  server: { middlewareMode: true, ws: false },
  appType: 'custom',
});
try {
  const { compileBBTimeline } = await server.ssrLoadModule('/src/contracts/compileBBTimeline.ts');
  const { readBBTestAudio } = await server.ssrLoadModule('/src/contracts/bbSyntheticAudio.ts');
  const { makeBBConfiguredTestAudio } = await server.ssrLoadModule(
    '/src/exporter/bbSyntheticAudio.ts',
  );
  const config = readBBTestAudio(doc);
  assert.ok(config, 'work has no configured synthetic test sound');
  const source = compileBBTimeline(doc, takeId).source,
    mix = makeBBConfiguredTestAudio(source, config);
  const run = (command, args) => execFileSync(command, args, { maxBuffer: 16_000_000 });
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
  const picture = info.streams.find((item) => item.codec_type === 'video'),
    audio = info.streams.find((item) => item.codec_type === 'audio');
  assert.equal(picture.codec_name, 'h264');
  assert.equal(Number(picture.nb_read_frames), source.totalFrames);
  assert.equal(picture.r_frame_rate, `${source.fps}/1`);
  assert.equal(audio.codec_name, 'aac');
  assert.equal(audio.sample_rate, '48000');
  assert.equal(audio.channels, 1);
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
  const events = [];
  for (const event of mix.events.filter((item) => !item.truncated)) {
    const length = Math.round((event.kind === 'place' ? 0.045 : 0.09) * 48000),
      start = event.startSample;
    if (start < 150 || start + length + 150 > Math.min(mix.pcm.length, bytes.length / 4)) continue;
    let best = -Infinity,
      offset = 0;
    for (let shift = -150; shift <= 150; shift++) {
      let dot = 0;
      for (let i = 0; i < length; i += 4)
        dot += mix.pcm[start + i] * bytes.readFloatLE((start + i + shift) * 4);
      if (dot > best) {
        best = dot;
        offset = shift;
      }
    }
    let xx = 0,
      yy = 0,
      xy = 0;
    for (let i = 0; i < length; i += 4) {
      const x = mix.pcm[start + i],
        y = bytes.readFloatLE((start + i + offset) * 4);
      xx += x * x;
      yy += y * y;
      xy += x * y;
    }
    const correlation = xy / Math.sqrt(xx * yy);
    assert.ok(
      Math.abs(offset) <= 1 && correlation > 0.95,
      `${event.id} differs from the configured PCM`,
    );
    events.push({
      id: event.id,
      kind: event.kind,
      seconds: start / 48000,
      offsetSamples: offset,
      correlation,
    });
  }
  assert.ok(
    events.some((event) => event.kind === 'place') &&
      events.some((event) => event.kind === 'line-cleared' || event.kind === 'cross-cleared'),
    'need placement and clear events',
  );
  console.log(
    JSON.stringify(
      {
        takeId,
        video: picture,
        audio,
        pcmFrames: mix.pcm.length,
        decodedFrames: bytes.length / 4,
        events,
        warning: mix.warning,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
