import type { CompiledTapTileLevel, OutroPack, TapTilePresentationRole, TapTileProjectV2 } from '../project';
import type { TapTilePresentationFrame } from '../director';
import {
  normalizeTapTileTrayBounds,
  TAPTILE_TRAY_CAPACITY,
  tapTileTraySlotCenter,
  tapTileTraySlotRect,
} from '../trayLayout';
import { resolveStageAssembly, resolveTileVisual, type ResolvedTileVisual } from '../visual';
import { tapTileMaterialAppearance } from '../visual/materialAppearance';
import { TAPTILE_POINTER_ASSET_ID } from '../presentation/assets';
import type { TapTileAssetCache } from './AssetCache';

export const TAPTILE_Z_BANDS = Object.freeze({
  base: 0,
  ambient: 10,
  board: 20,
  boardFeedback: 30,
  moving: 40,
  tray: 50,
  pointer: 60,
  matchVfx: 70,
  praiseWarning: 80,
  hud: 90,
  outro: 100,
} as const);

export interface CanvasRenderTraceItem {
  band: number;
  id: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface CanvasRenderTrace {
  frameNumber: number;
  width: number;
  height: number;
  items: CanvasRenderTraceItem[];
}

export interface TapTileCanvasRenderBundle {
  project: TapTileProjectV2;
  level: CompiledTapTileLevel;
  assets: TapTileAssetCache;
}

export interface TapTileCanvasRenderOptions {
  pixelScale?: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutBack(value: number): number {
  const t = clamp01(value) - 1;
  return 1 + 2.70158 * t ** 3 + 1.70158 * t ** 2;
}

/**
 * Draws praise as a screen-space feedback layer. Export with Blender calls this
 * a second time after the transparent 3D pass, while suppressing it in the base
 * pass, so ceramic fragments never cover the message.
 */
export function renderTapTilePraiseOverlay(
  canvas: HTMLCanvasElement,
  frame: TapTilePresentationFrame,
  bundle: TapTileCanvasRenderBundle,
  options: TapTileCanvasRenderOptions = {},
): CanvasRenderTraceItem[] {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('CANVAS_2D_CONTEXT_UNAVAILABLE');
  const pixelScale = Math.max(1, Math.min(2, options.pixelScale ?? 1));
  const width = bundle.project.stage.exportWidth;
  const tray = normalizeTapTileTrayBounds(bundle.project.stage.safeAreas.tray);
  const items: CanvasRenderTraceItem[] = [];
  context.save();
  context.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
  for (const effect of frame.effects.filter((candidate) => candidate.kind === 'match' && candidate.praiseLabel)) {
    const enter = clamp01((effect.progress - 0.16) / 0.18);
    const exit = 1 - clamp01((effect.progress - 0.72) / 0.28);
    const opacity = Math.min(enter, exit);
    if (opacity <= 0) continue;
    const label = `${effect.praiseLabel!.replace(/!+$/u, '')}!`;
    const scale = 0.7 + easeOutBack(enter) * 0.3;
    const y = tray.bottom + 72 - (1 - enter) * 18;
    context.save();
    context.translate(width / 2, y);
    context.scale(scale, scale);
    context.globalAlpha = opacity;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '900 70px "Arial Rounded MT Bold", "Trebuchet MS", "Segoe UI", sans-serif';
    context.lineJoin = 'round';
    context.lineWidth = 15;
    context.strokeStyle = 'rgba(255, 255, 255, 0.98)';
    context.strokeText(label, 0, 0);
    context.lineWidth = 8;
    context.strokeStyle = '#168f45';
    context.shadowColor = 'rgba(87, 255, 142, 0.82)';
    context.shadowBlur = 24;
    context.strokeText(label, 0, 0);
    const gradient = context.createLinearGradient(0, -42, 0, 38);
    gradient.addColorStop(0, '#f6ff9a');
    gradient.addColorStop(0.46, '#8dff76');
    gradient.addColorStop(1, '#35ce68');
    context.fillStyle = gradient;
    context.shadowBlur = 15;
    context.fillText(label, 0, 0);
    context.restore();
    items.push({
      band: TAPTILE_Z_BANDS.praiseWarning,
      id: `praise:${effect.id}`,
      bounds: { x: 270, y: Math.round(y - 58), width: 540, height: 116 },
    });
  }
  context.restore();
  return items;
}

function round(value: number): number {
  return Math.round(value);
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const safe = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + safe, y);
  context.lineTo(x + width - safe, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safe);
  context.lineTo(x + width, y + height - safe);
  context.quadraticCurveTo(x + width, y + height, x + width - safe, y + height);
  context.lineTo(x + safe, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safe);
  context.lineTo(x, y + safe);
  context.quadraticCurveTo(x, y, x + safe, y);
  context.closePath();
}

function drawCover(context: CanvasRenderingContext2D, image: CanvasImageSource, x: number, y: number, width: number, height: number): void {
  context.drawImage(image, round(x), round(y), round(width), round(height));
}

function drawMatchFracture(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  progress: number,
  variant: number,
): void {
  const appear = clamp01((progress - 0.07) / 0.24);
  const disappear = 1 - clamp01((progress - 0.69) / 0.31);
  const alpha = Math.min(appear, disappear);
  if (alpha <= 0) return;
  context.save();
  roundedRect(context, centerX - width * 0.48, centerY - height * 0.48, width * 0.96, height * 0.96, 15);
  context.clip();
  context.globalAlpha = alpha * 0.76;
  context.fillStyle = '#fffdf5';
  context.fillRect(centerX - width / 2, centerY - height / 2, width, height);
  context.translate(centerX + ((variant % 3) - 1) * width * 0.035, centerY - height * 0.04);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const rayCount = 6;
  for (let ray = 0; ray < rayCount; ray += 1) {
    const angle = -Math.PI * 0.92 + ray * (Math.PI * 1.84 / (rayCount - 1)) + ((variant + ray) % 3 - 1) * 0.1;
    const radius = width * (0.28 + ((variant * 7 + ray * 5) % 9) * 0.021);
    const midX = Math.cos(angle) * radius * 0.52 + Math.sin(angle * 2 + variant) * 7;
    const midY = Math.sin(angle) * radius * 0.52 + Math.cos(angle * 1.7 + variant) * 5;
    const endX = Math.cos(angle) * radius;
    const endY = Math.sin(angle) * radius;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(midX, midY);
    context.lineTo(endX, endY);
    context.globalAlpha = alpha * 0.8;
    context.strokeStyle = 'rgba(255, 255, 255, 0.96)';
    context.lineWidth = 5;
    context.stroke();
    context.globalAlpha = alpha * 0.68;
    context.strokeStyle = 'rgba(85, 124, 143, 0.84)';
    context.lineWidth = 1.8;
    context.stroke();
    if (ray % 2 === 0) {
      context.beginPath();
      context.moveTo(midX, midY);
      context.lineTo(midX + Math.cos(angle + 1.02) * radius * 0.24, midY + Math.sin(angle + 1.02) * radius * 0.24);
      context.stroke();
    }
  }
  context.restore();
}

function drawMaterialCastShadow(
  context: CanvasRenderingContext2D,
  material: ReturnType<typeof tapTileMaterialAppearance>,
  role: TapTilePresentationRole,
  width: number,
  height: number,
  elevationRank: number,
): void {
  const shortestSide = Math.min(width, height);
  const safeRank = Math.min(4, Math.max(0, elevationRank));
  context.save();
  context.shadowColor = role === 'match-ghost' ? 'rgba(96, 255, 169, 0.92)' : material.shadowColor;
  context.shadowBlur = shortestSide * (material.shadowBlurRatio + safeRank * 0.0025);
  context.shadowOffsetX = shortestSide * 0.01;
  context.shadowOffsetY = shortestSide * (0.026 + safeRank * 0.006);
  context.fillStyle = role === 'match-ghost' ? 'rgba(96, 255, 169, 0.12)' : 'rgba(5, 18, 43, 0.07)';
  roundedRect(context, -width / 2, -height / 2, width, height, shortestSide * material.radiusRatio);
  context.fill();
  context.restore();
}

function drawTileMaterial(
  context: CanvasRenderingContext2D,
  bundle: TapTileCanvasRenderBundle,
  visual: ResolvedTileVisual,
  role: TapTilePresentationRole,
  width: number,
  height: number,
  castShadow = true,
  elevationRank = 0,
): number {
  const material = tapTileMaterialAppearance(visual.material);
  const shortestSide = Math.min(width, height);
  const radius = shortestSide * material.radiusRatio;
  const surfaceOffsetY = height * material.surfaceOffsetYRatio;
  const edgeDepth = Math.max(2, height * material.edgeDepthRatio);
  const left = -width / 2;
  const top = -height / 2;
  const surfaceTop = top + surfaceOffsetY;
  const surfaceHeight = Math.max(1, height - edgeDepth - Math.max(0, surfaceOffsetY));

  if (castShadow) drawMaterialCastShadow(context, material, role, width, height, elevationRank);

  context.fillStyle = material.edgeColor;
  roundedRect(context, left, top, width, height, radius);
  context.fill();

  const surface = context.createLinearGradient(left, surfaceTop, width / 2, surfaceTop + surfaceHeight);
  for (const [offset, color] of material.fillStops) surface.addColorStop(offset, color);
  context.fillStyle = surface;
  roundedRect(context, left, surfaceTop, width, surfaceHeight, radius);
  context.fill();

  const bodyImage = visual.bodyStyle.bodyAssetId ? bundle.assets.get(visual.bodyStyle.bodyAssetId) : undefined;
  if (bodyImage) {
    context.save();
    roundedRect(context, left, surfaceTop, width, surfaceHeight, radius);
    context.clip();
    context.globalAlpha *= material.textureOpacity;
    drawCover(context, bodyImage, left, surfaceTop, width, surfaceHeight);
    context.restore();
  }

  context.save();
  context.shadowColor = 'transparent';
  context.lineWidth = Math.max(1.5, visual.bodyStyle.borderWidthPx * 0.72);
  context.strokeStyle = material.borderColor;
  roundedRect(context, left, surfaceTop, width, surfaceHeight, radius);
  context.stroke();
  if (role !== 'tray') {
    const highlightInset = shortestSide * material.highlightInsetRatio;
    context.lineWidth = Math.max(1, shortestSide * material.highlightWidthRatio);
    context.strokeStyle = material.highlightColor;
    roundedRect(
      context,
      left + highlightInset,
      surfaceTop + highlightInset,
      width - highlightInset * 2,
      surfaceHeight - highlightInset * 2,
      Math.max(0, radius - highlightInset * 0.45),
    );
    context.stroke();
  }
  context.restore();
  return surfaceOffsetY - edgeDepth / 2;
}

function drawTileCastShadow(
  context: CanvasRenderingContext2D,
  bundle: TapTileCanvasRenderBundle,
  archetypeId: string,
  role: TapTilePresentationRole,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  rotationDeg: number,
  elevationRank: number,
): void {
  const visual = resolveTileVisual(bundle.project, archetypeId, bundle.project.visuals.selectedThemeId, role);
  const drawWidth = round(width * visual.roleScale);
  const drawHeight = round(height * visual.roleScale);
  const material = tapTileMaterialAppearance(visual.material);
  context.save();
  context.translate(round(centerX), round(centerY));
  context.rotate(rotationDeg * Math.PI / 180);
  drawMaterialCastShadow(context, material, role, drawWidth, drawHeight, elevationRank);
  context.restore();
}

function drawTile(
  context: CanvasRenderingContext2D,
  bundle: TapTileCanvasRenderBundle,
  archetypeId: string,
  role: TapTilePresentationRole,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  rotationDeg: number,
  scale = 1,
  opacity = 1,
  castShadow = true,
  elevationRank = 0,
): ResolvedTileVisual {
  const visual = resolveTileVisual(bundle.project, archetypeId, bundle.project.visuals.selectedThemeId, role);
  const drawWidth = round(width * scale * visual.roleScale);
  const drawHeight = round(height * scale * visual.roleScale);
  context.save();
  context.globalAlpha = opacity;
  context.translate(round(centerX), round(centerY));
  context.rotate(rotationDeg * Math.PI / 180);
  const surfaceOffsetY = drawTileMaterial(context, bundle, visual, role, drawWidth, drawHeight, castShadow, elevationRank);

  context.save();
  roundedRect(
    context,
    -drawWidth / 2,
    -drawHeight / 2,
    drawWidth,
    drawHeight,
    Math.min(drawWidth, drawHeight) * tapTileMaterialAppearance(visual.material).radiusRatio,
  );
  context.clip();
  for (const part of visual.renderedFace.parts) {
    const partWidth = Math.abs(part.transform.scaleX) * drawWidth;
    const partHeight = Math.abs(part.transform.scaleY) * drawHeight;
    const x = (part.transform.x - 0.5) * drawWidth;
    const y = (part.transform.y - 0.5) * drawHeight + surfaceOffsetY;
    context.save();
    context.globalAlpha *= part.transform.opacity;
    context.translate(round(x), round(y));
    context.rotate(part.transform.rotationDeg * Math.PI / 180);
    if (part.source.kind === 'glyph') {
      context.font = `${Math.max(12, round(Math.min(partWidth, partHeight) * 0.82))}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = '#17233a';
      context.fillText(part.source.value, 0, round(partHeight * 0.04));
    } else {
      const image = bundle.assets.get(part.source.assetId);
      if (image) drawCover(context, image, -partWidth / 2, -partHeight / 2, partWidth, partHeight);
    }
    context.restore();
  }
  context.restore();
  context.restore();
  return visual;
}

function sceneColors(project: TapTileProjectV2): [string, string] {
  if (project.authoring.sceneTheme === 'sunset') return ['#76375b', '#dd784f'];
  if (project.authoring.sceneTheme === 'candy') return ['#7251a8', '#d989bd'];
  if (project.authoring.sceneTheme === 'forest') return ['#184b48', '#4e8768'];
  return ['#163b78', '#24749b'];
}

export function renderTapTilePresentationFrame(
  canvas: HTMLCanvasElement,
  frame: TapTilePresentationFrame,
  bundle: TapTileCanvasRenderBundle,
  options: TapTileCanvasRenderOptions = {},
): CanvasRenderTrace {
  const pixelScale = Math.max(1, Math.min(2, options.pixelScale ?? 1));
  const width = bundle.project.stage.exportWidth;
  const height = bundle.project.stage.exportHeight;
  const pixelWidth = Math.round(width * pixelScale);
  const pixelHeight = Math.round(height * pixelScale);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('CANVAS_2D_CONTEXT_UNAVAILABLE');
  const trace: CanvasRenderTrace = { frameNumber: frame.frameNumber, width, height, items: [] };
  context.save();
  context.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
  context.clearRect(0, 0, width, height);

  const [topColor, bottomColor] = sceneColors(bundle.project);
  const background = context.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, topColor);
  background.addColorStop(1, bottomColor);
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  trace.items.push({ band: TAPTILE_Z_BANDS.base, id: 'stage:base', bounds: { x: 0, y: 0, width, height } });

  const stage = resolveStageAssembly(bundle.project);
  for (const layer of stage.layers.filter((candidate) => candidate.role === 'ambient')) {
    context.save();
    context.globalAlpha = layer.opacity;
    if (layer.color) { context.fillStyle = layer.color; context.fillRect(0, 0, width, height); }
    if (layer.assetId) {
      const image = bundle.assets.get(layer.assetId);
      if (image) drawCover(context, image, 0, 0, width, height);
    }
    context.restore();
    trace.items.push({ band: TAPTILE_Z_BANDS.ambient, id: `stage:${layer.id}`, bounds: { x: 0, y: 0, width, height } });
  }

  context.save();
  context.translate(frame.camera.xPx, frame.camera.yPx);
  context.translate(width / 2, height / 2);
  context.scale(frame.camera.zoom, frame.camera.zoom);
  context.translate(-width / 2, -height / 2);
  const boardTiles = frame.gameState.boardIds
    .map((id) => bundle.level.tiles[id])
    .filter((tile): tile is NonNullable<typeof tile> => Boolean(tile))
    .sort((left, right) => left.geometry.layer - right.geometry.layer || left.geometry.order - right.geometry.order || left.id.localeCompare(right.id));
  const boardLayers = [...new Set(boardTiles.map((tile) => tile.geometry.layer))];
  for (const [layerRank, layer] of boardLayers.entries()) {
    const layerTiles = boardTiles.filter((tile) => tile.geometry.layer === layer);
    for (const tile of layerTiles) {
      drawTileCastShadow(context, bundle, tile.archetypeId, 'board', tile.geometry.centerXPx, tile.geometry.centerYPx, tile.geometry.widthPx, tile.geometry.heightPx, tile.geometry.rotationDeg, layerRank);
      trace.items.push({ band: TAPTILE_Z_BANDS.board, id: `board-shadow:${tile.id}`, bounds: { x: round(tile.geometry.centerXPx - tile.geometry.widthPx / 2), y: round(tile.geometry.centerYPx - tile.geometry.heightPx / 2), width: round(tile.geometry.widthPx), height: round(tile.geometry.heightPx) } });
    }
    for (const tile of layerTiles) {
      drawTile(context, bundle, tile.archetypeId, 'board', tile.geometry.centerXPx, tile.geometry.centerYPx, tile.geometry.widthPx, tile.geometry.heightPx, tile.geometry.rotationDeg, 1, 1, false, layerRank);
      trace.items.push({ band: TAPTILE_Z_BANDS.board, id: `board:${tile.id}`, bounds: { x: round(tile.geometry.centerXPx - tile.geometry.widthPx / 2), y: round(tile.geometry.centerYPx - tile.geometry.heightPx / 2), width: round(tile.geometry.widthPx), height: round(tile.geometry.heightPx) } });
    }
  }
  for (const layer of stage.layers.filter((candidate) => candidate.role === 'foreground' || candidate.role === 'overlay')) {
    context.save();
    context.globalAlpha = layer.opacity;
    if (layer.color) { context.fillStyle = layer.color; context.fillRect(0, 0, width, height); }
    if (layer.assetId) {
      const image = bundle.assets.get(layer.assetId);
      if (image) drawCover(context, image, 0, 0, width, height);
    }
    context.restore();
    trace.items.push({ band: TAPTILE_Z_BANDS.boardFeedback, id: `stage:${layer.id}`, bounds: { x: 0, y: 0, width, height } });
  }
  for (const moving of frame.movingTiles) {
    const tile = bundle.level.tiles[moving.tileId];
    if (!tile) continue;
    drawTile(context, bundle, tile.archetypeId, 'flight', moving.xPx, moving.yPx, tile.geometry.widthPx, tile.geometry.heightPx, moving.rotationDeg, moving.scale);
    trace.items.push({ band: TAPTILE_Z_BANDS.moving, id: `moving:${moving.tileId}`, bounds: { x: round(moving.xPx - tile.geometry.widthPx / 2), y: round(moving.yPx - tile.geometry.heightPx / 2), width: round(tile.geometry.widthPx), height: round(tile.geometry.heightPx) } });
  }
  context.restore();

  const tray = normalizeTapTileTrayBounds(bundle.project.stage.safeAreas.tray);
  roundedRect(context, tray.left, tray.top, tray.width, tray.height, 36);
  context.fillStyle = 'rgba(7, 27, 64, 0.78)';
  context.fill();
  context.strokeStyle = 'rgba(130, 169, 255, 0.62)';
  context.lineWidth = 5;
  context.stroke();
  trace.items.push({ band: TAPTILE_Z_BANDS.tray, id: 'tray', bounds: { x: tray.left, y: tray.top, width: tray.width, height: tray.height } });
  for (let index = 0; index < TAPTILE_TRAY_CAPACITY; index += 1) {
    const slot = tapTileTraySlotRect(index, tray);
    const center = tapTileTraySlotCenter(index, tray);
    roundedRect(context, slot.left, slot.top, slot.width, slot.height, 18);
    context.fillStyle = 'rgba(3, 17, 45, 0.65)';
    context.fill();
    const tileId = frame.gameState.trayIds[index];
    const tile = tileId ? bundle.level.tiles[tileId] : undefined;
    if (tile) drawTile(context, bundle, tile.archetypeId, 'tray', center.xPx, center.yPx, slot.width, slot.height, 0);
    trace.items.push({ band: TAPTILE_Z_BANDS.tray, id: `tray-slot:${index}`, bounds: { x: slot.left, y: slot.top, width: slot.width, height: slot.height } });
  }

  if (frame.pointer.visible) {
    context.save();
    context.globalAlpha = frame.pointer.opacity;
    context.translate(round(frame.pointer.xPx), round(frame.pointer.yPx));
    context.rotate(frame.pointer.rotationDeg * Math.PI / 180);
    context.scale(frame.pointer.scale, frame.pointer.scale);
    const pointerImage = bundle.assets.get(TAPTILE_POINTER_ASSET_ID);
    const pointerWidth = 235;
    const pointerHeight = pointerWidth * 360 / 280;
    if (pointerImage) {
      drawCover(
        context,
        pointerImage,
        -pointerWidth * 58 / 280,
        -pointerHeight * 19 / 360,
        pointerWidth,
        pointerHeight,
      );
    } else {
      context.font = '132px "Segoe UI Emoji", sans-serif';
      context.textAlign = 'left';
      context.textBaseline = 'top';
      context.fillText('👆🏻', -36, -22);
    }
    if (frame.pointer.pressed) {
      const ringProgress = (frame.frameNumber % 4) / 3;
      context.globalAlpha *= 1 - ringProgress;
      context.strokeStyle = '#c6ff9f';
      context.shadowColor = 'rgba(91, 255, 169, 0.9)';
      context.shadowBlur = 14;
      context.lineWidth = 5;
      context.beginPath();
      context.arc(0, 0, 24 + ringProgress * 26, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
    trace.items.push({
      band: TAPTILE_Z_BANDS.pointer,
      id: 'pointer',
      bounds: {
        x: round(frame.pointer.xPx - pointerWidth * 0.22),
        y: round(frame.pointer.yPx - pointerHeight * 0.06),
        width: pointerWidth,
        height: round(pointerHeight),
      },
    });
  }

  for (const effect of frame.effects.filter((candidate) => candidate.kind === 'match')) {
    for (const [index, tileId] of effect.tileIds.entries()) {
      const tile = bundle.level.tiles[tileId];
      if (!tile) continue;
      const slotIndex = effect.slotIndexes?.[index] ?? index;
      const slot = tapTileTraySlotRect(slotIndex, tray);
      const center = tapTileTraySlotCenter(slotIndex, tray);
      const pulse = Math.sin(Math.min(1, effect.progress / 0.34) * Math.PI) * 0.12;
      const dissolve = Math.max(0, Math.min(1, (effect.progress - 0.24) / 0.5));
      context.save();
      context.globalAlpha = Math.max(0, (1 - effect.progress) * 0.72);
      context.fillStyle = '#8dffb0';
      context.shadowColor = 'rgba(96, 255, 169, 0.96)';
      context.shadowBlur = 44;
      context.beginPath();
      context.arc(center.xPx, center.yPx, slot.width * (0.36 + effect.progress * 0.45), 0, Math.PI * 2);
      context.fill();
      context.restore();
      drawTile(
        context,
        bundle,
        tile.archetypeId,
        'match-ghost',
        center.xPx,
        center.yPx,
        slot.width,
        slot.height,
        0,
        1 + pulse + dissolve * 0.2,
        1 - dissolve,
      );
      drawMatchFracture(context, center.xPx, center.yPx, slot.width, slot.height, effect.progress, index);
    }
    for (const particle of effect.particles) {
      context.save();
      context.globalAlpha = particle.opacity;
      context.translate(round(particle.xPx), round(particle.yPx));
      context.rotate(particle.rotationDeg * Math.PI / 180);
      context.scale(particle.scale, particle.scale);
      context.shadowColor = particle.shape === 'spark' ? 'rgba(126, 255, 175, 0.95)' : 'rgba(213, 255, 239, 0.82)';
      context.shadowBlur = particle.shape === 'spark' ? 14 : 7;
      context.fillStyle = particle.shape === 'spark' ? '#dfff9f' : ceramicShardColor(particle.tone ?? 0);
      context.strokeStyle = 'rgba(103, 145, 164, 0.58)';
      context.lineWidth = 1.4;
      context.beginPath();
      if (particle.shape === 'spark') {
        context.moveTo(0, -9);
        context.lineTo(3, -3);
        context.lineTo(9, 0);
        context.lineTo(3, 3);
        context.lineTo(0, 9);
        context.lineTo(-3, 3);
        context.lineTo(-9, 0);
        context.lineTo(-3, -3);
      } else {
        context.moveTo(-11, -7);
        context.lineTo(8, -10);
        context.lineTo(12, 3);
        context.lineTo(2, 10);
        context.lineTo(-12, 5);
      }
      context.closePath();
      context.fill();
      if (particle.shape !== 'spark') context.stroke();
      context.restore();
    }
    trace.items.push({ band: TAPTILE_Z_BANDS.matchVfx, id: effect.id, bounds: { x: tray.left, y: tray.top - 80, width: tray.width, height: tray.height + 160 } });
  }

  const praiseItems = renderTapTilePraiseOverlay(canvas, frame, bundle, options);
  trace.items.push(...praiseItems);

  const warning = praiseItems.length === 0 && frame.gameState.status === 'playing' && frame.gameState.trayIds.length === 6;
  if (warning) {
    context.save();
    context.fillStyle = 'rgba(255, 186, 35, 0.94)';
    context.font = '700 42px "Segoe UI", sans-serif';
    context.textAlign = 'center';
    context.fillText('槽位即将填满 6 / 7', width / 2, tray.bottom + 62);
    context.restore();
    trace.items.push({ band: TAPTILE_Z_BANDS.praiseWarning, id: 'warning', bounds: { x: 260, y: tray.bottom + 8, width: 560, height: 76 } });
  }

  context.save();
  context.fillStyle = '#ffffff';
  context.font = '900 72px "Segoe UI", sans-serif';
  context.textAlign = 'center';
  context.fillText('LEVEL 07', width / 2, 122);
  context.font = '900 38px "Segoe UI", sans-serif';
  context.textAlign = 'right';
  context.fillText('TAP TILE', width - 62, 118);
  context.restore();
  trace.items.push({ band: TAPTILE_Z_BANDS.hud, id: 'hud', bounds: { x: 0, y: 0, width, height: 180 } });

  if (frame.gameState.status !== 'playing') {
    context.save();
    context.fillStyle = 'rgba(5, 13, 28, 0.64)';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#ffffff';
    context.font = '900 98px "Segoe UI", sans-serif';
    context.textAlign = 'center';
    context.fillText(frame.gameState.status === 'won' ? 'CLEAR!' : 'TRY AGAIN', width / 2, height / 2);
    context.restore();
    trace.items.push({ band: TAPTILE_Z_BANDS.outro, id: `status:${frame.gameState.status}`, bounds: { x: 0, y: 0, width, height } });
  }
  context.restore();
  return trace;
}

export function renderTapTileOutroOverlay(
  canvas: HTMLCanvasElement,
  outro: OutroPack,
  progress: number,
  bundle: TapTileCanvasRenderBundle,
  options: TapTileCanvasRenderOptions = {},
): CanvasRenderTraceItem {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('CANVAS_2D_CONTEXT_UNAVAILABLE');
  const pixelScale = Math.max(1, Math.min(2, options.pixelScale ?? 1));
  const width = bundle.project.stage.exportWidth;
  const height = bundle.project.stage.exportHeight;
  const clamped = Math.max(0, Math.min(1, progress));
  const entrance = Math.min(1, clamped / 0.24);
  context.save();
  context.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
  context.globalAlpha = entrance;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#142f73');
  gradient.addColorStop(0.55, '#6c3fc4');
  gradient.addColorStop(1, '#ed6b9e');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  if (outro.backgroundAssetId) {
    const background = bundle.assets.get(outro.backgroundAssetId);
    if (background) {
      context.globalAlpha = entrance * 0.72;
      drawCover(context, background, 0, 0, width, height);
    }
  }
  context.globalAlpha = entrance;
  const lift = round((1 - entrance) * 80);
  const scale = outro.transitionId === 'soft-zoom' ? 0.9 + entrance * 0.1 : 1;
  context.translate(width / 2, height / 2);
  context.scale(scale, scale);
  context.translate(-width / 2, -height / 2 + lift);
  context.fillStyle = 'rgba(255,255,255,0.14)';
  roundedRect(context, 130, 360, 820, 1010, 64);
  context.fill();
  context.strokeStyle = 'rgba(255,255,255,0.34)';
  context.lineWidth = 4;
  context.stroke();
  if (outro.logoAssetId) {
    const logo = bundle.assets.get(outro.logoAssetId);
    if (logo) drawCover(context, logo, 340, 455, 400, 220);
  } else {
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.font = '900 94px "Segoe UI", sans-serif';
    context.fillText('TAP TILE', width / 2, 600);
  }
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.font = '900 72px "Segoe UI", sans-serif';
  context.fillText(outro.headline ?? '轻点配对，立即通关！', width / 2, 820, 760);
  context.font = '500 38px "Segoe UI", sans-serif';
  context.fillStyle = 'rgba(255,255,255,0.84)';
  context.fillText('三张同图即可消除', width / 2, 920);
  const pulse = 1 + Math.sin(clamped * Math.PI * 6) * 0.025;
  context.translate(width / 2, 1115);
  context.scale(pulse, pulse);
  roundedRect(context, -300, -82, 600, 164, 82);
  context.fillStyle = '#ffd64a';
  context.shadowColor = 'rgba(29, 16, 78, 0.38)';
  context.shadowBlur = 30;
  context.shadowOffsetY = 16;
  context.fill();
  context.shadowColor = 'transparent';
  context.fillStyle = '#362467';
  context.font = '900 58px "Segoe UI", sans-serif';
  context.fillText(outro.ctaLabel ?? '立即试玩', 0, 20);
  context.restore();
  return { band: TAPTILE_Z_BANDS.outro, id: `outro:${outro.id}`, bounds: { x: 0, y: 0, width, height } };
}

function ceramicShardColor(tone: number): string {
  return ['#ffffff', '#e4f3f5', '#b8dce4'][Math.abs(Math.round(tone)) % 3] ?? '#ffffff';
}
