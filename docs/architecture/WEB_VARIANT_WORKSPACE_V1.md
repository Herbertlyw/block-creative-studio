# Web Variant Workspace v1

## Purpose

The browser Studio and the BCS CLI now consume the same Headless Core instead of maintaining separate theme and validation logic.

```text
Human Web UI ─┐
External Agent ├── Asset Registry → Variant Compiler → Quality Gate → Resolved Render Plan
BCS CLI ──────┘
```

The Web UI remains a human-first client. It does not interpret prompts, call a model, or execute arbitrary uploaded code. External Agents may author JSON manifests, media, shaders, geometry, or future DCC artifacts upstream; the Web workspace starts at the strict artifact boundary.

## Web workflow

1. Build or load a gameplay project and select a Take.
2. Select an available Look Pack or keep `Current project Look`.
3. Choose the invariant policy:
   - `frame-exact`: appearance changes only; Replay timing and FPS remain locked.
   - `semantic`: gameplay events remain locked; director timing may change.
   - `rule-only`: only the gameplay rules are invariant.
4. The Studio derives a `CreativeMaster` from the current project and Take.
5. The selected `VariantRecipe` is compiled through `compileVariant`.
6. The same `runQualityGate` used by CLI checks hashes, fixed-camera aspect, required slots, renderer support, material/effect compatibility, plugin permissions, and budgets.
7. A preview is shown only when the resolved Look Pack declares a supported `metadata.studio.style` binding for the current browser renderer.
8. Formal video export is blocked until compilation and the structural Quality Gate pass.

## Built-in packs

The first bridge exposes several built-in packs as regression fixtures rather than a closed product taxonomy:

- Current project Look: generated from the current inspector values.
- Reference Garden: the full reference-first 2D presentation.
- Reference Clean: a reduced 2D presentation for behavior and timing review.
- Fixed-camera 3D Candy: the current experimental Three.js backend as a versioned Look Pack.
- Fixed-camera 3D Crystal: a second experimental pack used to verify atomic replacement.

A change made through the legacy inspector returns selection to `Current project Look`. This keeps the old authoring controls usable while ensuring the output is recompiled into a new immutable plan hash.

## External artifact round trip

The panel can export:

- `CreativeMaster`
- active `VariantRecipe`
- `ResolvedRenderPlan`
- `QualityReport`
- the current manifest-only Asset Bundle

An external Agent can modify or generate compatible manifests and recipes, then return them through the two JSON import controls.

Imported manifests and recipes are stored locally and validated before registration. An existing `id@version` cannot be replaced by different content; the producer must publish a new version. Browser Asset Store v1 now stores actual binary bytes in IndexedDB by SHA-256 and binds them through `bcs-asset://sha256/…`. Background images and Reference 2D tile-face images have runtime preview/export adapters; GLB, Flipbook, audio, texture maps and particle assets currently remain compile-only until their Render Passes are implemented.

## Preview binding versus compile support

A valid external asset may compile successfully but remain unavailable for Web preview. These are separate capabilities:

```text
Contract-valid + renderer-compatible
                ≠
Current Web renderer knows how to display it
```

The Web panel therefore reports one of three states:

- **Renderable**: compile and Quality Gate pass, and a browser preview binding exists.
- **Compilable**: the plan is valid for an external/future renderer, but the current Web renderer has no binding.
- **Rejected**: compilation or Quality Gate failed with a machine-readable code.

This prevents the UI from pretending that an imported GLB, shader, or DCC effect is visible before an actual runtime adapter exists.

## Fixed-camera invariant

Every generated project camera manifest records:

- design resolution;
- board screen rectangle;
- `allowOrbit=false`;
- bounded screen-space zoom, translation, and rotation.

The Quality Gate rejects output aspect ratios that do not match the fixed-camera design. Page layout and editor panel dimensions are not allowed to redefine the creative composition.

## Current limitations

- The existing `ProjectSpec` remains the authoring document for board editing, recording, and legacy style controls. `CreativeMaster` and `VariantRecipe` are derived views in this release; the persisted project schema is not yet replaced.
- Binary asset storage is implemented with IndexedDB, but portable project-package export/import is not yet available.
- `metadata.studio.style` remains the temporary style adapter; actual uploaded bytes now enter renderers through `RuntimeAssetBindings` rather than being embedded into `ProjectSpec`.
- The browser currently compiles one active project recipe plus imported recipes. Cartesian variant-matrix authoring and batch queue execution remain next-stage work.
- The structural Quality Gate is not yet a rendered-frame perceptual gate.
- `fixed-camera-cinematic` remains a compile target; the production hybrid renderer is not implemented in this release.
