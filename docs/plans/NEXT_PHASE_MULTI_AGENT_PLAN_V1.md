# 下一阶段多 Agent 执行任务书 v1

日期：2026-09-03  
状态：**工作计划，尚未实施或验收**  
仓库：`dongyuan21/block-creative-studio`  
已核对代码基线：`74a2fba002fe62643884759b6611af9181330964`（`0.3.0-alpha.3`）

本文是交给外部编码 Agent 的任务书，不是完成报告。后续执行者必须重新核对 HEAD；若基线变化，应记录差异并保留其他开发者的修改。历史聊天中的 ZIP、临时分支和“已完成”说明不能替代当前源码。

## 1. 本阶段目标与范围

### 1.1 最终交付

让同一份可复现 Take 能够完成：

```text
Reference 2D 模块化重放
        +
参考视频的事件对应关系与批量 Golden 检查
        +
固定画幅、可检查的 3D 材质与灯光
        +
外部 PBR 贴图/参数真正驱动牌块
        ↓
同一玩法、至少三个材质版本的 1080×1920 / 30fps 无声样片
        +
可复跑的代码、测试、图片、视频和质量报告
```

本阶段做到的是“可校准的 2D + 固定机位生产后端的第一条实际切片 + 开放 PBR 材质”，不是完整商业生产平台。只有真实视频经过人工对比通过，才可说样片达到目标质感。增加分辨率、降低亮度或 CI 通过，都不能单独证明比人工成品更好。

### 1.2 本阶段明确不做

不内置 LLM、Prompt 面板或模型服务；不开发 Blender/AE 全工程解析器；不实现 MaterialX/SBSAR 运行时；不直接执行上传的 JS/WASM；不重写整个仓库为大型 monorepo；不建设云端账号、分布式队列、全功能剪辑时间线；不在本阶段承诺全部材质破坏机制、音频混音或全部 CLI/MCP 自动化。

已完成的导入边界继续以 `docs/architecture/ASSET_IMPORT_PIPELINE_V1.md` 为准。DCC 源文件留作上游来源，已经提取的图片、材质和特效可作为测试输入。不要为了展示导入能力另写一个不接现有 Registry 的上传器。

### 1.3 产品不变量

- 玩法和渲染分离：Renderer 不修改棋盘、落子、分数、Combo 或候选生成。
- 母版和外观分离：换材质不改变 Take、事件顺序、固定镜头和布局。
- 几何、材质、颜色、牌面 Decal、离场行为分别可描述。
- 外部 Agent 负责创作；BCS 负责结构校验、编译和确定性执行。Web UI 与 CLI 调同一 Core，不在 CLI、页面各实现一套规则。
- 区分 `contract-valid`、`compiled`、`resources-ready`、`rendered`、`visually-approved`。不能把前三项当作后两项。
- 同一已锁定运行环境须可重复渲染；跨浏览器/GPU以语义不变量和视觉容差验证，不承诺 MP4 字节完全相同。

## 2. 已有实现与需要避免的重复开发

当前源码已有 Headless Registry/Compiler/Quality Gate、Browser Asset Store、单帧 Golden Diff、Neutral/Balanced/High Energy LookDev，以及旧 Three.js 渲染器。

关键现有入口：

```text
src/headless/
src/assets/browserAssetStore.ts
src/assets/runtimeAssetBindings.ts
src/integration/studioAssetCatalog.ts
src/integration/studioVariantBridge.ts
src/state/useVariantWorkspace.ts
src/reference2d/Reference2DScene.ts
src/reference2d/Reference2DViewport.tsx
src/reference2d/ReferenceCalibrationOverlay.tsx
src/reference2d/calibrationMetrics.ts
src/reference2d/referenceProfile.ts
src/renderer/StudioScene.ts
src/renderer/ThreeViewport.tsx
src/renderer/lookDev.ts
src/renderer/materialProfiles.ts
src/renderer/materialPresets.ts
src/exporter/offlineVideoExporter.ts
src/cli/bcs.ts
```

