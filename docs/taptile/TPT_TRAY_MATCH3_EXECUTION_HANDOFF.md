# TapTile 7 槽三消前端导演台：Codex 执行交接与完整开发计划

> **文档日期**：2026-09-02  
> **目标仓库**：`Herbertlyw/block-creative-studio`  
> **当前远端参考分支**：`feature/taptile-stack-studio`  
> **编写时观察到的远端基线提交**：`c1c455800a627b1b1a835fdf4a772e30a068e088`（`feat: add TapTile gameplay engine and video audit`）  
> **建议放入仓库的位置**：`docs/taptile/TPT_TRAY_MATCH3_EXECUTION_HANDOFF.md`  
> **建议后续开发分支**：`feature/taptile-tray-match3-director-v1`  
> **本文性质**：执行规格，不是讨论稿。新 Codex 会话应阅读后直接检查代码、实施、测试、提交，不要只重新输出一份计划。

---

## 0. 新 Codex 会话必须先做的事情

进入仓库后，先执行并记录实际结果：

```bash
git status --short
git branch --show-current
git log --oneline -8
node --version
npm --version
```

然后阅读：

```text
docs/taptile/TPT_TRAY_MATCH3_EXECUTION_HANDOFF.md   ← 本文
docs/taptile/TPT_GAMEPLAY_SPEC.md
docs/taptile/TPT_VIDEO_AUDIT.md
docs/taptile/TPT_PIXEL_ALIGNMENT.md
docs/taptile/TPT_ATOM_CATALOG.md
README.md
package.json
```

再检查以下现有实现，不要凭文档猜代码：

```text
src/taptile/TapTileStackStudio.tsx
src/taptile/stackModel.ts
src/taptile/pixelGeometry.ts
src/taptile/smartSnap.ts
src/taptile/stackAlignment.ts
src/taptile/stackSelection.ts
src/taptile/gameplay/types.ts
src/taptile/gameplay/blockers.ts
src/taptile/gameplay/tray.ts
src/taptile/gameplay/engine.ts
tests/taptileGameplay.test.ts
scripts/smoke-taptile-cdp.ps1
```

基线校验：

```bash
npm install
npm run check
npm test
npm run typecheck
npm run build
```

在 Windows 且 Chrome 可用时，再运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-taptile-cdp.ps1
```

### Git 安全规则

禁止执行：

```text
git reset --hard
git clean -fd
git checkout -- .
覆盖未读过的用户文件
无差别回滚本地未提交改动
```

如果工作区不干净：

1. 逐个查看差异；
2. 判断是否属于现有 TapTile 工作；
3. 在不覆盖用户改动的前提下继续；
4. 必要时创建可读的 WIP 检查点提交，但不要用 stash 隐藏未知改动；
5. 在交付说明中列出保留、修改和未触碰的文件。

远端提交号只用于理解基线，**不得假设本地仓库恰好等于该提交**。

---

## 1. 项目目标

我们要做的不是一个普通休闲小游戏，也不是把 AE 的几百个图层原样搬进浏览器。

目标产品是：

> **TapTile 7 槽三消前端游戏导演台**。

它应让用户在浏览器内完成：

```text
搭建牌堆
→ 编译遮挡关系
→ 校验关卡
→ 真人或 Agent 试玩
→ 保存语义 Take
→ 更换牌面、牌体、背景、HUD 和槽位皮肤
→ 更换手势、飞牌、槽位运动、三消特效、镜头和节奏
→ 固定帧回放
→ 导出视频
→ 批量生成素材变体
```

核心价值不是“能改坐标”，而是让不懂代码的人也能像使用 WPS 流程图、PPT 或 Figma 一样搭牌堆、调素材和导演玩法：

- 直接拖拽；
- 智能吸附；
- 框选、多选和批量操作；
- 层级与遮挡关系清楚；
- 所有编辑可撤销、可保存、可复现；
- 同一玩法 Take 可以重复换皮和重新导演；
- 导出结果确定，不依赖实时录屏运气。

---

## 2. 一期范围已经锁定

### 2.1 唯一正式规则 Profile

```ts
ruleProfileId: 'taptile-tray-match3-v1'
```

规则固定为：

```text
只有没有活动上层 blocker 的牌可点击
→ 合法牌从棋盘逻辑状态移除
→ 按 matchKey 插入 7 格槽位中的同类组尾部
→ 同一 matchKey 达到 3 张时立即逻辑清除
→ 清除后剩余槽位牌左移补位
→ 上层牌移除后，下层牌解锁
→ 先解析三消，再检查 7 格是否仍满
→ 棋盘和槽位都为空时胜利
→ 解析后槽位仍达到 7 张时失败
```

### 2.2 一期不做

以下内容不得进入正式 UI、正式 Schema 或正式运行链：

```text
direct-set-clear
manual-in-place-match
原位三消
整盘坍缩或重排
目标收集关
问号牌
×2 牌
大型金币
撤回、洗牌、提示、加槽、复活
严格 Combo 公式
严格评价词阈值
AE/AEP 自动导入
浏览器直接解析 PSD
Saber、Particular、Real Glow 等插件复刻
Blender 互通
3D 牌局主链
完整随机关卡生成器
```

已有研究代码可以保留在 `experimental` 命名空间或文档中，但正式入口只允许 7 槽三消。

### 2.3 需要预留，但不实现的扩展缝

数据结构可预留：

- 目标事件；
- 特殊牌类型；
- 外部资产 Provider；
- 透明序列特效；
- AE/Blender Adapter；
- 其他 RuleProfile。

预留不能等于把这些能力塞进一期状态机。

---

## 3. 证据、产品决策与未知项必须分层

### 3.1 视频审计支持的事实

现有视频审计可以支持：

- 主流玩法有 7 个槽位；
- 6/7 时会出现只剩一格的警告；
- 相同牌进入槽位后会自动靠拢；
- 第三张同面牌触发清除；
- 牌从棋盘移除后，其他棋盘牌不做物理重力坠落；
- 是否可点击由上层覆盖关系决定；
- 被遮挡牌点击会被拒绝；
- 逻辑结算与碎裂、评价词、彩屑等表现可以重叠，输入不必等全部 VFX 结束。

### 3.2 当前产品明确采用的决策

以下属于产品决策，不得冒充“官方规则已被完全逆向”：

- 未解析三消的第 7 张导致失败；
- 严格胜利条件为棋盘与槽位同时为空；
- 同层牌不互相阻挡；确需先后关系就调整层级；
- 一期固定 3 消、7 槽，不在 UI 中开放修改；
- 第一版使用 Canvas 2D 作为正式运行与导出渲染后端；
- 第一版不接目标、特殊牌和道具；
- 遮挡阈值保持可配置，当前值只能视作工程默认值，不能声称是真实游戏公式。

### 3.3 仍然未知或证据不足

- 商业原作精确的遮挡相交阈值；
- 完整失败演出与复活规则；
- Good / Great / Amazing 等评级公式；
- Combo 的严格计算；
- 特殊金币、问号、×2 的完整逻辑。

遇到这些点时，使用显式配置和可替换策略，不要编造“官方算法”。

---

## 4. 复杂 AE 工程对本项目的有效结论

用户提供的多个 AE 工程拆解不用于改变 7 槽三消规则，而用于决定**视觉资产和导演系统怎样建模**。

必须吸收以下结论：

### 4.1 牌面不一定是一张透明 PNG

至少支持三种正式模式：

```text
overlay-on-body
    透明图案叠在牌体上

full-front
    完整正面素材覆盖前表面，可能自带底板、材质和阴影

composed
    多个部件、数字/单位、重复子元素组合成一张牌面
