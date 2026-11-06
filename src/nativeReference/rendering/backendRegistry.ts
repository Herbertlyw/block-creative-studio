import type { PresentationPacket } from '../game-runtime/presentationPacket';
import type { PixelSize } from './composition';
import type { PreparedRenderResources } from './preparedRenderResources';

export class RenderBackendError extends Error {
  readonly code: string;
  readonly path?: string;

  constructor(code: string, message: string, path?: string) {
    super(message);
    this.name = 'RenderBackendError';
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}

export interface RenderStage {
  resize(width: number, height: number, pixelRatio?: number): void;
  warmup(packet: PresentationPacket): Promise<void>;
  renderAt(packet: PresentationPacket): void;
  captureStill?(): HTMLCanvasElement;
  dispose(): void;
}

export interface RenderBackendAdapter {
  readonly id: string;
  readonly renderer: string;
  readonly cameraMicroProjection?: 'perspective' | 'orthographic' | 'flat';
  readonly supportedPresentationSchemas: readonly string[];
  readonly letterboxFromDesign: boolean;
  readonly designResolution?: PixelSize;
  createStage(canvas: HTMLCanvasElement, resources: PreparedRenderResources): RenderStage;
}

export function assertBackendSupportsPacket(
  backend: RenderBackendAdapter,
  packet: PresentationPacket,
): void {
  if (!backend.supportedPresentationSchemas.includes(packet.payloadSchemaId)) {
    throw new RenderBackendError(
      'BACKEND_SCHEMA_UNSUPPORTED',
      `Backend ${backend.id} does not support presentation schema ${packet.payloadSchemaId}.`,
      '$.payloadSchemaId',
    );
  }
}

const backends = new Map<string, RenderBackendAdapter>();

export function registerRenderBackend(adapter: RenderBackendAdapter): void {
  const existing = backends.get(adapter.id);
  if (existing) {
    if (existing !== adapter) {
      throw new RenderBackendError(
        'BACKEND_DUPLICATE',
        `Render backend ${adapter.id} is already registered.`,
        '$.id',
      );
    }
    return;
  }
  backends.set(adapter.id, adapter);
}

export function getRenderBackend(id: string): RenderBackendAdapter | undefined {
  return backends.get(id);
}

export function requireRenderBackend(id: string): RenderBackendAdapter {
  const backend = backends.get(id);
  if (!backend) {
    throw new RenderBackendError('BACKEND_UNKNOWN', `Unknown render backend ${id}.`, '$.id');
  }
  return backend;
}

export function unregisterRenderBackend(id: string): void {
  backends.delete(id);
}