必须先复用已有功能，再补缺口。以下是本次源码检查发现的优先核查点，而不是宣称所有相关 Bug 已经证实：

1. `captureReferenceFrame()` 当前将显示 Canvas 的内容裁出再放大到设计分辨率；这不是原生设计分辨率的重新渲染。像素误差可能混入代理分辨率和缩放误差。[R1]
2. 参考视频绝对帧号与 BCS Take 帧号没有天然相同含义。即使 FPS 相同，也不能直接把源录像第 N 帧与任意 Take 第 N 帧相比。[R2]
3. 当前 2D 资源解码失败存在返回 null 的路径；正式捕获/导出应检查是否静默回退到旧图片或内置图案。[R1]
4. 当前 `StudioScene.getMaterial()` 仍主要通过材质枚举、颜色、Opacity 和环境强度取缓存；需要接入解析后的 Material Pack，而不是仅给枚举再加几个名字。[R3]
5. `studioVariantBridge` 当前使用 `project.style.renderer` 编译，并生成当前 Project 的母版视图；要核查锁定是否只是本次生成的 Hash，而不是可比较的已冻结母版约束。[R4]
6. 已有 Runtime Binding 会遍历 Plan 直接槽位和依赖资产，不要再维护第二套依赖搜索。[R5]

## 3. Agent 分工与依赖

建议四个角色；一个编码 Agent 也可以按同样任务顺序全部执行。

| 角色 | 任务 | 主要所有权 |
|---|---|---|
| Agent A：集成负责人 | T0、T5，跨模块契约与集成 | Core 接口、迁移、CLI/UI 接线、测试与发布 |
| Agent B：2D | T1、T2 | Reference 2D Pass、帧捕获、Golden 工具 |
| Agent C：3D | T3 | 固定机位、LookDev、后处理、3D 场景 |
| Agent D：材质 | T4 | PBR 语义、资源准备、Material Runtime 与测试 |

```text
T0：冻结基线与最小接口
 ├── T1：2D 模块化 + 原生帧捕获 ──→ T2：批量 Golden 校准
 ├── T3：固定机位 + LookDev/反光诊断
 └── T4：PBR 契约/编译/资源加载 ──→ 与 T3 集成实际渲染
                  ↓
T5：完整切片 + 三变体样片 + Review 交付
```

T4 可以先与 T3 并行开发纯函数、校验和资源加载；接入实际牌块阶段需等待双方接口冻结。不要让多个 Agent 同时重写 `StudioScene.ts`、`types.ts`、`useVariantWorkspace.ts` 或 `package.json`。

`src/domain/types.ts`、项目 Schema/迁移、`src/headless/contracts.ts`、`src/App.tsx`、Inspector、CLI、Exporter 的跨任务修改由 Agent A 合并。T1 第一 PR 必须保持画面和玩法不变；后续风格改进另提 PR。

## 4. 开工协议与共同接口（T0）

### 4.1 先形成可重复基线

执行：

```bash
git status --short
git rev-parse HEAD
node --version
npm --version
npm ci
npm run check
npm test
npm run typecheck
npm run build
```

保存 commit、Node/npm、浏览器、Three.js、OS、实际 GPU/软件渲染器、设计/输出分辨率、FPS、DPR、素材 Hash 和测试日志。不得为通过测试而用类型桩、`--noCheck`、关闭 strict、删除失败测试或广泛添加 `any` 掩盖问题。

先采集可公开的自制基线场景：Idle、Pickup、合法/非法预览、单行清除、交叉清除、连续两次落子、终局。保存重构前的帧与事件状态。用户原始视频只在获准存储位置使用，不能进入公开 Git。

### 4.2 只补必要契约

以下是本阶段需具备的概念接口，名称可与已有接口合并，不要求再创造平行类型体系：

