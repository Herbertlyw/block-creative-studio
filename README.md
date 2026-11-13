# Block Creative Studio

[![CI](https://github.com/Herbertlyw/block-creative-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/Herbertlyw/block-creative-studio/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**让休闲游戏视频素材持续产出，降低重复制作成本。**

制作拖消、落消等方块类休闲游戏素材时，不必每次都从零开始。基于同一套可编辑工程，你可以调整玩法、画面、声音和节奏，持续制作不同的视频变体，减少重复制作所需的时间和人力。

Block Creative Studio 是一个本地运行的创作工作台，支持 BB 拖消和 BC 落消。你可以从示例或已有工程开始，编辑棋盘、动作和画面，再调整图片、音乐与效果，预览并导出视频。工程可以保存和重新打开，方便继续制作变体。

> 本项目目前是展示和开发版本。不同游戏、工程和素材的支持范围不同，使用前请查看下方的[功能与限制](#功能与限制)。

## 快速开始

需要 **Node.js 22.12 或更高版本**、npm 和支持 WebCodecs 的桌面浏览器；建议使用 Chrome。带声音的视频导出还需要浏览器支持 AVC 和 AAC 编码。

```sh
git clone https://github.com/Herbertlyw/block-creative-studio.git
cd block-creative-studio
npm ci
npm run dev
```

在浏览器中打开终端显示的地址，默认是 <http://127.0.0.1:4173>。

- **试用 BB**：在首页新建 BB 作品，设置棋盘和供给，录制或生成 Take。
- **试用 BC**：选择“打开 BC 落消工作台”，再选择“打开落消示例”；也可以访问 `/#bc`。
- **打开已有作品**：选择“导入项目”。内嵌素材随工程加载；外部素材需要选择对应目录并通过哈希校验。

编辑后可以预览、保存并导出。保存会由浏览器发起下载，请确认文件已实际保存，并保留原始工程。

## 工作台能做什么

| 工作流           | 当前能力                                                                     |
| ---------------- | ---------------------------------------------------------------------------- |
| **创作玩法**     | 编辑 BB 棋盘和固定供给，录制拖放动作或生成机器 Take；BC 可编辑落位和轨迹。   |
| **参考视频观察** | 在 BB 中结合视频和测量结果，标注棋盘、动作时间、几何和轨迹，确认后生成作品。 |
| **制作变体**     | 按游戏和工程支持范围，调整颜色、背景、牌面、音乐和效果。                     |
| **预览与导出**   | 切换 Take、定位画面或连续播放，使用工程声音导出 MP4。                        |
| **保存与重开**   | 保存可编辑工程；可用的内嵌素材随作品保存，外部素材需按引用和哈希解析。       |

**Take** 是工程中的一段动作记录。同一个作品可以有多个 Take，用于保存和查看不同的动作过程。

### 选择一条工作流

1. **从零开始**：新建作品或打开示例 → 设置棋盘和动作 → 调整画面、声音 → 预览、保存和导出。
2. **继续已有作品**：导入工程或作品包 → 检查素材和 Take → 编辑并另存 → 重新打开确认 → 导出。
3. **参考视频制作**：在 BB 观察入口载入视频 → 标注并确认可见信息 → 生成作品 → 检查和调整后导出。

参考视频需要人工或 Agent 观察和确认；项目目前不提供任意视频的自动玩法识别。浏览器中的视频定位为近似 seek，不应直接视为精确提帧。

## 命令行

仓库提供 `bcs` CLI，可查询和校验工程、编辑部分玩法与素材、生成预览帧及导出视频。先安装依赖，再构建 CLI：

```sh
npm run build:cli
npm run --silent bcs -- games list --json
npm run --silent bcs -- games describe block-placement --json
npm run --silent bcs -- games describe block-crush-drop --json
```

创建并检查一个 BB 作品包：

```sh
npm run --silent bcs -- game block-placement 'project create' --out bb.json --json
npm run --silent bcs -- game block-placement 'project validate' --input bb.json --json
```

CLI 的写操作需要指定新的输出文件，不会覆盖输入文件。预览和视频渲染需要本机 Chrome 及相应编码能力；待渲染素材须已内嵌。命令、参数和具体限制见 [CLI 使用说明](docs/CLI_WORKFLOW.md)。

## 功能与限制

- **游戏和工程格式**：BB 支持当前作品包及受支持的原生工程；BC 展示入口使用 `block-crush-drop` 0.4.0 原生工程。旧公开 V1 格式不在当前展示入口的支持范围内。
- **图片与效果**：PNG/JPEG 可用于受支持的图片槽；不同槽位可能影响棋盘、候选或拖动中的不同部分。BC 可播放已有的受支持透明 PNG 序列，但不会自动为变化后的消除区域生成新序列。
- **声音**：支持工程中的 PCM WAV 音乐和事件音效，具体编辑能力取决于游戏与工程。预混 WAV 中的音乐和音效不能自动拆开。
- **视频**：使用支持 WebCodecs 的浏览器导出；AAC 时间处理针对实际编码器校准。浏览器、编码器和历史工程的兼容范围并非全部覆盖。
- **素材安全**：素材缺失、哈希错误或无法解析时，需要补齐或重新绑定，不能假定所有外部资源都会自动找到。

完整使用范围与限制请查看 [BB 工作流](docs/BB_WORKFLOW.md)、[BC 工作流](docs/BC_WORKFLOW.md) 和 [CLI 使用说明](docs/CLI_WORKFLOW.md)。

## 开发与验证

```sh
npm run check
npm test
npm run check:repository
npm run format:check
npm run typecheck
npm run build
npm run build:cli
```

需要验证浏览器中的预览、保存和有声导出时，可按修改范围运行：

```sh
npm run test:browser:preview-session  # BB
npm run test:browser:bc               # BC
```

浏览器媒体检查还需要本机 Chrome、FFmpeg 和 FFprobe。合成测试通过不等于所有真实工程都已验收，也不代替视觉和听感检查。

## 项目结构与文档

- `src/games/`：各游戏的编辑、玩法适配和画面实现。
- `src/contracts/` 与 `contracts/`：工程、素材、校验及相关 Schema。
- `src/exporter/`：视频编码、封装与音频时间处理。
- `src/cli/`：`bcs` 命令行入口。
- `docs/`：按游戏、CLI 和架构整理的使用说明。
- `outputs/`：本机生成的工程、媒体和诊断文件，由 Git 忽略。

| 文档                                 | 内容                                     |
| ------------------------------------ | ---------------------------------------- |
| [BB 工作流](docs/BB_WORKFLOW.md)     | BB 创作、观察、素材和声音                |
| [BC 工作流](docs/BC_WORKFLOW.md)     | BC 工程、变体、效果和导出                |
| [CLI 使用说明](docs/CLI_WORKFLOW.md) | 命令、参数、示例和限制                   |
| [架构](docs/ARCHITECTURE.md)         | 作品、玩法、时间线、绘制和导出的模块边界 |
| [贡献指南](CONTRIBUTING.md)          | 开发约定和检查方式                       |
| [Agent 入口](AGENTS.md)              | 项目内技能和工作约定                     |
| [第三方声明](THIRD_PARTY_NOTICES.md) | 主要依赖和许可说明                       |

## 许可

本项目以 [MIT License](LICENSE) 发布。第三方依赖的许可信息见 [第三方声明](THIRD_PARTY_NOTICES.md)；实际使用的图片、音乐和视频素材仍需遵守其各自许可。
