/** Checks cross-references from the received V2 projectDocument and migration contracts.
 * This does not parse a game state, recompute its hash, or validate game legality. */
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function inspectNativeReplay(value: unknown): string[] {
  const root = object(value),
    game = object(root?.game),
    identity = object(game?.game),
    state = object(game?.initialState);
  if (!Array.isArray(root?.takes)) return ['$.takes：未找到 Take 数组，无法检查回放关联。'];
  if (root.takes.length === 0) return ['$.takes：没有 Take，无法检查回放关联。'];
  const issues: string[] = [];
  for (const [ti, item] of root.takes.entries()) {
    const take = object(item),
      path = `$.takes[${ti}]`;
    if (!take) {
      issues.push(`${path}：不是回放对象。`);
      continue;
    }
    if (take.gameId !== identity?.id || take.moduleVersion !== identity?.moduleVersion)
      issues.push(`${path}：游戏或模块版本与工程不一致。`);
    if (take.initialStateHash !== state?.stateHash || typeof take.initialStateHash !== 'string')
      issues.push(`${path}.initialStateHash：与工程初始状态哈希引用不一致。`);
    if (!Array.isArray(take.actions) || !Array.isArray(take.interactions)) {
      issues.push(`${path}：缺少动作或交互数组。`);
      continue;
    }
    const actions = take.actions.map(object),
      interactions = take.interactions.map(object);
    const ids = new Set<string>();
    for (const [ai, action] of actions.entries()) {
      const ap = `${path}.actions[${ai}]`,
        id = action?.id;
      if (typeof id !== 'string' || !id) {
        issues.push(`${ap}：缺少动作 ID。`);
        continue;
      }
      if (ids.has(id)) issues.push(`${ap}：动作 ID 重复（${id}）。`);
      ids.add(id);
      const committed = interactions.filter((interaction) => interaction?.committedActionId === id);
      if (!committed.length)
        issues.push(`${ap}（${id}）：缺少提交该动作的交互，无法按参考迁移成 Take。`);
      if (committed.length > 1)
        issues.push(`${ap}（${id}）：多个交互指向该动作，参考迁移只读取第一个。`);
    }
    for (const [ii, interaction] of interactions.entries()) {
      const ip = `${path}.interactions[${ii}]`;
      if (!interaction) {
        issues.push(`${ip}：不是交互对象。`);
        continue;
      }
      const committed = interaction.committedActionId;
      if (committed !== undefined && (typeof committed !== 'string' || !ids.has(committed)))
        issues.push(`${ip}.committedActionId：未指向已有动作。`);
      const start = interaction.startFrame,
        end = interaction.endFrame;
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        (end as number) < (start as number)
      ) {
        issues.push(`${ip}：帧区间无效。`);
        continue;
      }
      const duration = (end as number) - (start as number);
      if (committed !== undefined && duration < 1) issues.push(`${ip}：动作交互时长不足一帧。`);
      if (interaction.samples !== undefined && !Array.isArray(interaction.samples)) {
        issues.push(`${ip}.samples：必须是数组。`);
        continue;
      }
      let previous = -1;
      if (Array.isArray(interaction.samples))
        for (const [si, sample] of interaction.samples.entries()) {
          const frame = object(sample)?.frameOffset;
          if (
            !Number.isInteger(frame) ||
            (frame as number) < previous ||
            (frame as number) < 0 ||
            (frame as number) > duration
          )
            issues.push(`${ip}.samples[${si}].frameOffset：须不递减且位于交互时长内。`);
          if (typeof frame === 'number') previous = frame;
        }
    }
  }
  return issues;
}
