# 贡献指南

## 开发环境

- 使用 `.nvmrc` 指定的 Node.js 版本；最低版本见 `package.json`。
- 包管理器为 npm，使用已提交的 `package-lock.json` 安装依赖。
- 浏览器目标为支持 WebGL2 和 WebCodecs 的桌面 Chrome。

```sh
npm ci
npm run dev
```

## 修改放在哪里

| 范围                      | 位置                              |
| ------------------------- | --------------------------------- |
| 工作台界面与作品会话      | `src/components/`、`src/state/`   |
| BB 时间线、帧求值和绘制层 | `src/games/block-placement/`      |
| 工程、素材引用和编辑校验  | `src/contracts/`、`contracts/bb/` |
| 通用编码与音频时间处理    | `src/exporter/`                   |
| 当前使用的基础运行模块    | `src/nativeReference/`            |
| 回归测试与本地验证工具    | `tests/`、`scripts/`              |

`src/nativeReference/` 是当前运行依赖。保留其职责边界，按具体调用修改；不能因为目录名含 Reference 就整体删除。详细调用关系见 [架构](docs/ARCHITECTURE.md)。

## 实现约定

- 玩法规则独立于 React 和具体绘制后端。Take 保存语义动作；指针采样用于表现，不代替合法落子判断。
- 预览和导出按同一帧时间线求值，不使用墙上时钟决定离线视频的运动。
- 修改工程字段时同步更新类型、解析、合同与实际消费者；保留旧文件，明确字段的单位和默认行为。
- 素材按真实内容哈希绑定。缺失或不支持的资源应报告具体错误，不能静默换成默认素材。
- 保留未保存草稿保护、过期异步结果检查、素材 URL 释放和导出取消行为。
- 新增游戏时使用所属游戏的合同和适配器，避免把 BB 规则复制成第二套游戏实现。

## 选择合适的检查

```sh
npm run check
npm test
npm run check:repository
npm run format:check
npm run build
```

修改玩法时运行对应规则与回放测试；修改界面状态时运行相关会话或草稿测试。影响预览、保存或导出时，可运行 `npm run test:browser:preview-session`，需要 Chrome、FFmpeg 和 FFprobe。

只有受到影响的内容需要追加检查。没有改动渲染或声音时，不要求重新导出历史视频；一般展示任务不需要生产级审批或采样级音频分析。

## 提交范围

- 一次提交说明一个明确的修改目的，PR 中简述行为变化和实际检查结果。
- 代码、合同、必要测试和当前文档可以提交。
- 工程导出、用户素材、视频、音频和诊断文件放在忽略的 `outputs/` 目录。
- 小型通用图片源码可放在 `src/assets/` 或 `public/`；其他媒体、归档及超过 1 MiB 的文件由仓库检查拦截。
- 测试夹具优先使用程序构造的输入，避免依赖本机绝对路径或历史交接目录。

`npm run check:repository` 检查当前 Git 跟踪文件、历史交接依赖及 Markdown 本地链接。它不清理远端旧分支或 Git 历史，不能据此宣称所有历史对象均已删除。
