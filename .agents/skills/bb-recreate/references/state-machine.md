# BB 展示任务的共用状态机

## 目的

状态机用于记住：

- 当前在做什么；
- 用户要求的终点；
- 使用哪个来源和工程；
- 允许修改什么、需要保留什么；
- 已经产生哪些文件；
- 上一步是否成功；
- 下一步从哪里继续。

它不是审批系统，也不替代工作台本身的合法性检查。
正常任务不需要逐阶段询问用户。

## 状态

正常路径：

`intake → prepare → execute → check → deliver → done`

辅助状态：

- `blocked`：缺必要输入、实际功能不支持或无法自行恢复。
- `paused`：用户明确要求暂停。

允许回退：

- `prepare → intake`：任务范围需要重新整理。
- `execute → prepare`：需要补素材或修改标注准备。
- `check → execute`：发现具体问题，回去修复。
- `deliver → check / execute`：交付前发现遗漏。

`done` 表示本次要求的终点已经完成，不代表用户已经正式批准画面。
新的变体要求建立新任务并引用原任务结果，不覆盖已完成任务。

## 各阶段应记录什么

### intake

记录任务类型、用户要求、输入和终点。

终点使用：

- `project`：可编辑工程；
- `preview`：工程和预览；
- `video`：工程和视频。

不要把“给我一个工程”扩大成必须出完整视频。

### prepare

复刻任务整理观察、测量、素材和当前模板。

变体任务记录：

- 修改项；
- 保留项；
- 基础工程；
- 新素材或目标参数。

能从用户上下文确定的内容直接采用，不要求重复确认。

### execute

使用当前工作台编辑、生成、保存或导出。

每完成一个有意义的小步骤，更新下一步，例如：

- “已确认前三步，继续标注第四步”
- “牌面已替换，接下来查看消除画面”
- “工程已另存，接下来重开并导出”

不要每一帧、每一次点击都写检查点。

### check

做与当前任务有关的轻量检查。

工程终点检查工程和重开；
预览终点检查相关画面；
视频终点检查本次实际成片。

检查不通过就回 `execute`，带上具体原因。
禁止用重复执行完整历史测试替代定位当前问题。

### deliver

确认交付文件存在，简短说明修改内容和已知限制。
无需增加另一轮模型评分或用户审批。

### done

只在用户要求的工程、预览或视频确实交付后进入。

## 持久化文件

任务目录中使用 `task.json`。

脚本保存：

- 输入和产物的路径、字节数、SHA-256；
- 任务类型、请求和终点；
- 修改范围和保留项；
- 当前状态和恢复状态；
- 最近检查；
- 下一步；
- 状态历史。

不要把图片 Base64、整段视频或完整工程载荷重复塞进任务状态。
任务状态和视频工程是两个不同文件。

## 辅助脚本

脚本位于：

`.agents/skills/bb-recreate/scripts/task_state.py`

从仓库根运行：

    BB_TASK="outputs/block-placement/2026-11-06/example"
    BB_STATE=".agents/skills/bb-recreate/scripts/task_state.py"

    python3 "$BB_STATE" init "$BB_TASK" \
      --kind recreation \
      --request "复刻提供的 BB 三步片段" \
      --endpoint video

    python3 "$BB_STATE" input "$BB_TASK" \
      --file "/实际路径/reference.mp4" \
      --role reference-video

    python3 "$BB_STATE" advance "$BB_TASK" \
      --to prepare --note "来源和任务范围已明确" \
      --next "测量源视频并标注动作"

变体任务使用 `--kind variant`，并设置范围：

    python3 "$BB_STATE" scope "$BB_TASK" \
      --change "只替换背景音乐" \
      --preserve "棋盘、供给、动作、画面、固定音效和视频时长"

正常推进：

    python3 "$BB_STATE" advance "$BB_TASK" \
      --to execute --note "输入和准备材料齐全"

实际保存文件之后登记：

    python3 "$BB_STATE" artifact "$BB_TASK" \
      --file "/实际路径/work.json" --role project

    python3 "$BB_STATE" artifact "$BB_TASK" \
      --file "/实际路径/result.mp4" --role video

轻量检查后：

    python3 "$BB_STATE" advance "$BB_TASK" \
      --to check --note "已生成本次工程和成片"

    python3 "$BB_STATE" check "$BB_TASK" \
      --result passed \
      --note "工程已重开；成片落位、消除和要求的声音正常"

    python3 "$BB_STATE" advance "$BB_TASK" \
      --to deliver --note "已准备交付链接和限制说明"

    python3 "$BB_STATE" advance "$BB_TASK" \
      --to done --note "已向用户交付本次要求的结果"

检查不通过：

    python3 "$BB_STATE" check "$BB_TASK" \
      --result needs-fix --note "第二步落位位置错误"

    python3 "$BB_STATE" advance "$BB_TASK" \
      --to execute --note "修正第二步目标及受影响轨道"

这些命令是操作范例。不要执行含“实际路径”的占位参数。

## 中断与恢复

查看：

    python3 "$BB_STATE" status "$BB_TASK"

缺少必要材料：

    python3 "$BB_STATE" hold "$BB_TASK" \
      --to blocked --note "缺少用户指定的背景图片"

恢复：

    python3 "$BB_STATE" resume "$BB_TASK" \
      --note "背景图片已补齐"

用户要求暂停时才使用 `--to paused`。
不要因为任务比较慢、文档较长或一般检查未完成而自动暂停。

出现网络、浏览器或导出临时错误时，先检查是否已有有效产物。
确认没有成功结果后，可以针对同一失败步骤重试。
重复失败且没有新信息时，记录具体原因，停止无意义循环。

恢复任务时先读状态和产物，不自动重做已通过的步骤。
某个输入已经变化时，重新登记该输入并回到受影响阶段。

## 检查与权限边界

`check --result passed` 只记录执行者实际完成的检查，不会自动检查画面，也不会替用户批准。

脚本只管理本地状态：

- 不运行渲染；
- 不上传；
- 不推送代码；
- 不删除素材；
- 不修改工程；
- 不给予额外外部操作权限。

脚本会阻止跳过阶段、缺产物交付和记录后被改动的文件。
输入或产物重新登记后，旧检查结果失效。

任务状态使用原子写入和短时目录锁。若进程被强制结束留下锁，先确认该任务没有运行进程，再清理对应的 `.state-lock` 空目录；不要删除 `task.json` 或历史产物。
