# TapTile 7 槽三消导演台实施状态

> 分支：`feature/taptile-tray-match3-director-v1`  
> 基线：`c1c455800a627b1b1a835fdf4a772e30a068e088`  
> 开始日期：2026-09-02（Asia/Shanghai）

## 基线记录

- 工作区在实施前为干净状态；没有用户未提交改动需要覆盖或迁移。
- 本机 PATH 未提供 `node` / `npm`。验证使用 Codex 工作区运行时 Node `v24.19.0` 与 pnpm `11.19.0`；安装结果为 already up to date。
- `check-source` 与 `check-core` 通过。
- Vitest：9 个测试文件、49 项测试全部通过。
- TypeScript 类型检查通过。
- Vite 构建通过；保留原有单个大于 500 kB 的主包警告。
- 原始 CDP 冒烟脚本在“框选后批量删除”步骤失败：牌数 `14 -> 14`。该失败发生在任何产品代码改动前，列为基线问题。
- 基线截图：`artifacts/design-qa/taptile/m0-baseline-hourglass.png`（截图目录由仓库忽略，不进入提交）。

## 状态表

| Milestone | 状态 | Commit | 自动测试 | 浏览器验证 | 主要遗留 |
|---|---|---|---|---|---|
| M0 基线与文档 | complete | 本状态文档首次提交 | 49/49；check/type/build 通过 | 基线截图完成；原冒烟脚本有已记录失败 | npm 不在 PATH；使用等价运行时 |
| M1 Schema V2 | complete | 本阶段提交 | 55/55；check/type/build 通过 | 编辑器已接 V2；完整闭环归 Gate A | IndexedDB 资产上传留到资产阶段 |
| M2 Level Compiler | complete | 本阶段提交 | 旋转几何、覆盖、hash 与验证测试通过 | 调试 UI 将随 Gate A 验证 | 阈值为显式工程默认值，不声称为官方公式 |
| M3 7 槽引擎 | complete | 本阶段提交 | 7 槽顺序、拒绝、解锁、6/7、胜负与 100 次确定性通过 | 浏览器交互归 Gate A | 旧多模式研究代码仅保留在 experimental |
| M4 Play + Take | complete | 本阶段提交 | 13 个测试文件、58/58；check/type/build 通过 | 试玩与回放闭环通过 | 编辑态布局变更在试玩中锁定 |
| Gate A | complete | 随 M4 | 13 个测试文件、58/58；check/type/build 通过 | 48 张初始牌；修正遮挡边 `91→90`；6 次动作完成 2 组三消并解锁 4 张；Replay `6/6`；终态 `state-c91f0b62`；控制台 0 错误 | 截图与示例已固化 |
| M5 Solver | complete | 本阶段提交 | 14 个测试文件、64/64；小关卡、正式沙漏、同 Seed、danger-rescue、intentional-fail、证据边界通过 | 48 步 `safe-win` Agent Take 胜利并确定性回放；终态 `state-8ba1e269`；控制台 0 错误 | Beam Search 的 `not-found` 不宣称数学无解 |
| M6 SkinPack | complete | 本阶段提交 | 15 个测试文件、71/71；两套完整覆盖、三类 FaceAssembly、Asset/Stage Registry、兼容错误、role 一致和视觉边界不变量通过 | animals/food 均显示 16 个匹配组完整覆盖 | IndexedDB 上传保留为后续资产入口；项目不持久化 blob URL |
| Gate B | complete | 随 M6 | 15 个测试文件、71/71；两套 Skin 的 Transition/State/Hash 全等测试通过 | 同一 48 步 Take 比较 49 个状态；`level-ec5f06bd` 与 `state-8ba1e269` 不变；视觉身份改变；board/tray 身份一致；控制台 0 错误 | flight/match-ghost 由同一 resolver 覆盖并有角色不变量测试，实际动画随导演阶段呈现 |
| M7 Director | complete | 本阶段提交 | 16 个测试文件、78/78；四 Profile、事件轨、动作时间点、直接/顺播一致、Seed、单动作覆盖和正式重放状态通过 | 动作条、事件点、播放头、缩放、Profile 与单动作飞行帧覆盖已接 UI | DOM 导演预览将在 M8 与 Canvas 固定帧渲染共用 PresentationFrame |
| Gate C | complete | 随 M7 | 直接 Seek、Seed 粒子、VFX overlap、玩法哈希不变量通过 | 三 Profile 为 `2430/1125/822` 帧；48 动作；快速 Profile 各 15 处 overlap；Seek 往返一致；控制台 0 错误 | 无 |
| M8 Canvas + MP4 | complete | `8d4d472` | 17 个测试文件、84/84；通用 FrameRenderJob、AssetCache、冻结身份、zBand、几何与像素哈希测试通过；check/type/build 通过 | 真实浏览器导出 1080×1920、30fps、108 帧、3.6 秒 H.264 MP4；取消后工程不变；6 个关键帧截图与解码帧比对；控制台 0 错误 | H.264 有预期有损压缩，关键帧 SSIM 为 0.9715–0.9819；布局由同一 CanvasRenderer 输出且无空间漂移 |
| M9 Audio/Batch | complete | 本阶段提交 | 18 个测试文件、94/94；AudioPack 变体/Seed/音量/偏移/淡入淡出/延迟/峰值、Cut/TimeWarp、Outro、矩阵去重/取消/失败隔离、manifest 与 ZIP hash 回导通过 | 组合预览、带音频单条导出、3 任务批量队列、manifest 下载、项目包导出/回导均接入 Export UI | IndexedDB 本地资产会写入包且校验 SHA-256；默认 Gate D 工程只使用 builtin/synth 资产，因此包内 assets 为 manifest |
| Gate D | complete | 随 M9 | 18 个测试文件、94/94；check/type/build 通过 | 1 Level、2 Take、2 Skin、4 Director、2 Audio、2 Cut、1 Outro；单条 AAC 成片与 3 个批量组合成功；项目包原样回导；控制台 0 错误 | WebCodecs 的 MP4 压缩字节流不承诺 bit-exact；两次重跑的解码视频帧与音频帧逐帧 MD5 完全一致，组合/PCM 内容 hash 一致 |