```

后续可以扩展 PSD layer、预合成等来源，但一期运行时先统一转为普通图片或组合描述。

### 4.2 牌体不一定全局唯一

同一主题内可以有多个 `BodyStyle`，不同逻辑牌型可绑定不同颜色或材质的牌体。

### 4.3 逻辑牌型不能依赖旧合成名、文件名或图片路径

必须显式分离：

```text
matchKey           决定哪三张匹配
TileArchetype      逻辑牌型身份
FaceAssembly       牌面怎样组成
BodyStyle          牌体怎样显示
ThemeVariant       同一逻辑身份在某套皮肤中的视觉绑定
```

### 4.4 同一逻辑牌会有多个表现实例角色

```text
board          棋盘实例
flight         飞向槽位的移动实例
tray           槽位实例
match-ghost    清除 VFX 期间的表现副本
hud-preview    UI 中展示的牌
```

这些角色必须读取同一套视觉绑定，不能出现棋盘已换皮、飞行和槽位仍使用旧牌面的情况。

### 4.5 背景不是单个 background.png

应支持 `StageAssembly`：

```text
base background
ambient layers
foreground layers
overlays
HUD
```

一期可以只实现图片和简单程序化层，但模型必须允许多层。

### 4.6 三消反馈是 Bundle，不是单个文件

一次 `match.resolved` 可以并行触发：

```text
预闪
牌体脉冲
裂纹
碎片
粒子
评价词
镜头冲击
音效
```

### 4.7 替换能力分级

- **A 级直接替换**：牌面、牌体、背景、槽位皮肤、HUD、手指素材、音频、透明序列、片尾；
- **B 级重新编译**：手势路径、飞牌、槽位归组运动、三消 Recipe、镜头、时间；
- **C 级适配或降级**：AE 插件和复杂表达式，使用 Web 预设、透明序列或以后保留 AE 后端；
- **D 级整体替换**：已烘焙进视频像素、没有独立图层的内容。

一期重点完成 A 和 B；C、D 只定义契约和回退标记。

---

## 5. 当前仓库基线与已知问题

### 5.1 已有能力，应保留

当前 TapTile 编辑器已经具备：

- 沙漏、T 型、阶梯、自由模板；
- 单张和多张牌拖拽；
- 中心、边缘、两牌缝线、等距和舞台中心吸附；
- 吸附磁滞、参考线、目标高亮；
- Shift 多选、空白框选、Shift 追加框选；
- Ctrl+A、Esc、复制、删除；
- 批量移动、对齐、等距、层级、缩放、旋转、锁定；
- 撤销、重做、自动保存、JSON 导入导出；
- 432×768 编辑舞台到 1080×1920 输出舞台的 2.5 倍整数像素体系；
- 第一版纯 TypeScript gameplay 研究代码；
- Vitest、类型检查、构建和 CDP 冒烟测试基础。

不要推倒重写这些交互。

### 5.2 当前实现的主要技术债

1. `TapTileStackStudio.tsx` 过大，编辑、状态、UI 和未来玩法会继续耦合；
2. `faceId` 同时承担匹配身份和视觉身份；
3. `locked` 是编辑器锁定，却被现有玩法代码当作不可点击；
4. `gameplay` 同时支持三种玩法模式，和当前收口方向不一致；
5. `blockers.ts` 使用轴对齐矩形，忽略旋转；
6. 阻挡关系在运行时反复扫描，没有形成冻结的 `CompiledLevel`；
7. 现有“预览”按钮没有接入真实 7 槽玩法 UI；
8. 没有完整 Take、确定性回放、TPT 导演编译器和 PresentationFrame；
9. TPT 尚未接入正式 Canvas 固定帧视频导出；
10. 视觉仍主要依赖 emoji/占位样式，复杂牌面模型未建立；
11. 当前测试仍覆盖目标系统和其他玩法模式，正式测试矩阵需要收口；
12. 主包已有体积警告，后续应做 workspace 与导出器的懒加载。

---

## 6. 冻结的架构原则

后续实现不得违反以下原则：

1. **规则单一**：一期正式链只有 `taptile-tray-match3-v1`。
2. **逻辑与视觉分离**：`matchKey` 不能由图片、文件名、合成名或素材 URI 推导。
3. **玩法几何与视觉边界分离**：换牌体、阴影、外发光不能改变 blocker graph。
4. **编辑锁定与玩法可点击分离**：`editorLocked` 只影响编辑器。
5. **工程数据与运行状态分离**：编辑器 Project 不在试玩过程中直接变异。
6. **关卡先编译再运行**：几何、阻挡图和反向依赖在进入试玩前冻结。
7. **语义 Action 是真相**：点击真相是 `tap(tileId)`，指针轨迹只是导演数据。
8. **逻辑结算不等待 VFX**：表现可以重叠，不能反向修改玩法结果。
9. **同一 Take 可重复导演**：换 Skin、Director、Audio 不重新求解关卡。
10. **固定帧可寻址**：任意 `frame=N` 必须能直接求值，不能依赖从 0 实时跑到 N。
11. **预览和导出同源**：同一 `PresentationFrame` 驱动浏览器预览和 MP4 导出。
12. **输出像素为几何真值**：正式关卡使用 1080×1920 整数输出像素；432×768 只作为编辑视图。
13. **稳定 ID，不靠文件名**：资产、牌型、主题和事件都使用显式 ID 与版本。
14. **迁移可回退**：旧工程自动迁移，但迁移失败不能破坏旧 autosave。
15. **所有随机均可复现**：粒子、音效变体、路径扰动使用 Seeded RNG。

---

## 7. 目标端到端架构

```text
TapTileProjectV2
    │
    ├── AssetManifest / TileVisualLibrary / ThemeVariant
    ├── LevelSpec
    ├── Take[]
    ├── DirectorProfile
    └── RenderSpec
            │
            ▼
Level Compiler
    ├── integer export-pixel geometry
    ├── rotated-rect blocker graph
    ├── reverse dependents graph
    ├── validation report
    └── levelHash
            │
            ▼
7-slot Match-3 Game Core
    ├── GameState
    ├── TapAction
    ├── Transition
    └── Semantic Events
            │
            ▼
Take Recorder / Take Validator / Solver
            │
            ▼
Director Compiler
    ├── pointer timeline
    ├── tile flight timeline
    ├── tray reorder timeline
    ├── match VFX bundle
    ├── camera / praise / audio cues
    └── compiledTake
            │
            ▼
evaluateFrame(compiledTake, frame)
            │
            ▼
TapTilePresentationFrame
            │
            ├── Canvas 2D Preview
            ├── Fixed-frame MP4 Export
            └── Audio Mix / Cut / Outro / Batch
```

---

## 8. 目标数据模型

以下接口是方向约束。实现时可以拆文件，但不要退回到单字段耦合模型。

### 8.1 Project V2

```ts
export interface TapTileProjectV2 {
  format: 'taptile-director-project';
  schemaVersion: '2.0.0';

  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;

  ruleProfileId: 'taptile-tray-match3-v1';

  stage: TapTileStageSpec;
  assets: AssetManifest;
  visuals: TileVisualLibrary;
  level: TapTileLevelSpec;
  takes: TapTileTake[];
  selectedTakeId?: string;

  director: TapTileDirectorProjectSpec;
  render: TapTileRenderSpec;
  authoring: TapTileAuthoringSettings;
}
```

### 8.2 坐标与舞台

```ts
export interface TapTileStageSpec {
  authoringWidth: 432;
  authoringHeight: 768;
  exportWidth: 1080;
  exportHeight: 1920;
  scale: 2.5;
  fps: 30;
  safeAreas: Record<string, PixelRect>;
}
```

持久化的玩法几何建议直接使用输出像素整数：

```ts
export interface TileGameplayGeometry {
  centerXPx: number;   // integer
  centerYPx: number;   // integer
  widthPx: number;     // integer
  heightPx: number;    // integer
  rotationDeg: number;
  layer: number;       // non-negative integer
  order: number;       // stable integer
}
```

编辑器显示时做 `/ 2.5`，拖动提交时再量化回整数输出像素。

### 8.3 逻辑牌型与视觉主题

```ts
export interface TileArchetype {
  id: string;
  displayName: string;
  matchKey: string;
}

