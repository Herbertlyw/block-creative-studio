# Reference Audit v2

本目录是对整段 225.833 秒、13,546 帧真机视频进行全覆盖审计后的机器可读真值层。

## 文件

- `FULL_FRAME_STATE_INDEX_V1.json`：第 0～13,545 帧连续覆盖；保存主状态与并行活动系统。
- `EVENT_INSTANCE_INDEX_V1.json`：分数、拖拽、清除、候选刷新、反馈和终局的机器候选窗口，以及人工复核代表事件。
- `ASSET_LINEAGE_V2.json`：149 个语义 Atom；区分视觉资源、程序配方、运动、粒子、规则、几何和音频。
- `REFERENCE_PROFILE_V2.json`：参考档必选、可选、capture-only 原子与最小反馈组。
- `FIXED_CAMERA_RENDERER_MAPPING_V1.json`：从 Reference 2D 到固定机位混合影视后端的表达映射。
- `GOLDEN_SCENE_INDEX_V1.json`：用于本地提取和视觉 Diff 的代表性事件区间。
- `CALIBRATION_WORKFLOW_V1.md`：在线 Golden Diff、像素坐标与时序校准流程。
- `FULL_VIDEO_AUDIT_REPORT_V1.md`：分析方法、整片新增发现和工程结论。
- `UNRESOLVED_EVIDENCE_V2.md`：仍不能从单条录像证明的规则与时序。

## 证据边界

- `machine-derived` / `machine-candidate`：全帧特征算法生成，用于覆盖、检索和人工复核。
- `manual-reviewed`：已通过密集帧或关键帧人工确认。
- `observed`：画面中直接可见。
- `inferred`：为完整产品行为所需，或由多帧关系合理推断。
- `unresolved`：当前录像不足以得出唯一结论。

源视频与截图不提交到公共仓库。`tools/reference_audit/` 提供本地重建索引和 Golden Frame 的工具。
