import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { boardFingerprint, canPlace, pieceCellColor } from '../domain/gameEngine';
import { seededFloat } from '../domain/rng';
import { getShape, getShapeBounds } from '../domain/shapes';
import type {
  BoardState,
  ClearingFrame,
  GameSnapshot,
  GridCell,
  PieceInstance,
  PresentationFrame,
  StyleSpec,
  TileColor,
} from '../domain/types';
import {
  EMPTY_RUNTIME_ASSET_BINDINGS,
  type RuntimeAssetBindings,
  type RuntimeImageFit,
} from '../assets/runtimeAssetBindings';
import { perspectiveDistanceToFitFrame } from './cameraFraming';
import { resolveLookDevBloom } from './lookDev';
import { createBlockMaterial, LIGHTING_VALUES, TILE_COLOR_HEX } from './materialPresets';
import { createPbrTileMaterial, type RuntimeTextureSet } from './pbrMaterialFactory';
import { disposeRuntimeTextureSet, loadRuntimeTextureSet, runtimeTextureResourceKey } from './runtimeTextures';
import { MaterialRuntimeLoadGate } from './materialRuntimeLoadGate';
import {
  particleCountForBehavior,
  resolveFractureBehavior,
  shardMotionForBehavior,
  shardScaleForBehavior,
  sparkBoostForBehavior,
} from './materialFracture';
import { activeShotProfile } from './planShotAdapter';
import { lockedCameraDistance, mapClientPointToComposition, viewportPolicyForRenderer, webglViewportFromCss } from './shotProfile';
import { materialCacheKey, materialDescriptorKey } from '../headless/materialRuntime';

export interface StudioSceneOptions {
  quality?: 'interactive' | 'cinematic';
  alpha?: boolean;
}

export type PickResult =
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'piece'; pieceId: string }
  | null;

const CELL_PITCH = 1.02;
const BOARD_SIZE = 8;
const BOARD_CENTER_OFFSET = (BOARD_SIZE - 1) / 2;
const RACK_Y = -5.3;
const MAX_SHARDS = 1536;
const MAX_PARTICLES = 3072;

// Fixed composition envelope used by the legacy experimental 3D preview.
// The board is 8.68 world units wide; the extra margin protects the bevel,
// shadow, rack pieces and small camera-shake offsets.
const CAMERA_FRAME_WIDTH = 9.05;
const CAMERA_FRAME_HEIGHT = 13.8;
const CAMERA_FRAME_WIDTH_FILL = 0.89;
const CAMERA_FRAME_HEIGHT_FILL = 0.9;

interface LiveBurst {
  clearing: ClearingFrame;
  startedAt: number;
  durationMs: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number): number {
  const t = clamp01(value);
  return 1 - Math.pow(1 - t, 3);
}

function drawImageFitted(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  fit: RuntimeImageFit,
): void {
  const sourceWidth = Math.max(1, image.naturalWidth);
  const sourceHeight = Math.max(1, image.naturalHeight);
  if (fit === 'stretch') {
    context.drawImage(image, 0, 0, width, height);
    return;
  }
  const scale = fit === 'contain'
    ? Math.min(width / sourceWidth, height / sourceHeight)
    : Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function disposeGroupObjects(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((object) => {
      if (object instanceof THREE.Sprite) {
        const material = object.material;
        material.map?.dispose();
        material.dispose();
      }
    });
  }
}

