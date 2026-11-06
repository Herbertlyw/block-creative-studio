import { expect, it } from 'vitest';
import { sourceDesignMap, type SourceDesignMap } from '../src/contracts/sourceDesignMap';
it('maps crop corners and inverts contain, cover and stretch with offsets', () => {
  for (const mode of ['contain', 'cover', 'stretch'] as const) {
    const m: SourceDesignMap = {
        version: '1.0.0',
        mode,
        crop: { x: 100, y: 30, width: 600, height: 500 },
        x: 40,
        y: -25,
        confirmed: true,
      },
      t = sourceDesignMap(m, 800, 600);
    for (const p of [
      { x: 100, y: 30 },
      { x: 700, y: 530 },
      { x: 201, y: 322 },
    ]) {
      const q = t.sourceToDesign(p.x, p.y),
        v = t.designToSource(q.x, q.y);
      expect(v.x).toBeCloseTo(p.x, 10);
      expect(v.y).toBeCloseTo(p.y, 10);
    }
    if (mode !== 'stretch') expect(t.sx).toBe(t.sy);
  }
  expect(() =>
    sourceDesignMap(
      {
        version: '1.0.0',
        mode: 'contain',
        crop: { x: 500, y: 0, width: 500, height: 500 },
        x: 0,
        y: 0,
        confirmed: true,
      },
      800,
      600,
    ),
  ).toThrow(/裁切/);
});

it('preserves letterbox, crop and output-size conversion without changing the design mapping', () => {
  const base = {
      version: '1.0.0' as const,
      mode: 'contain' as const,
      crop: { x: 0, y: 0, width: 1920, height: 1080 },
      x: 0,
      y: 0,
      confirmed: true,
    },
    m = sourceDesignMap(base, 1920, 1080);
  expect(m.left).toBeCloseTo(0);
  expect(m.top).toBeGreaterThan(0);
  const q = m.sourceToDesign(960, 540);
  for (const size of [
    { w: 512, h: 864 },
    { w: 1080, h: 1920 },
    { w: 360, h: 640 },
  ]) {
    const out = { x: (q.x * size.w) / 1080, y: (q.y * size.h) / 1920 };
    const back = m.designToSource((out.x * 1080) / size.w, (out.y * 1920) / size.h);
    expect(back.x).toBeCloseTo(960, 9);
    expect(back.y).toBeCloseTo(540, 9);
  }
  const cover = sourceDesignMap({ ...base, mode: 'cover', x: 25, y: -40 }, 1920, 1080);
  expect(cover.left).toBeLessThan(0);
  expect(cover.top).toBeCloseTo(-40);
});
