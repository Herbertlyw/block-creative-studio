# Changelog

## Unreleased

### Added

- Plan camera/layout metadata compile into `StyleSpec.shotExecution` and drive cinematic letterbox, pick mapping and punch zoom. Pose/FOV remain fallback.
- Per-cell PBR UV jitter via `Texture.clone()` (shared image, independent offset/rotation).
- Clear-shard kinematics read `MaterialBehaviorProfile` instead of a wood-only scale hack. Not a G-buffer fracture claim.
- Local verification prompt: `docs/verification/LOCAL_VERIFY_PROMPT.md`.

### Current boundary

- Implementer does not visually approve wood grain, shard identity, or production framing.
- T0–T5 remain incomplete. 39 commercial Golden cases remain BLOCKED.

## 0.3.0-alpha.4 — 2026-09-03

### Added

- Headless contracts for FrameRenderRequest, PreparedResources, FrameRenderResult, CalibrationCase and MaterialRuntimeDescriptor.
- Native 1064×1788 Reference 2D capture, pass isolation, and resource-decode failure on formal warmup/capture.
- Golden batch CLI/report covering all 13 scenes / 39 anchors; missing source video is BLOCKED.
- `fixed-camera-cinematic` renderer option consuming a locked 9:16 Shot Profile and LookDev diagnostic views.
- MaterialPack → MaterialRuntime compile path and three public packs (stainless-steel, oak-wood, aurora-shell).
- Public gameplay fixtures for idle, preview, single/cross clear, consecutive placements and endgame.
- Synthetic independent PBR maps for stainless-steel and oak-wood; aurora-shell remains a parameter-only custom ID.
- Headless Chrome review capture (`npm run capture:review`) writing native frames and 1080×1920 silent MP4s.
- Review evidence files under `outputs/review/` and `docs/reports/`.

### Changed

- Reference 2D video export letterboxes design pixels into 1080×1920 instead of stretching.

### Current boundary

- Original reference video Golden content remains BLOCKED.
- Bloom remains threshold-bloom.
- Material-aware fracture stays pending.
- Capture GPU is SwiftShader; not a shipping performance result.
- Visual status is ready-for-review, not visually-approved.


## 0.3.0-alpha.3 — 2026-09-03

### Added

- Detailed Blender, After Effects, PBR Texture Set, GLB and BCS Material Pack import pipeline documentation.
- Reference 2D Golden Diff overlay with local reference-frame import, opacity overlay, split comparison, difference heatmap, alignment guides and current-frame PNG export.
- Pure calibration metrics for mean color error, RMS error, changed-pixel ratio, edge mismatch and alpha mismatch.
- `StyleSpec.lookDev` with Neutral, Balanced Cinematic and High Energy profiles.
- Independent controls for exposure, environment reflection, baseline Bloom, Bloom threshold and clear-event Bloom boost.
- Neutral material-inspection lighting and fixed neutral background behavior.
- Regression tests for calibration metrics, LookDev bloom resolution, material optics and legacy project migration.

### Changed

- Rebalanced built-in plastic, resin and glass optics to preserve base color and material readability.
- Reduced board/slot clearcoat, PMREM contribution and lighting intensity.
- Separated normal static highlights from HDR clear-event particles and shockwave Bloom.
- Transparent placement ghosts no longer combine low opacity with transmissive material response.
- Current project schema accepts persisted LookDev controls while legacy projects receive the balanced default.
- Updated the package version to `0.3.0-alpha.3`.

### Current boundary

- Golden Diff is a one-frame diagnostic tool; batch Golden Scene reports and semantic masks remain pending.
- Thresholded HDR Bloom is improved but is not yet the final dedicated selective-bloom render graph.
- The existing Three.js backend remains experimental; PBR Texture Set and GLB runtime import are still pending.

## 0.3.0-alpha.2 — 2026-09-03

### Added

