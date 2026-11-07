# 当前实现状态

## 版本定位

`0.2.0-alpha.2` 是 **全视频真值层 + Reference 2D 骨架**，不是一比一复刻完成版，也不是固定机位影视后端完成版。

## 本轮已落地

- 对参考录像全部 13,546 个解码帧完成机器特征扫描；
- Frame State Index 从第 0 帧连续覆盖到第 13,545 帧，零缺口、零重叠；
- Event Index 保存 509 个机器候选/复核窗口，其中 9 个代表区间经过密集帧人工复核；
- Asset Lineage v2 包含 149 个语义 Atom，并区分视觉资源、程序配方、运动、粒子、规则、几何与音频；
- 每个 Atom 都具备必要性、触发、依赖、可为空、可替换、证据状态和三类渲染表达；
- Reference Profile 对全部 Atom 完成必选/可选/capture-only 分类；
- Fixed-camera Renderer Mapping 对全部 Atom 完成唯一主表达映射；
- Golden Scene Index 覆盖待机、拾取、发牌、预消除、清除、六级 Praise、高分横幅和终局；
- 新增整片审计工具、Golden Frame 提取工具和 CI 审计一致性检查；
- 颜色模型从六色扩展为整片确认的七色，新增 `rose`；
- 当前分数和历史最高分的显示关系修正为 `max(previousBest, currentScore)` 的近似；
- 固定机位 Camera Profile 和语义资产 Slot 类型已进入源码。

## 当前运行时已经具备

- 8×8 玩法核心、三个候选块、合法落子、同步清行列、候选刷新和失败判断；
- 真人/机器共用 Action 与 Take；
- Raw Take → Directed Take → 固定帧 PresentationFrame；
- Reference 2D 预览与 Chrome 固定帧视频导出；
- 逐格候选颜色、拾取放大/上移、合法 Ghost、预消除、基础清除和反馈；
- 实验性 Three.js 后端继续保留，但当前不扩展。

## 已确认但尚未完全进入运行时

- 扶桑花、单叶、龟背竹、多瓣花和玫瑰轮廓的独立牌面槽位；
- `Amazing!`、`Incredible!` 的正式字形资产和受证据约束的触发；
- `NEW HIGH SCORE` 横幅、皇冠、数值和只在首次越线时出现的事件；
- 候选刷新五段式演出；
- 横/纵扫光的 Body、Head、Trail、花朵印记和交叉爆点；
- VFX 与下一次输入的完整异步重叠；
- Game Over 卡片的全部子资产和交互状态；
- 外部背景、材质包、牌面和 VFX 的项目资产导入。

## 未解决，不应声称一致

- 精确清除奖励公式、浮动分数和格内 `5/9` 的选择规则；
- 六级 Praise 的严格排序、阈值与抢占关系；
- Combo 延续、中断及终局 `Combo 14` 的准确语义；
- 候选块形状/颜色/纹样生成概率、保底和难度调节；
- 非法释放的参考反馈；
- 音频事件和音画对应；
- 参考录像的源制作方式、物理焦距和三维深度。

## 下一工程门禁

1. 把 Reference 2D 单体场景拆成数据驱动资产槽位；
2. 本地提取 Golden Scene 并建立截图 Diff；
3. 完成 Background / Board / Tile / Face / Tray / Preview / Clear / Feedback / Endgame 资产替换闭环；
4. Reference 2D 的代表事件通过视觉和时序 Review；
5. 之后才新建 `fixed-camera-cinematic`，从完整单行清除切片开始迁移。

## 工程验证

```bash
npm install
npm run check
npm test
npm run typecheck
npm run build
```

浏览器验收仍需单独完成真人拖拽、Golden Scene 并排、1080×1920 MP4 和导出性能测试。
