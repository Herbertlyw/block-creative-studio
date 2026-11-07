# Reference specification

本目录保存从用户提供的真机试玩录像提取的可执行规格。`v1` 文件是早期代表片段拆解；`v2/` 是当前主线，覆盖整段录像并建立完整语义资产谱系。

## 当前主线

- [`v2/FULL_VIDEO_AUDIT_REPORT_V1.md`](v2/FULL_VIDEO_AUDIT_REPORT_V1.md)：整段视频审计方法与结论；
- [`v2/FULL_FRAME_STATE_INDEX_V1.json`](v2/FULL_FRAME_STATE_INDEX_V1.json)：13,546 帧连续覆盖；
- [`v2/EVENT_INSTANCE_INDEX_V1.json`](v2/EVENT_INSTANCE_INDEX_V1.json)：机器事件候选与人工复核代表区间；
- [`v2/ASSET_LINEAGE_V2.json`](v2/ASSET_LINEAGE_V2.json)：149 个语义 Atom；
- [`v2/REFERENCE_PROFILE_V2.json`](v2/REFERENCE_PROFILE_V2.json)：必选性和可选性；
- [`v2/FIXED_CAMERA_RENDERER_MAPPING_V1.json`](v2/FIXED_CAMERA_RENDERER_MAPPING_V1.json)：固定机位混合影视表达；
- [`v2/GOLDEN_SCENE_INDEX_V1.json`](v2/GOLDEN_SCENE_INDEX_V1.json)：本地视觉校准场景。

## 历史 v1

- [`VIDEO_ANALYSIS_V1.md`](VIDEO_ANALYSIS_V1.md)
- [`LAYOUT_V1.json`](LAYOUT_V1.json)
- [`ATOM_CATALOG_V1.json`](ATOM_CATALOG_V1.json)
- [`TIMING_OBSERVATIONS_V1.md`](TIMING_OBSERVATIONS_V1.md)
- [`SCORING_OBSERVATIONS_V1.md`](SCORING_OBSERVATIONS_V1.md)

证据标签：

- `machine-derived` / `machine-candidate`：整片算法扫描产生，用于覆盖和检索；
- `manual-reviewed`：代表事件经过密集帧人工确认；
- `observed`：录像中直接可见；
- `inferred`：由多帧关系合理推断；
- `unresolved`：当前录像不足以得出唯一结论。
