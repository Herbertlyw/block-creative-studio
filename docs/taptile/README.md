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

## 对应代码

- `src/taptile/gameplay/`：纯 TypeScript 玩法状态机、槽位归组、三消、原位消除和遮挡图。
- `src/taptile/pixelGeometry.ts`：编辑坐标到 1080×1920 输出整数像素的唯一换算入口。
- `src/taptile/stackModel.ts`：堆叠编辑模型。
- `scripts/analyze-taptile-videos.mjs`：可重复生成视频索引。

重新扫描本地成片目录：

```powershell
npm run analyze:taptile-videos -- `
  --input "D:\0824-AE(AI大模型)\8.25换牌面叉乘结果去水印版（只放视频）" `
  --output "docs\taptile\generated"
```