## 决策账本

- 正式运行链只接受 `taptile-tray-match3-v1`；已有多模式研究实现仅在兼容/实验边界保留。
- 1080×1920 整数输出像素是玩法几何真值；432×768 只用于编辑显示。
- `editorLocked` 只影响编辑器，不进入可点击判定。
- `levelHash` 排除主题、牌面、牌体、背景、导演与音频字段。
- 未经浏览器和固定帧实测的能力不会在本表中标为 Gate 完成。
- “确定性成片”以冻结输入、帧映射、PCM hash 与解码后逐帧内容为准；硬件 WebCodecs 允许产生内容等价但容器 SHA 不同的合法码流。

## Gate A 证据

- `artifacts/design-qa/taptile/gate-a-blocker-validation.png`
- `artifacts/design-qa/taptile/gate-a-play-two-matches.png`
- `artifacts/design-qa/taptile/gate-a-deterministic-replay.png`
- `examples/taptile-gate-a-project.json`
- `examples/taptile-gate-a-take.json`

## M5 证据

- `artifacts/design-qa/taptile/m5-agent-safe-win-replay.png`
- 浏览器结果：48 个动作、全部 actor=`agent`、结果 `won`、Replay valid、控制台 0 错误。
- `danger-rescue` 固定关卡会先触发一次 `tray.warning`，随后以三消降回 6 槽以下并最终通关。

## Gate B 证据

- `artifacts/design-qa/taptile/gate-b-animals-v1-replay.png`
- `artifacts/design-qa/taptile/gate-b-food-v1-replay.png`
- 同一 Take 的 49 个状态哈希、棋盘 ID 和槽位 ID 逐步相同；两套主题的视觉身份不同。
- `animals-v1` 与 `food-v1` 均严格覆盖全部 16 个 archetype，缺绑定时明确报错且不会静默回退。

## Gate C 证据

- `artifacts/design-qa/taptile/gate-c-human-natural.png`
- `artifacts/design-qa/taptile/gate-c-tight-fast.png`
- `artifacts/design-qa/taptile/gate-c-combo-rush.png`
- 三套 Profile 共享 `level-ec5f06bd` 与 `state-8ba1e269`；总时长不同，动作与三消结果不变。
- 快速 Profile 的播放头截图可见三消 ghost/VFX 与下一动作时间条重叠；直接 Seek 往返快照完全一致。

## M8 证据

- `artifacts/design-qa/taptile/m8-six-action-combo-rush-1080x1920.mp4`
- `artifacts/design-qa/taptile/m8-{initial,first-click,first-flight-midpoint,first-tray-reorder,first-match,ending}-frame-*.png`
- 浏览器导出元数据：H.264 High、`yuv420p`、1080×1920、30fps、108 帧、3.600 秒、3,849,167 bytes。
- 6 个固定帧像素哈希：`pixels-7aa2d09a`、`pixels-41817f6f`、`pixels-ee3b1709`、`pixels-8b63219e`、`pixels-52c38aec`、`pixels-32a4ae33`。
- 同一 `TapTileRenderJob` 与 `CanvasRenderer` 驱动预览和导出；导出前冻结 Project/Level/Take/Skin/Director/Asset 身份，取消操作确认 Take 集合未变。

## M9 / Gate D 证据

- `artifacts/design-qa/taptile/gate-d-single-audio.mp4` 与对应 `.manifest.json`。
- 单条成片：H.264 High、`yuv420p`、1080×1920、30fps、163 帧 / 5.433 秒；AAC-LC、48kHz、立体声；21 个语义 cue；4,394,698 bytes。
- 音频实测平均 `-19.4 dB`、峰值 `-3.6 dB`；混音器限制后浮点峰值 `0.6510`，低于 AudioPack 上限。
- 同组合重跑的 `variant-4733e779` 与 `pcm-1ec9cafc` 一致；两份 MP4 的解码视频 frame-MD5 与音频 frame-MD5 逐帧完全一致。容器 SHA 不同属于 WebCodecs 合法编码差异，不是画面/声音漂移。
- `artifacts/design-qa/taptile/gate-d-batch-{1,2,3}.mp4`：3/3 成功，均含 H.264 + AAC，并各自带 manifest、唯一组合 hash 与 PCM hash。
- `artifacts/design-qa/taptile/gate-d-project.taptile-project.zip`：63,680 bytes；包含 `project.json`、`assets/manifest.json`、2 个 Take、项目 manifest 与 `checksums.json`；浏览器回导前逐文件 SHA-256 校验，回导后工程身份完全一致。
- `artifacts/design-qa/taptile/gate-d-production-matrix.png`、`gate-d-outro-final-frame.png`、`gate-d-batch-complete.png`。
- 浏览器 Gate D：2 Take、2 SkinPack、4 DirectorProfile、2 AudioPack、2 CutSpec、1 OutroPack、48 个去重可执行组合；控制台 0 错误。