export interface ThemeVariant {
  id: string;
  name: string;
  bindings: Record<string, {
    faceAssemblyId: string;
    bodyStyleId: string;
  }>;
}
```

### 8.4 牌面组件

```ts
export type FaceAssemblyMode =
  | 'overlay-on-body'
  | 'full-front'
  | 'composed';

export interface FaceAssembly {
  id: string;
  name: string;
  mode: FaceAssemblyMode;
  bodyInteraction:
    | 'show-body'
    | 'partially-cover-body'
    | 'replace-front-surface';
  parts: FacePart[];
}

export interface FacePart {
  id: string;
  source:
    | { kind: 'image'; assetId: string }
    | { kind: 'glyph'; value: string };
  transform: {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotationDeg: number;
    opacity: number;
  };
  repeat?: {
    count: number;
    layout: 'row' | 'column' | 'grid' | 'custom';
    offsets?: Array<{ x: number; y: number }>;
  };
}

export interface BodyStyle {
  id: string;
  name: string;
  bodyAssetId?: string;
  materialPresetId: string;
  cornerRadiusPx: number;
  borderWidthPx: number;
  shadowPresetId: string;
}
```

### 8.5 LevelSpec 与编译结果

```ts
export interface TapTileLevelSpec {
  id: string;
  name: string;
  tileInstances: TapTileInstanceSpec[];
  blockerPolicy: BlockerPolicy;
  blockerOverrides: BlockerOverrides;
}

export interface TapTileInstanceSpec {
  id: string;
  archetypeId: string;
  geometry: TileGameplayGeometry;
  authoring: {
    editorLocked: boolean;
  };
}

export interface BlockerPolicy {
  minimumOverlapAreaPx: number;
  minimumOverlapRatio: number;
}

export interface BlockerOverrides {
  forced: Array<{ blockerId: string; blockedId: string }>;
  ignored: Array<{ blockerId: string; blockedId: string }>;
}

export interface CompiledTapTileLevel {
  levelHash: string;
  ruleProfileId: 'taptile-tray-match3-v1';
  tiles: Record<string, CompiledTapTile>;
  initialBoardIds: string[];
  blockersByTile: Record<string, string[]>;
  dependentsByTile: Record<string, string[]>;
  initialBlockerCount: Record<string, number>;
  initialPlayableIds: string[];
  validation: LevelValidationReport;
}
```

`forced` 边也必须满足高层指向低层。需要同层先后关系时，应调整 `layer`，不要制造违反几何语义的边。

### 8.6 GameState、Action、Transition

```ts
export interface TapTileGameState {
  status: 'playing' | 'won' | 'lost';
  turn: number;
  boardIds: string[];
  trayIds: string[];
  clearedIds: string[];
  activeBlockerCount: Record<string, number>;
}

export interface TapTileAction {
  id: string;
  type: 'tap';
  actor: 'human' | 'agent' | 'script';
  tileId: string;
}

export interface TapTileTransition {
  before: TapTileGameState;
  after: TapTileGameState;
  action: TapTileAction;

  accepted: boolean;
  rejectReason?: 'not-playing' | 'not-on-board' | 'blocked';
  blockerIds?: string[];

  trayBefore: string[];
  trayAfterInsert: string[];
  trayAfterResolve: string[];
  insertedIndex?: number;

  matchedTileIds: string[];
  newlyUnlockedTileIds: string[];
  terminal?: 'won' | 'lost';
}
```

### 8.7 Take

```ts
export interface TapTileTake {
  id: string;
  name: string;
  createdAt: string;

  levelHash: string;
  ruleProfileId: 'taptile-tray-match3-v1';

  actions: Array<{
    id: string;
    type: 'tap';
    actor: 'human' | 'agent' | 'script';
    tileId: string;
    startedAtFrame: number;
    durationFrames: number;
    pointerPath?: Array<{
      frameOffset: number;
      x: number; // normalized 0..1
      y: number; // normalized 0..1
    }>;
  }>;

  result: 'won' | 'lost' | 'unfinished';
  finalStateHash: string;
}
```

### 8.8 语义事件与表现帧

```ts
export type TapTileDirectorEvent =
  | { type: 'tap.accepted'; tileId: string }
  | { type: 'tap.rejected'; tileId: string; reason: string }
  | { type: 'tile.fly-to-tray'; tileId: string; trayIndex: number }
  | {
      type: 'tray.reordered';
      before: string[];
      afterInsert: string[];
      afterResolve: string[];
    }
  | { type: 'match.resolved'; matchKey: string; tileIds: string[] }
  | { type: 'tiles.unlocked'; tileIds: string[] }
  | { type: 'tray.warning'; occupied: number; capacity: 7 }
  | { type: 'game.won' }
  | { type: 'game.lost' };

export interface TapTilePresentationFrame {
  frame: number;
  fps: number;
  totalFrames: number;

  boardTiles: PresentedTile[];
  movingTiles: PresentedTile[];
  trayTiles: PresentedTile[];

  pointer?: PresentedPointer;
  effects: PresentedEffect[];
  praise?: PresentedPraise;
  camera: PresentedCamera;
  audioEvents: PresentedAudioEvent[];
}
```

---

## 9. Hash、缓存和失效规则

必须建立稳定序列化，不要用对象当前插入顺序直接做哈希。

建议哈希：

```text
levelHash
    规则版本 + archetype/matchKey + 玩法几何 + blocker policy/override

takeHash
    levelHash + 动作序列

skinHash
    ThemeVariant + FaceAssembly + BodyStyle + Stage/HUD/Tray skin

directorHash
    Take + DirectorProfile + 单动作覆盖

audioHash
    AudioPack + Seed

cutHash
    CutSpec + OutroPack
```

失效矩阵：

| 修改内容 | 重编 Level | 重验 Take | 重编 Director | 重渲染 |
|---|---:|---:|---:|---:|
| FaceAssembly | 否 | 否 | 否 | 是 |
| BodyStyle | 否 | 否 | 否 | 是 |
| 背景/HUD/槽位皮肤 | 否 | 否 | 否 | 是 |
| DirectorProfile | 否 | 否 | 是 | 是 |
| AudioPack | 否 | 否 | 是 | 是 |
| Take | 否 | 是 | 是 | 是 |
| 牌位置/尺寸/旋转/层级 | 是 | 是 | 是 | 是 |
| archetypeId / matchKey | 是 | 是 | 是 | 是 |
| Blocker Override | 是 | 是 | 是 | 是 |
| RuleProfile 版本 | 是 | 是 | 是 | 是 |

`levelHash` 绝对不能包含牌面图片、背景、材质和导演参数。

---

## 10. 目标目录结构

采用渐进式重构，不要一次删除现有 `src/taptile/`。

```text
src/taptile/
  project/
    types.ts
    schemaV2.ts
    migrateV1.ts
    validation.ts
    stableHash.ts
    defaultProject.ts

  authoring/
    TapTileAuthoringWorkspace.tsx
    AuthoringStage.tsx
    AssetLibraryPanel.tsx
    TileInspector.tsx
    LayerPanel.tsx
    BlockerInspector.tsx
    smartSnap.ts
    stackAlignment.ts
    stackSelection.ts

  gameplay/
    profile.ts
    types.ts
    engine.ts
    tray.ts
    stateHash.ts

    compiler/
      compileLevel.ts
      rotatedRect.ts
      polygonIntersection.ts
      blockerGraph.ts
      validateLevel.ts
      validationCodes.ts

    take/
      types.ts
      recorder.ts
      replayTake.ts
      validateTake.ts

    solver/
      beamSearch.ts
      scoring.ts
      scenarioProfiles.ts

    experimental/
      README.md
      legacyMultiModeEngine.ts

  visual/
    types.ts
    AssetRegistry.ts
    ThemeResolver.ts
    FaceAssemblyRenderer.ts
    BodyStyleRenderer.ts
    StageAssembly.ts
    compatibility.ts

  director/
    types.ts
    events.ts
    profiles.ts
    compileTake.ts
    evaluateFrame.ts
    easing.ts
    timeWarp.ts

  render2d/
    TapTileScene.ts
    TileRenderer.ts
    StageRenderer.ts
    TrayRenderer.ts
    PointerRenderer.ts
    EffectRenderer.ts
    AssetCache.ts

  audio/
    types.ts
    compileAudioEvents.ts
    offlineMix.ts

  export/
    createTapTileRenderJob.ts

  workspace/
    TapTileWorkspace.tsx
    WorkspaceMode.ts
    useTapTileWorkspace.ts

