# BCS Asset Import Pipeline v1

## 1. 目标与边界

Block Creative Studio 不把 `.blend`、`.aep`、`.sbsar` 等创作源文件直接当作浏览器运行时资源。它们属于 **Source Artifact**：用于追溯、重新编译和交给设计师或外部 Agent 继续修改。

BCS 真正消费的是经过适配器编译后的、可校验和可复现的运行资产：

```text
创作源文件
.blend / .aep / .spp / .sbsar / .mtlx
              ↓ DCC / Material Adapter

交换与烘焙产物
GLB / PBR Texture Set / Flipbook / PNG RGBA / Transform Track
              ↓ BCS Asset Compiler

BCS 运行资产
AssetManifest / MaterialPack / EffectPack / LookPack
              ↓ Variant Compiler

ResolvedRenderPlan
              ↓
Reference 2D / Fixed-camera Cinematic Renderer
```

系统原则是：

> 上游创作格式开放，下游执行格式严格。

BCS 不需要知道资产是由人、Blender、AE、Substance、生成模型还是外部 Agent 制作；但进入渲染计划之前，必须拥有明确的语义、版本、内容 Hash、依赖、预算和 Renderer 兼容声明。

---

## 2. 三层资产模型

### 2.1 Source Artifact：创作源文件

典型文件：

```text
*.blend
*.aep
*.c4d
*.spp
*.sbsar
*.mtlx
```

用途：

- 记录来源、作者、软件版本和许可证；
- 允许外部 Agent 或设计师重新打开并修改；
- 作为 Adapter 的输入；
- 关联其编译出的 Runtime Pack。

限制：

- 浏览器不直接解析或执行；
- 不直接进入 Render Plan；
- 源工程内的插件、表达式、脚本和缓存不被默认信任。

### 2.2 Exchange Artifact：交换与烘焙文件

BCS 第一阶段重点接受：

```text
GLB
PBR Texture Set
PNG / WebP / AVIF RGBA
Sprite Sheet / Flipbook
透明视频
WAV / FLAC
Transform Track
```

这些文件足够接近运行时，但仍需要进行语义识别和校验。

### 2.3 Runtime Pack：BCS 运行契约

```text
AssetManifest
MaterialPack
EffectPack
LookPack
CameraProfile
VariantRecipe
```

它们才是 Variant Compiler 和 Renderer 的正式输入。

---

## 3. BCS Material Pack 不是行业标准

`BCS Material Pack` 是 Block Creative Studio 自己的产品契约，不是 Khronos、Adobe 或 ASWF 已经发布的通用格式。

它内部复用行业通用语义：

```text
外观层：glTF 2.0 Metallic-Roughness PBR
复杂上游交换：MaterialX / SBSAR / DCC 节点网络
BCS 领域扩展：Destruction Behavior
```

普通 PBR 标准描述“表面怎样受光”，但不会描述“消除时应该产生金属片、木屑、玻璃碎片还是软体撕裂”。因此 BCS Material Pack 由两部分组成：

```text
Material Appearance
+
Material Behavior
```

建议目录：

```text
brushed-copper.material-pack/
├── manifest.json
├── material.json
├── behavior.json
├── textures/
│   ├── basecolor.png
│   ├── normal.png
│   ├── roughness.png
│   ├── metallic.png
│   ├── ao.png
│   ├── height.png          # 可选
│   ├── emissive.png        # 可选
│   └── opacity.png         # 可选
├── geometry/
│   └── tile.glb            # 可选
└── preview/
    ├── neutral.png
    └── gameplay.png
```

### 3.1 Appearance

```text
Base Color
Normal
Roughness
Metallic
AO
Height
Clearcoat
Transmission
IOR
Thickness
Emission
Opacity
```

### 3.2 Behavior

```text
materialClass
density
brittleness
ductility
elasticity
hardness
fractureMode
largeFragmentRatio
dustAmount
sparkAmount
dropletAmount
gravityScale
drag
```

Appearance 可以来自贴图、GLB 材质或程序参数；Behavior 可以由人工填写、由外部 Agent 提议，或从已有模板继承。系统不能假装仅凭一张铜纹图片就恢复了真实材料力学。

---

