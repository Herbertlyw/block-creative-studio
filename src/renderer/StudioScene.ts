import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  boardFingerprint,
  canPlace,
  pieceCellColor,
} from '../nativeReference/games/block-placement/runtime/gameEngine';
import { seededFloat } from '../nativeReference/domain/rng';
import { getShape, getShapeBounds } from '../nativeReference/games/block-placement/runtime/shapes';
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
import { createBlockMaterial, LIGHTING_VALUES, TILE_COLOR_HEX } from './materialPresets';

export interface StudioSceneOptions {
  quality?: 'interactive' | 'cinematic';
  alpha?: boolean;
}

/** Only the appearance values actually consumed by the 3D backend. */
export type ThreeSceneStyle = Pick<
  StyleSpec,
  'material' | 'lighting' | 'camera' | 'fx' | 'geometry' | 'background' | 'showPointer'
>;

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
  private readonly whiteColor = new THREE.Color(0xffffff);
  private readonly materialCache = new Map<string, THREE.MeshPhysicalMaterial>();
  private readonly slotMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x17213a,
    roughness: 0.42,
    metalness: 0.05,
    clearcoat: 0.35,
    clearcoatRoughness: 0.2,
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
    roughness: 0.3,
    metalness: 0.16,
    clearcoat: 0.62,
    clearcoatRoughness: 0.12,
  });
  private readonly plateGeometry = new RoundedBoxGeometry(8.68, 8.68, 0.46, 8, 0.38);
  private readonly slotGeometry = new RoundedBoxGeometry(0.9, 0.9, 0.15, 3, 0.16);
  private readonly shardGeometry = new THREE.TetrahedronGeometry(0.2, 0);
  private readonly shardMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.2,
    metalness: 0.05,
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
    color: 0xffffff,
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

  private style: ThreeSceneStyle | null = null;
  private frame: PresentationFrame | null = null;
  private currentBoardKey = '';
  private currentRackKey = '';
  private currentDragKey = '';
  private currentUiKey = '';
  private currentLighting = '';
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
      this.quality === 'cinematic' ? 0.45 : 0.32,
      0.52,
      0.82,
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

  resize(width: number, height: number, pixelRatio = 1): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.renderer.setPixelRatio(Math.max(0.5, Math.min(2, pixelRatio)));
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(Math.max(0.5, Math.min(2, pixelRatio)));
    this.composer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
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

  setFrame(frame: PresentationFrame, style: ThreeSceneStyle): void {
    if (this.disposed) return;
    this.frame = frame;
    this.style = style;
    this.applyShardMaterial(style);
    this.syncCamera(frame.cameraPunch);
    this.syncScene();
  }

  setLiveSnapshot(snapshot: GameSnapshot, style: ThreeSceneStyle): void {
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

  pick(clientX: number, clientY: number): PickResult {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
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
    return null;
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
    return Boolean(
      piece &&
        canPlace(this.frame?.snapshot.board ?? { rows: 0, cols: 0, cells: [] }, piece, anchor),
    );
  }

  render(time = this.rafTime): void {
    if (!this.frame || !this.style || this.disposed) return;
    this.syncCamera(this.frame.cameraPunch);
    this.updateFx(time);
    this.updatePointer();
    this.composer.render();
  }

  renderAt(frame: PresentationFrame, style: ThreeSceneStyle): void {
    this.setFrame(frame, style);
    this.render(frame.frame * (1000 / Math.max(1, frame.fps)));
  }

  async warmup(frame: PresentationFrame, style: ThreeSceneStyle): Promise<void> {
    this.renderAt(frame, style);
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
    this.environmentTarget.dispose();
    for (const material of this.materialCache.values()) material.dispose();
    this.materialCache.clear();
    disposeGroupObjects(this.uiRoot);
    this.composer.dispose();
    this.renderer.dispose();
  }

  private pickCellOnly(clientX: number, clientY: number): GridCell | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const object = this.raycaster.intersectObjects(this.cellHitTargets, false)[0]?.object;
    if (object?.userData.kind !== 'cell') return null;
    return { row: object.userData.row as number, col: object.userData.col as number };
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
    this.ensureLighting();
    this.syncBackground();

    const clearingKey = this.frame.clearing
      ? `${this.frame.clearing.seed}:${Math.round(this.frame.clearing.progress * 90)}`
      : 'none';
    const boardKey = `${boardFingerprint(this.frame.board)}:${this.currentGeometryKey}:${this.style.material}:${clearingKey}`;
    if (boardKey !== this.currentBoardKey) {
      this.rebuildBoardTiles();
      this.currentBoardKey = boardKey;
    }

    const rackKey = `${this.frame.snapshot.pieces
      .map(
        (piece) =>
          `${piece.id}:${piece.shapeId}:${piece.color}:${piece.cellColors?.join('.') ?? ''}:${piece.used ? 1 : 0}`,
      )
      .join(
        ',',
      )}:${this.frame.hiddenPieceId ?? ''}:${this.currentGeometryKey}:${this.style.material}`;
    if (rackKey !== this.currentRackKey) {
      this.rebuildRack();
      this.currentRackKey = rackKey;
    }

    const dragKey = this.frame.draggedPiece
      ? `${this.frame.draggedPiece.piece.id}:${this.frame.draggedPiece.piece.shapeId}:${this.frame.draggedPiece.piece.color}:${this.frame.draggedPiece.piece.cellColors?.join('.') ?? ''}:${this.frame.draggedPiece.anchor.row}:${this.frame.draggedPiece.anchor.col}:${this.frame.draggedPiece.progress.toFixed(3)}:${this.frame.draggedPiece.pointerDriven ? 1 : 0}:${this.frame.pointer?.x.toFixed(4) ?? ''}:${this.frame.pointer?.y.toFixed(4) ?? ''}:${this.currentGeometryKey}:${this.style.material}`
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

  private ensureLighting(): void {
    if (!this.style || this.currentLighting === this.style.lighting) return;
    for (const child of [...this.lightingRoot.children]) this.lightingRoot.remove(child);
    const values = LIGHTING_VALUES[this.style.lighting];
    this.renderer.toneMappingExposure = values.exposure;

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
    this.currentLighting = this.style.lighting;
  }

  private syncBackground(): void {
    if (!this.style || this.currentBackground === this.style.background) return;
    this.backgroundTexture?.dispose();
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 1024;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create background canvas context.');
    const base = new THREE.Color(this.style.background);
    const top = base.clone().lerp(new THREE.Color(0x253f82), 0.35);
    const bottom = base.clone().multiplyScalar(0.42);
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, `#${top.getHexString()}`);
    gradient.addColorStop(0.55, `#${base.getHexString()}`);
    gradient.addColorStop(1, `#${bottom.getHexString()}`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const glow = context.createRadialGradient(256, 410, 10, 256, 410, 380);
    glow.addColorStop(0, 'rgba(125,160,255,0.24)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, canvas.width, canvas.height);

    this.backgroundTexture = new THREE.CanvasTexture(canvas);
    this.backgroundTexture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.backgroundTexture;
    this.currentBackground = this.style.background;
  }

  private applyShardMaterial(style: ThreeSceneStyle): void {
    if (style.material === 'crystal-glass') {
      this.shardMaterial.roughness = 0.04;
      this.shardMaterial.metalness = 0.02;
    } else if (style.material === 'candy-resin') {
      this.shardMaterial.roughness = 0.32;
      this.shardMaterial.metalness = 0;
    } else {
      this.shardMaterial.roughness = 0.16;
      this.shardMaterial.metalness = 0.06;
    }
  }

  private getMaterial(color: TileColor, opacity = 1): THREE.MeshPhysicalMaterial {
    if (!this.style) throw new Error('Style not initialized.');
    const key = `${this.style.material}:${color}:${opacity.toFixed(2)}`;
    let material = this.materialCache.get(key);
    if (!material) {
      material = createBlockMaterial(color, this.style.material, opacity);
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
        const block = new THREE.Mesh(this.blockGeometry, this.getMaterial(color));
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

      for (const [[row, col], cellIndex] of shape.cells.map(
        (cell, index) => [cell, index] as const,
      )) {
        const mesh = new THREE.Mesh(
          this.blockGeometry,
          this.getMaterial(pieceCellColor(piece, cellIndex)),
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
    for (const [[row, col], cellIndex] of shape.cells.map(
      (cell, index) => [cell, index] as const,
    )) {
      const baseMaterial = this.getMaterial(pieceCellColor(piece, cellIndex), valid ? 0.86 : 0.58);
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
    const score = createLabelSprite(String(this.frame.snapshot.score).padStart(4, '0'), 'SCORE');
    score.position.set(0, 5.5, 1.2);
    this.uiRoot.add(score);

    if (this.frame.snapshot.combo > 1) {
      const combo = createLabelSprite(`× ${this.frame.snapshot.combo}`, 'COMBO', {
        accent: '#fff0a8',
        width: 640,
        height: 220,
      });
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
    const dynamicFactor = this.style.camera === 'dynamic-clear' ? 1 : 0.56;
    const effectivePunch = punch * dynamicFactor;
    const frame = this.frame?.frame ?? 0;
    const shakeX = Math.sin(frame * 2.13) * effectivePunch * 0.08;
    const shakeY = Math.cos(frame * 1.71) * effectivePunch * 0.055;

    if (this.style.camera === 'flat-gameplay') {
      this.camera.fov = 39;
      this.camera.position.set(shakeX, -0.15 + shakeY, 18.7 - effectivePunch * 0.22);
    } else if (this.style.camera === 'premium-perspective') {
      this.camera.fov = 42;
      this.camera.position.set(0.12 + shakeX, -1.1 + shakeY, 17.6 - effectivePunch * 0.35);
    } else {
      this.camera.fov = 43;
      this.camera.position.set(-0.15 + shakeX, -1.45 + shakeY, 17.1 - effectivePunch * 0.62);
    }
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
      this.bloomPass.strength = this.quality === 'cinematic' ? 0.46 : 0.31;
      this.shardMesh.count = 0;
      this.particleGeometry.setDrawRange(0, 0);
      this.shockwave.visible = false;
      return;
    }

    const progress = clamp01(clearing.progress);
    const t = progress * 0.78;
    const shardsPerCell =
      this.style?.fx === 'clean-pop' ? 3 : this.quality === 'cinematic' ? 10 : 6;
    const particlesPerCell = this.style?.fx === 'energy-burst' ? 11 : 6;
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
        const speed = 1.45 + seededFloat(clearing.seed, baseIndex + 1) * 2.65;
        const lift = 1.4 + seededFloat(clearing.seed, baseIndex + 2) * 2.6;
        dummy.position.set(
          origin.x + Math.cos(angle) * speed * t,
          origin.y + Math.sin(angle) * speed * t - 1.3 * t * t,
          origin.z + 0.15 + lift * t - 3.4 * t * t,
        );
        dummy.rotation.set(
          t * (3 + seededFloat(clearing.seed, baseIndex + 3) * 8),
          t * (2 + seededFloat(clearing.seed, baseIndex + 4) * 7),
          t * (2 + seededFloat(clearing.seed, baseIndex + 5) * 9),
        );
        const scale =
          (0.7 + seededFloat(clearing.seed, baseIndex + 6) * 0.68) * Math.pow(1 - progress, 0.36);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        this.shardMesh.setMatrixAt(shardIndex, dummy.matrix);
        color.setHex(TILE_COLOR_HEX[cell.color]).lerp(this.whiteColor, 0.16);
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
        color.setHex(TILE_COLOR_HEX[cell.color]).lerp(this.whiteColor, 0.5);
        this.particleColors[offset] = color.r;
        this.particleColors[offset + 1] = color.g;
        this.particleColors[offset + 2] = color.b;
        particleIndex += 1;
      }
    }

    this.shardMesh.count = shardIndex;
    this.shardMesh.instanceMatrix.needsUpdate = true;
    if (this.shardMesh.instanceColor) this.shardMesh.instanceColor.needsUpdate = true;
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
    const ringScale = 0.7 + easeOutCubic(progress) * 5.4;
    this.shockwave.scale.setScalar(ringScale);
    this.shockwaveMaterial.opacity = Math.sin(progress * Math.PI) * 0.5;

    this.bloomPass.strength =
      (this.quality === 'cinematic' ? 0.46 : 0.31) +
      Math.sin(progress * Math.PI) * (this.style?.fx === 'energy-burst' ? 0.42 : 0.24);
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