- Content-addressed Browser Asset Store backed by IndexedDB, with raw blobs separated from LocalStorage project/variant metadata.
- SHA-256 `bcs-asset://sha256/...` URI contract, media classification, per-file size limits, image dimension inspection, deduplication, deletion and storage estimates.
- Web upload authoring for background images, tile-face images, particle Sprites, Flipbooks/transparent clips, audio, self-contained GLB and material texture maps.
- Automatic binary Asset Manifest, derived Look Pack and Variant Recipe creation through the existing Headless Core.
- Runtime asset binding layer that resolves active Render Plan references to revocable browser object URLs and reports missing local bytes.
- Uploaded background preview/export support in Reference 2D and the fixed-camera Three.js experiment.
- Uploaded tile-face preview/export support in Reference 2D while keeping the face independent from tile material and geometry.
- Local asset library status, storage usage, semantic upload role, asset list and dependency-aware deletion in the Variant Workspace.
- Browser Asset Store, authoring and runtime-binding regression tests plus architecture documentation.
- Recursive Asset dependency resolution for Material Pack texture refs, Effect Pack layer refs and explicit manifest dependencies, including cycle rejection and dependency-aware runtime binding.

### Changed

- Formal video export now waits for active binary image decoding and rejects plans with unresolved local binary assets.
- Updated the package version to `0.3.0-alpha.2`.
- Single-file 3D import is restricted to structurally valid self-contained GLB 2.0 in v1; plain glTF with unresolved sidecar dependencies is rejected.
- SVG runtime import is deferred until a sanitizer/rasterizer is available; raster images are decoded and checked against pixel budgets before registration.

### Current boundary

- Background and Reference 2D tile-face images are the first fully rendered binary roles.
- Particle Sprites, Flipbooks, audio, GLB and texture maps are stored and compiled but remain Web-render-pass pending.
- Binary data is local to one browser origin/profile; portable project-package transfer and cloud synchronization are not implemented.
- The production `fixed-camera-cinematic` renderer and rendered-frame perceptual Quality Gate remain future milestones.

## 0.3.0-alpha.1 — 2026-09-02

### Added

- Web Variant Workspace backed by the same Asset Registry, Variant Compiler and Quality Gate as the BCS CLI.
- Project-to-Headless bridge that derives a Creative Master, immutable current-project Look Pack, fixed-camera metadata, Variant Recipe, Resolved Render Plan and Quality Report from the active project and Take.
- Built-in reference and experimental fixed-camera Look Packs expressed as versioned atomic asset manifests rather than closed theme branches.
- Browser import for external manifest-only Asset Bundles and Variant Recipes, plus LocalStorage persistence of the Agent round-trip workspace.
- Browser export for Creative Master, active Variant Recipe, Resolved Render Plan, Quality Report and current Asset Bundle.
- Variant status, plan hash, renderer, asset count, declared texture budget and quality issues in the human-facing inspector.
- Regression tests for Web/CLI compiler parity, Look Pack style resolution, fixed-camera aspect invariants and strict external manifest parsing.
- Architecture specification for the first Web Variant Workspace and its preview-binding boundary.

### Changed

- Video export now consumes the active resolved Look style and is blocked until the active Variant compiles and passes the structural Quality Gate.
- Editing legacy visual controls returns the workspace to an automatically versioned `Current project Look`, keeping existing authoring usable without bypassing the compiler.
- Updated the package version to `0.3.0-alpha.1`.

### Fixed

- Fit the legacy experimental Three.js camera against the actual portrait viewport aspect so the 8×8 board, bevel and shadow remain inside the phone canvas instead of clipping at both sides.
- Added regression coverage for 9:16 perspective framing and resize-driven camera updates.
- Preserved complete nested `reference2d` and geometry styles when atomic asset patches are applied.

### Current boundary

- Imported Web assets are manifests only; binary image, texture, GLB, Flipbook, audio and plugin storage is not yet implemented.
- External packs without a deliberate `metadata.studio.style` adapter may compile for another renderer but are not falsely presented as browser-previewable.
- The persisted gameplay project still uses `ProjectSpec`; the Master/Variant model is currently a derived compile view.
- Cartesian matrix authoring, batch render queue, rendered-frame Quality Gate and the production `fixed-camera-cinematic` renderer remain future work.

## 0.3.0-alpha.0 — 2026-09-02

### Added