## 4. 文件格式与透明通道

不是所有输入都必须是带 Alpha 的 PNG。

| 用途 | 推荐格式 | Alpha | 说明 |
|---|---|---:|---|
| 全屏背景 | JPEG / WebP / AVIF / PNG | 通常不需要 | 不透明背景无需强制 PNG |
| 牌面 Decal | PNG / WebP / AVIF / 安全 SVG | 通常需要 | 独立于牌块材质和几何 |
| UI / Praise / Combo | PNG RGBA / WebP RGBA / SVG | 通常需要 | Screen 2D |
| 粒子 Sprite | PNG RGBA / WebP RGBA | 需要 | 建议打图集 |
| AE / Blender VFX | PNG / EXR 序列、Flipbook、透明视频 | 需要 | Manifest 必须声明 Alpha 约定 |
| PBR Base Color | PNG / WebP / KTX2 | 可选 | 非透明材质不需要 Alpha |
| Normal / Roughness / Metallic / AO | PNG / KTX2 | 不需要 | 数据纹理，不建议使用有损 JPEG |
| 3D 几何与材质 | GLB | 不适用 | 单文件、自包含，优先于松散 glTF |
| 音效 | WAV / FLAC / AAC | 不适用 | 后续绑定语义事件 |

Alpha 资产必须声明：

```text
straight / unassociated
或
premultiplied
```

BCS 的默认资产约定应为 **Straight Alpha**。如果 AE 导出的是 Premultiplied，Adapter 必须在编译时转换或在 Manifest 中明确记录，避免黑边和白边。

---

## 5. Blender 导入路径

Blender 是 BCS 的主要 3D 上游资产工厂，但 `.blend` 不是浏览器运行格式。

### 5.1 只提取材质

```text
source.blend
→ Blender 后台脚本
→ 烘焙 BaseColor / Normal / Roughness / Metallic / AO
→ BCS Material Pack
```

适合：

- 标准牌块几何不变；
- 只替换金属、木材、玉石、玻璃等表面；
- 批量材质变体。

### 5.2 几何与材质一起提取

```text
source.blend
→ 应用/烘焙修改器
→ 导出 self-contained tile.glb
→ 保留独立 tile.face 槽位
→ 补充 behavior.json
```

适合：

- 特殊倒角；
- 水晶内部结构；
- 异形牌块；
- 预切碎片；
- 棋盘部件。

### 5.3 动画、刚体和缓存

Geometry Nodes、刚体、Alembic、复杂约束和任意 Cycles 节点通常不能原样进入 GLB。Adapter 应根据内容选择：

```text
应用为最终 Mesh
烘焙为 PBR 贴图
烘焙为 GLB 关键帧
转换为压缩 Transform Track
转换为 VAT
转换为 Flipbook / 序列帧
```

建议未来 CLI：

```bash
bcs dcc compile-blender source.blend \
  --profile tile-material \
  --output ./compiled/copper-tile
```

标准输出：

```text
compiled/copper-tile/
├── source-artifact.json
├── manifest.json
├── tile.glb
├── fragments.glb          # 可选
├── material.json
├── behavior.json
├── camera-profile.json    # 可选
└── preview.png
```

---

## 6. After Effects 导入路径

AE 更适合生产 Screen 2D 和 Camera-facing 特效，不作为主要 GLB 生产工具。

典型输入：

```text
source.aep
```

通过 ExtendScript / UXP 脚本和 `aerender` 编译为：

```text
vfx-pack/
├── source-artifact.json
├── manifest.json
├── atlas.png
├── atlas.json
├── timing.json
├── masks/
├── emission/
├── depth/                 # 可选
└── preview.mp4
```

适合提取：

```text
Praise / Combo 动画
拇指与数字动画
花瓣和烟雾
扫光装饰层
Hero Burst
Mask
Emission Pass
透明序列帧
```

AE 资产进入 BCS 后必须绑定语义事件，而不是成为一段不可拆解的完整视频：

```text
line-clear
cross-clear
combo
all-clear
placement
```

---

## 7. PBR Texture Set 导入

这是近期优先级最高的真实材质入口。

推荐文件命名：