- `FrameRenderRequest`：Plan/Take 引用、帧号或明确时间、目标像素尺寸、诊断选项；输入只读。
- `PreparedResources`：明确的资源 readiness、所有权、释放方法；加载失败拒绝完成，不静默使用默认素材。
- `FrameRenderResult`：图像、帧/Plan 身份、可选区域/Mask、诊断与警告。
- `CalibrationCase`：源媒体 Hash + 原始 PTS/时间基准 + 目标 Take/Fixture Hash + 事件对应关系 + ROI/Mask。
- `MaterialRuntimeDescriptor`：标准参数、纹理引用、通道、色彩空间、UV/法线约定、能力与不支持项。

渲染求值只依赖明确传入的时间、状态、种子和资源；随机流至少按事件/物体稳定 ID 分离，不能因为某个 Pass 关闭就改变其他 Pass 的粒子随机数。实时 UI 可以有时钟，但固定帧捕获不得使用墙上时间驱动画面。

### 4.3 T0 验收

产出 `BASELINE_REPORT.md`、基线图片、可重放 Fixture，以及小型接口决议。确认原生设计坐标、固定视频坐标、DOM 展示坐标三者映射。不得把 1064×1788 参考画面无说明地拉伸成 1080×1920。

不通过 T0，不开始大规模重构。依赖安装或参考素材缺失要标 BLOCKED，而不是写 PASS。

## 5. T1：Reference 2D 模块化与确定性捕获

### 目标

把 2D 从单体 Canvas 改为可独立定位、替换和复用的合成层；这层未来继续承担 HUD、评价词和 3D 的对照基线，不会废弃。

### 工作

1. 先提取公共绘图/布局工具，再按现有实际绘制顺序拆 Background、Board、Tile Body/Face、Tray、Interaction、Placement、Clear、Feedback/HUD、Endgame。保留真实图层遮挡，不为追求目录整齐改变顺序。
2. 为逻辑 Pass 提供明确输入与状态隔离；Canvas Pass 使用 save/restore，不能泄漏 Alpha、Transform、Clip、Shadow 或混合模式。
3. Pass 独立开关是诊断工具，默认完整图应与重构前一致。原子材质/牌面仍来自 Registry/Plan，不另建独立枚举系统。
4. 实现原生分辨率 offscreen 帧捕获，等待字体和图片就绪；不能把 540p 代理画面放大当作原生 Golden 输出。
5. 诊断 Overlay、参考图、对齐线绝不能烘进正式帧或 MP4。捕获必须对应冻结的 FrameRequest，而不是异步结束时页面正在播放的另一帧。
6. 捕获、重放、随机 Seek、导出共享求值路径。不能只保证从第 0 帧顺播正常。
7. 修复资源解码失败、切换 Variant 时旧资源覆盖新资源、取消后残余异步回写等问题；明确谁持有和释放解码图片及 Object URL。

### 测试与交付

- 保持玩法/Replay Hash、每个落子和消除集合不变。
- 在同一锁定环境，重构前后至少覆盖上述七类场景；稳定区域达到预先冻结的近零差异容差，差异必须解释，不能直接更新 Golden 掩盖变化。
- 相同帧重复渲染、乱序 Seek 后再渲染，结果一致或处于明确的平台容差。
- 关闭某一 Pass 只影响其负责区域/遮挡结果，不改变玩法或其他随机流。
- 图片加载故意失败时，捕获/导出明确失败；旧图不得混入新计划。

交付源码、Pass 责任表、before/after/diff 图、失败路径测试和可重复捕获命令。只把 `drawXXX()` 搬到文件里而仍依赖全部 Scene 私有可变状态，不算通过。

## 6. T2：Golden 批量校准，而非全屏相似度装饰

### 目标

把现有单帧工具升级成证据化校准工作流：知道在比较什么、哪块区域错了、错了几帧，且能实际提交布局/时序修正。

### 关键前置：先建立对应关系

