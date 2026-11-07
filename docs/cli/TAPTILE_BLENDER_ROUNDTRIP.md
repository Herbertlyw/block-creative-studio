# TapTile Blender 往返工作流

这条链路用于把 Studio 中已经冻结的关卡、牌面贴图、固定机位和三消事件交给 Blender 制作，再把受限的 3D 消除层带回同一份导演预览和 MP4 成片。

## 1. 从 Studio 导出

在“导出”页选择需要的 Take、导演、音频和 Cut，点击“导出 Blender 自包含包”。得到的 `.bcs-blender.zip` 包含场景合同、实际牌面、动画 Track、match 事件、清单和逐文件 SHA-256。

## 2. 本地编译

先构建 CLI，然后把 ZIP 直接交给 Blender 编译器，无需手动解压：

```powershell
npm run build:cli
node dist-cli/cli/bcs.js dcc compile-blender `
  TapTile-scene.bcs-blender.zip `
  --output artifacts/blender/taptile-scene `
  --engine eevee `
  --max-triangles 250000
```

CLI 会先复验 ZIP 的文件集合、CRC 和 SHA-256，再在临时目录解包。Blender 只读取受合同约束的数据；原始工程和 ZIP 都不会被修改。

## 3. 选择正确的产物

- `scene.normalized.blend`：继续在 Blender 中审看或精修的规范化工程。
- `scene.glb`：包含牌块、贴图和 3D 特效的完整场景，适合结构审看。
- `scene.vfx.glb`：只包含固定相机、碎片和核心闪光，是回到 Studio 的推荐文件。
- `compile-report.json`：记录 Blender 版本、帧率、分辨率、对象/三角形数量、全部输出哈希和质量结论。
- `representative-frames/`：首帧、消除峰值和尾帧等人工审看证据。

不要把完整 `scene.glb` 当作网页运行时的默认资源。专用 VFX 文件不重复牌面，也不携带贴图，载入和持久化成本更低。

## 4. 独立检查

```powershell
node dist-cli/cli/bcs.js dcc inspect-glb `
  artifacts/blender/taptile-scene/scene.vfx.glb `
  --max-triangles 250000

node dist-cli/cli/bcs.js dcc verify-blender `
  artifacts/blender/taptile-scene/compile-report.json `
  --max-triangles 250000
```

合格的 VFX 层应满足：固定相机、精确 30fps 时间线、`match-core` 与 `match-fragment` 角色、稳定 `bcs_id`、零牌面角色、零纹理、预算内三角形数。

## 5. 回到 Studio 并导出

在“Blender 3D 特效叠加”中选择 `scene.vfx.glb`，勾选“叠加到预览与成片”。文件通过验证后会按 SHA-256 存入浏览器，并在该工程刷新时恢复。

如果之后切换了 Take，Studio 会重新比较总帧、fps 和完整 `actionId:match` 集合。旧 VFX 不匹配时只会自动停用 3D 层并给出差异，2D 导演预览和导出仍可继续；切回原 Take 或导入重新编译的 VFX 后即可再次启用。

最终 MP4 仍由同一份浏览器 RenderJob 生成，因此 2D 牌面、槽位、手势、文案、声音和 3D 特效使用同一时间轴。每次导出还会生成 `.manifest.json`，其中冻结 VFX 文件名、SHA-256、字节数、碎片数、是否为专用层和完整帧范围。

## 6. 当前验收基线

- 目标视频：1080×1920，30fps，H.264 + AAC。
- `cinematic`：1.5× 物理像素渲染后下采样编码。
- 必查帧：开头、中段、结尾、首个和最后一个实际三消反馈帧。
- 必查一致性：容器可回读、帧数/时长/帧率一致、VFX SHA 与清单一致、编码后样本达到像素误差阈值。
- 当前专用 VFX 基线：33 节点、32 个动画特效对象、1,536 个视觉碎片、22,220 三角形、0 贴图、2.83 MiB。

后续若需要更强的玻璃、烟雾或体积光，不应直接突破 GLB 预算；优先新增透明序列或多通道合成输出，并继续沿用同一 match 事件、固定相机和帧精确合同。