```text
copper_basecolor.png
copper_normal.png
copper_roughness.png
copper_metallic.png
copper_ao.png
copper_height.png
copper_emissive.png
copper_opacity.png
```

导入器应完成：

1. 根据文件名和显式映射识别通道；
2. 检查尺寸、位深、颜色空间和纹理一致性；
3. Base Color / Emissive 按 sRGB 采样；
4. Normal / Roughness / Metallic / AO / Height 按线性数据采样；
5. 检查 Normal Y 方向约定；
6. 生成 Texture Set Manifest；
7. 绑定标准牌块几何；
8. 保留独立 `tile.face` Decal；
9. 生成中性 LookDev 预览；
10. 由人工或外部 Agent 补充 Behavior。

---

## 8. GLB 导入

GLB 是 glTF 2.0 的单文件二进制形式，是近期优先支持的 3D 交换格式。

可包含：

```text
Mesh
UV
Vertex Normal / Tangent
PBR Material
Textures
Scene Hierarchy
Camera
Light
Animation
```

BCS 不应把整个 GLB 场景无条件加入运行时。导入器必须先选择语义角色：

```text
tile-geometry
board-part
large-fragments
hero-prop
baked-animation
```

然后检查：

```text
GLB 2.0 Header
文件是否自包含
Mesh 数量
Triangle 数量
UV / Normal / Tangent
材质和纹理数量
动画 Clip
坐标轴与单位
包围盒
牌面 Decal Anchor
固定机位屏幕占用
```

如果 GLB 内已经带完整牌面，系统仍应允许覆盖为独立 `tile.face`，除非资产明确声明为不可拆 Hero Asset。

---

## 9. 统一导入与验证流程

一个新资产进入正式批量生产前，应经过：

```text
1. 文件分类
2. 安全与完整性检查
3. SHA-256 内容寻址
4. 语义角色选择
5. 格式编译 / 烘焙
6. Asset Manifest
7. 依赖闭包检查
8. 中性预览
9. 玩法场景预览
10. Quality Gate
11. 人工 / Agent 审批
12. 冻结版本
```

### 9.1 结构门禁

```text
文件缺失
Hash 不一致
版本冲突
不受支持的依赖
纹理通道缺失
GLB 不完整
预算超限
Renderer 不兼容
```

### 9.2 光学门禁

```text
高光过曝
主体颜色丢失
粗糙度不合理
金属/非金属难以区分
透明排序穿帮
Normal 方向错误
```

### 9.3 固定机位门禁

```text
棋盘/牌块不越界
候选区缩小时仍可识别
拖拽时不改变材质身份
牌面与几何对齐
最大镜头 Punch 时不裁切
```

### 9.4 动态门禁

```text
帧间闪烁
透明排序跳变
碎片材质与本体不一致
清除 Emission 过强
下一次输入被旧 VFX 遮挡
```

---

## 10. 当前支持状态

### 已完成

- Browser Asset Store 的 SHA-256 内容寻址；
- 图片、纹理、音频、透明片段和自包含 GLB 的本地存储与版本化；
- `background.base` 运行时替换；
- `tile.face` 运行时替换；
- Asset Manifest、Look Pack、Variant Recipe 和依赖闭包；
- 缺失 Blob 时阻止正式导出。

### 尚未完成

- PBR Texture Set 自动分组和材质编译；
- Material Pack LookDev 工作台；
- GLB Loader 与语义角色校验；
- 碎片 GLB / Transform Track 播放；
- Flipbook / Sprite Sheet 播放；
- 音频事件绑定和混音；
- Blender / AE 自动编译 Adapter；
- 大型 ZIP 工程包和外部 Artifact Store。

---

## 11. 实施优先级

```text
P0：PBR Texture Set → 标准牌块 Material Pack
P1：中性 LookDev 与反光/曝光验证
P2：GLB 牌块与大碎片
P3：AE / Blender Flipbook
P4：Transform Track / VAT
P5：音频 Event Pack
P6：Blender / AE CLI Adapter
```

近期最小闭环是：

```text
导入 PBR Texture Set
→ 绑定标准牌块几何
→ 保留独立牌面
→ 中性 LookDev 验证
→ 单行清除测试
→ 冻结 Material Pack
→ 批量 Variant
```
