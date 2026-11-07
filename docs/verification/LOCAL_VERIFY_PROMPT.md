# 本地验证 Prompt（Plan 机位 / 每格 UV / 材质破碎）

把下面整段复制给本地 Cursor / 你自己，按清单验。**不要把视觉观感标成通过，也不要把 T0–T5 标成完成。**

---

## 你要验证什么

仓库：`dongyuan21/block-creative-studio`  
对照分支：实现 Plan camera/layout → 像素、每格 UV 克隆、材质 behavior 破碎的那次提交（不要用 Git 里的旧 `outputs/review/frames/` / `videos/`，那些是 STALE）。

本环境（Linux + 单元测试 + 可选 Headless Chrome/SwiftShader）**已经能证明**：

1. `resolveStyleFromRenderPlan` 会把 `camera.fixed` / `layout.vertical` 写成 `style.shotExecution`。
2. 只有这条路径会把 `cameraDrivesPixels` / `layoutDrivesPixels` 设为 true；只做 `overlayPlanMaterialOnStyle` 仍然是 false。
3. Plan 的 `designResolution` / `boardScreenRect` / `maximumScreenZoom` / layout 宽高比进入 `viewportPolicyForRenderer` 和 `lockedCameraDistance`。
4. `camera.fixed.json` **没有 pose**。FOV / lookAt / cameraOffset 仍回退 `FIXED_SHOT_PROFILE`。代码里 `poseSource` / `fovSource` 必须是 `fallback-fixed-shot`。
5. 相邻格子的 `cellUvJitter` 不同；`Texture.clone()` 共享 `image`，不共享 `offset`。
6. wood=`splinters`、metal=`chips`、glass=`radial-shards`、jelly=`soft-tear` 的碎片缩放/重力/阻力公式不同。这不是 G-buffer 材质感知破坏。

你必须在本机看、本环境不能替你签字的：

- 木纹是否真的每格不一样（不是同一张贴图整齐重复）。
- 消除碎片是否能看出钢/木/玻璃不同（ splint / 碎屑 / 薄片），而不是“好像换了个颜色”。
- Plan 机位是否让棋盘落在 `boardScreenRect ≈ (78,332,924,924)` 附近（相对旧 draft `(80,309,912,912)` 的差异很小，要盯着看）。
- 完整 App 壳：Variant 选择器 → 三维预览 → 导出按钮 → MP4。
- IndexedDB 导入五张 PBR 图 → 预览 → 导出（不只是 public fixture）。
- GitHub Pages 线上 `/block-creative-studio/` 路径。
- 真机 GPU 帧率（SwiftShader 不算）。
- 39 条商业 Golden（没有源视频，保持 BLOCKED）。
- 任何“视觉批准”。

---

## 环境准备

```bash
git fetch origin
git checkout <本 PR 分支>
npm ci
npm test
npm run typecheck
npm run check
```

单元测试失败就先不要做视觉验收。预期 `tests/planExecution.test.ts` 与 `tests/reviewBlockers.test.ts` 里 Plan 证据断言为绿。

可选（有 Chrome 时）：

```bash
npm run test:browser-e2e
```

看 `outputs/review/run/` 里新跑出来的报告，不要看 Git 里的旧 PNG/MP4。

本地网页：

```bash
npm run dev
```

浏览器打开终端里的本地地址（默认 `http://127.0.0.1:4173`）。

---

## 验证步骤

### A. Plan 证据字段（5 分钟，可对照 Network / 控制台）

1. 切到 **固定机位 3D**，选不锈钢或橡木 Variant（走 `resolveStyleFromRenderPlan` 的那条，不是只叠加 runtime）。
2. 打开导出/Capture 报告或浏览器控制台里打印的 plan evidence。
3. 确认：
   - `validatedCameraId` = `camera.fixed`
   - `cameraDrivesPixels` = **true**
   - `validatedLayoutId` = `layout.vertical`
   - `layoutDrivesPixels` = **true**
   - `renderedFxPreset` 与 EffectPack `stylePatch.fx` 一致时，`effectDrivesPixels` 才是 true
4. 对照：如果只是把 MaterialRuntime 叠到默认 2D 工程上、没有 resolve Plan shot，`cameraDrivesPixels` 必须仍是 false。不要看到 true 就以为 overlay 路径也接上了。

### B. Camera / Layout 是否改画面（10 分钟）

