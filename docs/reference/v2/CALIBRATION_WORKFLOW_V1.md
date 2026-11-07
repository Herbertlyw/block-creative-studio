# Reference 2D Calibration Workflow v1

## Goal

Reference 2D calibration does **not** require every stochastic particle to occupy the same source-video pixel. Its purpose is to lock the reusable truths that future 3D, material and DCC renderers must preserve:

```text
layout
interaction geometry
event timing
z-order and occlusion
screen-space feedback
```

The accepted term is **pixel-coordinate and event-timing calibration**, not a promise of source-identical pixels.

## Golden Scene workflow

1. Open a Take in Replay mode.
2. Seek to the `startFrame`, `peakFrame` or `endFrame` listed in `GOLDEN_SCENE_INDEX_V1.json`.
3. Open **2D 校准 / Golden Diff** inside the Reference 2D viewport.
4. Import the locally extracted reference frame.
5. Use:
   - **叠加** to inspect positioning and opacity;
   - **分屏** to compare local details without flickering;
   - **差异** to inspect the generated heatmap.
6. Enable alignment guides for the board, grid, rack centers and score center.
7. Export the current BCS frame when a review artifact is needed.
8. Record accepted deviations and unresolved behavior; do not silently tune an uncertain gameplay rule to match one frame.

Reference video and extracted frames remain local and are never committed to the public repository.

## Metrics

The browser computes diagnostic signals on the 1064×1788 design canvas:

```text
mean absolute RGB error
RGB root mean square error
changed-pixel ratio
edge mismatch ratio
alpha mismatch ratio
```

The combined diagnostic score is useful for iteration, not a universal acceptance threshold. Random petals, glints, compression blocks and generated particles can create large pixel differences while preserving the correct semantic event.

## Suggested gates

| Element | Suggested tolerance |
|---|---:|
| Board outer rectangle | 2–3 px |
| Cell size and gap | 1–2 px |
| HUD / tray anchors | 3–5 px |
| Pickup scale | 2% |
| Pre-clear cells | exact logical-cell match |
| Event start / peak / end | 2–3 frames |
| Praise / modal bounding box | high overlap, manual review |
| Stochastic particles | density, origin, direction and lifetime ranges |

## Review order

```text
1. Idle layout
2. Pickup and drag
3. Legal ghost and pre-clear
4. Placement response
5. Clear propagation
6. Praise / Combo overlap
7. Tray refresh
8. New High Score
9. Endgame modal
```

Lock geometry and timing before color grading. Lock color and value before adding extra particles. Otherwise a visually dense effect can hide a wrong board position or wrong event frame.

## Current limitations

- Golden reference images are loaded manually from the local machine.
- The tool compares one frame at a time; automatic batch extraction and report aggregation remain pending.
- Semantic masks for board, HUD and VFX regions are not yet generated automatically.
- The score does not replace human aesthetic approval.