schemas/
  taptile-director-project.schema.json

tests/
  taptileProjectMigration.test.ts
  taptileLevelCompiler.test.ts
  taptileRotatedBlockers.test.ts
  taptileGameplayV1.test.ts
  taptileTakeReplay.test.ts
  taptileSkinInvariance.test.ts
  taptileDirectorCompiler.test.ts
  taptileFrameDeterminism.test.ts
  taptileExportJob.test.ts
```

旧文件应在新模块接管后再删除或移动，避免一次性大爆炸重构。

---

# 11. 分阶段执行计划

## M0：基线保护、文档入库和真实状态确认

### 目标

确保新会话不是在未知工作区上盲改。

### 任务

- [ ] 把本文放入 `docs/taptile/TPT_TRAY_MATCH3_EXECUTION_HANDOFF.md`；
- [ ] 记录当前分支、HEAD、未提交改动和现有测试结果；
- [ ] 检查当前 `feature/taptile-stack-studio` 与本地状态的差异；
- [ ] 保留已有用户改动；
- [ ] 若工作区允许，创建 `feature/taptile-tray-match3-director-v1`；
- [ ] 新建 `docs/taptile/TPT_IMPLEMENTATION_STATUS.md`，按 M0–M9 记录状态、提交和验证结果；
- [ ] 对现有页面做一张基线截图，记录牌数、模板、层级和当前 UI。

### 验收

- 全部基线命令有实际输出记录；
- 没有破坏或丢失未提交改动；
- 现有测试失败项已被区分为“原有失败”或“本次引入”。

### 建议提交

```text
docs(taptile): add tray-match3 execution handoff and status ledger
```

---

## M1：Project Schema V2、逻辑身份和视觉身份分离

### 目标

修复 `faceId` 与视觉资源耦合、`locked` 语义混用，并为复杂牌面与多牌体建立稳定模型。

### 任务

#### M1.1 新增 Project V2

- [ ] 建立 `src/taptile/project/types.ts`；
- [ ] 建立运行时校验，不只依赖 TypeScript；
- [ ] 新增 `schemas/taptile-director-project.schema.json`；
- [ ] 工程统一声明 `ruleProfileId: 'taptile-tray-match3-v1'`；
- [ ] 旧 `format: 'taptile-stack-studio', version: '0.1.0'` 仍可读取。

#### M1.2 拆开三类身份

```text
TileInstance.archetypeId
TileArchetype.matchKey
ThemeVariant.bindings[archetypeId]
```

- [ ] 三消逻辑只读 `matchKey`；
- [ ] UI 展示只通过 `ThemeVariant → FaceAssembly + BodyStyle`；
- [ ] 任何资源文件名变化不影响三消。

#### M1.3 编辑锁定改名

- [ ] `locked` 迁移为 `editorLocked`；
- [ ] 玩法引擎完全不读取 `editorLocked`；
- [ ] UI 仍保持“锁定后不能拖动/修改”的行为。

#### M1.4 坐标迁移

- [ ] V2 玩法几何持久化为 1080×1920 输出像素整数；
- [ ] V1 `x/y/size` 通过 `×2.5` 转为整数；
- [ ] 编辑 UI 通过转换函数显示 432×768；
- [ ] 禁止隐式小数漂移。

#### M1.5 FaceAssembly 基础模式

正式支持：

- [ ] `overlay-on-body`；
- [ ] `full-front`；
- [ ] `composed`；
- [ ] emoji/glyph 只保留为兼容占位源，不作为最终资源系统。

#### M1.6 多 BodyStyle

- [ ] ThemeVariant 可按 archetype 绑定不同 BodyStyle；
- [ ] 不再只有一个项目级全局牌体；
- [ ] 仍可提供“一键全部换牌体”的批量操作。

#### M1.7 Autosave 和文件迁移

- [ ] 新 autosave key 使用 V2；
- [ ] 首次加载先读 V2，缺失时再读 V1 并迁移；
- [ ] 迁移成功后写 V2，但不要立即删除 V1；
- [ ] 导入旧文件后给出明确“已迁移”提示；
- [ ] 迁移失败时不覆盖原文件和旧 autosave。

### 测试

- V1 → V2 后牌数不变；
- 位置、层级、缩放和视觉近似不变；
- `faceId` 唯一值正确生成 archetype；
- `matchKey` 与原 `faceId` 对应；
- `locked` 正确转成 `editorLocked`；
- 改 FaceAssembly 不改变 level gameplay hash；
- 非整数输出像素被拒绝；
- V2 JSON round-trip 一致。

### 验收

- 旧工程和旧 autosave 可以无损打开；
- UI 中明确区分“修改匹配分组”和“更换视觉牌面”；
- 编辑锁定不再导致试玩点击被拒绝。

### 建议提交

```text
refactor(taptile): introduce project schema v2 and separate match identity from visuals
```

---

## M2：Level Compiler、旋转几何与正式 Blocker Graph

### 目标

把可编辑牌堆编译为不可变、可验证、可高效运行的关卡。

### 任务

#### M2.1 编译入口

```ts
compileTapTileLevel(project: TapTileProjectV2): CompiledTapTileLevel
```

- [ ] 只提取玩法相关字段；
- [ ] 生成稳定 `levelHash`；
- [ ] 输出 blockers、dependents 和初始 blocker count；
- [ ] 编译结果不可被 UI 直接修改。

#### M2.2 旋转矩形相交

现有 AABB 只适合旋转为 0 的原型。正式实现需要：

- [ ] 由中心、宽高、旋转生成四边形；
- [ ] 使用确定性多边形裁剪计算交叠面积；
- [ ] 使用明确 epsilon，避免浮点边界在不同运行中抖动；
- [ ] 按 `(layer, order, id)` 做稳定排序；
- [ ] 同层不阻挡；
- [ ] 阴影、侧壁和透明留白不参与 gameplay bounds。

可以采用纯 TypeScript Sutherland–Hodgman 裁剪或等价稳定算法，不要为矩形相交引入大型几何依赖。

#### M2.3 阻挡条件

建议实现：

```text
candidate.layer > tile.layer
AND
intersectionArea >= max(
  minimumOverlapAreaPx,
  tileArea * minimumOverlapRatio
)
```

当前阈值仅作为可配置工程默认值。不要在文档里称其为“已逆向官方阈值”。

#### M2.4 人工覆盖

- [ ] `ignored` 先删除自动边；
- [ ] `forced` 再添加边；
- [ ] forced 边必须满足高层指向低层；
- [ ] 检查自环和环路；
- [ ] 生成可读错误码和对象定位信息。

#### M2.5 Level Validation

至少检查：

```text
重复 tile ID
缺失 archetype
缺失 matchKey
matchKey 数量不是 3 的倍数
坐标越界
宽高非法
层级非法
order 冲突或不稳定
阻挡图自环/有环
forced 边方向错误
初始无可点击牌
视觉绑定缺失
牌数量为 0
```

验证报告必须区分：

- `error`：不能试玩；
- `warning`：允许试玩但需要用户注意；
- `info`：统计信息。

#### M2.6 编辑器调试视图

新增模式：

```text
普通
可点击态
阻挡关系
单层
```

选中一张牌时显示：

- 当前是否可点击；
- 自动 blocker；
- forced blocker；
- ignored blocker；
- 它阻挡的下层牌；
- 相交面积和比例；
- 一键定位关联牌；
- 添加/移除人工覆盖。

### 测试

- 0°、15°、30°、45° 旋转矩形；
- 只接触边缘不算交叠；
- 微小交叠根据阈值正确判断；
- 同层不阻挡；
- 高层压低层；
- 移除 blocker 后 dependent 解锁；
- forced/ignored 生效；
- 环路被拒绝；
- 两次编译相同输入得到相同 levelHash；
- 换 ThemeVariant 后 levelHash 不变。

### 验收

- 编辑器与玩法引擎读取同一份编译 blocker graph；
- 不再在每次点击时重新全量做几何扫描；
- 错误关卡不能进入试玩。

### 建议提交

```text
feat(taptile): compile rotated blocker graph and level validation
```

---

## M3：正式单一 7 槽三消引擎

### 目标

把当前多模式研究引擎收窄成可信、确定、可审计的正式状态机。

### 任务

#### M3.1 收口 Profile

- [ ] 正式导出只保留 `taptile-tray-match3-v1`；
- [ ] `matchSize=3`、`trayCapacity=7`、`warningAt=6` 固定；
- [ ] 目标、无槽位模式和特殊牌从正式类型中移除；
- [ ] 需要保留的研究代码迁移到 `gameplay/experimental/`，不被产品入口 import。

#### M3.2 不可变状态转移

正式入口：

```ts
applyTapAction(
  level: CompiledTapTileLevel,
  state: TapTileGameState,
  action: TapTileAction,
): TapTileTransition
```

不得修改传入 state。

#### M3.3 事件顺序锁死

```text
1. 检查状态
2. 检查 tile 是否仍在 board
3. 检查 activeBlockerCount
4. 从 board 移除
5. 按 matchKey 归组插入 tray
6. 若达到 3 张，先清除
7. 更新 dependents 的 blocker count
8. 产生 newlyUnlockedTileIds
9. 6/7 警告
10. 失败/胜利判定
```

#### M3.4 槽位归组

示例：

```text
[A, A, B, C, C] + B
→ [A, A, B, B, C, C]

