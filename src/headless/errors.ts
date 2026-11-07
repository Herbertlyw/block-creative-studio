export class BcsHeadlessError extends Error {
  readonly code: string;
  readonly path?: string;
  readonly recoverable: boolean;
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    options: { path?: string; recoverable?: boolean; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'BcsHeadlessError';
    this.code = code;
    if (options.path !== undefined) this.path = options.path;
    this.recoverable = options.recoverable ?? true;
    if (options.details !== undefined) this.details = options.details;
  }
}