源视频 Frame/PTS 与目标 Take 帧号必须分别保存。源录像 60fps、输出 30fps，或者开始时间不同，都不能直接复制帧号。只有同一时间原点和速度时才可用固定比例映射；一般情况应按语义事件锚点建立显式分段映射。

每个 Case 至少记录：

```text
referenceMediaHash
sourceFrameIndex（可选）/ sourcePTS / timeBase
referenceCrop 与 referenceDesignTransform
targetTakeHash 或 isolatedFixtureHash
targetFrame / targetFPS
eventId / eventType
对应关系：exact-replay / state-matched / isolated-presentation
ROI / Mask / excludedRegions
reviewStatus / unresolvedReasons
```

如果源视频局面或输入动作没有重建，就不能声称已复刻该事件。可以使用隔离表现 Fixture 验证 Praise 或弹窗绘制，但必须标为 isolated-presentation，不能假称该玩法触发规则已经确认。

### 工作

1. 读取现有 13 组 Golden 定义，生成 start/peak/end 目标清单（通常最多 39 个点，去重后以报告为准）。逐项建立对应关系，不删除难例凑通过率。
2. 用 T1 原生捕获输出候选帧；源媒体/图片本地读取，保留来源 Hash，拒绝比例不匹配时的无声拉伸。
3. 按 Board、Tile、Tray、HUD、Feedback/VFX 区域分别统计几何、边缘、色彩、Alpha 和事件时间偏差；粒子/压缩敏感区域单独展示。
4. 产出可本地打开的 HTML 对比报告与机器可读 JSON。批量模式读取相同 Case，不允许 CLI 与页面各写一个比较算法。
5. 修复现有单帧工具的结果身份：换 Take、帧号、Plan、参考图或布局后，旧 Diff 必须失效或保持为明确的冻结快照。关闭校准面板后不得遗留参考叠加层影响试玩。
6. 在 `referenceProfile` 或受控布局配置中实际修正已确认的偏差。工具通过与内容校准通过分开验收。
7. 不凭一条视频编造计分、Combo 或 Praise 阈值。证据不足保留 unresolved；允许完成“表现层”，不冒充“规则真值”。

### 建议起始验收门槛

仅适用于已对齐、可比较、分辨率归一正确的 Case；单位是参考设计像素：棋盘矩形 2–3px、格尺寸/间距 1–2px、HUD/候选锚点 3–5px、拾取比例 2%、事件锚点误差不超过目标输出 2–3 帧。预消除及实际消除的逻辑格集合必须完全一致。

阈值在 T0/T2 开始时冻结，不能看到结果后随意放宽。不是要求不同材质/风格的画面像素相同，也不是所有 ROI 都必须采用一个综合分数。

### T2 两道验收

- **工具验收**：有自制可公开 Fixture，自动批量报告可复跑；故意偏移棋盘、错一帧、漏一资产时能失败。
- **参考内容验收**：现有 13 组全部列出为 PASS/FAIL/BLOCKED/NOT_COMPARABLE，并有证据。缺少原始视频时，工具可验收，真实参考内容仍须 BLOCKED。

新高分、候选刷新等尚未对应的表现，不强行一次实现完；列入单独后续 Case 和 PR。核心 Idle→拖拽→预消除→清除→恢复输入必须优先完成。

## 7. T3：固定机位契约、3D 反光诊断与后处理

### 目标

将“相机暂时没动、画面调暗了”升级为可验证的固定构图和可解释材质展示。复用已有 LookDev 三档，不重复增加同名开关。

### 工作 A：固定构图

1. 由统一 Shot/Camera/Layout Profile 定义目标画幅、投影、棋盘平面、BoardScreenRect 和关键安全区，Renderer 真正消费它，而不是只在 Manifest 里声明。
2. DOM Resize 只缩放展示；切换设备 DPR 不改变归一化构图。不同输出宽高比须显式换 Profile，不偷改镜头。
3. 棋盘几何、厚度、相机投影与屏幕矩形由单一关系推导，避免同时独立写死 FOV、相机位置和屏幕 Rect 造成矛盾。
4. 测试棋盘/格槽可见边界、候选块包围盒、合法拖拽落点、最大允许震动/推近。离场碎片可以有意出框，不能与“关键玩法被裁切”混为同一错误。
5. 固定基准相机；Reactive Motion 显式声明作用于世界、合成层还是 UI。HUD 不应因无关相机适配漂移。2D 叠加层与 3D 必须共享屏幕投影约定。

