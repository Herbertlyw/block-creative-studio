# BB / BC CLI 使用说明

本入口面向本仓库开发环境。使用 `npm ci` 安装依赖后执行 `npm run build:cli`，之后可运行 `node dist-cli/bcs.js` 或 `npm run --silent bcs --`。`--silent` 避免 npm 在 JSON stdout 前打印横幅。`package.json` 的 `bcs` bin 指向构建产物；独立安装发布尚未验收。

```sh
npm run build:cli
npm run --silent bcs -- games list --json
npm run --silent bcs -- games describe block-placement --json
npm run --silent bcs -- games describe block-crush-drop --json
npm run --silent bcs -- game block-placement 'project create' --out bb.json --json
npm run --silent bcs -- game block-crush-drop 'project create' --out bc.json --json
npm run --silent bcs -- game block-crush-drop 'project validate' --input bc.json --json
```

每次输出一行 JSON；成功退出 0，工程或操作失败退出 1，参数错误退出 2，Ctrl+C 取消退出 130。发现结果列出参数 Schema、执行环境和限制；标记 `not-exposed` 的 BB 原生操作不能直接调用。查询仅返回 report，不输出工程中的 Base64 媒体。

`--input`、`--out` 和 `--options-file` 相对当前工作目录。options JSON 中的 `file` 相对该 options 文件所在目录；也可使用绝对路径。所有写操作必须指定不存在的新输出文件，不能覆盖输入、已有文件或路径别名。候选完成验证后才原子发布；不会删除磁盘素材。

## 当前操作

以下操作均通过 `game <游戏 ID> '<操作名>'` 调用。BB 的游戏 ID 为 `block-placement`；BC 为 `block-crush-drop`。有选项的操作使用 `--options-file`，写操作还需 `--out`。

| 操作                                   | 选项 JSON                                            | 说明                                                                      |
| -------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `project create`                       | 无                                                   | 创建 BB 作品包或 BC 可编辑示例                                            |
| `project inspect` / `project validate` | 无                                                   | 验证并汇总工程或作品包                                                    |
| `board edit`                           | `{"row":0,"column":0,"color":"coral"}`               | BB 初始棋盘单格；颜色可为 null                                            |
| `action edit`（BB）                    | `{"takeId":"new","index":0,"row":0,"column":0}`      | 修改 BB 动作锚点并重验后续动作                                            |
| `action edit`（BC）                    | `{"takeId":"demo","index":0,"column":5,"seconds":1}` | 修改 BC 列与秒数，沿用 30Hz 取整                                          |
| `take list`                            | 无                                                   | 列出 Take、动作／交互数量、演员及依赖                                     |
| `take inspect` / `take validate`       | `{"takeId":"new"}`                                   | 查询动作与交互，或验证真实回放                                            |
| `take generate`                        | `{"takeId":"new","count":1}`                         | 新增机器 Take；BB 数量 1–100，BC 1–24；报告实际生成数量                   |
| `take clone`                           | `{"takeId":"new","newTakeId":"copy"}`                | 复制语义动作与交互，不复制专属绑定                                        |
| `take import`                          | `{"file":"replay.json"}`                             | 导入原生 replay，核对游戏、版本、初始哈希与回放；不改 ID                  |
| `take delete`                          | `{"takeId":"new"}`                                   | 删除指定 Take；受引用或受保护时拒绝                                       |
| `asset catalog`                        | 无                                                   | 列出本工程素材和本入口支持的图片槽                                        |
| `asset inspect`                        | `{"assetId":"image"}`                                | 查询元数据、绑定和引用，不输出图片正文                                    |
| `asset import`                         | `{"id":"image","file":"image.png"}`                  | 真实解码 PNG/JPEG 并内嵌；同 ID 异内容拒绝                                |
| `asset bind`                           | `{"assetId":"image","slotId":"world.background"}`    | 绑定图片；可选 `fit`、`opacity`、`blendMode`、`inset`                     |
| `asset unbind`                         | `{"slotId":"world.background"}`                      | 仅解除绑定，保留素材                                                      |
| `asset prune`                          | 无                                                   | 保守删除没有引用的图片条目，不删除音频或磁盘文件                          |
| `audio catalog` / `audio inspect`      | 无                                                   | 查询内置声音、预设、素材，或区分显式与生效设置                            |
| `audio import`                         | `{"id":"music","file":"music.wav"}`                  | 导入 PCM WAV；仅导入，不自动绑定                                          |
| `audio bgm edit`                       | `{"assetId":"music","gain":0.25,"loop":true}`        | 仅修改给出的 BGM 字段                                                     |
| `audio sfx edit`                       | `{"index":0,"gain":0.4}`                             | 按 cue 索引编辑 `gain`、`offsetSeconds`、`assetId`；默认 cue 会先显式展开 |
| `preview render`                       | `{"takeId":"demo","frame":30}`                       | 输出完整 Take 的绝对帧 PNG                                                |
| `video render`                         | `{"takeId":"demo","scope":"take","audio":"project"}` | 输出完整 Take、范围或有效片段的 MP4                                       |
| `audio edit`                           | `{"masterGain":0,"sfxEnabled":false}`                | 修改 `masterGain`、`sfxGain`、`sfxEnabled`、`mastering` 的指定字段        |

