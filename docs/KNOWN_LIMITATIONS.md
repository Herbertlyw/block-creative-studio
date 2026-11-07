# Known limitations

- Original reference MP4/frames are not in the public repo. All 39 Golden content cases remain BLOCKED. Public-fixture tool checks and native captures are not a substitute for exact-replay against the commercial video. Without a target Take hash, Golden batch correspondence is `isolated-presentation`.
- 1064×1788 → 1080×1920 letterbox is a transitional reference-transfer mapping, not a finished 9:16 production profile.
- `world-normal`, `highlight-clip` and `bloom-contribution` diagnostic ids are proxy visualizations, not named G-buffer / HDR clip / bloom buffers.
- T1 is still one `Reference2DScene` with pass conditionals. Praise is gated by the `feedback` pass (`PRAISE_PASS`) and painted after clear so it stays on top.
- Browser capture ran on Headless Chrome + SwiftShader. That proves WebCodecs/WebGL function, not high-end GPU performance or desktop interactive framerate.
- Before/after/diff against the pre-T1 proxy-upscale path was not frozen before the refactor; `frames/before` is absent on purpose (NOT_RUN).
- Bloom is still UnrealBloomPass threshold-bloom. Not selective-bloom.
- Aurora-shell has no PBR maps (parameter-only custom ID). Steel and oak-wood have independent synthetic 128×128 maps. Clear shards now read `MaterialBehaviorProfile` (splinters/chips/radial-shards/soft-tear kinematics). This is not a G-buffer material-aware fracture solve; `capabilities.materialAwareFracture` stays pending.
- CLI never reports `rendered: true`. Node material compile with maps still sets `resourcesReady: false` because it does not decode GPU textures.
- Visual status is ready-for-review, never visually-approved by this implementer. Clear-peak shockwave intensity was reduced and material diagnostics use Neutral LookDev + idle; this is not a visual pass.
- React UI drag / Inspector switching is covered only indirectly; the capture harness drives the same Scene/export path without the full App shell. Smoke adds `prepared-pbr-maps` (IndexedDB/MemoryAssetStore → `bcs-asset://` → PreparedResources → TextureLoader) and `letterbox-pick` (1920×1080 host, letterbox miss + center cell). That is still not a full Studio DOM E2E (Variant picker → export button).
- Formal `captureReferenceFrame()` requires runtime assets. `capturePreviewFrame()` is the explicit non-authoritative overlay path.
- `resolveStyleFromRenderPlan` attaches `style.shotExecution` from Plan camera/layout metadata. Cinematic viewport, pick mapping and locked zoom consume that shot. Pose/FOV still fall back to `FIXED_SHOT_PROFILE` because `camera.fixed.json` has no pose. `cameraDrivesPixels` / `layoutDrivesPixels` are true only on that resolve path. Material overlay alone still reports false. `effectDrivesPixels` is true only when the EffectPack `stylePatch.fx` matches the executed `style.fx`.
- PBR MaterialPacks no longer declare `reference-2d`. Unbound Plan material overlays switch the webpage to `fixed-camera-cinematic`; Reference 2D does not consume `MaterialRuntimeDescriptor`.
- Public fixture maps are rewritten with Vite/Pages `BASE_URL` (`/block-creative-studio/materials/maps/...` on GitHub Pages). `bcs-asset://` maps must come from `runtimeAssets.textureMaps` and are not fetchable as a custom scheme.

Historical review images, videos and machine reports are archived outside Git. Local capture commands write to `outputs/review/`. CI checks source and tests without uploading media; full browser captures remain available through `npm run capture:review`.