### 工作 B：材质与高光诊断

提供 Beauty、Base Color/Albedo、World/View Normal、Roughness、Metalness、Emission、Bloom Contribution 和近白高光诊断。调试视图必须读取实际运行材质/贴图，而不是按材质名称涂一张演示色图。

检查输入/工作/输出色彩转换只执行正确次数；颜色贴图与数据贴图使用不同语义。Three.js 当前官方说明见 [S1]；实际 API 以仓库锁定版本为准。

区分 LDR 近白诊断与 HDR 能量：最终 RGB 接近白不一定代表物理计算已经“裁切”，报告必须说明测量空间、ROI 和阈值。不要把玻璃的合理高光或 VFX 全部判失败。

### 工作 C：选择性 Bloom

实现明确的 Bloom 参与分类或独立发光通道，让普通牌块高光、HUD 和参考 Overlay 不被无差别扩散。使用包含亮白非发光物体与 HDR 发光物体的测试场景证明选择性成立。若本 PR 仅改善 Threshold，必须仍标 threshold-bloom，不能命名为已实现 selective-bloom。

合成时保留正确深度/遮挡，不能让背后光效无意透过前景。先在 Neutral 保持可读，再调 Balanced，最后 High Energy。不得用关闭阴影、统一改成哑光或压黑整幅画面代替反光修复。

### T3 验收

固定 9:16 在多种 DOM 尺寸和 DPR 1/2 下关键屏幕坐标一致；最大允许响应无关键裁切。提交同一 Take、同一材质、同一帧的修复前后图、调试通道图与完整清除短视频。保留现有玻璃/树脂拖拽回归，透明度和 Transmission 不得不加区分地叠用。[S2]

## 8. T4：PBR 材质真正进入运行时

### 目标

用户/外部 Agent 提交一个此前未内置的合法材质，牌块外观实际改变，并在棋盘、候选、拖拽、导出中一致。不是“文件进入 IndexedDB”或“MaterialPack JSON 校验成功”。

### 本阶段输入

优先支持现有资源引用 + MaterialPack JSON，以及 PNG/WebP 等已解码可用的静态 PBR 贴图组。提供多文件选取与显式通道映射；文件名自动识别只能给建议，歧义须确认。ZIP/整个工程包不是本任务前置；GLB 特殊几何和 DCC Adapter 本阶段后置。

最低通道：Base Color、Normal、Roughness、Metallic、AO，另支持必要的纯参数因子。Emission 可纳入既有标准通道。Height/Displacement、任意各向异性节点、真实次表面和复杂透射不在最低范围；存在未实现字段时必须报告，不静默承诺已支持。

### 必须实现

