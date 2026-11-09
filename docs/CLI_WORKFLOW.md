# BB / BC CLI 基础入口

本入口面向本仓库开发环境。先使用 `npm ci` 安装包含开发依赖的依赖，再执行 `npm run build:cli`。构建后可用 `node dist-cli/bcs.js` 或 `npm run --silent bcs --` 调用；最后一种写法的 `--silent` 让 npm 本身不向 stdout 输出命令横幅。`package.json` 也声明了 `bcs` bin，指向构建产物；独立打包发布与生产环境安装尚未验收。

命令结果是一行 JSON，成功退出码为 0、操作错误为 1、参数或操作选项错误为 2。JSON 的 `ok` 和 `report` 沿用现有 Agent 结果结构。输出路径的目录须已存在；写操作必须指定不存在的新文件，拒绝覆盖输入或已有文件。

```sh
npm run build:cli
npm run --silent bcs -- games list --json
npm run --silent bcs -- games describe block-placement --json
npm run --silent bcs -- games describe block-crush-drop --json
npm run --silent bcs -- game block-placement 'project create' --out bb.json --json
npm run --silent bcs -- game block-crush-drop 'project create' --out bc.json --json
npm run --silent bcs -- game block-placement 'project inspect' --input bb.json --json
npm run --silent bcs -- game block-crush-drop 'project validate' --input bc.json --json
```

两个游戏的 `project inspect` 和 `project validate` 均执行工程验证；前者同时返回名称、格式和 Take 列表。`project create` 不接收输入文件，生成可编辑的 BB 作品包或 BC 示例。编辑参数通过 `--options-file` 指向 JSON 文件：

```json
{ "row": 0, "column": 0, "color": "coral" }
```

```sh
npm run --silent bcs -- game block-placement 'board edit' --input bb.json --options-file bb-options.json --out bb-edited.json --json
```

BC 示例第一步将列号改为 5，落位时间保持 1 秒：

```json
{ "takeId": "demo", "index": 0, "column": 5, "seconds": 1 }
```

```sh
npm run --silent bcs -- game block-crush-drop 'action edit' --input bc.json --options-file bc-options.json --out bc-edited.json --json
```

BB 棋盘使用现有工作台服务，带来源、指针、校准轨道或已保存片段的玩法编辑会拒绝，原作品保持不变。BC 动作沿用原生规则、30Hz 时间取整和效果绑定校验；当前有已保存片段、或多 Take 共享参考轨迹时拒绝编辑，避免擅自改写依赖。非法数字、越界和失效消除绑定也会拒绝。报告标记受影响 Take 及需要重新编译的计划和渲染结果。

本版只接受已内嵌素材的文件，不提供外部素材目录参数。BB 使用现有作品包校验；BC 检查工程、动作回放、效果绑定和已绑定素材／音频的哈希。CLI 校验不是浏览器完整渲染或解码验收，不能据此声称所有画面和声音都经过预览。

`games describe block-placement` 中可调用项只有 4 项。BB 原始适配器其余 31 项列为 `not-exposed`，其用途和失效信息供后续接入审核，不可作为本版文件写操作调用。BC 本版也只有 4 项；没有提供预览、渲染、批量、完整素材操作或与来源 CLI 的全面兼容。源端盘点的原始证据与构建版本尚待取得，不能将其计为已验收。

回归验证：

```sh
npm run build:cli
npm run test:cli
```

测试需要本机 Chrome。它通过真实 CLI 子进程检查输入、输出与拒绝行为，并在 BB、BC 工作台中分别重新打开和保存 CLI 输出；生成物写入忽略的 `outputs/`。