- Agent-neutral Headless Core contracts for versioned assets, material appearance and behavior, effect packs, look packs, plugins, Creative Masters, Variant Recipes, immutable Resolved Render Plans and Quality Reports.
- Open Asset Registry supporting built-in, uploaded, generated, project-local and future DCC-produced artifacts through one versioned `AssetRef` contract.
- Deterministic Variant Compiler with `frame-exact`, `semantic` and `rule-only` lock modes, atomic slot overrides, renderer compatibility checks and stable plan hashes.
- Structural Quality Gate for required slots, unresolved assets, deterministic hashes, material/effect compatibility, fixed-camera output ratios, plugin permissions and declared render budgets.
- JSON-first BCS CLI commands for capability discovery, schema discovery, asset validation, variant compilation and quality checking.
- Headless JSON Schemas, a complete copper material/effect/look example, CLI smoke workflow and regression tests for registry resolution, stable hashing, variant compilation and quality gates.
- Architecture documents that define BCS as Agent-operable rather than Agent-embedded: external Agents may author assets and recipes, while BCS performs strict validation, compilation and deterministic execution.

### Changed

- Updated the package to `0.3.0-alpha.0` and made the production build emit both the Vite web application and the Node.js CLI.
- Replaced closed theme assumptions at the Headless Core boundary with versioned packs and atomic asset slots; Gold, Steel and Wood remain reference examples rather than product limits.
- Promoted the fixed camera, layout profile, replay fingerprint and output aspect ratio to invariant inputs of variant compilation.

### Not implemented yet

- The current Web Studio has not yet been migrated to edit Asset Registry packs, Variant Recipes or Variant Matrices.
- Plugin manifests are validated, but generated JavaScript, Web Worker and WASM plugins are not executed yet.
- MCP and Agent Skills are intentionally deferred until the CLI and Headless Core contracts stabilize.
- The Quality Gate currently covers structure, compatibility, determinism and budgets; visual checks such as clipping, overexposure, flicker, occlusion and baseline A/B scoring remain pending.
- `fixed-camera-cinematic` is currently a compile target contract, not yet the final production renderer; the existing `three-3d` renderer remains an experimental preview backend.

## 0.2.0-alpha.2 — 2026-09-02

### Added

- Full-frame audit indexes covering all 13,546 decoded frames without temporal gaps.
- Machine-candidate event index plus nine manually reviewed representative windows.
- 149-atom semantic asset lineage with requirement classes, dependencies, evidence status and renderer mappings.
- Reference profile classification for core, event-required, reference-required, optional and capture-only atoms.
- Fixed-camera cinematic representation map and Golden Scene extraction index.
- Reproducible local audit tools for every-frame analysis and Golden Frame extraction.
- Runtime-independent semantic asset contracts and a calibration-pending fixed-camera profile.
- Seventh observed tile color token, `rose`, across gameplay, project validation, Canvas and Three.js palettes.
- Six observed praise labels in the reference renderer; trigger thresholds remain explicitly provisional.
- CI validator for frame coverage, event bounds, asset lineage, profile completeness and renderer mappings.

### Changed

- Reframed the future production target as a fixed-camera hybrid cinematic renderer rather than a universal full-3D game scene.
- Updated the best-score HUD approximation to follow `max(previousBest, currentScore)`.
- Separated machine-derived full-video coverage from manually reviewed evidence in the committed truth layer.

### Still unresolved

- Exact scoring, cell glyph selection, praise thresholds, Combo timing, piece generation and audio-event lineage.
- Pixel-level Golden Scene calibration and external 2D asset replacement remain the next implementation gate.

## 0.2.0-alpha.1 — 2026-09-02

### Added

- TapTile Project Schema V2 with stable hashes, V1 migration and a strict visual/gameplay identity split.
- Rotation-aware TapTile blocker compiler, graph overrides, validation diagnostics and browser debugging UI.
- Production-only deterministic seven-slot match-3 engine with incremental unlock, warning/win/loss semantics and immutable transitions.
- TapTile play mode, semantic Take recording, state-verified replay/seek and a browser-verified Gate A example project and Take.
- Deterministic TapTile Beam Search with safe-win, danger-rescue, combo-heavy, fast-clear and intentional-fail Agent Take profiles.
- Strict TapTile SkinPacks with overlay/full-front/composed face assemblies, multiple body styles, asset/stage registries and one resolver for board/flight/tray/match-ghost roles.
- Seekable TapTile director compiler with four profiles, semantic event tracks, action timing overrides, seeded procedural effects and input/VFX overlap.
- Shared deterministic TapTile Canvas renderer and generic fixed-frame WebCodecs/Mediabunny exporter with frozen render identities, cancellable progress and six regression checkpoints.
- Two semantic TapTile AudioPacks with seeded cue variants, per-cue gain/offset/fades/delay, peak limiting and AAC muxing.
- Independent CutSpec/TimeWarp and Outro compilation, production-frame preview, hash-deduplicated batch queues, per-result manifests and deterministic result naming.
- Deterministic `.taptile-project.zip` export/import with project, asset manifest, Takes, bundle manifest, per-file SHA-256 checksums and strict mismatch rejection.
- Reference-first Canvas 2D renderer calibrated from the supplied 1064×1788 gameplay recording.
- Machine-readable layout, atom catalog, timing observations and scoring evidence under `docs/reference/`.
- Per-cell colors for candidate pieces, placement, replay, serialization and both render backends.
- Independent 2D controls for tile material, face motif, pre-clear tint, clear performance, praise/Combo and ambient particles.
- Placement feedback state with stepped score increments, tile glow and temporary thumbs.
- Reference-style HUD, board frame, rack scale/lift, line preview, sweep, score glyphs, praise, Combo and continue modal.

