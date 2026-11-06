export class GamePlatformError extends Error {
  readonly code: string;
  readonly path?: string;
  readonly details?: unknown;

  constructor(code: string, message: string, options: { path?: string; details?: unknown } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options.path !== undefined) this.path = options.path;
    if (options.details !== undefined) this.details = options.details;
  }
}

export class GameRegistryError extends GamePlatformError {}
export class GameSchemaError extends GamePlatformError {}
export class GameRuntimeError extends GamePlatformError {}
