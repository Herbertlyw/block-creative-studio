import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { writeNewBytes } from './files';
import { mediaWindow } from './mediaContract';
import { compileBBTimeline } from '../contracts/compileBBTimeline';
import { compileBCPlayback } from '../games/block-crush/timeline';
import { hasReferenceCalibration } from '../contracts/hasReferenceCalibration';
import { productionFromDocument } from '../nativeReference/agent-director/contracts';

export class MediaCancelled extends Error {
  constructor() {
    super('CANCELLED: 已取消渲染。');
  }
}
export async function runMedia(
  game: string,
  operation: string,
  work: unknown,
  options: Record<string, unknown>,
  input: string,
  output: string,
  inputHash: string,
  isCancelled: () => boolean,
) {
  const dest = resolve(output),
    parent = await realpath(dirname(dest));
  const actual = join(parent, basename(dest));
  if (actual === (await realpath(input))) throw new Error('输出路径不能与输入相同。');
  try {
    await lstat(actual);
    throw new Error('OUTPUT_EXISTS: 输出路径已存在。');
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
  }
  const project: any = game === 'block-placement' ? (work as any).project : work;
  const take = project.takes.find((entry: any) => entry.takeId === options.takeId);
  if (!take) throw new Error('TAKE_NOT_FOUND: 指定 Take 不存在。');
  if (
    game !== 'block-placement' ||
    (!hasReferenceCalibration(project) && options.scope !== 'clip')
  ) {
    const source =
      game === 'block-placement'
        ? compileBBTimeline(project, options.takeId as string).source
        : compileBCPlayback(project, options.takeId as string, true).source;
    const range =
      operation === 'preview render'
        ? { scope: 'range', startFrame: options.frame, endFrame: options.frame }
        : options;
    mediaWindow(
      range,
      source.totalFrames,
      take,
      source.frameSourceHash,
      productionFromDocument(project)?.clips,
    );
  }
  const temp = await mkdtemp(join(tmpdir(), 'bcs-media-'));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let page: Awaited<ReturnType<NonNullable<typeof browser>['newPage']>> | undefined;
  let cancelled = isCancelled(),
    lastProgress = 0;
  const onSignal = () => {
    cancelled = true;
    if (page)
      void page
        .evaluate(async () => {
          const modulePath = '/src/cli/mediaBrowser.ts';
          const media = await import(/* @vite-ignore */ modulePath);
          media.cancel();
        })
        .catch(() => {});
  };
  process.on('SIGINT', onSignal);
  if (isCancelled()) cancelled = true;
  const progress = (value: string) => {
    const now = Date.now();
    if (!value.startsWith('渲染和编码 ') || now - lastProgress > 1000) {
      process.stderr.write(`${value}\n`);
      lastProgress = now;
    }
  };
  try {
    progress('准备本地渲染环境');
    server = await createServer({
      root,
      configFile: join(root, 'vite.config.ts'),
      cacheDir: join(temp, 'vite'),
      logLevel: 'error',
      server: { host: '127.0.0.1', port: 0, hmr: false },
    });
    if (cancelled) throw new MediaCancelled();
    await server.listen();
    try {
      browser = await chromium.launch({ channel: 'chrome', headless: true, handleSIGINT: false });
    } catch (error) {
      throw new Error(
        `CHROME_UNAVAILABLE: 无法启动本机 Chrome：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (cancelled) throw new MediaCancelled();
    page = await browser.newPage({ acceptDownloads: true });
    await page.exposeFunction('bcsProgress', progress);
    await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`);
    if (cancelled) throw new MediaCancelled();
    const pending = page.waitForEvent('download', { timeout: 0 });
    void pending.catch(() => {});
    const metadata = await page.evaluate(
      async ({ game, operation, work, options }) => {
        const modulePath = '/src/cli/mediaBrowser.ts';
        const media = await import(/* @vite-ignore */ modulePath);
        return media.run(game, operation, work, options, (message: string) => {
          void (window as any).bcsProgress(message);
        });
      },
      { game, operation, work, options },
    );
    if (cancelled) throw new MediaCancelled();
    const download = await pending;
    const temporaryFile = join(temp, operation === 'preview render' ? 'frame.png' : 'video.mp4');
    await download.saveAs(temporaryFile);
    if (cancelled) throw new MediaCancelled();
    const bytes = await readFile(temporaryFile);
    if (!bytes.length) throw new Error('MEDIA_EMPTY: 渲染输出为空。');
    progress('发布输出');
    await writeNewBytes(actual, bytes, input, () => {
      if (cancelled) throw new MediaCancelled();
    });
    process.off('SIGINT', onSignal);
    return {
      ...metadata,
      inputSha256: inputHash,
      output: actual,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (error) {
    if (cancelled) throw new MediaCancelled();
    throw error;
  } finally {
    process.off('SIGINT', onSignal);
    await Promise.allSettled([browser?.close(), server?.close()]);
    await rm(temp, { recursive: true, force: true });
  }
}
