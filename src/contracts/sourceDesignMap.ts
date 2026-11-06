export type SourceDesignMap = {
  version: '1.0.0';
  mode: 'contain' | 'cover' | 'stretch';
  crop: { x: number; y: number; width: number; height: number };
  x: number;
  y: number;
  confirmed: boolean;
};
export function sourceDesignMap(map: SourceDesignMap, width: number, height: number) {
  if (
    !map ||
    typeof map !== 'object' ||
    Object.keys(map).sort().join(',') !== 'confirmed,crop,mode,version,x,y' ||
    map.version !== '1.0.0' ||
    !['contain', 'cover', 'stretch'].includes(map.mode) ||
    typeof map.confirmed !== 'boolean' ||
    !map.crop ||
    Object.keys(map.crop).sort().join(',') !== 'height,width,x,y' ||
    ![width, height, map.x, map.y, map.crop.x, map.crop.y, map.crop.width, map.crop.height].every(
      Number.isFinite,
    ) ||
    width <= 0 ||
    height <= 0 ||
    map.crop.x < 0 ||
    map.crop.y < 0 ||
    map.crop.width <= 0 ||
    map.crop.height <= 0 ||
    map.crop.x + map.crop.width > width ||
    map.crop.y + map.crop.height > height ||
    Math.abs(map.x) > 2160 ||
    Math.abs(map.y) > 3840
  )
    throw new Error('源画面裁切、比例或平移无效。');
  const { crop } = map,
    fitX = 1080 / crop.width,
    fitY = 1920 / crop.height;
  const sx =
      map.mode === 'stretch'
        ? fitX
        : map.mode === 'contain'
          ? Math.min(fitX, fitY)
          : Math.max(fitX, fitY),
    sy = map.mode === 'stretch' ? fitY : sx;
  const left = (1080 - crop.width * sx) / 2 + map.x,
    top = (1920 - crop.height * sy) / 2 + map.y;
  return {
    sx,
    sy,
    left,
    top,
    sourceToDesign: (x: number, y: number) => ({
      x: left + (x - crop.x) * sx,
      y: top + (y - crop.y) * sy,
    }),
    designToSource: (x: number, y: number) => ({
      x: crop.x + (x - left) / sx,
      y: crop.y + (y - top) / sy,
    }),
  };
}
