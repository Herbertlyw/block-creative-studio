type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;

/** Remove only superseded entries that no remaining consumer or asset references.
 * The caller owns a cloned document; original files and unrelated library entries stay intact. */
export function pruneSupersededAssets(document: unknown, superseded: Iterable<string>): string[] {
  const root = record(document),
    direction = record(root?.direction);
  const style = record(direction?.style),
    extension = record(style?.agentAssets);
  const production = record(direction?.production),
    audio = record(production?.audio);
  const tables = [record(extension?.entries), record(audio?.assets)].filter(
    (v): v is RecordValue => !!v,
  );
  const candidates = new Set(superseded);
  const ids = [...new Set(tables.flatMap((table) => Object.keys(table)))];
  const used = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      // Be conservative about reference syntax used by extension contracts.
      for (const id of ids)
        if (value === id || value.includes(`asset:${id}`) || value.includes(`"${id}"`))
          used.add(id);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (record(value)) {
      if (tables.includes(value as RecordValue)) return;
      for (const [key, child] of Object.entries(value as RecordValue)) {
        if (
          key === 'data' &&
          (value as RecordValue).encoding === 'base64' &&
          typeof child === 'string'
        )
          continue;
        visit(child);
      }
    }
  };
  visit(document);
  // Unrelated assets may be intentionally kept in the project's library.
  for (const id of ids) if (!candidates.has(id)) used.add(id);
  const visited = new Set<string>();
  while ([...used].some((id) => !visited.has(id))) {
    for (const id of [...used]) {
      if (visited.has(id)) continue;
      visited.add(id);
      for (const table of tables) if (table[id]) visit(table[id]);
    }
  }
  const removed: string[] = [];
  for (const id of candidates)
    if (!used.has(id)) {
      for (const table of tables)
        if (Object.hasOwn(table, id)) {
          delete table[id];
          removed.push(id);
        }
    }
  return removed;
}