BGM 还支持 `enabled`、`startSeconds`、`sourceOffsetSeconds`、`fadeInSeconds`、`fadeOutSeconds`。合法的数字 0 会保留。更详细的范围与必填字段以 `games describe` 的 Schema 为准；例如：

```json
{ "takeId": "demo", "index": 0, "column": 5, "seconds": 1 }
```

```sh
npm run --silent bcs -- game block-crush-drop 'action edit' --input bc.json --options-file change.json --out bc-edited.json --json
```

## 素材、声音与保护

BB 图片槽为 `background.base`、`tile.face`、`board.atlas`；BC 为 `world.background`、`tile.palette`。导入和绑定使用本机 Chrome 真实解码。BC 调色板支持符合颜色数的 PNG 横向图集；正方形原图通过工作台已有逻辑生成图集。已有透明序列可以保留和查询，本入口不提供新序列导入器。

声音输入为当前解码器支持的 PCM WAV，单文件最多 16 MiB。导入、BGM 和 cue 是独立操作；BGM 修改保留其他 cue，cue 修改保留 BGM。音频预设、所有显式 cue、BGM 引用、真实字节和哈希均会检查；默认预设及 cue 保持原合同语义。

对于原先没有工程音频的作品，首次导入 WAV 或仅设置 BGM 会保持游戏音效关闭；需要时可通过 `audio edit` 显式设置 `sfxEnabled: true`。已有音频配置的作品继续沿用原有默认和显式设置。

BB 含来源、指针或校准轨道时，不能直接修改玩法 Take；图片和音频使用作品包更新校验并保留这些关联。删除被片段或效果引用的 Take 会指出依赖并拒绝。BC 的共享逐步参考轨迹以及已保存片段在部分玩法／图片编辑时仍受保护；不会自动解绑效果或删除片段以消除错误。

当前仍不支持外部素材目录参数、BC 3D、主题序列生成、持久批处理或全量来源 CLI 操作。源端原始盘点文件和构建版本未取得，不宣称与来源 CLI 全部兼容。

## 定帧和视频渲染

媒体命令需要本机已安装 Chrome，以及浏览器的 AVC 编码能力；含音轨时还需要 AAC 编码能力。CLI 启动只监听 `127.0.0.1` 的临时 Vite 服务和独立浏览器，直接使用工作台帧源、场景、工程混音与共享编码器。FFmpeg 和 FFprobe 仅用于外部检查，不是命令运行依赖。输入素材须已内嵌，BB 作品包中的指针随包读取。

```json
{ "takeId": "demo", "frame": 30 }
```

```sh
npm run --silent bcs -- game block-placement 'preview render' --input bb.json --options-file preview.json --out frame.png --json
npm run --silent bcs -- game block-crush-drop 'video render' --input bc.json --options-file video.json --out video.mp4 --json
```

`frame` 从 0 开始，是完整 Take 的绝对帧；PNG 为工程输出尺寸的画布像素。`video.json` 支持以下互斥形式：

```json
{ "takeId": "demo", "scope": "take", "audio": "project" }
{ "takeId": "demo", "scope": "range", "startFrame": 0, "endFrame": 89, "audio": "project" }
{ "takeId": "demo", "scope": "clip", "clipId": "opening", "audio": "silent" }
```

省略 scope 时使用完整 Take，省略 audio 时使用工程音频。范围首尾都包含：30fps 的 0–89 帧为 90 帧、3 秒。视频从零开始播放，画面和混音取原 Take 的同一时间窗口；不会受工作台上次选中的片段影响。`silent` 不输出音轨，不修改工程；`project` 在工程没有音频时保持无声，不添加测试音效。

片段必须属于指定 Take，来源 Take 和帧源哈希必须匹配；过期片段或含裁切的片段会拒绝，不自动刷新。BB 观察作品的指针同时绑定工程内容：CLI 会先核验真实指针，并接受移除片段元数据后按原有算法计算的帧源身份；无法核对的旧身份仍会拒绝。工作台的观察渲染入口保留原有片段限制。额外的 production 镜头、时序和后期特效未接入，会拒绝视频输出。BB 已保存的 2D 外观、工作台视图和质量设置以及观察作品的指针按现有消费者处理；BC 只支持现有 30fps reference-2d。小于 1 秒的有声音频窗口使用现有独立 AAC 编码器探针校准，结果会在报告中注明；较长音频保留内容校准。编码器当前限制偶数尺寸、宽高不超过 1920、最多 18000 帧。正式输出不覆盖既有文件；失败或 Ctrl+C 取消不会发布半成品，取消后可直接重试相同路径。进度输出到 stderr，stdout 仅输出最终 JSON；成功报告包含帧范围、尺寸、输入及输出 SHA-256 和混音提示。

## 验证

```sh
npm run build:cli
npm run test:cli:smoke
node scripts/test-cli-takes.mjs
node scripts/test-cli-audio.mjs
node scripts/test-cli-media.mjs
node scripts/verify-cli-media-review.mjs  # 需要 Chrome、FFmpeg 和 FFprobe
node scripts/test-cli-assets.mjs
npm run test:cli
```

Node 媒体测试覆盖参数、范围、片段身份和文件保护；图片测试和最后的工作台重开测试需要本机 Chrome。本轮还用程序生成的 BB／BC 工程执行 PNG、有声短片、FFprobe、完整解码及取消后重试。检查覆盖的样例不等于全部历史工程或跨平台验收。