### Changed

- Isolated the earlier TapTile multi-mode research engine under `gameplay/experimental`; production paths now accept only `taptile-tray-match3-v1`.
- Made `reference-2d` the default renderer and reclassified Three.js 3D as an experimental backend.
- Split placement points from clear bonus points so observed placement scoring can be calibrated independently.
- Extended project import validation and JSON Schema for per-cell colors and reference 2D style atoms.
- Reframed the roadmap: establish a faithful 2D baseline before 3D generalization and DCC integration.

### Known gaps

- Hardware WebCodecs may produce byte-different MP4 containers for identical input; frozen combination/PCM identities and decoded frame hashes are used for deterministic-content verification.
- Exact clear scoring, praise thresholds, Combo rules, tray generation and several overlapping VFX timings remain unresolved from a single recording.

## 0.1.4 — 2026-09-01

### Changed

- Corrected Git Bundle recovery instructions to explicitly check out the `main` branch.
- Clarified that runtime source has no CDN dependency: network access is only needed to install pinned npm packages before local builds.
- Rebuilt and verified the source ZIP, Git Bundle and release checksums as one consistent handoff.

## 0.1.3 — 2026-09-01

### Added

- Collision-resistant runtime IDs for human and machine Takes.
- Dependency-free source-integrity check covering TypeScript syntax, relative imports, JSON files and required package scripts.
- Deterministic multi-seed Replay stress checks and camera-recovery regression coverage.

### Changed

- Locked setup, visual, rhythm, Take and project mutations while recording or rendering.
- Frozen a cloned Project/Take snapshot at export start so an MP4 render cannot drift when UI state changes.
- Hardened project import validation for candidate-set consistency, unique Take/action IDs, pointer-track duration bounds and even H.264 dimensions.
- Added an explicit browser AVC capability preflight before allocating the cinematic render pipeline.
- Preserved nonzero piece-set indexes and deterministic candidate IDs through shape edits.
- Made machine-player pointer paths originate from the actual candidate slot.
- Included camera-recovery time in the compiled director timeline.
- Corrected Three.js rack/drag cache keys so candidate color or shape changes always rebuild the scene.
- Pinned the currently verified Mediabunny package line and exact React/Three.js type packages.

## 0.1.2 — 2026-09-01

### Fixed

- Fixed fixed-frame presentation evaluation so a non-clearing placement releases the timeline and later actions can render.
- Added a deterministic regression scenario covering two sequential non-clearing placements.
- Removed invalid nested interactive controls from the candidate-piece cards.

## 0.1.1 — 2026-09-01

### Added

- Aggregate dependency-free validation commands, contribution guidance, third-party notices and a planning-to-code implementation map.
- Export preconditions for non-empty Takes, even video dimensions and font readiness.

## 0.1.0 — 2026-09-01

### Added

- Browser-first 8×8 block-placement gameplay core and deterministic three-piece tray generation.
- Human drag recording and rule-based machine-player Take generation through one semantic action protocol.
- Fixed-frame replay compiler with four rhythm profiles.
- Three.js 3D board, PBR materials, lighting/camera presets, deterministic 3D fracture, particles and post-processing.
- In-browser H.264/MP4 frame-by-frame export with three supersampling quality profiles and cancellation.
- Project JSON import/export, runtime hardening, LocalStorage autosave, example project and DCC extension interfaces.
