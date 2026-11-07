import type {
  CompiledBlockerEdge,
  LevelValidationIssue,
  LevelValidationReport,
  TapTileProjectV2,
} from '../../project';
import { LEVEL_VALIDATION_CODES as CODES } from './validationCodes';

function issue(
  severity: LevelValidationIssue['severity'],
  code: string,
  message: string,
  objectIds: string[] = [],
  suggestion?: string,
): LevelValidationIssue {
  return { severity, code, message, objectIds, ...(suggestion ? { suggestion } : {}) };
}

function detectCycle(nodes: readonly string[], edges: readonly CompiledBlockerEdge[]): string[] | null {
  const outgoing = Object.fromEntries(nodes.map((id) => [id, [] as string[]]));
  for (const edge of edges) outgoing[edge.blockerId]?.push(edge.blockedId);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      return [...path.slice(Math.max(0, start)), id];
    }
    if (visited.has(id)) return null;
    visiting.add(id);
    path.push(id);
    for (const next of outgoing[id] ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  };
  for (const id of nodes) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

export function validateTapTileLevel(
  project: TapTileProjectV2,
  edges: readonly CompiledBlockerEdge[],
  playableIds: readonly string[],
): LevelValidationReport {
  const issues: LevelValidationIssue[] = [];
  const instances = project.level.tileInstances;
  const ids = new Set<string>();
  const orders = new Map<number, string>();

  if (instances.length === 0) issues.push(issue('error', CODES.empty, '关卡没有牌。', [], '从模板或牌面库添加至少三张牌。'));
  for (const tile of instances) {
    if (ids.has(tile.id)) issues.push(issue('error', CODES.duplicateTileId, `牌 ID ${tile.id} 重复。`, [tile.id], '为重复实例生成新的稳定 ID。'));
    ids.add(tile.id);
    const archetype = project.visuals.archetypes[tile.archetypeId];
    if (!archetype) {
      issues.push(issue('error', CODES.missingArchetype, `牌 ${tile.id} 引用了不存在的 archetype ${tile.archetypeId}。`, [tile.id, tile.archetypeId]));
    } else if (!archetype.matchKey) {
      issues.push(issue('error', CODES.missingMatchKey, `牌型 ${archetype.id} 缺少 matchKey。`, [tile.id, archetype.id]));
    }
    const geometry = tile.geometry;
    if (![geometry.centerXPx, geometry.centerYPx, geometry.widthPx, geometry.heightPx].every(Number.isInteger)) {
      issues.push(issue('error', CODES.nonIntegerGeometry, `牌 ${tile.id} 不是整数输出像素几何。`, [tile.id]));
    }
    if (geometry.widthPx <= 0 || geometry.heightPx <= 0) issues.push(issue('error', CODES.invalidSize, `牌 ${tile.id} 宽高必须大于 0。`, [tile.id]));
    if (!Number.isInteger(geometry.layer) || geometry.layer < 0) issues.push(issue('error', CODES.invalidLayer, `牌 ${tile.id} 层级必须是非负整数。`, [tile.id]));
    const existingOrder = orders.get(geometry.order);
    if (existingOrder) issues.push(issue('warning', CODES.duplicateOrder, `牌 ${tile.id} 与 ${existingOrder} 使用相同 order。`, [existingOrder, tile.id], '重新整理稳定绘制顺序。'));
    else orders.set(geometry.order, tile.id);
    const halfDiagonal = Math.hypot(geometry.widthPx, geometry.heightPx) / 2;
    if (geometry.centerXPx + halfDiagonal < 0 || geometry.centerXPx - halfDiagonal > project.stage.exportWidth || geometry.centerYPx + halfDiagonal < 0 || geometry.centerYPx - halfDiagonal > project.stage.exportHeight) {
      issues.push(issue('error', CODES.outOfBounds, `牌 ${tile.id} 完全位于输出舞台之外。`, [tile.id], '把牌移回 1080×1920 舞台。'));
    }
    const theme = project.visuals.themes[project.visuals.selectedThemeId];
    const binding = theme?.bindings[tile.archetypeId];
    if (!binding || !project.visuals.faceAssemblies[binding.faceAssemblyId] || !project.visuals.bodyStyles[binding.bodyStyleId]) {
      issues.push(issue('error', CODES.missingVisualBinding, `当前主题没有完整覆盖牌 ${tile.id} 的牌型。`, [tile.id, tile.archetypeId], '补齐 FaceAssembly 和 BodyStyle 绑定。'));
    }
  }

  const byId = Object.fromEntries(instances.map((tile) => [tile.id, tile]));
  for (const edge of [...project.level.blockerOverrides.ignored, ...project.level.blockerOverrides.forced]) {
    if (!byId[edge.blockerId] || !byId[edge.blockedId] || edge.blockerId === edge.blockedId) {
      issues.push(issue('error', CODES.invalidOverride, `阻挡覆盖 ${edge.blockerId} → ${edge.blockedId} 引用了无效对象或自环。`, [edge.blockerId, edge.blockedId]));
    }
  }
  for (const edge of project.level.blockerOverrides.forced) {
    const blocker = byId[edge.blockerId];
    const blocked = byId[edge.blockedId];
    if (blocker && blocked && blocker.geometry.layer <= blocked.geometry.layer) {
      issues.push(issue('error', CODES.forcedDirection, `人工阻挡 ${edge.blockerId} → ${edge.blockedId} 必须从高层指向低层。`, [edge.blockerId, edge.blockedId], '调整层级后再添加人工阻挡。'));
    }
  }
  const cycle = detectCycle([...ids], edges);
  if (cycle) issues.push(issue('error', CODES.graphCycle, `阻挡图存在环：${cycle.join(' → ')}。`, cycle, '删除人工边或调整层级。'));
  if (instances.length > 0 && playableIds.length === 0) issues.push(issue('error', CODES.noPlayable, '初始状态没有可点击牌。', [], '查看阻挡关系并移除环路或错误人工边。'));

  issues.push(issue('info', 'LEVEL_STATISTICS', `关卡包含 ${instances.length} 张牌、${edges.length} 条阻挡边、${playableIds.length} 张初始可点击牌。`));
  return {
    valid: !issues.some((candidate) => candidate.severity === 'error'),
    issues,
    statistics: {
      tileCount: instances.length,
      archetypeCount: new Set(instances.map((tile) => tile.archetypeId)).size,
      edgeCount: edges.length,
      playableCount: playableIds.length,
    },
  };
}