[A, A, B, B, C, C] + A
→ [A, A, A, B, B, C, C]
→ [B, B, C, C]
```

三消依据是 `matchKey`，不是 face asset。

#### M3.5 失败和胜利

```text
先三消，再判满槽
board 为空且 tray 为空 → won
解析后 tray.length >= 7 → lost
board 为空但 tray 非空 → lost/invalid terminal，使用明确 reason
```

#### M3.6 Transition 必须包含导演所需的中间态

至少保存：

```text
trayBefore
trayAfterInsert
trayAfterResolve
insertedIndex
matchedTileIds
newlyUnlockedTileIds
blockerIds（拒绝时）
```

否则后续无法正确导演归组挤压和清除补位。

### 正式核心测试

- [ ] 被遮挡牌拒绝；
- [ ] 拒绝不增加 turn；
- [ ] 拒绝不改变任何数组和 blocker count；
- [ ] 上层移除后下层立即解锁；
- [ ] 同类牌插入同组尾部；
- [ ] 第三张立即清除；
- [ ] 清除后剩余槽位顺序正确；
- [ ] 6/7 产生 warning；
- [ ] 第 7 张不匹配时失败；
- [ ] 第 7 张形成三消时不失败；
- [ ] board+tray 为空时胜利；
- [ ] 不存在的 tile 被拒绝；
- [ ] 已清除 tile 不能再次点击；
- [ ] 换视觉主题后全部 Transition 相同；
- [ ] 相同输入运行 100 次 stateHash 一致。

### 验收

- `gameplay` 包不 import React、DOM、Canvas、资源 URI 或动画代码；
- 正式测试不再依赖其他玩法模式；
- 当前旧测试中与范围冲突的测试被迁移或删除，并在提交说明中解释。

### 建议提交

```text
refactor(taptile): lock production gameplay to deterministic seven-slot match-3
```

---

## M4：试玩模式、Take 记录和确定性回放

### 目标

完成第一条真正可用的纵向闭环：

```text
编辑 → 校验 → 试玩 → 保存 Take → 重放
```

### 任务

#### M4.1 渐进拆分大组件

不要重写全部 UI。先提取：

```text
workspace/TapTileWorkspace.tsx
workspace/useTapTileWorkspace.ts
authoring/AuthoringStage.tsx
authoring/TileInspector.tsx
play/GameplayStage.tsx
play/GameplayTray.tsx
play/useGameplaySession.ts
```

现有吸附、多选、框选、快捷键代码保持可用。

#### M4.2 Workspace Mode

```ts
export type TapTileWorkspaceMode =
  | 'edit'
  | 'validate'
  | 'play'
  | 'replay'
  | 'direct'
  | 'export';
```

进入 `play` 时：

```text
保存当前 Project Revision
→ compileLevel
→ 验证
→ 冻结 CompiledLevel
→ 创建初始 GameState
→ 锁住布局编辑
```

退出试玩时可以回到编辑，但不能把运行状态写回关卡工程。

#### M4.3 第一版 Gameplay UI

先实现可信逻辑，不追求高级 VFX：

- [ ] 可点击牌正常显示；
- [ ] 被挡牌轻微变暗或提供可选调试层；
- [ ] 点击被挡牌显示拒绝反馈；
- [ ] 合法牌从 board 移除；
- [ ] 真实 7 格槽位展示；
- [ ] 同类归组；
- [ ] 三消清除；
- [ ] 6/7 警告；
- [ ] 胜利和失败覆盖层；
- [ ] “重新开始”和“结束并保存 Take”。

#### M4.4 Take Recorder

记录：

- `tileId`；
- actor；
- 起始帧；
- 动作持续帧；
- 可选归一化 pointer path；
- levelHash；
- finalStateHash；
- 结果。

不要把 DOM 坐标或屏幕缩放后的像素当作动作真相。

#### M4.5 Take Validator

每次保存、导入、选择和关卡修改后，检查：

```text
levelHash 是否匹配
所有 tileId 是否存在
每一步是否已解锁
是否在中途已失败
最终结果是否一致
finalStateHash 是否一致
```

错误示例必须具体：

```text
动作 12 无效：tile-34 在该时刻仍被 tile-07 阻挡
```

不要静默修改动作顺序。

#### M4.6 Replay

- [ ] 从初始状态重新执行 Take；
- [ ] 支持单步前进；
- [ ] 支持直接跳到动作索引；
- [ ] 逻辑回放不依赖动画；
- [ ] 相同 Take 重放结果一致。

### Gate A：玩法闭环验收

必须由实际浏览器完成：

```text
加载模板
→ 编辑堆叠
→ 查看阻挡图
→ 修正一条 blocker
→ 验证关卡
→ 开始试玩
→ 完成至少两组三消
→ 触发一次新牌解锁
→ 保存 Take
→ 从头重放
→ finalStateHash 一致
```

同时保存：

- 浏览器截图；
- console error 数；
- 测试命令结果；
- 一份示例 V2 Project；
- 一份示例 Take。

### 建议提交

```text
feat(taptile): add playable seven-slot mode with take recording and replay
```

> **不得在只完成 Schema 或纯单元测试后宣称 Gate A 完成。**

---

## M5：可解性分析、规则型 Agent 和素材剧情 Take

### 目标

在不依赖 LLM 截图操作的情况下，生成和验证可用的玩法路径。

### 任务

#### M5.1 Solver API

```ts
interface SolveResult {
  status: 'solved' | 'not-found' | 'invalid-level';
  actions?: TapTileAction[];
  expandedStates: number;
  finalStateHash?: string;
  diagnostic?: string;
}
```

### M5.2 确定性 Beam Search

评分建议：

```text
立即三消：高奖励
新解锁牌数量：奖励
降低槽位占用：奖励
槽位中的不同 matchKey 数量：惩罚
进入 6/7：高惩罚
揭开深层牌：奖励
重复状态：去重
```

所有 tie-break 使用稳定排序和 Seeded RNG。

### M5.3 证据边界

- Beam Search 没找到不能声称“关卡数学上无解”；
- 只在小关卡完成穷举时才允许返回严格 `unsolvable`；
- 大关卡统一返回 `not-found` 并给诊断。

### M5.4 Scenario Profiles

第一版提供：

```text
safe-win          稳定通关
danger-rescue     槽位接近 6 后翻盘
combo-heavy       尽量连续完成三消
fast-clear        动作较少、节奏紧凑
intentional-fail  有意在第 7 格失败
```

这些 Profile 只选择 Action 序列，不负责动画。

### 验收

- 小型固定关卡能稳定求解；
- 同一个 Seed 生成相同 Take；
- 所有生成 Take 都经过正式引擎重放验证；
- `danger-rescue` 能产生至少一次 6/7 警告后恢复；
- Agent 通过语义 API 下棋，不模拟鼠标。

### 建议提交

```text
feat(taptile): add deterministic solver and creative take profiles
```

---

## M6：视觉原子、ThemeVariant 和 SkinPack

### 目标

证明同一 Level 与同一 Take 可以更换整套视觉，而玩法结果完全不变。

### 任务

#### M6.1 AssetManifest 与 Registry

```ts
export interface AssetManifestEntry {
  id: string;
  kind: 'image' | 'sequence' | 'audio' | 'video';
  source:
    | { type: 'builtin'; uri: string }
    | { type: 'indexeddb'; blobId: string };
  width?: number;
  height?: number;
  hasAlpha?: boolean;
  contentHash?: string;
  version: string;
}
```

第一步可先使用 `public/assets/taptile/` 的 built-in 资产，随后接入本地上传与 IndexedDB。不要把临时 `blob:` URL 持久化到项目 JSON。

#### M6.2 FaceAssembly Renderer

支持：

- `overlay-on-body`：透明图案 fit 到安全区；
- `full-front`：完整正面替换；
- `composed`：多个部件按变换和 repeat 组合。

#### M6.3 视觉与玩法边界

```text
visualBounds 可以变化
gameplayBounds 不变
```

牌体厚度、外发光、阴影不得写入 blocker graph。

#### M6.4 Presentation Roles

棋盘、飞行、槽位、清除副本和 HUD 统一使用 ThemeResolver：

```ts
resolveTileVisual(archetypeId, themeVariantId, role)
```

#### M6.5 StageAssembly

第一版支持：

- 静态 base image；
- 简单 ambient image/video loop；
- foreground overlay；
- HUD；
- 7 槽皮肤。

#### M6.6 Compatibility QA

`overlay-on-body` 检查：

- Alpha；
- 可视边界；
- 安全区；
- 边缘裁切；
- 是否意外遮满牌体。

`full-front` 检查：

- 画幅；
- 留白；
- 裁切；
- 是否与牌体重复产生双边框。

`composed` 检查：

- 部件是否存在；
- repeat 数量和布局；
- 合成后边界；
- 透明边缘；
- 锚点。

#### M6.7 准备两套示例 SkinPack

至少：

```text
animals-v1
food-v1
```

每套覆盖全部 archetype，不允许缺牌面时静默回退。

### Gate B：换皮闭环验收

同一个 Level 和 Take：

```text
切 animals-v1
→ 重放
→ 记录全部 Transition 和 finalStateHash

