# TapTile 下一阶段质量 Gate

本文件承接 `TAPTILE_CONTINUOUS_OPTIMIZATION_V1.md`。原则是每条路线先定义可自动验收的失败条件，再决定是否扩大实现；不以“看起来更高级”替代规则、时间线和成片一致性。

## 优先级结论

1. 先做求解 Worker 与流式视频，因为它们直接决定大关卡和长成片是否稳定；
2. 再做事件级参数化 3D VFX，让 Blender 资产可以复用和调参；
3. 最后做多通道合成与完整 3D 牌块，避免过早把整个编辑器绑死在一套重型渲染器上。

## Gate E1 · Worker 化最大消除

目标：搜索完全离开 UI 主线程，但同步求解器仍是唯一确定性内核。

建议结构：

- 主线程冻结并序列化 `CompiledTapTileLevel + SolveOptions`；
- Worker 驱动现有 generator，每 128–256 个扩展状态回传一次 compact progress；
- 只在最佳路径改变时传动作 ID，普通进度不复制完整状态；
- Abort 先发消息，100ms 内未响应再终止 Worker；
- Worker 不可用时回退现有 cooperative anytime 路径。

验收门槛：

- 20 个 seed 的动作序列、终止原因、清除数与同步内核逐项相同；
- 搜索期间 UI 输入延迟 p95 < 50ms；
- 点击取消到收到最终 best-so-far < 100ms；
- 48、96、144 牌三档基准均输出理论上限、峰值槽位和扩展状态；
- Worker 崩溃不得破坏工程，只返回可解释错误并保留最后最佳路径。

## Gate E2 · 长视频流式写出

现状使用 `BufferTarget`，完整 MP4 在结束前常驻内存。依赖中已有 `StreamTarget`，可增加两条输出路线：

- 默认 Blob 路线：短视频和 GitHub Pages 继续零权限下载；
- 文件流路线：支持 File System Access API 时直接写用户选定文件，避免完整 MP4 常驻 JS 堆。

实现时保留相同 FrameRenderJob、H.264/AAC 参数和编码后语义帧复验。流式路线另写增量 SHA-256，最终 manifest 不得因输出方式不同而丢字段。

验收门槛：

- 15 秒、60 秒、180 秒 1080p30 压力样例均能取消并重新开始；
- 60 秒成片峰值 JS heap < 512 MiB，且不随已编码帧数线性增长；
- Blob 与流式输出解码后的抽样帧 PSNR 差异 < 0.1 dB；
- 文件中断时关闭 writer，不生成伪装成成功的 manifest；
- 页面隐藏、GPU context lost、磁盘写失败都有明确可恢复状态。

## Gate E3 · 参数化 3D VFX 配方

当前 `scene.vfx.glb` 已能交付，但把 16 次事件全部烘焙进同一资产。下一步将其拆成：

```text
vfx-recipe.glb          # 局部坐标中的碎片、核心与冲击波模板
vfx-events.json         # eventId、frame、screen/world anchor、palette、intensity、seed
vfx-package.json        # 版本、预算、文件哈希、Blender/编译器版本
```

Studio 只暴露受限参数：碎片数、爆散、重力、寿命、核心亮度、冲击波和调色板。Blender 编译器把这些参数绑定到稳定语义对象，不允许执行任意脚本。

验收门槛：

- 一个 recipe 可复用于任意数量 match，事件文件大小随事件数线性增长但 GLB 不增长；
- 同 seed、参数和 eventId 的像素/变换轨迹可复现；
- 编辑器、导演预览、MP4 和 Blender 代表帧使用相同事件中心与起止帧；
- 单事件预算默认 ≤ 128 视觉碎片、≤ 20k 三角形、≤ 32 动画对象；
- 缺少、重复或跨角色复用稳定 ID 必须在 CLI 和浏览器解析 Three.js 前失败。

## Gate E4 · Blender 多通道合成

GLB 适合几何碎裂，但烟雾、折射、运动模糊和体积光不应强行塞进网页实时材质。为高级效果增加事件局部的离线通道：

- straight RGBA beauty；
- emission/glow；
- linear depth；
- 可选 motion vector；
- 每帧 checksum 与相机/色彩空间元数据。

浏览器先支持短事件 PNG/WebP 序列，之后再评估带 alpha 的视频容器。最终 H.264 仍由 BCS 合成，避免 UI、文字和音频在 Blender 中产生第二套实现。

验收门槛：

- alpha 边缘无黑边/白边，合成前后抽样误差有量化阈值；
- depth 遮挡能让手势、牌块和烟雾按同一空间关系交错；
- 未支持通道可降级到 beauty，不得整段黑屏；
- 事件缓存以 recipe hash + 参数 hash + Blender 版本寻址；
- 修改一个事件只重渲该事件，不重渲整条 Take。

## Gate E5 · 真正 3D 牌块

完整 3D 牌块不是简单替换 Canvas。必须先把现有规则与导演层保持为纯数据，再提供新的渲染实现：

- 牌面几何、圆角、厚度、材质和层级遮挡来自同一项目合同；
- 2D 仍作为低端设备与精确 UI 合成 fallback；
- 3D 牌块、Blender VFX 和 2D HUD 在固定相机下输出同一逻辑画布；
- 导出只选择渲染后端，不复制点击、槽位、匹配或 Take 逻辑。

验收门槛：

- 48 牌场景在目标设备预览 ≥ 30fps；
- 1080p30 导出无 context lost，三次连续导出资源计数回到基线；
- 牌块接触间距的 0、+1、-1px 语义在固定相机投影后仍成立；
- 槽位、遮挡可点击性、三消先于判满等规则测试完全复用；
- 2D/3D 同帧的牌中心误差 ≤ 0.5px，事件时间误差为 0 帧。

## 不应现在做的事

- 不把任意 `.blend` 上传后直接执行；
- 不用整场 Cycles 终片替代浏览器 UI/音频合成；
- 不为了 WebGPU 标签重写已通过验证的 WebGL/Canvas 路径；
- 不在没有内存与像素证据前把 4K/60fps 暴露为正式选项；
- 不让 AI 自动改动规则数据后跳过编译、重放和可消除性检查。

## 建议里程碑

- E1 + E2：稳定性里程碑，可支持更大关卡和 1–3 分钟广告成片；
- E3：创作效率里程碑，设计师可在 Studio 调 3D 消除而无需每次进 Blender；
- E4：视觉质量里程碑，承载烟雾、玻璃和体积光；
- E5：产品形态里程碑，Studio 从 2D 参考渲染升级为双后端 3D 创意工具。
