# BCS CLI

The CLI is the first-class automation interface for external Agents, CI, and future render workers. It emits JSON on stdout and machine-readable errors on stderr.

## Build

```bash
npm run build:cli
```

The executable is generated at:

```text
dist-cli/cli/bcs.js
```

## Discover capabilities

```bash
node dist-cli/cli/bcs.js capabilities
node dist-cli/cli/bcs.js schema list
node dist-cli/cli/bcs.js schema get asset-manifest@1
node dist-cli/cli/bcs.js schema get blender-scene-exchange@1
```

## Validate an externally authored asset

```bash
node dist-cli/cli/bcs.js asset validate \
  examples/headless/assets/material.copper.json
```

## Compile one variant

```bash
node dist-cli/cli/bcs.js variant compile \
  --master examples/headless/master.demo.json \
  --recipe examples/headless/variant.copper.demo.json \
  --assets examples/headless/assets \
  --renderer fixed-camera-cinematic \
  --require-hashes \
  --out /tmp/copper-plan.json
```

## Run the structural quality gate

```bash
node dist-cli/cli/bcs.js quality check \
  --plan /tmp/copper-plan.json \
  --strict \
  --require-hashes \
  --max-texture-mib 512 \
  --max-triangles 1000000
```

A failed command returns a stable error code such as `ASSET_NOT_FOUND`, `EFFECT_MATERIAL_INCOMPATIBLE`, `FRAME_EXACT_DIRECTOR_OVERRIDE`, or `PLUGIN_PERMISSION_FORBIDDEN`.

## Compile a material runtime (no render)

```bash
node dist-cli/cli/bcs.js material compile \
  --pack examples/headless/materials/material.aurora-shell.json \
  --out /tmp/aurora-runtime.json
```

The command never sets `rendered: true`. Packs with on-disk maps under `examples/headless/materials/maps/` compile those URIs into the descriptor; Node still reports `resourcesReady: false` because it does not decode GPU textures. Parameter-only packs (no maps) report `resourcesReady: true`.

## Golden batch report

```bash
node dist-cli/cli/bcs.js golden batch \
  --index docs/reference/v2/GOLDEN_SCENE_INDEX_V1.json \
  --out /tmp/golden-report.json \
  --html /tmp/golden-report.html
```

Without local reference frames the 13 scenes / 39 anchors stay `BLOCKED`. This is not a visual PASS.

## Compile a constrained scene through Blender

BCS never executes an arbitrary `.blend` in the browser. A producer first writes
a validated scene-exchange package, then the CLI starts Blender in background
mode and compiles it into runtime-safe artifacts:

```bash
node dist-cli/cli/bcs.js dcc validate-exchange \
  fixtures/dcc/taptile-match-v1.scene-exchange.json

node dist-cli/cli/bcs.js dcc compile-blender \
  fixtures/dcc/taptile-match-v1.scene-exchange.json \
  --output artifacts/blender/taptile-match-v1 \
  --engine eevee \
  --max-triangles 250000

# When scene assets use /assets/... builtin URIs, bind them to a trusted root.
node dist-cli/cli/bcs.js dcc compile-blender \
  scene-exchange.json \
  --asset-root public \
  --output artifacts/blender/textured-scene

node dist-cli/cli/bcs.js dcc inspect-glb \
  artifacts/blender/taptile-match-v1/scene.glb \
  --max-triangles 250000

node dist-cli/cli/bcs.js dcc verify-blender \
  artifacts/blender/taptile-match-v1/compile-report.json \
  --max-triangles 250000
```

Use `--blender <path>` when Blender is not installed in a standard location.
The command refuses to overwrite a non-empty output directory and verifies the
size and SHA-256 of every reported artifact before returning success. A passing
package contains:

```text
source-artifact.json
compile-report.json
scene-exchange.json
scene.normalized.blend
scene.glb
scene.vfx.glb
preview.png
representative-frames/*.png
```

The normalized `.blend` is always a new file under the output directory. The
source exchange package is never modified.

The Studio export panel downloads a self-contained `.bcs-blender.zip`. Pass it
directly to the compiler; the CLI validates every package checksum, extracts it
into a temporary directory, binds its package-relative image assets, and removes
the temporary files when Blender exits:

```bash
node dist-cli/cli/bcs.js dcc compile-blender \
  TapTile-scene.bcs-blender.zip \
  --output artifacts/blender/taptile-scene \
  --engine eevee
```

The ZIP contains its own manifest and SHA-256 table. New compile reports
distinguish `quality.structure` from `quality.visual`: a glyph or missing-image
fallback may keep the structural compile usable while marking the visual result
`degraded` instead of silently claiming final-picture parity.

Every new TapTile compile emits two GLBs. `scene.glb` is the complete editable
review scene. `scene.vfx.glb` is the production overlay: it contains only the
fixed camera and match VFX, carries stable `bcs_id`/`bcs_role` metadata, has no
tile textures, and is the recommended file to import back into the Studio. See
[TapTile Blender round trip](./TAPTILE_BLENDER_ROUNDTRIP.md) for the complete
operator workflow and acceptance criteria.

### Render the compiled Blender scene to H.264

The normalized scene can be rendered directly without reopening the authoring
exchange. The command refuses to overwrite an existing movie, renders at the
scene's locked resolution and fps, then independently reopens the MP4 and checks
its H.264 codec, dimensions, exact frame count, duration, rate, byte length and
SHA-256 digest:

```bash
node dist-cli/cli/bcs.js dcc render-blender \
  artifacts/blender/taptile-match-v1/scene.normalized.blend \
  --output artifacts/blender/taptile-match-v1/final.mp4 \
  --quality cinematic

# A bounded range is useful for CI and effect review.
node dist-cli/cli/bcs.js dcc render-blender \
  artifacts/blender/taptile-match-v1/scene.normalized.blend \
  --output artifacts/blender/taptile-match-v1/match-review.mp4 \
  --frame-start 128 \
  --frame-end 142 \
  --quality draft
```

`draft`, `standard`, and `cinematic` map to explicit Blender FFmpeg quality and
encoding presets. A sidecar `<movie>.render-report.json` records the source hash,
Blender version, engine, frame range, encoding profile, output hash and render
duration. The current bridge intentionally emits video-only MP4; soundtrack and
2D HUD composition remain deterministic BCS post-production steps.
