import { expect, it } from 'vitest';
import { exportBBVideo } from '../src/exporter/exportBBVideo';

it('rejects an already cancelled export before touching the canvas or encoder', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    exportBBVideo({
      canvas: {} as HTMLCanvasElement,
      width: 512,
      height: 864,
      fps: 30,
      totalFrames: 60,
      render: () => {
        throw new Error('rendered after cancellation');
      },
      audio: null,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError', message: '作品或预览设置已更改，已取消旧导出。' });
});
