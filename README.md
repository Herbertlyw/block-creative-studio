> Experimental TapTile source branch. The current BB showcase is maintained on [main](https://github.com/Herbertlyw/block-creative-studio/tree/main). This branch keeps gameplay code and reusable textures; historical review media and handoff reports are archived locally, and new captures stay in ignored `outputs/review/`. Known constraints are documented in [Known limitations](docs/KNOWN_LIMITATIONS.md).

# Block Creative Studio

Block Creative Studio 是一个面向 IAA 方块消除试玩素材的浏览器创作与渲染工程。用户先编辑牌面，由人类或机器完成试玩并保存语义 Replay；随后可以独立调整节奏、视觉资产和演出层，最后由 Chrome 按固定时间步逐帧重演并导出视频。

在线预览：[`herbertlyw.github.io/block-creative-studio`](https://herbertlyw.github.io/block-creative-studio/)

> 当前版本为 `0.3.0-alpha.4`。工程主线是 **reference-first 2D → 固定机位混合影视渲染**。2D 阶段负责确认玩法、布局、事件、时序和资产谱系；后续生产后端会在固定摄像机下混合 Screen 2D、Shader、浅 3D、真实 3D 牌块/碎片和预烘焙 VFX，而不是把所有元素强制做成一种技术形态。

本项目独立实现 8×8 方块放置与完整行列清除机制；不包含第三方游戏的品牌、原始美术、声音、源代码或内部算法。

## 当前主线：整段视频审计与 Reference 2D

第一份 225.833 秒真机录像已经完成全帧机器扫描：13,546 个源帧全部纳入连续状态索引，没有采样跳帧。机器区间用于保证覆盖和检索事件候选；代表事件另行人工复核，不把启发式窗口冒充逐像素人工真值。

[`docs/reference/v2/`](docs/reference/v2/README.md) 当前包含：

- `FULL_FRAME_STATE_INDEX_V1.json`：第 0～13,545 帧连续覆盖；
- `EVENT_INSTANCE_INDEX_V1.json`：分数、拖拽、清除、刷新、反馈、终局候选窗口与人工复核事件；
- `ASSET_LINEAGE_V2.json`：149 个语义 Atom，不是图片清单；
- `REFERENCE_PROFILE_V2.json`：核心必选、事件必选、参考档必选、capture-only 与可选项；
- `FIXED_CAMERA_RENDERER_MAPPING_V1.json`：每个 Atom 在固定机位生产后端中的主要表达方式；
- `GOLDEN_SCENE_INDEX_V1.json`：下一轮本地截图校准的代表区间。

整片审计额外确认：

- 方块存在七个颜色族：`coral / amber / lime / cyan / blue / violet / rose`；
- 牌面至少包含扶桑花、叶片、龟背竹、多瓣花和玫瑰轮廓等家族；
- 评价词至少包含 `Nice / Great / Amazing / Incredible / Fantastic / Unbelievable` 六级；
- 存在独立 `NEW HIGH SCORE` 横幅与最高分动态更新；
- 候选刷新由花轮廓、花芯、光晕、花瓣/彩屑和 Piece 入场构成；
- 玩法输入可以与上一轮 Praise、Combo、计分和余辉异步重叠。

精确清除得分、格内 `5/9` 选择、Praise 阈值、Combo 窗口、发牌策略和音频事件仍标记为 `unresolved`。

## TapTile 7 槽三消导演台 Gate D

默认首页现已提供一个独立的 TapTile 9:16 可视化工作台。编辑器保留沙漏、T 型、阶梯和自由模板及完整堆叠编辑能力，并已接入 Project Schema V2、旋转矩形遮挡编译、7 槽三消正式状态机、玩法校验、真人试玩、Take 录制与确定性回放。右上角可切回原 Block Creative Studio。

拖拽采用带磁滞的智能轨道吸附：可识别牌块中心、边缘、相邻两牌的中间缝线、重复间距和画布中心；吸住后可沿参考线稳定滑动，明显离开才释放。拖动中按 `Alt` 可临时关闭吸附，按 `Shift` 可锁定横向或纵向，并以实时参考线、目标牌高亮和状态标签反馈结果。

牌块层数支持无固定上限的整数增减，层数越大越靠上；层级过滤只展示实际使用的层。多选两张以上可执行上下左右边缘或水平/垂直中心对齐，多选三张以上还可执行横向、纵向等距分布。

Gate A 已在真实浏览器中完成两组三消、增量解锁和逐步回放闭环，且控制台无错误。确定性 Agent 现可生成稳定通关、险境翻盘、连续三消、快速清台和刻意失败五类 Take，并在保存前由正式引擎重放验证。Gate B 证明同一 Level/Take 在动物与食物两套完整 SkinPack 下逐步逻辑和终态哈希不变；Gate C 又完成四套可切换导演节奏、任意帧 Seek、固定 Seed 粒子与 VFX/下一次输入重叠。M8 已用预览同源的 CanvasRenderer 在真实浏览器导出 1080×1920、30fps H.264 MP4。Gate D 进一步完成 2 套语义 AudioPack、Cut/TimeWarp、Outro、带 AAC 单条成片、批量组合 manifest，以及带 SHA-256 校验的 `.taptile-project.zip` 导出回导闭环。

## 当前可运行能力

- 8×8 玩法核心、三个候选块、合法落子、同步清行列、候选刷新和失败判断；
- 牌面模板、逐格棋盘编辑、18 种基础形状与七色 Token；
- 候选方块逐格颜色编辑；
- 真人鼠标/触摸试玩，记录语义动作、归一化指针轨迹、帧长与 Seed；
- 规则型机器玩家；人和机器共用同一种 Action/Take 协议；
- Raw Take → Directed Take → 固定帧 PresentationFrame；
- 四套导演节奏：`human-natural`、`tight-fast`、`suspense-burst`、`combo-rush`；
- 默认 `reference-2d` Canvas 渲染器；
- 保留 `three-3d` 实验后端，但停止把它当作当前视觉基线；
- WebCodecs + Mediabunny 的浏览器固定帧 H.264/MP4 导出；
- TapTile 语义事件音频混合、AAC 封装、Cut/TimeWarp、Outro、组合批量队列和逐条 manifest；
- 带资产清单、独立 Takes、manifest 与 checksums 的 `.taptile-project.zip` 工程包；
- 工程 JSON 导入/导出、运行时校验、自动保存和 CI；
- 固定机位 Camera Profile 与语义资产类型契约，为后续混合渲染器留出稳定接口。
- IndexedDB Browser Asset Store：真实背景/牌面文件按 SHA-256 持久化，自动派生 Look/Variant，并进入实时预览与固定帧导出。
- Reference 2D Golden Diff：本地导入参考帧，叠加、分屏、差异热图、对齐线和诊断指标。
- 3D LookDev：中性、平衡、高能量三档；曝光、环境反射、Bloom 阈值与清除 Boost 可独立控制。
- 原生 1064×1788 捕获与图层 Pass 隔离；1080×1920 导出对 2D 使用 contain，不再拉伸。
- `fixed-camera-cinematic`：锁定 9:16 Shot Profile，并提供 Albedo/Roughness/Metalness 等诊断视图。
- Headless Material Runtime 与 `bcs material compile` / `bcs golden batch`。
- 不锈钢 / 橡木独立合成 PBR 贴图进入 Three.js 牌块；aurora-shell 为任意 ID 的参数材质。
- `npm run capture:review`：无头 Chrome 产出公开 Fixture 原生帧与三变体 1080×1920 无声样片。

## Headless Core 与外部 Agent 边界

BCS 当前开始提供 Agent-neutral 的 Headless Core。系统本身不内置 LLM 或 Prompt 面板；外部 Agent、设计师、DCC 或生成工具先生产版本化资产与 Recipe，BCS 再负责严格校验、变体编译、质量门禁和后续确定性渲染。

已加入：

- 开放 `AssetManifest / MaterialPack / EffectPack / LookPack / PluginPackage` 契约；
- `CreativeMaster + VariantRecipe → ResolvedRenderPlan` 编译器；
- `frame-exact / semantic / rule-only` 三种不变量锁定模式；
- 材质外观与破坏行为分离，以及 Material-aware Effect 兼容检查；
- 结构、确定性、权限和资源预算型 Quality Gate；
- 机器可读的 `bcs` CLI 与 JSON Schema；
- 批量矩阵编译时单变体失败隔离。

```bash
npm run build:cli
node dist-cli/cli/bcs.js capabilities
node dist-cli/cli/bcs.js variant compile \
  --master examples/headless/master.demo.json \
  --recipe examples/headless/variant.copper.demo.json \
  --assets examples/headless/assets \
  --renderer fixed-camera-cinematic \
  --require-hashes \
  --out /tmp/copper-plan.json
node dist-cli/cli/bcs.js quality check --plan /tmp/copper-plan.json --strict --require-hashes
```

详见 [`AGENT_OPERABLE_BOUNDARY.md`](docs/architecture/AGENT_OPERABLE_BOUNDARY.md)、[`HEADLESS_CORE_V1.md`](docs/architecture/HEADLESS_CORE_V1.md)、[`WEB_VARIANT_WORKSPACE_V1.md`](docs/architecture/WEB_VARIANT_WORKSPACE_V1.md)、[`ASSET_IMPORT_PIPELINE_V1.md`](docs/architecture/ASSET_IMPORT_PIPELINE_V1.md)、[`FIXED_CAMERA_LOOKDEV_V1.md`](docs/architecture/FIXED_CAMERA_LOOKDEV_V1.md) 和 [`CLI 文档`](docs/cli/README.md)。插件执行、MCP 和云端渲染仍然延后；网页工作台已经接入同一套 Registry、Variant Compiler 与 Quality Gate。

## Web Variant Workspace

右侧属性面板现在包含第一版变体工作区。网页端不再直接把一个材质下拉框视为最终生产配置，而会将当前项目和 Take 编译成：

```text
CreativeMaster
+ VariantRecipe
+ versioned Asset Registry
→ ResolvedRenderPlan
→ QualityReport
```

当前可以：

- 在“当前工程、参考花园、清洁 2D、固定机位 3D 糖果、固定机位 3D 水晶”等内置 Look Pack 之间切换；
- 选择 `frame-exact / semantic / rule-only` 不变量策略；
- 导入外部 Agent 或工具生成的 Asset Manifest Bundle 和 Variant Recipe JSON；
- 查看 Plan Hash、目标 Renderer、资产数量、显存预算和结构质量问题；
- 导出 Master、Recipe、Plan、Quality Report 与资产清单，交给外部 Agent 继续加工；
- 只有在变体编译和质量门禁通过后才允许正式视频导出。

## Browser Asset Store

网页工作台现在可以直接接收真实二进制资产。文件按 SHA-256 存入浏览器 IndexedDB，并通过 `bcs-asset://sha256/<digest>` 与版本化 Manifest 绑定；大文件不会写入 LocalStorage。

当前上传入口支持：

- 背景图片：立即替换 `background.base`，可在 Reference 2D 和实验性固定机位 3D 中预览，并进入离线视频导出；
- 牌面贴图：独立替换 `tile.face`，可在 Reference 2D 中预览并进入离线导出；
- 粒子 Sprite、Flipbook/透明片段、音频、自包含 GLB、材质纹理图：已经能够存储、版本化、生成 Manifest 和 Variant；Material/Effect 的嵌套 AssetRef 会进入完整依赖闭包，但对应 Web Render Pass 尚未全部实现，因此会标记为“可编译”而不是伪装成已经可见。

上传成功后，系统会自动创建一个派生 Look Pack 和 Variant Recipe，再通过同一套 Variant Compiler 与 Quality Gate。若当前 Plan 引用的本机 Blob 缺失，正式 MP4 导出会被阻止。

详见 [`docs/architecture/BROWSER_ASSET_STORE_V1.md`](docs/architecture/BROWSER_ASSET_STORE_V1.md)。

## Reference 2D 校准

Reference 2D 画布右下角提供 `2D 校准`：

```text
本地 Golden Reference 帧
+ 当前 BCS 帧
→ 叠加 / 分屏 / 差异热图
→ 平均色差 / 变化像素 / 边缘错位
```

参考帧只在本地浏览器中读取，不上传，也不写入项目。该工具用于锁定棋盘、HUD、候选区、拖拽和事件帧位；随机粒子不以单一像素分数决定通过。详见 [`CALIBRATION_WORKFLOW_V1.md`](docs/reference/v2/CALIBRATION_WORKFLOW_V1.md)。

## 3D LookDev 与反光治理

实验性 3D 已加入中性材质校准、平衡影视和高能量三种 LookDev Profile。内置材质、灯光、环境反射、静态 Emission 和 Bloom 已重新归一化；透明拖拽 Ghost 不再同时叠加低 Opacity 与 Transmission。

正常顺序是：

```text
Neutral LookDev：判断材质本身
→ Balanced Cinematic：检查固定机位质感
→ High Energy：只为清除峰值增加能量
```

详见 [`FIXED_CAMERA_LOOKDEV_V1.md`](docs/architecture/FIXED_CAMERA_LOOKDEV_V1.md)。

## 运行

要求 Node.js 22.12+ 和近期桌面版 Chrome。

```bash
npm install
npm run dev
```

开发服务地址：`http://127.0.0.1:4173`。

## 校验与构建

```bash
npm run check
npm run check:reference
npm test
npm run typecheck
npm run build
npm run test:render-regression
npm run test:golden-batch
npm run test:pbr-runtime
npm run test:browser-e2e
npm run capture:review
```

`test:browser-e2e` 在本机有 Chrome 时跑冒烟捕获；`capture:review` 写出原生 PNG 与三变体 1080×1920 无声 MP4 到 `outputs/review/`。软件 SwiftShader 不能当作高端 GPU 性能结论。缺少源视频时 Golden 内容校准仍为 BLOCKED。

GitHub Actions 会在每次 Push 和 Pull Request 中执行 check / test / typecheck / build。`check:reference` 会验证整段帧覆盖、事件边界、149 个 Atom、必选性分类、固定机位映射与 Golden Scene 引用。

## 本地重建整段视频索引

源视频和参考截图不会提交到公共仓库。持有本地参考录像时，可执行：

```bash
python -m pip install -r tools/reference_audit/requirements.txt
python tools/reference_audit/analyze_video.py \
  "/path/to/reference.mp4" \
  --output-dir .reference-audit-work/generated

python tools/reference_audit/extract_golden_frames.py \
  "/path/to/reference.mp4" \
  docs/reference/v2/GOLDEN_SCENE_INDEX_V1.json \
  --output-dir .reference-audit-work/golden
```

详见 [`tools/reference_audit/README.md`](tools/reference_audit/README.md)。

## 推荐 Review 流程

1. 先审阅 [`FULL_VIDEO_AUDIT_REPORT_V1.md`](docs/reference/v2/FULL_VIDEO_AUDIT_REPORT_V1.md)，确认整片新增发现；
2. 审阅 [`ASSET_LINEAGE_V2.json`](docs/reference/v2/ASSET_LINEAGE_V2.json) 的必选性与固定机位表达；
3. 本地生成 Golden Scene 的 start/peak/end 帧；
4. 在 `Edit` 模式编辑棋盘和七色候选块；
5. 真人拖拽，检查拾取放大、上移、合法 Ghost 与预消除填充；
6. 保存 Take 后切换节奏，确认玩法结果不变；
7. 对照 Golden Scene 记录 Reference 2D 的布局、颜色和时序偏差；
8. 2D 门禁通过前，不扩展自由相机或通用真 3D 表现。

## 代码结构

```text
src/domain          纯 TypeScript 玩法、形状、计分分解、工程校验
src/headless        开放资产契约、Registry、变体编译与质量门禁
src/integration     Web 项目与 Headless Core 的适配桥
src/cli             外部 Agent / CI 使用的机器可读 CLI
src/director        Take → 固定帧表现状态；逻辑与 VFX 时间解耦
src/assets          语义资产、固定机位契约、Browser Asset Store 与运行时绑定
src/reference2d     真机参考 2D 布局、Canvas 渲染和交互
src/renderer        旧 Three.js 3D 实验后端
src/exporter        固定帧 Canvas → WebCodecs → MP4
src/components      Human-first 工作台与 Variant/Quality 面板
src/state           项目、试玩、Take、变体工作区、回放与导出编排
docs/reference/v2  全帧索引、事件索引、资产谱系和渲染映射
tools/reference_audit  本地整片分析与 Golden Frame 提取工具
schemas             工程、资产谱系和固定机位契约 Schema
```

## 当前限制

- 13,546 帧已被机器逐帧处理并实现 100% 时间覆盖，但不是 13,546 帧全部人工逐像素标注；
- Reference 2D 仍是第一版渲染骨架，尚未达到像素级复刻；
- 外部背景与牌面二进制资产已可持久化、预览和导出；GLB、Flipbook、音频、材质纹理和粒子资产目前仅完成存储与契约绑定，尚未完成对应 Render Pass；
- 六级 Praise 已进入谱系，当前运行时阈值仍是明确标注的原型启发式；
- `NEW HIGH SCORE`、候选刷新复合 VFX 和完整异步演出尚未完全进入运行时；
- Block 主线导出当前仍为无声 MP4；其音频事件轨尚未接入；
- TapTile 同一冻结组合的源帧映射、PCM 与解码内容确定；浏览器硬件 WebCodecs 不承诺 MP4 容器字节流 bit-exact；
- 当前只保证桌面 Chrome；
- Blender/AE 接口保留，但 DCC 适配推迟到 2D 资产槽位和 Golden Scene 门禁之后。

## TapTile 堆叠与玩法支线

当前 fork 同时包含 TapTile 手工堆叠编辑器，以及从 143 条无水印成片审计出的纯 TypeScript 玩法基础层。入口与证据边界见 [`docs/taptile/README.md`](docs/taptile/README.md)。
