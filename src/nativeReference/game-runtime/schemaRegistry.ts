import type { RuntimeSchema } from './contracts';
import { GameRegistryError } from './errors';

export function schemaKey(id: string, version: string): string {
  return `${id}@${version}`;
}

export class SchemaRegistry {
  private readonly schemas = new Map<string, RuntimeSchema<unknown>>();

  register<T>(schema: RuntimeSchema<T>): void {
    const key = schemaKey(schema.id, schema.version);
    if (this.schemas.has(key)) {
      throw new GameRegistryError(
        'DUPLICATE_SCHEMA',
        `Schema ${key} is already registered.`,
        { details: { id: schema.id, version: schema.version } },
      );
    }
    this.schemas.set(key, schema as RuntimeSchema<unknown>);
  }

  unregister(id: string, version: string): void {
    this.schemas.delete(schemaKey(id, version));
  }

  get<T>(id: string, version: string): RuntimeSchema<T> {
    const key = schemaKey(id, version);
    const schema = this.schemas.get(key);
    if (!schema) {
      throw new GameRegistryError(
        'UNKNOWN_SCHEMA',
        `Schema ${key} is not registered.`,
        { details: { id, version } },
      );
    }
    return schema as RuntimeSchema<T>;
  }

  parse<T>(id: string, version: string, value: unknown): T {
    return this.get<T>(id, version).parse(value);
  }

  has(id: string, version: string): boolean {
    return this.schemas.has(schemaKey(id, version));
  }

  list(): Array<{ id: string; version: string }> {
    return [...this.schemas.values()].map((schema) => ({ id: schema.id, version: schema.version }));
  }
}