1. 复用 `src/assets/` 的内容寻址和资源解析，不另建第二个 IndexedDB。UI 与 CLI 共用纯参数/通道校验与编译函数；运行资源获取允许 Browser/Node 各自适配。
2. 通道、颜色空间、法线方向、UV、repeat/offset/rotation、采样与贴图因子的语义明确。Base Color/Emissive 与 Normal/Roughness/Metallic/AO 的颜色空间处理不同。[S1]
3. 支持分离灰度图与 ORM 通道映射。glTF 的 Roughness 取 G、Metallic 取 B，AO 取 R；不能直接把任意单通道红图绑定到 G/B 而不转换。[S3]
4. 纯参数因子与纹理采样如何组合写入契约和测试。法线 Y 约定不明时不靠静默翻转猜对。
5. 运行材质从 ResolvedRenderPlan 读取。不得要求外部 Pack 携带旧 `studio.style.material` 枚举才能显示；旧预设作为内置 Pack 或显式兼容适配保留。
6. Material Hash、纹理 Hash、采样/UV 配置、参数和 relevant LookDev 配置参与正确缓存身份。共享资源可复用，但单物体的预消除/离场变化不能修改整局共用材质。
7. 棋盘上的牌块、候选牌块、拖拽牌块共用外观定义；Ghost/非法落点是独立表现策略。牌面 Decal 单独保留，并检查 mipmap、深度、透明混合与 z-fighting。
8. 不把材料 density 等行为字段当成真实物理单位。行为字段现阶段可以进入描述，但未消费的能力必须显示为 pending，不能标已实现材质感知破坏。
9. 加载失败、Hash 不符、错误纹理、过大解码尺寸、无 UV、不支持字段等必须有结构化错误。资源加载完成前禁止正式导出。连续切换材质不得使用旧结果覆盖新结果或持续泄漏纹理。

### T4 验收

至少使用不锈钢、木材和一个任意命名的新自定义材质；其中两套有真实独立 PBR 贴图，不能全部用一个贴图染色。再对既有塑料/树脂/玻璃做兼容回归。

用人工构造的数值纹理验证：只改变 Roughness 会改变高光而不改变 Base Color；只改变 Metallic 不改变棋盘状态；Normal 正反 Y 样例有可解释差异；ORM 和分离图得到一致结果。

提交外部 JSON + 贴图 + 许可证/来源 + Hash + 测试片段。随机重命名为全新合法 ID 后仍能渲染，证明不是按 gold/wood/steel 硬编码分支。

### 最小 CLI 增量

保留已存在命令；仅补本任务必需的材质检查/编译入口（最终命名在 T0 冻结）。现有入口通过源码核查后复用，不先假定不存在。Node 命令不得直接依赖 DOM/IndexedDB；还没有无头视频能力就不要输出 `rendered: true`。

## 9. T5：纵向切片、三个变体与正式 Review 交付

### 目标切片

选一份自制、可公开重放的约 6–8 秒 Take：

```text
候选待机 → 拾取 → 拖拽 → 合法预览/预消除
→ 落子 → 单行清除 → 简单评价 → 下一次输入
```

补一个交叉清除压力用例。两者的状态真值不依赖商业参考视频版权资产。

### 集成工作

1. 同一不可变 Plan/Take、资源版本和输出 Profile 进入预览与导出；导出冻结快照，不能录到中途 UI 修改。
2. 产出 Reference 2D 与固定机位 3D 对照。2D→3D 的外观可变，但棋盘坐标、落子结果、清除格集合和事件锚点应保持契约一致。
3. `fixed-camera-cinematic` 只有在存在可执行后端且该切片实际跑通时才在能力表标 available；不能简单给 `three-3d` 改标签。允许复用旧场景的有效模块，不要求推倒重建。
4. 同一 Take 输出三个材质变体。暂不要求完整笛卡尔矩阵 UI或云队列，但应提供一个可复跑的本地检查/渲染脚本或明确操作步骤，记录每个变体的 Plan、Asset、Replay/Camera/Layout Hash。
5. 正式视频规格 1080×1920、30fps、无声；视频长度、帧数、编码时间戳应自洽。浏览器内离线导出与 CLI 无头导出是两种能力，报告须分别列出。
6. 将实际能力更新到 capabilities/README，pending 功能仍保留 pending。浏览器本地资产不可用时，清楚报错，不输出缺图视频。

### T5 硬验收

- 三个变体 `frame-exact` 时：Take、落子格、清除集合、分数事件、相机和布局一致；仅外观及获准表现变化。
- 用源视频参考进行质感对比时记录“同玩法精确重放”还是“同类型场景审美比较”，不能混用为严格像素 A/B。
- 持续进行多次 Look/材质切换、Seek、取消导出、重新导出后没有黑帧、旧图回写、重复离场或关键裁切。
- 预览与导出使用相同资源/画面逻辑；抗锯齿/超采样差异可允许，但不能遮挡、位置或动作时间不同。
- 用户审核前，质量状态为 `ready-for-review`，不是 `visually-approved`。