function createLabelSprite(
  title: string,
  subtitle: string,
  options: { accent?: string; width?: number; height?: number } = {},
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = options.width ?? 768;
  canvas.height = options.height ?? 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create 2D canvas context.');

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '700 44px Inter, ui-sans-serif, system-ui, sans-serif';
  context.fillStyle = 'rgba(255,255,255,0.6)';
  context.fillText(subtitle, canvas.width / 2, 58);
  context.font = '900 112px Inter, ui-sans-serif, system-ui, sans-serif';
  context.fillStyle = options.accent ?? '#ffffff';
  context.shadowColor = 'rgba(70, 100, 255, 0.55)';
  context.shadowBlur = 22;
  context.fillText(title, canvas.width / 2, 164);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(4.8, 1.6, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function createCtaSprite(opacity: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 220;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create CTA canvas context.');
  const alpha = clamp01(opacity);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.globalAlpha = alpha;
  const gradient = context.createLinearGradient(100, 0, 668, 220);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(1, '#dce7ff');
  context.fillStyle = gradient;
  context.shadowColor = 'rgba(80, 105, 255, 0.55)';
  context.shadowBlur = 32;
  context.beginPath();
  context.roundRect(98, 36, 572, 146, 73);
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = '#18224a';
  context.font = '900 58px Inter, ui-sans-serif, system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('PLAY NOW', canvas.width / 2, 109);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    opacity: alpha,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(4.9, 1.4, 1);
  sprite.renderOrder = 30;
  return sprite;
}

export class StudioScene {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 9 / 16, 0.1, 100);
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly boardScaffoldRoot = new THREE.Group();
  private readonly tileRoot = new THREE.Group();
  private readonly rackRoot = new THREE.Group();
  private readonly dragRoot = new THREE.Group();
  private readonly uiRoot = new THREE.Group();
  private readonly lightingRoot = new THREE.Group();
  private readonly cellHitTargets: THREE.Object3D[] = [];
  private readonly pieceHitTargets: THREE.Object3D[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly materialCache = new Map<string, THREE.MeshPhysicalMaterial>();
  private readonly slotMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x17213a,
    roughness: 0.62,
    metalness: 0.03,
    clearcoat: 0.08,
    clearcoatRoughness: 0.36,
    envMapIntensity: 0.45,
  });
  private readonly invalidPlacementMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xff5068,
    roughness: 0.25,
    transparent: true,
    opacity: 0.65,
    emissive: 0x441019,
    depthWrite: false,
  });
  private readonly plateMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x10192d,
    roughness: 0.5,
    metalness: 0.08,
    clearcoat: 0.16,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.52,
  });
  private readonly plateGeometry = new RoundedBoxGeometry(8.68, 8.68, 0.46, 8, 0.38);
  private readonly slotGeometry = new RoundedBoxGeometry(0.9, 0.9, 0.15, 3, 0.16);
  private readonly shardGeometry = new THREE.TetrahedronGeometry(0.2, 0);
  private readonly shardMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.04,
    transparent: true,
    opacity: 1,
  });
  private readonly shardMesh = new THREE.InstancedMesh(
    this.shardGeometry,
    this.shardMaterial,
    MAX_SHARDS,
  );
  private readonly particlePositions = new Float32Array(MAX_PARTICLES * 3);
  private readonly particleColors = new Float32Array(MAX_PARTICLES * 3);
  private readonly particleGeometry = new THREE.BufferGeometry();
  private readonly particleMaterial = new THREE.PointsMaterial({
    size: 0.105,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly particles: THREE.Points;
  private readonly shockwaveMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.42, 0.62, 0.78),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  private readonly shockwave = new THREE.Mesh(
    new THREE.RingGeometry(0.36, 0.48, 64),
    this.shockwaveMaterial,
  );
  private readonly pointerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly pointerMesh = new THREE.Mesh(
    new THREE.RingGeometry(0.16, 0.24, 48),
    this.pointerMaterial,
  );
  private readonly environmentTarget: THREE.WebGLRenderTarget;

  private style: StyleSpec | null = null;
  private frame: PresentationFrame | null = null;
  private currentBoardKey = '';
  private currentRackKey = '';
  private currentDragKey = '';
  private currentUiKey = '';
  private currentLighting = '';
  private currentLookDev = '';
  private currentBackground = '';
  private currentGeometryKey = '';
  private blockGeometry: RoundedBoxGeometry | null = null;
  private liveBurst: LiveBurst | null = null;
  private rafTime = 0;
  private started = false;
  private disposed = false;
  private width = 540;
  private height = 960;
  private readonly quality: 'interactive' | 'cinematic';
  private backgroundTexture: THREE.CanvasTexture | null = null;
  private runtimeAssets: RuntimeAssetBindings = EMPTY_RUNTIME_ASSET_BINDINGS;
  private runtimeBackgroundImage: HTMLImageElement | null = null;
  private runtimeAssetsReady: Promise<void> = Promise.resolve();
  private runtimeTextures: RuntimeTextureSet = {};
  private runtimeTextureKey = '';
  private runtimeTextureFailure: string | null = null;
  private readonly materialLoadGate = new MaterialRuntimeLoadGate();
  private committedMaterialRuntime: StyleSpec['materialRuntime'];

  constructor(canvas: HTMLCanvasElement, options: StudioSceneOptions = {}) {
    this.canvas = canvas;
    this.quality = options.quality ?? 'interactive';
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: options.alpha ?? false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: this.quality === 'cinematic',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(1);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      0.1,
      0.3,
      1.02,
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environmentTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.environmentTarget.texture;
    pmrem.dispose();

    this.scene.add(
      this.boardScaffoldRoot,
      this.tileRoot,
      this.rackRoot,
      this.dragRoot,
      this.uiRoot,
      this.lightingRoot,
    );

    this.particleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.particlePositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.particleGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.particleColors, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.particleGeometry.setDrawRange(0, 0);
    this.particles = new THREE.Points(this.particleGeometry, this.particleMaterial);
    this.scene.add(this.shardMesh, this.particles, this.shockwave, this.pointerMesh);
    this.shardMesh.count = 0;
    this.pointerMesh.visible = false;
    this.shockwave.visible = false;

    this.buildBoardScaffold();
    this.resize(this.width, this.height, 1);
  }

  get rendererLabel(): string {
    return this.renderer.capabilities.isWebGL2
      ? 'Three.js · WebGL 2 · GPU'
      : 'Three.js · WebGL · GPU';
  }

  private applyViewportPolicy(): void {
    const policy = viewportPolicyForRenderer(
      this.style?.renderer ?? 'three-3d',
      this.width,
      this.height,
      activeShotProfile(this.style),
    );
    const glViewport = webglViewportFromCss(policy.viewport, this.height);
    this.camera.aspect = policy.aspect;
    this.renderer.setViewport(glViewport.x, glViewport.y, glViewport.width, glViewport.height);
    this.renderer.setScissor(glViewport.x, glViewport.y, glViewport.width, glViewport.height);
    this.renderer.setScissorTest(policy.scissorTest);
    this.camera.updateProjectionMatrix();
  }

  resize(width: number, height: number, pixelRatio = 1): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.renderer.setPixelRatio(Math.max(0.5, Math.min(2, pixelRatio)));
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(Math.max(0.5, Math.min(2, pixelRatio)));
    this.composer.setSize(this.width, this.height);
    this.applyViewportPolicy();
    if (this.style) this.syncCamera(this.frame?.cameraPunch ?? 0);
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.renderer.setAnimationLoop((time) => {
      this.rafTime = time;
      this.render(time);
    });
  }

  stop(): void {
    if (!this.started) return;
    this.renderer.setAnimationLoop(null);
    this.started = false;
  }

  setFrame(frame: PresentationFrame, style: StyleSpec): void {
    if (this.disposed) return;
    this.frame = frame;
    this.style = style;
    this.applyViewportPolicy();
    this.syncCamera(frame.cameraPunch);
    this.syncScene();
  }

  setRuntimeAssets(bindings: RuntimeAssetBindings): void {
    if (bindings.revision === this.runtimeAssets.revision) return;
    this.runtimeAssets = bindings;
    this.runtimeBackgroundImage = null;
    this.currentBackground = '';
    const background = bindings.background;
    if (!background) {
      this.runtimeAssetsReady = Promise.resolve();
      if (this.style) this.syncBackground();
      return;
    }
    const revision = bindings.revision;
    this.runtimeAssetsReady = new Promise<void>((resolve) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        if (this.runtimeAssets.revision === revision) {
          this.runtimeBackgroundImage = image;
          this.currentBackground = '';
          if (this.style) this.syncBackground();
          this.render();
        }
        resolve();
      };
      image.onerror = () => resolve();
      image.src = background.objectUrl;
    });
  }

  setLiveSnapshot(snapshot: GameSnapshot, style: StyleSpec): void {
    this.setFrame(
      {
        frame: snapshot.turn,
        fps: 30,
        snapshot,
        board: snapshot.board,
        cameraPunch: 0,
      },
      style,
    );
  }

  setDragPreview(
    pieceId: string | null,
    anchor: GridCell | null,
    pointer?: { x: number; y: number },
  ): void {
    if (!this.frame) return;
    if (!pieceId) {
      const next = { ...this.frame };
      delete next.draggedPiece;
      delete next.hiddenPieceId;
      delete next.pointer;
      this.frame = next;
      this.syncScene();
      return;
    }

    const piece = this.frame.snapshot.pieces.find((candidate) => candidate.id === pieceId);
    if (!piece) return;
    this.frame = {
      ...this.frame,
      hiddenPieceId: pieceId,
      draggedPiece: {
        piece,
        anchor: anchor ?? { row: -100, col: -100 },
        progress: 1,
        pointerDriven: true,
      },
      ...(pointer ? { pointer: { ...pointer, pressed: true } } : {}),
    };
    this.syncScene();
  }

  triggerClear(clearing: ClearingFrame, durationMs = 560): void {
    this.liveBurst = { clearing, startedAt: performance.now(), durationMs };
  }

  mapClientPointer(clientX: number, clientY: number): { x: number; y: number } | null {
    const mapped = this.mapClientComposition(clientX, clientY);
    if (!mapped?.inside) return null;
    return { x: mapped.compositionX, y: mapped.compositionY };
  }

  pick(clientX: number, clientY: number): PickResult {
    const mapped = this.mapClientComposition(clientX, clientY);
    if (!mapped?.inside) return null;
    this.camera.updateMatrixWorld();
    this.pointer.x = mapped.ndcX;
    this.pointer.y = mapped.ndcY;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const pieceHit = this.raycaster.intersectObjects(this.pieceHitTargets, false)[0]?.object;
    if (pieceHit?.userData.kind === 'piece') {
      return { kind: 'piece', pieceId: pieceHit.userData.pieceId as string };
    }

    const cellHit = this.raycaster.intersectObjects(this.cellHitTargets, false)[0]?.object;
    if (cellHit?.userData.kind === 'cell') {
      return {
        kind: 'cell',
        row: cellHit.userData.row as number,
        col: cellHit.userData.col as number,
      };
    }
    const planeCell = this.pickCellFromBoardPlane();
    return planeCell ? { kind: 'cell', ...planeCell } : null;
  }

  anchorForPiece(clientX: number, clientY: number, pieceId: string): GridCell | null {
    const cell = this.pickCellOnly(clientX, clientY);
    const piece = this.frame?.snapshot.pieces.find((candidate) => candidate.id === pieceId);
    if (!cell || !piece) return null;
    const bounds = getShapeBounds(getShape(piece.shapeId));
    return {
      row: cell.row - Math.floor((bounds.rows - 1) / 2),
      col: cell.col - Math.floor((bounds.cols - 1) / 2),
    };
  }

  isValidAnchor(pieceId: string, anchor: GridCell): boolean {
    const piece = this.frame?.snapshot.pieces.find((candidate) => candidate.id === pieceId);
    return Boolean(piece && canPlace(this.frame?.snapshot.board ?? { rows: 0, cols: 0, cells: [] }, piece, anchor));
  }

  render(time = this.rafTime): void {
    if (!this.frame || !this.style || this.disposed) return;
    this.syncCamera(this.frame.cameraPunch);
    this.updateFx(time);
    this.updatePointer();
    this.composer.render();
  }

  renderAt(frame: PresentationFrame, style: StyleSpec): void {
    this.setFrame(frame, style);
    this.render(frame.frame * (1000 / Math.max(1, frame.fps)));
  }

  async prepareMaterialRuntime(style: StyleSpec): Promise<void> {
    const maps = style.materialRuntime?.maps ?? [];
    const resourceKey = runtimeTextureResourceKey(maps, this.runtimeAssets);
    const descriptorKey = style.materialRuntime ? materialDescriptorKey(style.materialRuntime) : '';
    if (this.materialLoadGate.shouldSkip(descriptorKey)) return;

    const loadId = this.materialLoadGate.begin();
    const commitDescriptor = (): boolean => {
      if (!this.materialLoadGate.commit(loadId, descriptorKey)) return false;
      this.runtimeTextureFailure = null;
      this.committedMaterialRuntime = style.materialRuntime;
      this.style = style;
      this.invalidateRuntimeMaterials();
      return true;
    };

    if (maps.length === 0) {
      if (!this.materialLoadGate.isCurrent(loadId)) return;
      disposeRuntimeTextureSet(this.runtimeTextures);
      this.runtimeTextures = {};
      this.runtimeTextureKey = resourceKey;
      commitDescriptor();
      return;
    }

    if (resourceKey === this.runtimeTextureKey) {
      commitDescriptor();
      return;
    }

    try {
      const loaded = await loadRuntimeTextureSet(maps, this.runtimeAssets);
      if (!this.materialLoadGate.isCurrent(loadId)) {
        disposeRuntimeTextureSet(loaded);
        return;
      }
      disposeRuntimeTextureSet(this.runtimeTextures);
      this.runtimeTextures = loaded;
      this.runtimeTextureKey = resourceKey;
      if (!commitDescriptor()) {
        disposeRuntimeTextureSet(loaded);
        this.runtimeTextures = {};
        this.runtimeTextureKey = '';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.materialLoadGate.fail(loadId, message)) return;
      this.runtimeTextureFailure = message;
      throw error;
    }
  }

  private invalidateRuntimeMaterials(): void {
    for (const material of this.materialCache.values()) material.dispose();
    this.materialCache.clear();
    this.currentBoardKey = '';
    this.currentRackKey = '';
    this.currentDragKey = '';
    if (this.frame && this.style) {
      this.syncScene();
      this.render();
    }
  }

  async warmup(frame: PresentationFrame, style: StyleSpec): Promise<void> {
    await this.prepareMaterialRuntime(style);
    this.renderAt(frame, style);
    await this.runtimeAssetsReady;
    await this.renderer.compileAsync(this.scene, this.camera);
    this.renderAt(frame, style);
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.blockGeometry?.dispose();
    this.plateGeometry.dispose();
    this.slotGeometry.dispose();
    this.slotMaterial.dispose();
    this.plateMaterial.dispose();
    this.invalidPlacementMaterial.dispose();
    this.shardGeometry.dispose();
    this.shardMaterial.dispose();
    this.particleGeometry.dispose();
    this.particleMaterial.dispose();
    this.shockwave.geometry.dispose();
    this.shockwaveMaterial.dispose();
    this.pointerMesh.geometry.dispose();
    this.pointerMaterial.dispose();
    this.backgroundTexture?.dispose();
    this.runtimeAssets = EMPTY_RUNTIME_ASSET_BINDINGS;
    this.runtimeBackgroundImage = null;
    this.runtimeAssetsReady = Promise.resolve();
    disposeRuntimeTextureSet(this.runtimeTextures);
    this.runtimeTextures = {};
    this.runtimeTextureKey = '';
    this.runtimeTextureFailure = null;
    this.committedMaterialRuntime = undefined;
    this.materialLoadGate.dispose();
    this.environmentTarget.dispose();
    for (const material of this.materialCache.values()) material.dispose();
    this.materialCache.clear();
    disposeGroupObjects(this.uiRoot);
    this.composer.dispose();
    this.renderer.dispose();
  }

  private mapClientComposition(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return mapClientPointToComposition({
      clientX,
      clientY,
      rect,
      renderer: this.style?.renderer ?? 'three-3d',
      canvasWidth: this.width,
      canvasHeight: this.height,
      shot: activeShotProfile(this.style),
    });
  }

  private pickCellOnly(clientX: number, clientY: number): GridCell | null {
    const mapped = this.mapClientComposition(clientX, clientY);
    if (!mapped?.inside) return null;
    this.pointer.x = mapped.ndcX;
    this.pointer.y = mapped.ndcY;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const object = this.raycaster.intersectObjects(this.cellHitTargets, false)[0]?.object;
    if (object?.userData.kind === 'cell') {
      return { row: object.userData.row as number, col: object.userData.col as number };
    }
    return this.pickCellFromBoardPlane();
  }

  private pickCellFromBoardPlane(): GridCell | null {
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.42);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, point)) return null;
    const col = Math.round(point.x / CELL_PITCH + BOARD_CENTER_OFFSET);
    const row = Math.round(BOARD_CENTER_OFFSET - (point.y - 0.25) / CELL_PITCH);
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return null;
    return { row, col };
  }

  private buildBoardScaffold(): void {
    const plate = new THREE.Mesh(this.plateGeometry, this.plateMaterial);
    plate.position.set(0, 0.25, -0.03);
    plate.receiveShadow = true;
    this.boardScaffoldRoot.add(plate);

    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const slot = new THREE.Mesh(this.slotGeometry, this.slotMaterial);
        const world = this.boardCellWorld(row, col);
        slot.position.set(world.x, world.y, 0.18);
        slot.receiveShadow = true;
        slot.userData = { kind: 'cell', row, col };
        this.boardScaffoldRoot.add(slot);
        this.cellHitTargets.push(slot);
      }
    }
  }

  private syncScene(): void {
    if (!this.frame || !this.style) return;
    this.ensureGeometry();
    this.ensureLookDev();
    this.ensureLighting();
    this.syncBackground();

    const clearingKey = this.frame.clearing
      ? `${this.frame.clearing.seed}:${Math.round(this.frame.clearing.progress * 90)}`
      : 'none';
    const lookKey = `${this.style.material}:${this.committedMaterialRuntime?.contentHash ?? this.style.materialRuntime?.contentHash ?? 'preset'}:${this.runtimeTextureKey}:${this.style.diagnosticView ?? 'beauty'}`;
    const boardKey = `${boardFingerprint(this.frame.board)}:${this.currentGeometryKey}:${lookKey}:${clearingKey}`;
    if (boardKey !== this.currentBoardKey) {
      this.rebuildBoardTiles();
      this.currentBoardKey = boardKey;
    }

    const rackKey = `${this.frame.snapshot.pieces
      .map((piece) => `${piece.id}:${piece.shapeId}:${piece.color}:${piece.cellColors?.join('.') ?? ''}:${piece.used ? 1 : 0}`)
      .join(',')}:${this.frame.hiddenPieceId ?? ''}:${this.currentGeometryKey}:${lookKey}`;
    if (rackKey !== this.currentRackKey) {
      this.rebuildRack();
      this.currentRackKey = rackKey;
    }

    const dragKey = this.frame.draggedPiece
      ? `${this.frame.draggedPiece.piece.id}:${this.frame.draggedPiece.piece.shapeId}:${this.frame.draggedPiece.piece.color}:${this.frame.draggedPiece.piece.cellColors?.join('.') ?? ''}:${this.frame.draggedPiece.anchor.row}:${this.frame.draggedPiece.anchor.col}:${this.frame.draggedPiece.progress.toFixed(3)}:${this.frame.draggedPiece.pointerDriven ? 1 : 0}:${this.frame.pointer?.x.toFixed(4) ?? ''}:${this.frame.pointer?.y.toFixed(4) ?? ''}:${this.currentGeometryKey}:${lookKey}`
      : 'none';
    if (dragKey !== this.currentDragKey) {
      this.rebuildDraggedPiece();
      this.currentDragKey = dragKey;
    }

    const ctaProgress = this.ctaProgress();
    const uiKey = `${this.frame.snapshot.score}:${this.frame.snapshot.combo}:${ctaProgress.toFixed(2)}`;
    if (uiKey !== this.currentUiKey) {
      this.rebuildUi(ctaProgress);
      this.currentUiKey = uiKey;
    }
  }

  private ensureGeometry(): void {
    if (!this.style) return;
    const { depth, bevel, gap } = this.style.geometry;
    const key = `${depth.toFixed(3)}:${bevel.toFixed(3)}:${gap.toFixed(3)}:${this.quality}`;
    if (key === this.currentGeometryKey && this.blockGeometry) return;
    this.blockGeometry?.dispose();
    const size = 0.92 - Math.max(0, Math.min(0.22, gap));
    const segments = this.quality === 'cinematic' ? 7 : 4;
    this.blockGeometry = new RoundedBoxGeometry(
      size,
      size,
      depth,
      segments,
      Math.min(bevel, size * 0.32),
    );
    this.currentGeometryKey = key;
    this.currentBoardKey = '';
    this.currentRackKey = '';
    this.currentDragKey = '';
  }

  private ensureLookDev(): void {
    if (!this.style) return;
    const { lookDev } = this.style;
    const diagnostic = this.style.diagnosticView ?? 'beauty';
    const key = [
      lookDev.id,
      lookDev.exposure.toFixed(3),
      lookDev.environmentIntensity.toFixed(3),
      lookDev.bloomStrength.toFixed(3),
      lookDev.bloomThreshold.toFixed(3),
      lookDev.bloomRadius.toFixed(3),
      lookDev.clearBloomBoost.toFixed(3),
      diagnostic,
    ].join(':');
    if (key === this.currentLookDev) return;

    const bloom = resolveLookDevBloom(lookDev, this.quality, 0, this.style.fx);
    const disableBloom = diagnostic !== 'beauty' && diagnostic !== 'bloom-contribution';
    this.bloomPass.strength = disableBloom ? 0 : bloom.strength;
    this.bloomPass.threshold = bloom.threshold;
    this.bloomPass.radius = bloom.radius;
    this.slotMaterial.envMapIntensity = 0.45 * lookDev.environmentIntensity;
    this.plateMaterial.envMapIntensity = 0.52 * lookDev.environmentIntensity;

    for (const material of this.materialCache.values()) material.dispose();
    this.materialCache.clear();
    this.currentBoardKey = '';
    this.currentRackKey = '';
    this.currentDragKey = '';
    this.currentLighting = '';
    this.currentLookDev = key;
  }

  private ensureLighting(): void {
    if (!this.style) return;
    const lightingKey = `${this.style.lighting}:${this.style.lookDev.exposure.toFixed(3)}`;
    if (this.currentLighting === lightingKey) return;
    for (const child of [...this.lightingRoot.children]) this.lightingRoot.remove(child);
    const values = LIGHTING_VALUES[this.style.lighting];
    this.renderer.toneMappingExposure = values.exposure * this.style.lookDev.exposure;

    const hemisphere = new THREE.HemisphereLight(0xdce9ff, 0x101a30, values.ambient);
    this.lightingRoot.add(hemisphere);

    const key = new THREE.DirectionalLight(values.keyColor, values.key);
    key.position.set(-4.8, 6.8, 9.5);
    key.castShadow = true;
    const shadowSize = this.quality === 'cinematic' ? 4096 : 2048;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    key.shadow.bias = -0.00035;
    this.lightingRoot.add(key);

    const fill = new THREE.PointLight(values.fillColor, values.fill, 30, 2);
    fill.position.set(5.5, -1, 7);
    this.lightingRoot.add(fill);

    const rim = new THREE.SpotLight(values.rimColor, values.rim, 36, Math.PI / 4, 0.5, 1.5);
    rim.position.set(3.5, 7.5, 8.5);
    rim.target.position.set(0, 0, 0);
    this.lightingRoot.add(rim, rim.target);
    this.currentLighting = lightingKey;
  }

  private syncBackground(): void {
    if (!this.style) return;
    const neutralLookDev = this.style.lookDev.id === 'neutral-lookdev';
    const runtimeBackground = neutralLookDev ? null : this.runtimeAssets.background;
    const backgroundKey = runtimeBackground
      ? `${this.style.lookDev.id}:${this.style.background}:${runtimeBackground.contentHash}:${runtimeBackground.fit}:${runtimeBackground.opacity}`
      : `${this.style.lookDev.id}:${this.style.background}`;
    if (this.currentBackground === backgroundKey) return;
    this.backgroundTexture?.dispose();
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 1024;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create background canvas context.');
    context.fillStyle = neutralLookDev ? '#222832' : this.style.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (runtimeBackground && this.runtimeBackgroundImage) {
      context.globalAlpha = runtimeBackground.opacity;
      context.globalCompositeOperation = runtimeBackground.blendMode;
      drawImageFitted(context, this.runtimeBackgroundImage, canvas.width, canvas.height, runtimeBackground.fit);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      const grade = context.createLinearGradient(0, 0, 0, canvas.height);
      grade.addColorStop(0, 'rgba(4,15,34,0.04)');
      grade.addColorStop(0.62, 'rgba(5,14,36,0.08)');
      grade.addColorStop(1, 'rgba(2,5,16,0.28)');
      context.fillStyle = grade;
      context.fillRect(0, 0, canvas.width, canvas.height);
    } else if (neutralLookDev) {
      const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, '#303844');
      gradient.addColorStop(0.62, '#232a34');
      gradient.addColorStop(1, '#171c24');
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      const base = new THREE.Color(this.style.background);
      const top = base.clone().lerp(new THREE.Color(0x253f82), 0.35);
      const bottom = base.clone().multiplyScalar(0.42);
      const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, `#${top.getHexString()}`);
      gradient.addColorStop(0.55, `#${base.getHexString()}`);
      gradient.addColorStop(1, `#${bottom.getHexString()}`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (!neutralLookDev) {
      const glow = context.createRadialGradient(256, 410, 10, 256, 410, 380);
      glow.addColorStop(0, 'rgba(125,160,255,0.18)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = glow;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    this.backgroundTexture = new THREE.CanvasTexture(canvas);
    this.backgroundTexture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.backgroundTexture;
    this.currentBackground = backgroundKey;
  }

  private getMaterial(
    color: TileColor,
    opacity = 1,
    cell?: { row: number; col: number },
  ): THREE.MeshPhysicalMaterial {
    if (!this.style) throw new Error('Style not initialized.');
    const environmentIntensity = this.style.lookDev.environmentIntensity;
    const runtime = this.committedMaterialRuntime ?? this.style.materialRuntime;
    const diagnostic = this.style.diagnosticView ?? 'beauty';
    const cellKey = cell ? `${cell.row}:${cell.col}` : 'shared';
    const key = runtime
      ? `${materialCacheKey(runtime, {
        color,
        opacity,
        lookDevId: this.style.lookDev.id,
        ...(cell ? { cell } : {}),
      })}:${diagnostic}`
      : `${this.style.material}:${color}:${opacity.toFixed(2)}:${environmentIntensity.toFixed(3)}:${diagnostic}:${cellKey}`;
    let material = this.materialCache.get(key);
    if (!material) {
      material = runtime
        ? createPbrTileMaterial({
          descriptor: runtime,
          color,
          opacity,
          environmentIntensity,
          diagnosticView: diagnostic,
          textures: this.runtimeTextures,
          ...(cell ? { cell } : {}),
        })
        : createBlockMaterial(
          color,
          this.style.material,
          opacity,
          environmentIntensity,
        );
      this.materialCache.set(key, material);
    }
    return material;
  }

  private boardCellWorld(row: number, col: number): THREE.Vector3 {
    return new THREE.Vector3(
      (col - BOARD_CENTER_OFFSET) * CELL_PITCH,
      (BOARD_CENTER_OFFSET - row) * CELL_PITCH + 0.25,
      0.42,
    );
  }

  private rackPosition(slotIndex: number): THREE.Vector3 {
    return new THREE.Vector3((slotIndex - 1) * 3.05, RACK_Y, 0.58);
  }

  private pieceTargetPosition(piece: PieceInstance, anchor: GridCell): THREE.Vector3 {
    const bounds = getShapeBounds(getShape(piece.shapeId));
    const first = this.boardCellWorld(anchor.row, anchor.col);
    return new THREE.Vector3(
      first.x + ((bounds.cols - 1) * CELL_PITCH) / 2,
      first.y - ((bounds.rows - 1) * CELL_PITCH) / 2,
      first.z + 0.28,
    );
  }

  private rebuildBoardTiles(): void {
    if (!this.frame || !this.style || !this.blockGeometry) return;
    for (const child of [...this.tileRoot.children]) this.tileRoot.remove(child);

    const clearingMap = new Set(
      this.frame.clearing?.clear.cells.map((cell) => `${cell.row}:${cell.col}`) ?? [],
    );
    const clearingProgress = this.frame.clearing?.progress ?? 0;

    for (let row = 0; row < this.frame.board.rows; row += 1) {
      for (let col = 0; col < this.frame.board.cols; col += 1) {
        const color = this.frame.board.cells[row]?.[col];
        if (!color) continue;
        const block = new THREE.Mesh(this.blockGeometry, this.getMaterial(color, 1, { row, col }));
        block.position.copy(this.boardCellWorld(row, col));
        block.castShadow = true;
        block.receiveShadow = true;
        if (clearingMap.has(`${row}:${col}`)) {
          const scale = Math.max(0.025, 1 - easeOutCubic(clearingProgress));
          block.scale.setScalar(scale);
          block.rotation.z = clearingProgress * 0.34 * (row % 2 === 0 ? 1 : -1);
          block.position.z += Math.sin(clearingProgress * Math.PI) * 0.36;
        }
        this.tileRoot.add(block);
      }
    }
  }

  private rebuildRack(): void {
    if (!this.frame || !this.style || !this.blockGeometry) return;
    for (const child of [...this.rackRoot.children]) this.rackRoot.remove(child);
    this.pieceHitTargets.length = 0;

    for (const piece of this.frame.snapshot.pieces) {
      if (piece.used || piece.id === this.frame.hiddenPieceId) continue;
      const shape = getShape(piece.shapeId);
      const bounds = getShapeBounds(shape);
      const group = new THREE.Group();
      group.position.copy(this.rackPosition(piece.slotIndex));
      group.scale.setScalar(0.62);

      for (const [[row, col], cellIndex] of shape.cells.map((cell, index) => [cell, index] as const)) {
        const mesh = new THREE.Mesh(
          this.blockGeometry,
          this.getMaterial(pieceCellColor(piece, cellIndex), 1, {
            row: row + piece.slotIndex * 8,
            col,
          }),
        );
        mesh.position.set(
          (col - (bounds.cols - 1) / 2) * CELL_PITCH,
          ((bounds.rows - 1) / 2 - row) * CELL_PITCH,
          0,
        );
        mesh.castShadow = true;
        mesh.userData = { kind: 'piece', pieceId: piece.id };
        group.add(mesh);
        this.pieceHitTargets.push(mesh);
      }
      this.rackRoot.add(group);
    }
  }

  private rebuildDraggedPiece(): void {
    for (const child of [...this.dragRoot.children]) this.dragRoot.remove(child);
    if (!this.frame?.draggedPiece || !this.style || !this.blockGeometry) return;

    const { piece, anchor, progress, pointerDriven } = this.frame.draggedPiece;
    const shape = getShape(piece.shapeId);
    const bounds = getShapeBounds(shape);
    const start = this.rackPosition(piece.slotIndex);
    const target = this.pieceTargetPosition(piece, anchor);
    const pointerPosition = this.frame.pointer
      ? this.normalizedPointOnPlane(this.frame.pointer, target.z + 0.58)
      : null;
    let position: THREE.Vector3;
    if (pointerDriven && pointerPosition) {
      position = pointerPosition;
    } else if (pointerPosition) {
      const snapWeight = clamp01((progress - 0.82) / 0.18);
      position = pointerPosition.lerp(target, snapWeight);
    } else {
      position = start.clone().lerp(target, clamp01(progress));
    }
    position.z += Math.sin(clamp01(progress) * Math.PI) * 0.42;
    const valid = canPlace(this.frame.snapshot.board, piece, anchor);

    const group = new THREE.Group();
    group.position.copy(position);
    group.scale.setScalar(0.62 + clamp01(progress) * 0.38);
    for (const [[row, col], cellIndex] of shape.cells.map((cell, index) => [cell, index] as const)) {
      const baseMaterial = this.getMaterial(
        pieceCellColor(piece, cellIndex),
        valid ? 0.86 : 0.58,
        { row: row + 16, col },
      );
      const material = valid ? baseMaterial : this.invalidPlacementMaterial;
      const mesh = new THREE.Mesh(this.blockGeometry, material);
      mesh.position.set(
        (col - (bounds.cols - 1) / 2) * CELL_PITCH,
        ((bounds.rows - 1) / 2 - row) * CELL_PITCH,
        0,
      );
      mesh.castShadow = true;
      group.add(mesh);
    }
    this.dragRoot.add(group);
  }

  private rebuildUi(ctaProgress: number): void {
    disposeGroupObjects(this.uiRoot);
    if (!this.frame) return;
    const score = createLabelSprite(
      String(this.frame.snapshot.score).padStart(4, '0'),
      'SCORE',
    );
    score.position.set(0, 5.5, 1.2);
    this.uiRoot.add(score);

    if (this.frame.snapshot.combo > 1) {
      const combo = createLabelSprite(
        `× ${this.frame.snapshot.combo}`,
        'COMBO',
        { accent: '#fff0a8', width: 640, height: 220 },
      );
      combo.scale.multiplyScalar(0.62);
      combo.position.set(0, 4.7, 1.15);
      this.uiRoot.add(combo);
    }

    if (ctaProgress > 0) {
      const cta = createCtaSprite(ctaProgress);
      const scale = 0.92 + Math.sin(ctaProgress * Math.PI) * 0.1;
      cta.scale.multiplyScalar(scale);
      cta.position.set(0, -6.55, 1.35);
      this.uiRoot.add(cta);
    }
  }

  private ctaProgress(): number {
    if (!this.frame?.totalFrames || this.frame.totalFrames <= 1) return 0;
    const start = Math.round(this.frame.totalFrames * 0.9);
    return clamp01((this.frame.frame - start) / Math.max(1, this.frame.totalFrames - start));
  }

  private syncCamera(punch: number): void {
    if (!this.style) return;
    const locked = this.style.renderer === 'fixed-camera-cinematic';
    const shot = activeShotProfile(this.style);
    const maxZoom = shot.maximumScreenZoom;
    const dynamicFactor = locked ? 0.4 : this.style.camera === 'dynamic-clear' ? 1 : 0.56;
    const effectivePunch = punch * dynamicFactor;
    const frame = this.frame?.frame ?? 0;
    const shakeScale = locked ? 0.45 : 1;
    const shakeX = Math.sin(frame * 2.13) * effectivePunch * 0.08 * shakeScale;
    const shakeY = Math.cos(frame * 1.71) * effectivePunch * 0.055 * shakeScale;

    if (locked) {
      this.camera.fov = shot.verticalFovDegrees;
      this.camera.aspect = shot.compositionAspect;
      const distance = lockedCameraDistance(effectivePunch, shot);
      const zoom = Math.min(maxZoom, 1 + effectivePunch * 0.015);
      this.camera.position.set(
        shot.cameraOffset.x + shakeX,
        shot.cameraOffset.y + shakeY,
        distance,
      );
      this.camera.lookAt(
        shot.lookAt[0],
        shot.lookAt[1],
        shot.lookAt[2],
      );
      this.camera.updateProjectionMatrix();
      void zoom;
      return;
    }

    let preferredDistance: number;
    let cameraX: number;
    let cameraY: number;
    let punchDepth: number;

    if (this.style.camera === 'flat-gameplay') {
      this.camera.fov = 39;
      preferredDistance = 18.7;
      cameraX = 0;
      cameraY = -0.15;
      punchDepth = 0.22;
    } else if (this.style.camera === 'premium-perspective') {
      this.camera.fov = 42;
      preferredDistance = 17.6;
      cameraX = 0.12;
      cameraY = -1.1;
      punchDepth = 0.35;
    } else {
      this.camera.fov = 43;
      preferredDistance = 17.1;
      cameraX = -0.15;
      cameraY = -1.45;
      punchDepth = 0.62;
    }

    // PerspectiveCamera.fov is vertical. The old preview used fixed distances,
    // so a portrait 9:16 viewport had a horizontal frustum narrower than the
    // 8.68-unit board and clipped both sides. Fit the fixed composition against
    // the actual viewport aspect before applying the small reactive punch.
    const fittedDistance = perspectiveDistanceToFitFrame({
      verticalFovDegrees: this.camera.fov,
      aspect: this.camera.aspect,
      contentWidth: CAMERA_FRAME_WIDTH,
      contentHeight: CAMERA_FRAME_HEIGHT,
      widthFill: CAMERA_FRAME_WIDTH_FILL,
      heightFill: CAMERA_FRAME_HEIGHT_FILL,
      minimumDistance: preferredDistance,
    });

    this.camera.position.set(
      cameraX + shakeX,
      cameraY + shakeY,
      fittedDistance - effectivePunch * punchDepth,
    );
    this.camera.lookAt(0, -0.05, 0.15);
    this.camera.updateProjectionMatrix();
  }

  private updateFx(timeMs: number): void {
    let clearing = this.frame?.clearing ?? null;
    if (!clearing && this.liveBurst) {
      const progress = (timeMs - this.liveBurst.startedAt) / this.liveBurst.durationMs;
      if (progress >= 1) {
        this.liveBurst = null;
      } else if (progress >= 0) {
        clearing = { ...this.liveBurst.clearing, progress };
      }
    }

    if (!clearing || clearing.clear.cells.length === 0) {
      if (this.style) {
        const bloom = resolveLookDevBloom(this.style.lookDev, this.quality, 0, this.style.fx);
        this.bloomPass.strength = bloom.strength;
        this.bloomPass.threshold = bloom.threshold;
        this.bloomPass.radius = bloom.radius;
      }
      this.shardMesh.count = 0;
      this.particleGeometry.setDrawRange(0, 0);
      this.shockwave.visible = false;
      return;
    }

    const progress = clamp01(clearing.progress);
    const t = progress * 0.78;
    const behavior = resolveFractureBehavior(this.style);
    const shardsPerCell =
      this.style?.fx === 'clean-pop' ? 3 : this.quality === 'cinematic' ? 10 : 6;
    const particlesPerCell = particleCountForBehavior(
      behavior,
      this.style?.fx === 'energy-burst' ? 11 : 6,
    );
    const sparkBoost = sparkBoostForBehavior(behavior);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let shardIndex = 0;
    let particleIndex = 0;
    const center = new THREE.Vector3();

    for (let cellIndex = 0; cellIndex < clearing.clear.cells.length; cellIndex += 1) {
      const cell = clearing.clear.cells[cellIndex];
      if (!cell) continue;
      const origin = this.boardCellWorld(cell.row, cell.col);
      center.add(origin);

      for (let shard = 0; shard < shardsPerCell && shardIndex < MAX_SHARDS; shard += 1) {
        const baseIndex = cellIndex * 97 + shard * 13;
        const angle = seededFloat(clearing.seed, baseIndex) * Math.PI * 2;
        const motion = shardMotionForBehavior(
          behavior,
          1.45 + seededFloat(clearing.seed, baseIndex + 1) * 2.65,
          1.4 + seededFloat(clearing.seed, baseIndex + 2) * 2.6,
        );
        dummy.position.set(
          origin.x + Math.cos(angle) * motion.speed * t,
          origin.y + Math.sin(angle) * motion.speed * t - motion.gravity * t * t,
          origin.z + 0.15 + motion.lift * t - 3.4 * motion.gravity / 1.3 * t * t,
        );
        dummy.rotation.set(
          t * (3 + seededFloat(clearing.seed, baseIndex + 3) * 8),
          t * (2 + seededFloat(clearing.seed, baseIndex + 4) * 7),
          t * (2 + seededFloat(clearing.seed, baseIndex + 5) * 9),
        );
        const scale =
          (0.7 + seededFloat(clearing.seed, baseIndex + 6) * 0.68) *
          Math.pow(1 - progress, 0.36);
        const shardScale = shardScaleForBehavior(
          behavior,
          scale,
          seededFloat(clearing.seed, baseIndex + 7),
        );
        dummy.scale.set(shardScale.x, shardScale.y, shardScale.z);
        dummy.updateMatrix();
        this.shardMesh.setMatrixAt(shardIndex, dummy.matrix);
        color.setHex(TILE_COLOR_HEX[cell.color]);
        if (this.committedMaterialRuntime?.baseColor) {
          color.lerp(new THREE.Color(this.committedMaterialRuntime.baseColor), 0.62);
        }
        this.shardMesh.setColorAt(shardIndex, color);
        shardIndex += 1;
      }

      for (
        let particle = 0;
        particle < particlesPerCell && particleIndex < MAX_PARTICLES;
        particle += 1
      ) {
        const baseIndex = 50_000 + cellIndex * 83 + particle * 17;
        const angle = seededFloat(clearing.seed, baseIndex) * Math.PI * 2;
        const speed = 2.2 + seededFloat(clearing.seed, baseIndex + 1) * 3.9;
        const offset = particleIndex * 3;
        this.particlePositions[offset] = origin.x + Math.cos(angle) * speed * t;
        this.particlePositions[offset + 1] = origin.y + Math.sin(angle) * speed * t;
        this.particlePositions[offset + 2] =
          origin.z + 0.45 + (1.2 + seededFloat(clearing.seed, baseIndex + 2) * 3) * t;
        color.setHex(TILE_COLOR_HEX[cell.color]);
        if (this.committedMaterialRuntime?.baseColor) {
          color.lerp(new THREE.Color(this.committedMaterialRuntime.baseColor), 0.45);
        }
        const particleLuminanceBoost = (this.style?.lookDev.id === 'neutral-lookdev' ? 1 : 1.12) * sparkBoost;
        this.particleColors[offset] = color.r * particleLuminanceBoost;
        this.particleColors[offset + 1] = color.g * particleLuminanceBoost;
        this.particleColors[offset + 2] = color.b * particleLuminanceBoost;
        particleIndex += 1;
      }
    }

    this.shardMesh.count = shardIndex;
    this.shardMesh.instanceMatrix.needsUpdate = true;
    if (this.shardMesh.instanceColor) this.shardMesh.instanceColor.needsUpdate = true;
    const runtime = this.committedMaterialRuntime;
    this.shardMaterial.roughness = runtime ? Math.min(0.95, Math.max(0.18, runtime.roughness)) : 0.55;
    this.shardMaterial.metalness = runtime ? runtime.metalness : 0.04;
    this.shardMaterial.opacity = Math.pow(1 - progress, 0.44);
    this.particleMaterial.opacity = Math.pow(1 - progress, 0.7);
    const position = this.particleGeometry.getAttribute('position');
    const particleColor = this.particleGeometry.getAttribute('color');
    position.needsUpdate = true;
    particleColor.needsUpdate = true;
    this.particleGeometry.setDrawRange(0, particleIndex);

    center.divideScalar(Math.max(1, clearing.clear.cells.length));
    this.shockwave.visible = true;
    this.shockwave.position.set(center.x, center.y, 1.15);
    const ringScale = 0.48 + easeOutCubic(progress) * 2.15;
    this.shockwave.scale.setScalar(ringScale);
    this.shockwaveMaterial.opacity = Math.sin(progress * Math.PI) * 0.2;

    if (this.style) {
      const bloom = resolveLookDevBloom(
        this.style.lookDev,
        this.quality,
        progress,
        this.style.fx,
      );
      this.bloomPass.strength = bloom.strength;
      this.bloomPass.threshold = bloom.threshold;
      this.bloomPass.radius = bloom.radius;
    }
  }

  private normalizedPointOnPlane(
    normalized: { x: number; y: number },
    planeZ: number,
  ): THREE.Vector3 | null {
    const ndc = new THREE.Vector2(normalized.x * 2 - 1, -(normalized.y * 2 - 1));
    this.raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ);
    const point = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, point) ? point : null;
  }

  private updatePointer(): void {
    if (!this.frame?.pointer || !this.style?.showPointer) {
      this.pointerMesh.visible = false;
      return;
    }
    const normalized = this.frame.pointer;
    const point = this.normalizedPointOnPlane(normalized, 1.9);
    if (!point) {
      this.pointerMesh.visible = false;
      return;
    }
    this.pointerMesh.visible = true;
    this.pointerMesh.position.copy(point);
    this.pointerMesh.scale.setScalar(normalized.pressed ? 0.82 : 1);
    this.pointerMaterial.opacity = normalized.pressed ? 1 : 0.72;
  }
}
