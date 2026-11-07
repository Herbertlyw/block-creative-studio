# 架构

## 产品目标

浏览器内部完成：牌面编辑、真人或机器试玩、语义 Replay、导演节奏、Reference 2D 校准、固定机位混合影视渲染和固定帧视频导出。Blender/AE 不进入当前运行链，只在后续作为资产工厂接入。

## 三层真值

```text
Gameplay / Replay / Event truth
              │
              ├── Reference2D Renderer
              │   用于布局、时序、资产谱系与 Golden Scene 校准
              │
              └── FixedCameraCinematic Renderer（下一阶段）
                  ├── Screen 2D
                  ├── Procedural Shader / Render Recipe
                  ├── Camera-facing Sprite
                  ├── Shallow 3D
                  ├── Full 3D tile / large fragments
                  └── Baked-view / baked-transform assets
```

Reference 2D 不会被 Cinematic 后端替换，它长期承担标准答案、调试视图和回归基线。

## 单向依赖

```text
Game Core
  → PlacementAction / Take
  → Presentation Compiler
  → PresentationFrame / Event tracks
  → Renderer Backend
  → Canvas / VideoFrame
  → WebCodecs / MP4
```

玩法状态不依赖 React、Three.js、Canvas 或视频编码器。Renderer 只能消费真值层，不能反向改变合法落子、计分或 Replay。

## 语义资产而不是文件清单

`ASSET_LINEAGE_V2` 将一个画面原子建模为：

```text
semantic role
+ requirement policy
+ trigger
+ dependencies
+ evidence status
+ renderer representations
+ view dependency
+ replaceability
```

因此同一个 `clear.tile-destruction` 可以在 Reference 2D 中表现为渐隐/缩小，在固定机位后端中表现为真实大碎片 + Sprite 小碎屑，而不改变清除事件本身。

## 固定机位契约

摄像机是一级 `CameraProfile`：

- Transform 锁定；
- 不允许 Orbit；
- 不允许镜头动画；
- 允许受限的最终屏幕平移、缩放、微旋转、震动和曝光脉冲；
- 物理投影在 Golden Scene 校准前保持 `calibration-pending`，不从单条录屏臆测焦距。

`src/assets/semanticAssetTypes.ts` 与 `src/assets/fixedCameraProfile.ts` 提供类型契约。

## 全视频审计

`tools/reference_audit/analyze_video.py` 解码每一个源帧，输出无时间缺口的状态索引和机器候选事件。人工复核事件与机器候选明确分级。公共仓库只提交帧号、状态、资产谱系和规则证据，不提交参考游戏的视频或截图。

## 人类与机器统一入口

人类拖拽和机器玩家最终都输出 `PlacementAction`。动作真相是 `pieceId + anchor`；指针轨迹只是导演信息。Agent 后续通过合法动作 API 下棋，无需截图猜测棋盘。

## 实时与成片分离

实时试玩只记录 Replay。成片阶段编译固定帧 `PresentationFrame`，逐帧重演后送入浏览器视频编码链。因此导出可以慢于实时，但动作帧位不随机器负载变化。

## DCC 扩展缝

DCC 接入必须在 Reference 2D 资产槽位和固定机位契约稳定后进行。未来 Blender/AE 输出将编译为 Runtime Asset，而不是让浏览器直接解释任意 `.blend` 或 `.aep`。DCC 资产必须声明 Camera Profile、空间表达、可重新打光/换材质能力和性能预算。
