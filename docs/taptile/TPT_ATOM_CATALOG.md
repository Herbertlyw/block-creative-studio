# TapTile 原子化目录

## 1. 工程与数据原子

| 原子 | 职责 | 可独立替换 |
|---|---|---|
| `StageSpec` | 1080×1920 输出、预览缩放、安全区 | 是 |
| `TileGeometry` | 中心、宽高、层级、旋转、锚点 | 是 |
| `TileFace` | 正面图案与 face id | 是 |
| `TileBody` | 牌体轮廓、圆角、侧壁 | 是 |
| `TileMaterial` | 纹理、反光、透明度、阴影参数 | 是 |
| `StackLayout` | 所有牌的坐标与层级 | 是 |
| `BlockerGraph` | 哪张牌挡住哪张牌 | 从布局派生 |
| `GoalSpec` | 目标面、目标数、计数触发点 | 是 |
| `RuleSpec` | 槽位数、匹配数、玩法模式 | 是 |

牌面、牌体、材质、堆叠和规则必须分开。换牌面不能改变遮挡矩形；换材质不能改变 face id；换堆叠必须重算阻挡图，但不应重写三消算法。

## 2. 输入与编辑原子

- 单击命中与当前可点击态提示。
- 空白拖框、Shift 追加、全选、批量移动/删除/属性设置。
- 中心、边缘、两牌缝线、等距和半格轨道吸附。
- 层级加减、置顶、置底、锁定。
- 像素网格量化和越界约束。
- 撤销/重做与语义操作记录。

## 3. 玩法原子

- `hitTest(tileId)`：命中哪张牌。
- `isPlayable(tileId)`：游戏状态、锁定和阻挡图联合判定。
- `removeFromBoard(tileId)`：逻辑离开棋盘，不触发重力。
- `insertGroupedTray(tileId)`：同面归组插入。
- `resolveMatch(faceId, 3)`：三张同面清除。
- `selectInPlace(tileId)`：原位选择缓冲。
- `directClear(faceId)`：点击一张自动清同面集合。
- `updateGoals(event)`：目标进度。
- `recomputeUnlocks()`：删除后重算可点击集合。
- `checkTerminal()`：警告、失败、胜利。
- `applyBooster()`：撤回、提示、洗牌等扩展点；当前不冒充已逆向完成。

## 4. 动画与导演原子

- 手指路径：出现、移动、按下、抬起。
- 牌被选中：描边、抬起、缩放、发光。
- 棋盘到槽位的飞行路径。
- 槽位同面归组与其他牌横向补位。
- 三消：预闪、碎裂、粒子、消失。
- 原位集合：高亮、聚合、爆开。
- 新解锁牌：由背面/灰态切为正面可点态。
- 警告：`Focus on the Top Tiles!`、`Only 1 Slot Left!`。
- 评价词：Good / Great / Excellent / Amazing / Unbelievable。
- 目标计数、金币飞行、彩屑、胜利卡和 CTA。

所有动画原子都由语义事件驱动，并允许互相重叠；输入不应等待上一次所有粒子播完。

## 5. 渲染原子

- 背景层。
- HUD/目标层。
- 棋盘牌体层（按层级和稳定 order 排序）。
- 选中/遮挡反馈层。
- 槽位层。
- 手指层。
- VFX/评价词层。
- CTA/结束卡层。
- 音频事件轨。

推荐使用同一份 `PresentationFrame` 同时驱动浏览器预览和固定帧视频导出，避免“编辑器看起来对，导出偏一像素”。

