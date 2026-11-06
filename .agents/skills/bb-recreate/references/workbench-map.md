# 当前 BB 工作台能力地图

此文件帮助定位实际入口，不代替当前源码。
下面路径均相对于仓库根。

## 启动和已有检查

- 页面开发服务：`npm run dev`
- 依赖未安装时：`npm ci`
- 针对性软件回归：`npm run test:demo`
- 类型检查：`npm run typecheck`
- 构建：`npm run build`
- 当前展示入口检查：`npm run check:bb-demo`
- 一次完整展示流程冒烟：`npm run test:browser:demo`

普通工程编辑和视频任务不要求运行所有软件测试。
这些命令主要在修改代码、首次配置环境或排查相关问题时使用。

`check:bb-single-mainline` 是更严格且更重的历史检查，不作为每次创作的默认门槛。

## 工程与任务不同

- 当前可移植作品包：`bcs-bb-work`
- 包内原生工程：`bcs-studio-project` V2
- 本 Skill 的 `task.json`：单独的任务进度记录

不要把状态机字段写进工程 Schema。
不要把未知自定义字段塞进 V2 后假装已有消费者。

旧公开 V1 格式不属于当前展示版支持入口。

## 当前实际源码

| 用途                       | 位置                                               |
| -------------------------- | -------------------------------------------------- |
| 工作台入口                 | `src/App.tsx`                                      |
| 当前作品会话               | `src/state/useBBWorkSession.ts`                    |
| 包打开、保存、引用处理     | `src/contracts/bbWorkPackage.ts`                   |
| 观察与复刻界面             | `src/components/ReferenceVideoNotes.tsx`           |
| 标注生成玩法               | `src/contracts/buildObservedTake.ts`               |
| 标注绑定校准轨迹           | `src/contracts/bindObservedCalibration.ts`         |
| 复刻作品恢复               | `src/contracts/restoreObservedWork.ts`             |
| 保留原作品内容合并观察修改 | `src/contracts/mergeObservedEdit.ts`               |
| 来源绑定                   | `src/contracts/observedSourceLink.ts`              |
| 通用图片绑定               | `src/contracts/setNativeWorkImage.ts`              |
| 音频角色添加、替换         | `src/contracts/setNativeWorkAudio.ts`              |
| 观察外观和消除变体         | `src/contracts/setObservedWorkVisual.ts`           |
| 普通作品节奏               | `src/contracts/setBBRhythm.ts`                     |
| 工程音频消费               | `src/contracts/nativeProductionAudio.ts`           |
| 当前共同 2D 场景           | `src/games/block-placement/rendering/BBScene2D.ts` |

这些 TypeScript 文件主要是应用内部接口，不是可以直接照文件名执行的 CLI。
使用页面或已有脚本；需要程序化接入时先读真实函数签名和调用方。

不要凭原工作台经验假设这个仓库具有完整的 `bcs` CLI 或全部 53 项命令。

## 当前常用素材范围

通用图片槽：

- `background.base`
- `tile.face`
- `board.atlas`

槽位的实际优先级要看当前消费者。
特别是棋盘已占格、候选、拖动和碎片可能读取不同资源，不能只看一个画面区域就断言全部换好了。

观察作品另有按主题分组的图片绑定。
已有灰色主题可区分 white、coral、cyan；不能推断所有颜色都有独立图片槽。

音频角色：

- BGM；
- 落子；
- 消除。

替换角色保留已配置参数；逐事件混音不能无意压成一个全局音效。

观察主题和消除效果的实际选项以 `setObservedWorkVisual.ts` 导出为准。
有选项不代表任意素材组合都适用；保留其资源与主题限制。

## 实际边界

- 复刻依赖人工或 Agent 标注。
- 浏览器 seek 是近似定位，精确源帧可用测量脚本提取。
- 观察作品玩法修改需要回观察编辑流程确认。
- 当前来源恢复主要面向单 Take。
- 额外独立时间轨道不会自动随新动作重定时。
- 2D 图片或效果不会自动获得完整 3D 消费。
- 任意序列特效、所有原生 profile 和所有历史工程并非已支持。
- 普通和观察作品共用 BB 核心，但外观绘制层仍有差异。

这些限制用于选择正确操作，不要求每次任务都先完成底层重构。