切 food-v1
→ 重放
→ 记录全部 Transition 和 finalStateHash
```

必须满足：

- levelHash 相同；
- action 序列相同；
- 每一步 Transition 逻辑相同；
- finalStateHash 相同；
- 只有渲染结果不同；
- board、flight、tray、match-ghost 视觉一致。

### 建议提交

```text
feat(taptile): add face assemblies body styles and invariant skin packs
```

---

## M7：Director Compiler、事件轨和可寻址 PresentationFrame

### 目标

把玩法 Transition 编译成可替换、可重排、可固定帧求值的素材演出。

### 任务

#### M7.1 语义事件

正式事件至少包括：

```text
tap.accepted
tap.rejected
tile.fly-to-tray
tray.reordered
match.resolved
tiles.unlocked
tray.warning
game.won
game.lost
```

素材不能直接调用玩法代码。

#### M7.2 DirectorProfile

```ts
export interface TapTileDirectorProfile {
  id: string;
  globalSpeed: number;
  betweenActionFrames: number;
  pointer: PointerMotionProfile;
  clickFeedback: ClickFeedbackProfile;
  tileFlight: TileFlightProfile;
  trayMotion: TrayMotionProfile;
  matchPresentation: MatchPresentationBundle;
  camera: CameraProfile;
}
```

第一版提供：

```text
human-natural
tight-fast
danger-rescue
combo-rush
```

#### M7.3 每个动作的编译时间点

建议显式保存：

```text
actionStartFrame
pointerArriveFrame
pressFrame
flightStartFrame
flightEndFrame
trayReorderStartFrame
trayReorderEndFrame
matchStartFrame
matchLogicVisibleFrame
matchVfxEndFrame
inputReadyFrame
actionVisualEndFrame
```

`inputReadyFrame` 和 `actionVisualEndFrame` 必须分开，使下一次点击可以与上一组碎片重叠。

#### M7.4 MatchPresentationBundle

```ts
export interface MatchPresentationBundle {
  preFlash?: EffectBinding;
  tilePulse?: EffectBinding;
  crack?: EffectBinding;
  shatter?: EffectBinding;
  particles?: EffectBinding;
  praise?: PraiseBinding;
  camera?: CameraBinding;
  audioCueId?: string;
}
```

特效实现类型：

```text
web-procedural
sprite-sequence
static-overlay
baked-clip
```

AE 插件效果暂不直接复刻；使用 Web 近似预设或透明序列。

#### M7.5 纯函数帧求值

```ts
evaluateTapTileFrame(compiledTake, frameNumber): TapTilePresentationFrame
```

要求：

- 从 0 顺播到 N 与直接求 N 相同；
- seek 不依赖上一次 frame；
- 同 Seed 粒子和抖动一致；
- 不读取 `Date.now()`、`Math.random()` 或浏览器实时帧率。

#### M7.6 时间线 UI

一期只做：

- 动作条；
- 点击时刻；
- 飞行时长；
- 三消事件；
- 警告和胜负事件；
- 播放头；
- 缩放；
- 单动作节奏覆盖；
- Profile 切换。

不要做 AE 式任意属性曲线编辑器。

### Gate C：导演闭环验收

同一 Take 切换至少三套 DirectorProfile：

- 动作和三消结果不变；
- 总时长允许变化；
- 任意帧直接 seek 正确；
- 上一组三消 VFX 未结束时下一次点击可开始；
- 导演 Profile 不进入 levelHash 或 finalStateHash；
- 预览无 console error。

### 建议提交

```text
feat(taptile): compile semantic takes into seekable director timelines
```

---

## M8：Canvas 2D 正式渲染与固定帧 MP4

### 目标

让浏览器预览和视频导出使用同一套表现帧与渲染器。

### 任务

#### M8.1 DOM 与 Canvas 分工

```text
React / DOM：
编辑器、面板、框选、吸附线、属性表单、时间线