## 10. 数值、性能和审美门禁

### 10.1 逻辑与确定性是硬门禁

使用真实状态/事件数据比较，不只比较开发者写进 JSON 的 Hash。对状态序列作规范化后计算 Hash；显示不同 Hash 时同时给出首个差异事件/格子。改变布局、FPS 或时序必须违反相应锁定策略，不应由重新生成母版自动掩盖。

### 10.2 显存与速度必须测量

记录预热耗时、离线逐帧 P50/P95、编码耗时、峰值已分配纹理/RenderTarget 估算、Draw Call/三角数。下载文件大小不能代替 GPU 解码后占用；CPU Heap 不能冒充 GPU 显存。[R5]

性能验收在 T0 选择的同一设备、同一分辨率与场景进行；若关键路径 P95 回退超过约定预算须解释并 Review。不要承诺任意电脑 60fps 或“秒级出片”。首次可以冻结 20% 回退警戒线作为项目测试规则，而不是跨硬件通用标准。

### 10.3 美术不是一个综合分数

同时检查牌块主色/材质可识别度、高光、接触感、拖拽重量感、清除因果、玩法可读性。提供基线与候选、盲标 A/B、建议与已知不足。没有用户审核不得声称超过参考成品。

本阶段不实现所有破坏族。新材质的离场至少保持材质/颜色一致、不误播明显不兼容的特效；真正金属延展、木纤维、透明脆裂、石材断面和软体撕裂留到下一独立里程碑。

## 11. 分支、PR 与合并

每个任务独立工作树/分支，例如 `work/t1-reference-passes`、`work/t2-golden-batch`、`work/t3-camera-lookdev`、`work/t4-pbr-runtime`。基于通过 T0 的集成基线，不能拿历史 ZIP 覆盖最新仓库。

PR 建议顺序：T0 → T1 → T3/材质纯模块 → T2/T4 完整接线 → T5。可并行写代码，但共享接口只由集成负责人落地。

本轮交给外部 Agent 后，不直接向 `main` 推未经 Review 的实现；不 force push、不重置其他人分支、不新增自修改 Bootstrap 工作流、不修改仓库权限或泄露凭据。基础设施确需变更时独立说明。不要自动把测试截图/视频提交到公开 Git，优先放有适当权限和保留期限的 CI Artifact。

## 12. 统一验收命令

以下前五条是基线已有命令，其他为本阶段应实现并写入 package.json 的检查入口，最终名称可以在 T0 调整，但文档/CI/Agent 必须一致：

```bash
npm ci
npm run check
npm test
npm run typecheck
npm run build

# 本阶段新增目标，当前不能假称已存在：
npm run test:render-regression
npm run test:golden-batch
npm run test:pbr-runtime
npm run test:browser-e2e
```

真实浏览器 E2E 至少覆盖：初始化、2D/3D 切换、图片/材质准备、拖拽/Seek、取消导出、固定构图、多次切换和正式帧捕获。软件 WebGL 可以验证功能，不作为高端硬件性能结论；须在报告中标出实际 Renderer。

## 13. 交回 Review 的证据包

每个任务交付最小 PR + `REVIEW.md`；T5 提供总包：

```text
outputs/review/
├── REVIEW.md
├── review-manifest.json
├── test-results.json
├── environment.json
├── fixtures/                 # 可公开的 Take/Case/Material 与 Hash
├── frames/                   # reference / before / after / diff
├── videos/                   # 2D 与三个固定机位材质版本
├── reports/
│   ├── golden-report.json
│   ├── resource-report.json
│   ├── invariants-report.json
│   └── performance-report.json
└── known-limitations.md
```

