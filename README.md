# Block Creative Studio

[![CI](https://github.com/Herbertlyw/block-creative-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/Herbertlyw/block-creative-studio/actions/workflows/ci.yml)
[MIT License](LICENSE)

在浏览器中创作、复刻和改编 BB 拖消、BC 落消视频。将棋盘、供给和动作保存为可编辑工程，再调整素材、声音与演出，预览并导出 MP4。

A browser-based studio for editable BB placement and BC falling-block videos, reference annotation, and creative variants.

## 能做什么

- **创作玩法**：编辑初始棋盘与固定供给，手动拖动录制动作，或生成机器 Take。
- **观察复刻**：结合参考视频和帧测量，标注棋盘、落点、时间、几何与轨迹。
- **制作变体**：在已有作品上修改图片、材质、颜色、背景、音乐和受支持的效果，保留其他内容。
- **保存与出片**：保存可移植作品、重新打开编辑，逐帧预览并导出带声音的 MP4。

参考复刻需要人工或 Agent 观察标注。当前不提供任意视频的自动识别；不同素材、效果与 3D 模式的支持范围见 [BB 工作流](docs/BB_WORKFLOW.md)。

## 快速开始

需要 Node.js 22.12 及以上、npm，以及支持 WebCodecs 的桌面浏览器。推荐使用当前版本的 Chrome。

```sh
npm ci
npm run dev
```

打开终端显示的本地地址，默认是 `http://127.0.0.1:4173`。

1. **已有工程**：导入工程或作品包，等待素材载入后预览、继续编辑或导出。
2. **从零创作**：新建作品，设置棋盘与供给，录制或生成 Take，再添加外观和音频。
3. **根据视频复刻**：打开参考视频观察入口，完成标注与校准，生成作品后继续编辑。

BC 从首页的“打开 BC 落消工作台”进入，也可在地址后加 `/#bc`。它使用独立的落消规则与原生 2D 场景，支持导入已有 BC V2 工程、编辑动作和轨迹、换色、换材质、换背景、保留序列效果及有声导出。具体范围见 [BC 工作流](docs/BC_WORKFLOW.md)。

作品和素材在本机处理。保存会发起浏览器下载，请保留原文件并检查下载是否完成。内嵌素材可随作品保存；外部引用需要提供对应素材并通过内容哈希校验。

## 开发与检查

```sh
npm run check
npm test
npm run check:repository
npm run format:check
npm run build
```

需要检查浏览器预览、保存、重开及一次有声导出时，运行：

```sh
npm run test:browser:preview-session
```

本轮分轨混音、保存重开、观察编辑与实际 BB/BC 有声出片检查为 `npm run test:browser:improvements`（先 build，再设置 `BCS_TEST_PRODUCTION=1` 可检查生产构建）。原生 AAC 不可用时按需使用官方软件 AAC，故障/取消/同页重试检查为 `npm run test:browser:aac-fallback`。`npm run test:browser:game-audio-endurance -- <上一步生成的目录>` 实际检查 BB 126.9 秒和 BC 121.167 秒合成有声工程的取消、重试、完整解码和事件时间；不代表真实作品或全高清压力验收。`npm run test:browser:export-endurance` 是独立的 120 秒合成无声检查。Chrome 不在默认路径时设置 `BCS_CHROME_PATH`。具体证据与限制见 [开发记录](docs/WORKBENCH_IMPROVEMENTS.md)。

浏览器检查额外需要本机 Chrome、FFmpeg 和 FFprobe。日常工程编辑只检查相关结果；开发测试与历史媒体全量验收分别进行。

## 文档

| 文档                                 | 内容                                         |
| ------------------------------------ | -------------------------------------------- |
| [BB 工作流](docs/BB_WORKFLOW.md)     | 创作、参考标注、素材、声音和实际限制         |
| [BC 工作流](docs/BC_WORKFLOW.md)     | 落消工程、外观变体、原生效果、音频与导出     |
| [声音混音](docs/AUDIO_MIX.md)        | BGM、事件 cue、人声、压低和默认兼容          |
| [CLI 基础入口](docs/CLI_WORKFLOW.md) | 工程查询、安全编辑、另存和当前能力限制       |
| [架构](docs/ARCHITECTURE.md)         | 作品会话、玩法、时间线、绘制与导出的模块边界 |
| [贡献指南](CONTRIBUTING.md)          | 开发约定、检查命令和提交范围                 |
| [Agent 入口](AGENTS.md)              | 复刻与变体 Skill、状态管理和轻量检查         |
| [第三方声明](THIRD_PARTY_NOTICES.md) | 使用的主要依赖及许可说明                     |

生成的视频、音频、工程导出和诊断文件放在忽略的 `outputs/` 目录，不纳入源码仓库。仓库保留代码、合同、程序构造的测试和使用文档。