Canvas 2D：
试玩正式画面、导演回放、固定帧导出
```

不要为了导出而重写成熟的 DOM 编辑器。

#### M8.2 固定输出分辨率

- 正式内部 Canvas：1080×1920；
- 预览只通过 CSS 统一缩放；
- 不允许 X/Y 分别 stretch；
- 不从截图尺寸反推游戏几何。

#### M8.3 固定 zBand

```text
00 base background
10 ambient background
20 board tiles
30 board feedback
40 moving tiles
50 tray
60 pointer
70 match VFX
80 praise / warning
90 HUD
100 outro / CTA
```

#### M8.4 AssetCache

- 图片、视频帧和序列预热；
- 统一 dispose；
- 导出前检测缺失资源和缺帧；
- 同一 assetId 不重复解码；
- 导出期间冻结资产版本。

#### M8.5 抽象通用固定帧导出器

现有 Block 导出器不应直接知道玩法类型。

```ts
export interface FrameRenderJob<Frame> {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  evaluate(frameIndex: number): Frame;
  render(frame: Frame, canvas: HTMLCanvasElement): void | Promise<void>;
}
```

实现：

```text
BlockRenderJob
TapTileRenderJob
```

共同使用 WebCodecs + Mediabunny。

#### M8.6 导出前预检

- 所有图片已加载；
- 所有序列无缺帧；
- 字体已加载；
- H.264 编码能力可用；
- 宽高为偶数；
- 所有帧可求值；
- Project、Level、Take、Skin、Director hash 已冻结；
- 缺失资源在编码开始前报错。

#### M8.7 视觉回归

至少保存：

- 初始帧；
- 第一次点击；
- 牌飞行中点；
- 槽位归组；
- 第一次三消；
- 6/7 警告；
- 胜利/失败；
- 结束帧。

比较预览截图和输出帧，几何位置不允许出现 1px 漂移。

### 验收

- 1080×1920、30fps H.264 MP4；
- 帧数和时长精确；
- 可取消；
- 导出失败不破坏工程；
- 同一输入导出两次的关键帧像素一致或在已声明的编码容差内一致；
- Preview 与 Export 使用同一 `TapTilePresentationFrame`；
- SkinPack 和 DirectorProfile 可组合导出。

### 建议提交

```text
feat(taptile): render seekable presentation frames to deterministic mp4
```

---

## M9：AudioPack、CutSpec、OutroPack、项目包与批量变体

### 目标

把单条无声玩法视频升级为可批量生产的完整投放素材。

### 任务

#### M9.1 AudioPack

```ts
export interface AudioPack {
  tap: AudioCueRef;
  pickup?: AudioCueRef;
  traySettle: AudioCueRef;
  match: AudioCueRef;
  shatter?: AudioCueRef;
  warning?: AudioCueRef;
  win?: AudioCueRef;
  outro?: AudioCueRef;
}
```

Cue 支持：

- 多个变体；
- Seeded 选择；
- 音量；
- 起始偏移；
- 淡入淡出；
- 峰值控制；
- 事件延迟。

音频按语义事件绑定，不按某个 AE 图层名或绝对秒数硬编码。

#### M9.2 OutroPack

```ts
export interface OutroPack {
  transitionId?: string;
  backgroundAssetId?: string;
  logoAssetId?: string;
  headline?: TextSpec;
  ctaButton?: CtaSpec;
  durationFrames: number;
}
```

#### M9.3 CutSpec 与 TimeWarp

```ts
export interface CutSpec {
  id: string;
  takeRange: {
    startActionIndex: number;
    endActionIndex: number;
  };
  timeWarpSegments?: Array<{
    sourceStartFrame: number;
    sourceEndFrame: number;
    speed: number;
  }>;
  introFrames?: number;
  outroPackId?: string;
  targetDurationFrames?: number;
}
```

玩法源时间与最终成片时间必须分开，不要通过篡改 Take 的逻辑动作来完成所有加速。

#### M9.4 批量矩阵

```text
Level
× Take
× SkinPack
× DirectorProfile
× AudioPack
× CutSpec
× OutroPack
× RenderSpec
```

提供：

- 组合预览；
- 依赖检查；
- hash 去重；
- 队列状态；
- 失败原因；
- 可取消；
- 结果命名；
- manifest。

#### M9.5 项目包

仅 JSON 无法携带 IndexedDB 中的本地资产。最终需要支持：

```text
.taptile-project.zip
├── project.json
├── assets/
├── takes/
├── manifests/
└── checksums.json
```

导入时校验 hash，不允许静默使用同名不同内容资源。

### Gate D：成片与批量闭环验收

至少完成：

```text
1 个可玩 Level
2 条 Take
2 套 SkinPack
3 套 DirectorProfile
2 套 AudioPack
2 个 CutSpec
1 个 OutroPack
```

并成功：

- 单条带音频导出；
- 批量生成若干组合；
- 所有结果带 manifest；
- 失败任务可定位；
- 同一组合重跑结果确定；
- 项目包可导出并重新导入。

### 建议提交

```text
feat(taptile): add audio cuts outros project bundles and batch variants
```

---

# 12. UX 要求

## 12.1 不做裸坐标工具

用户默认通过直接操作完成工作：

- 拖拽；
- 吸附；
- 框选；
- 对齐；
- 层级；
- 批量设置；
- 可视阻挡关系；
- 试玩验证。

X/Y 数字输入是精调能力，不是主流程。

## 12.2 必须区分两种“换牌”

### 修改匹配分组

```text
改变 archetypeId / matchKey
→ 会改变玩法
→ 重编关卡并重验 Take
```

### 更换视觉主题

```text
改变 FaceAssembly / BodyStyle / ThemeVariant
→ 不改变玩法
→ 只重新渲染
```

UI 文案、颜色和警告必须让用户不会混淆两者。

## 12.3 模式清楚

顶部应清楚显示：

```text
编辑
验证
试玩
回放
导演
导出
```

每个模式只开放相关操作，避免试玩中误改工程。

## 12.4 错误必须可定位

不允许只显示：

```text
关卡无效
Take 失败
资源错误
```

应显示对象、动作索引、错误码和建议修复方式。

## 12.5 保留现有成熟交互

重构后必须继续支持：

- Shift 点击和 Shift 框选；
- Ctrl+A；
- Esc；
- Ctrl/Command+Z、Y、D；
- Alt 临时关闭吸附；
- Shift 锁定拖动方向；
- 批量移动保持相对位置；
- 层级越高视觉越靠上。

---

# 13. 测试与 QA 矩阵

## 13.1 单元测试

### Project / Migration

- V1 → V2；
- V2 round-trip；
- stable hash；
- autosave fallback；
- schema error messages。

### Geometry / Compiler

- 坐标整数；
- 旋转矩形；
- 相交面积；
- 同层规则；
- blocker override；
- graph cycle；
- levelHash invariance。

### Gameplay

- 拒绝点击；
- 归组；
- 三消；
- 6/7；
- 第 7 张解析顺序；
- win/loss；
- stateHash；
- 100 次确定性。

### Take

- 录制；
- 重放；
- 失效定位；
- finalStateHash；
- levelHash mismatch。

### Visual

- 三种 FaceAssembly；
- 多 BodyStyle；
- role 一致；
- Skin 不改变逻辑。

### Director

- 时间点；
- seek；
- Profile 切换；
- VFX overlap；
- Seeded particle；
- direct frame equals sequential frame。

### Export

- 帧数；
- 取消；
- 缺资产预检；
- codec 不支持；
- 同输入关键帧一致。

## 13.2 集成测试

至少准备三个固定 Fixture：

```text
simple-clear
    无遮挡，验证槽位归组和三消

stacked-unlock
    多层遮挡，验证 blocker 与解锁

danger-rescue
    先到 6/7，再完成三消恢复
