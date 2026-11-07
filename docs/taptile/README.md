# TapTile 逆向规格与实现入口

本目录把 2026-08-25 无水印成片中的可观察行为，转换成可审计、可实现、可继续校准的 TapTile 规格。它描述的是录像中能验证的交互与画面规律，不声称取得或复刻任何第三方内部代码。

## 建议阅读顺序

1. [`TPT_VIDEO_AUDIT.md`](TPT_VIDEO_AUDIT.md)：143 条视频的范围、分组和证据边界。
2. [`TPT_GAMEPLAY_SPEC.md`](TPT_GAMEPLAY_SPEC.md)：三种已观察玩法及主流 7 槽三消状态机。
3. [`TPT_EVIDENCE_TIMELINE.md`](TPT_EVIDENCE_TIMELINE.md)：可回到成片复核的关键时间点。
4. [`TPT_ATOM_CATALOG.md`](TPT_ATOM_CATALOG.md)：前端导演工具可拆分的逻辑、画面、交互和演出原子。
5. [`TPT_PIXEL_ALIGNMENT.md`](TPT_PIXEL_ALIGNMENT.md)：1080×1920 输出坐标、整数像素和堆叠遮挡统一规范。
6. [`source-mechanics.json`](source-mechanics.json)：供 Agent/脚本直接读取的源项目玩法分类。
7. [`generated/video-index.json`](generated/video-index.json) / [`generated/video-index.csv`](generated/video-index.csv)：完整视频索引。
8. [`TPT_TRAY_MATCH3_EXECUTION_HANDOFF.md`](TPT_TRAY_MATCH3_EXECUTION_HANDOFF.md)：7 槽三消导演台的执行约束、阶段门禁与交付标准。
9. [`TPT_IMPLEMENTATION_STATUS.md`](TPT_IMPLEMENTATION_STATUS.md)：逐阶段测试、浏览器验证和遗留台账。

## 对应代码

- `src/taptile/project/`：Project Schema V2、V1 迁移、稳定哈希和编辑器适配层。
- `src/taptile/gameplay/compiler/`：旋转牌块遮挡图、覆盖修正、关卡校验和稳定 `levelHash`。
- `src/taptile/gameplay/`：正式 `taptile-tray-match3-v1` 7 槽三消状态机；历史多模式研究实现隔离在 `experimental/`。
- `src/taptile/gameplay/take/`：语义 Take 录制、确定性重放、逐动作校验和 Seek。
- `src/taptile/gameplay/solver/`：确定性 Beam Search、五类素材剧情 Profile 和正式引擎验证后的 Agent Take。
- `src/taptile/visual/`：Asset Registry、三类 FaceAssembly、严格 ThemeResolver、StageAssembly 和 SkinPack 兼容检查。
- `src/taptile/director/`：语义事件轨、四套 Profile、动作级时间点、VFX overlap、纯函数 PresentationFrame 和可寻址时间线。
- `src/taptile/render/`：1080×1920 固定 zBand CanvasRenderer、AssetCache、预览/导出共用 RenderJob 与关键帧回归。
- `src/taptile/production/`：语义 AudioPack 混音、Cut/TimeWarp、Outro、成片 manifest、批量矩阵/队列和可校验 `.taptile-project.zip`。
- `src/taptile/play/`：试玩台、7 槽 UI、可点击提示和回放交互。
- `src/taptile/pixelGeometry.ts`：编辑坐标到 1080×1920 输出整数像素的唯一换算入口。
- `src/taptile/stackModel.ts`：堆叠编辑模型。
- `scripts/analyze-taptile-videos.mjs`：可重复生成视频索引。

重新扫描本地成片目录：

```powershell
npm run analyze:taptile-videos -- `
  --input "D:\0824-AE(AI大模型)\8.25换牌面叉乘结果去水印版（只放视频）" `
  --output "docs\taptile\generated"
```