`REVIEW.md` 必須说明任务 ID、基线/Head SHA、PR、改动路径、逐条验收状态、复跑命令、失败/未测项、破坏性变更与迁移方式。`review-manifest.json` 记录环境、Take/素材/Plan 身份、每个产物文件路径及 SHA-256。报告中的 `passed` 必须来自实际运行；未执行使用 NOT_RUN，证据缺失用 BLOCKED。

用户交给 ChatGPT Review 时提供：PR/分支及固定 commit、REVIEW.md、证据包。重点审查功能事实、状态不变量、固定构图、真实资源消费、错误路径、回归画面与质量证据，不只看代码量和测试个数。

## 14. 可直接转发给执行 Agent 的指令

> 你负责 Block Creative Studio 下一阶段的指定任务。先阅读本文件、AGENT_OPERABLE_BOUNDARY.md、ASSET_IMPORT_PIPELINE_V1.md、FIXED_CAMERA_LOOKDEV_V1.md，并核对当前 HEAD。不要把历史聊天或旧 ZIP 当作源码。按 T0→分工任务→T5 执行；没有其他并行 Agent 时按顺序执行全部。本轮目标是可校准 2D、固定机位 3D 及任意 PBR 材质的真实渲染切片，不是内置模型或重建通用引擎。实现写独立分支/PR，不直接合并 main。每一步实际运行检查和浏览器验证，交付 REVIEW.md、机器报告、前后帧、样片和已知限制。不能以 Schema/编译通过替代渲染成功，也不能以 CI 通过替代审美验收。缺失源视频则标记真实参考校准 BLOCKED，继续完成自制 Fixture 的工具与功能验证。

## 15. 后续里程碑，不计入本阶段完成声明

- 材质感知破坏：少量基础机制族 + 连续行为参数 + DCC/美术增强资源，而非每种颜色一套完整视频。
- GLB 特殊几何、预切碎片、Transform Track、AE/Blender Flipbook 与 Alpha/深度/发光通道。
- 素材完整工程包、正式 Variant Matrix、无头浏览器渲染 CLI、批量队列/恢复。
- 音频事件、材质音色与混音。
- MCP/Skills 外部 Agent 适配；不改变 Agent-neutral 边界。

## 16. 依据与技术参考

下面仓库链接固定到已核对基线；接口实现以项目锁定依赖为准。公开文档用于确定格式/色彩语义，不表示项目已实现其全部能力。

- [R1 Reference2DScene](https://github.com/dongyuan21/block-creative-studio/blob/74a2fba002fe62643884759b6611af9181330964/src/reference2d/Reference2DScene.ts)：帧捕获、解码、实时与固定帧路径。
- [R2 Calibration Workflow](https://github.com/dongyuan21/block-creative-studio/blob/74a2fba002fe62643884759b6611af9181330964/docs/reference/v2/CALIBRATION_WORKFLOW_V1.md)：现有单帧校准目标与限制；本任务补充事件/时间对应约束。
- [R3 StudioScene](https://github.com/dongyuan21/block-creative-studio/blob/74a2fba002fe62643884759b6611af9181330964/src/renderer/StudioScene.ts)：现有材质缓存和 3D 场景。
- [R4 studioVariantBridge](https://github.com/dongyuan21/block-creative-studio/blob/74a2fba002fe62643884759b6611af9181330964/src/integration/studioVariantBridge.ts)：母版派生、Renderer 与变体接线。
- [R5 runtimeAssetBindings](https://github.com/dongyuan21/block-creative-studio/blob/74a2fba002fe62643884759b6611af9181330964/src/assets/runtimeAssetBindings.ts)：现有运行资源描述和依赖遍历。
- [S1 Three.js Color Management](https://threejs.org/manual/en/color-management.html)：颜色贴图、数据贴图、工作/输出色彩空间。
- [S2 Three.js MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)：Transmission 与 Opacity 语义。
- [S3 Khronos glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)：PBR 通道、法线与 Alpha 规范。