```

## 13.3 浏览器冒烟测试

每个 Gate 都要实际浏览器验证：

- 无 console error；
- 操作命中正确；
- 不出现页面滚动抢占拖拽；
- 框选和快捷键无回归；
- 试玩模式锁住编辑；
- 回放可 seek；
- 导出可取消。

## 13.4 视觉 QA

保存到：

```text
artifacts/design-qa/taptile/
```

文件名包含：

```text
<gate>-<fixture>-<skin>-<director>-<frame>.png
```

几何对齐检查：

- 同行 top/bottom 偏差 0px；
- 同列 left/right 偏差 0px；
- 等距 gap 偏差 0px；
- Preview 与 Export 关键元素偏差 0px。

## 13.5 每阶段统一命令

```bash
npm run check
npm test
npm run typecheck
npm run build
```

任何阶段交付必须报告：

```text
执行了哪些命令
通过了多少测试
是否有新增 warning
浏览器是否实际验证
截图在哪里
哪些项仍未完成
```

---

# 14. 性能与工程质量要求

这些是产品目标，不是视频逆向事实：

- 编辑器拖拽和框选保持流畅；
- 运行时不在每帧重算 blocker graph；
- 关卡编译可以 O(n²)，但只在布局提交/进入试玩前发生；
- 正式播放使用编译数据和 O(依赖边数) 增量解锁；
- 典型 100–250 张牌时仍能编辑、试玩和回放；
- AssetCache 防止重复解码；
- Canvas 和事件监听器在卸载时释放；
- Block Studio 与 TapTile Workspace 做代码拆分或懒加载；
- 导出器和大型素材编辑器不进入首屏主包；
- 不在 React render 中做大规模 JSON stringify 比较；
- History 使用结构化操作或受控快照，避免无限复制大型二进制资产。

---

# 15. 错误处理和迁移策略

必须提供可恢复行为：

### Project 错误

- 显示 schema path 和原因；
- 不覆盖当前工程；
- 支持下载原始错误文件；
- V1 迁移失败时保留旧 autosave。

### Level 错误

- 禁止进入试玩；
- 在画布定位牌；
- 提供错误码；
- blocker 环路可视化。

### Take 错误

- 显示第几个动作失效；
- 显示 blocker 或 terminal 状态；
- 不自动删除 Take；
- 允许复制后手工修复。

### Asset 错误

- 缺失资产不能静默回退到错误牌面；
- 列出所有受影响 archetype 和 role；
- 检查 Alpha、尺寸、hash 和版本；
- 临时 object URL 不得被持久化。

### Export 错误

- 编码前预检；
- 可取消；
- finally 中释放资源；
- 失败后工程仍可继续编辑；
- 保留结构化日志。

---

# 16. Git 与提交纪律

建议提交序列：

```text
docs(taptile): add tray-match3 execution handoff and status ledger
refactor(taptile): introduce project schema v2 and separate match identity from visuals
feat(taptile): compile rotated blocker graph and level validation
refactor(taptile): lock production gameplay to deterministic seven-slot match-3
feat(taptile): add playable seven-slot mode with take recording and replay
feat(taptile): add deterministic solver and creative take profiles
feat(taptile): add face assemblies body styles and invariant skin packs
feat(taptile): compile semantic takes into seekable director timelines
feat(taptile): render seekable presentation frames to deterministic mp4
feat(taptile): add audio cuts outros project bundles and batch variants
```

每个提交：

- 只解决一个清晰主题；
- 测试通过；
- 文档同步；
- 不混入无关格式化；
- 不删除研究资料；
- 不声称尚未浏览器验证的能力已完成。

每个 Gate 后更新：

```text
docs/taptile/TPT_IMPLEMENTATION_STATUS.md
README.md
CHANGELOG.md
```

---

# 17. 总体 Definition of Done

整个 TPT 7 槽三消导演台完成，必须同时满足：

## 玩法

- [ ] 关卡可编辑；
- [ ] blocker graph 可视化和人工修正；
- [ ] 7 槽三消规则正确；
- [ ] warning、win、loss 正确；
- [ ] 真人试玩可用；
- [ ] Take 可保存、校验、重放；
- [ ] Solver 可生成确定性 Take。

## 视觉

- [ ] `matchKey` 与视觉完全分离；
- [ ] 支持 overlay/full-front/composed；
- [ ] 支持多 BodyStyle；
- [ ] 支持 ThemeVariant；
- [ ] board/flight/tray/match-ghost 视觉一致；
- [ ] 至少两套 SkinPack 通过逻辑不变量测试。

## 导演

- [ ] 语义事件驱动；
- [ ] 指针、飞牌、槽位、三消、镜头可配置；
- [ ] VFX 不阻塞逻辑；
- [ ] 至少三套 DirectorProfile；
- [ ] 任意帧可直接 seek；
- [ ] 逐帧结果确定。

## 输出

- [ ] Preview 与 Export 同源；
- [ ] 1080×1920、30fps MP4；
- [ ] 音频事件混合；
- [ ] CutSpec 和 OutroPack；
- [ ] 批量矩阵；
- [ ] 项目包可导入导出；
- [ ] 自动 QA 和结构化日志。

## 工程质量

- [ ] 全部检查、测试、类型和构建通过；
- [ ] 浏览器 console error 为 0；
- [ ] 无破坏性 Git 操作；
- [ ] 文档与实际代码一致；
- [ ] 未决规则明确标记为 product decision 或 unresolved；
- [ ] 不把其他玩法、AE 插件和 Blender 提前塞进一期主链。

---

# 18. 执行状态表

新会话应持续更新，不要只在聊天里口头汇报。

| Milestone | 状态 | Commit | 自动测试 | 浏览器验证 | 主要遗留 |
|---|---|---|---|---|---|
| M0 基线与文档 | pending |  |  |  |  |
| M1 Schema V2 | pending |  |  |  |  |
| M2 Level Compiler | pending |  |  |  |  |
| M3 7 槽引擎 | pending |  |  |  |  |
| M4 Play + Take | pending |  |  |  |  |
| Gate A | pending |  |  |  |  |
| M5 Solver | pending |  |  |  |  |
| M6 SkinPack | pending |  |  |  |  |
| Gate B | pending |  |  |  |  |
| M7 Director | pending |  |  |  |  |
| Gate C | pending |  |  |  |  |
| M8 Canvas + MP4 | pending |  |  |  |  |
| M9 Audio/Batch | pending |  |  |  |  |
| Gate D | pending |  |  |  |  |

---

# 19. 新 Codex 会话可直接使用的启动提示词

```text
你现在位于 block-creative-studio 仓库。请不要重新讨论产品方向，也不要只输出计划；按仓库中的执行规格开始实施。

第一步完整阅读：
- docs/taptile/TPT_TRAY_MATCH3_EXECUTION_HANDOFF.md
- docs/taptile/TPT_GAMEPLAY_SPEC.md
- docs/taptile/TPT_VIDEO_AUDIT.md
- docs/taptile/TPT_PIXEL_ALIGNMENT.md
- docs/taptile/TPT_ATOM_CATALOG.md

然后运行：
- git status --short
- git branch --show-current
- git log --oneline -8
- npm run check
- npm test
- npm run typecheck
- npm run build

不要执行 git reset --hard、git clean -fd 或覆盖未知未提交改动。远端参考分支是 feature/taptile-stack-studio，但必须以本地实际状态为准。

产品范围已经锁定：只实现 taptile-tray-match3-v1，即遮挡解锁、7 格槽位、同 matchKey 自动归组、三张立即清除、先清除再判满槽、无棋盘重力。目标、特殊牌、无槽位玩法、AE 导入、Blender 和复杂插件不进入一期主链。

先完成 M0–M4 和 Gate A，不得只停在 Schema 或纯单元测试；Gate A 必须在真实浏览器中完成“编辑→验证→试玩→保存 Take→确定性重放”。随后继续按 M5–M9 推进。每个 Milestone 使用独立清晰提交，更新 docs/taptile/TPT_IMPLEMENTATION_STATUS.md，并报告测试、浏览器截图、实际完成项和遗留问题。

关键架构边界：
- matchKey 与视觉牌面分离；
- editorLocked 与玩法可点击分离；
- gameplayBounds 与 visualBounds 分离；
- Project、CompiledLevel、GameState、Take、PresentationFrame 分离；
- 游戏逻辑不等待 VFX；
- 同一 Take 可换 Skin/Director/Audio；
- 预览和导出使用同一 PresentationFrame；
- 正式几何使用 1080×1920 整数输出像素。

遇到文档未覆盖但不影响产品语义的工程细节，请做保守、可测试、可迁移的实现并记录决定，不要因为小问题停下来等待确认。遇到会改变核心产品语义的冲突时，先保留现有用户改动、给出证据和最小决策点。
```

---

# 20. 最后提醒

本项目的成功标准不是“增加了很多类和接口”，而是完成可验证的纵向闭环。

实施顺序必须保持：

```text
玩法真相
→ 关卡编译
→ 真人试玩与 Take
→ 换皮不变性
→ 导演可寻址
→ 固定帧成片
→ 音频与批量
```

不要先做华丽特效来掩盖玩法、Take 或确定性尚未成立；也不要为了抽象未来所有游戏而牺牲当前 7 槽三消的可用性。