当前 `camera.fixed` 与 `layout.vertical` 都是 1080×1920，构图宽高比和旧 `FIXED_SHOT_PROFILE.compositionAspect` **相同**。空闲帧的机位差异主要来自 `maximumScreenZoom` 1.025 vs 1.03，以及记录下来的 `boardScreenRect`。Pose/FOV **没有**从 Plan 来。

请这样看，不要期待“整镜换了”：

1. 固定机位 3D，窗口先 1080×1920，再拉成 1920×1080 横屏。
2. 横屏时左右应有 letterbox；点 letterbox **不能**点到格子；点构图中心应落到棋盘（常见是 4,4 附近）。
3. 做一次消行，看 punch 推近是否被更紧的 1.025 zoom 卡住（和旧 1.03 比很细）。
4. **不要**因为空闲帧和以前几乎一样，就说 camera/layout 没接线。先用 A 的字段，再用“横屏 letterbox + 中心拾取”确认消费的是 shot，而不是全局常量各写各的。

若你改一份本地 camera（例如 `designResolution: 1000×2000`）再编译 Plan，正方形画布上的 letterbox 应变成长条，而不是继续 1080/1920。单元测试已经覆盖这个；本机改 JSON 是为了用眼睛确认 Scene 也吃了同一份 shot。

### C. 木纹每格 UV（5 分钟，必须看图）

1. 选 **Oak wood / 橡木**，棋盘上多放几块同色格。
2. 盯着木纹年轮/导管方向：相邻同色格 **不该**像复盖了同一张贴纸。
3. 拖架上的积木、拖拽中的积木也应有各自偏移，不要和棋盘某格锁死同一 UV。
4. 若所有同色格纹理对齐得像砖块贴图重复，记为 **FAIL（UV 仍在共享 Texture 上）**。
5. 这不是视觉批准，只回答：每格是否 visibly 错开。

### D. 材质破碎是否分档（5 分钟，必须看消除）

同一消除动作，分别看：

| 材质 | 预期碎片倾向（公式层已测，观感你签字） |
|---|---|
| 橡木 wood / splinters | 细长条，纵向多于横向 |
| 不锈钢 metal / chips | 较碎、较接近块状 |
| 玻璃 glass / radial-shards | 更薄、更长的放射碎片 |
| 树脂 jelly / soft-tear | 更扁、下落更慢、更“黏” |

对照点：

- 不能再是“只有木头拉长、钢和玻璃一个四面体”。
- 粒子多少可随 `dustAmount` 变，火花略亮可随 `sparkAmount`。
- **不要**写成“材质感知破坏已完成”。没有 G-buffer、没有真断裂网格。

### E. 2D 不得假装消费 PBR

1. 切回 **真机参考 2D**。
2. 选带 PBR maps 的 Look 时，2D 仍应是参考画布，不能出现 Three.js 木纹/钢刷。
3. 网页若因 Plan 材质不兼容而切到固定机位 3D，这是预期；2D 工程本身不应静默画 PBR。

### F. Pages 路径与 IndexedDB 链（本机有则做）

```bash
PAGES_BASE_PATH=/block-creative-studio/ npm run build
# 打包 JS 里应出现字面量 /block-creative-studio/
```

完整链（本环境未做 App 壳 E2E）：

1. 上传五张图到 Browser Asset Store（baseColor / normal / roughness / metallic / ao）。
2. 编成 MaterialPack，Variant 预览等到材质 status = ready。
3. 点正式导出，确认门禁在 loading/stale/error 时挡住。
4. 得到无声 MP4。缺任何一步就写 BLOCKED，不要用 public fixture 冒充。

### G. 明确不要做的结论

- 不要标 T0–T5 完成。
- 不要标 visually-approved。
- 不要把 `rendered: true` 写进 CLI。
- 不要把 39 条 Golden 标 PASS。
- 不要把 UnrealBloomPass 说成 selective bloom。

---

## 回写格式（给你自己或下一位 Agent）

```text
环境：<OS / 浏览器 / GPU>
HEAD：<sha>
npm test / typecheck / check：PASS | FAIL
A 证据字段：PASS | FAIL | 截图/JSON
B 构图/letterbox/pick：PASS | FAIL | 没看出来差异
C 木纹每格：PASS | FAIL | 说不清
D 碎片分材质：PASS | FAIL | 说不清
E 2D 不消费 PBR：PASS | FAIL
F Pages / IndexedDB 导出：PASS | FAIL | SKIP
视觉批准：PENDING（实现者未批）
T0–T5：未完成
```
