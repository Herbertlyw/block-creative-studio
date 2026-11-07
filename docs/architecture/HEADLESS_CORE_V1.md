# Headless Core v1

## Goal

Turn the browser prototype into a deterministic creative compiler that can be operated by a human-facing Web UI, a CLI, CI, or an external Agent.

```text
Creative Master
      +
Variant Recipe
      +
Asset Registry
      ↓
Variant Compiler
      ↓
Resolved Render Plan
      ↓
Quality Gate
      ↓
Renderer / Batch Runtime
```

## Contracts

### Creative Master

Holds the facts that a visual variant must not silently change: rule profile, board dimensions, replay identity, fixed layout/camera references, frame count, FPS, and base output profile.

### Asset Manifest

Every runtime artifact has an id, semantic version, kind, origin, renderer compatibility, determinism declaration, optional content hash, and optional resource budget.

The registry accepts artifacts created by humans, external Agents, procedural tools, or DCC software, but it never accepts an untyped arbitrary file as a render dependency.

### Material Pack

Separates appearance from destruction behavior. This is what lets the renderer pair copper with metallic chips and sparks, wood with splinters and dust, glass with radial shards, or jelly with deformation rather than a generic explosion.

### Effect Pack

Declares supported gameplay events, compatible material classes, and independently replaceable layers such as energy propagation, material response, tile exit, large fragments, particles, lighting reaction, and audio.

### Look Pack

A convenience bundle mapping semantic slots to assets. It is not an opaque theme: a Variant Recipe may override any individual slot.

### Variant Recipe

References one master and one look, then applies optional slot/output/director overrides. Lock modes are:

- `frame-exact`: visual/audio changes only; timing and FPS stay locked.
- `semantic`: gameplay actions and semantic events stay locked; director timing may change.
- `rule-only`: only the gameplay rules remain invariant.

### Resolved Render Plan

The compiler output. All indirect look references have been resolved, required slots are present, renderer compatibility is known, material/effect compatibility has passed, and a deterministic plan hash has been generated.

The compiler also emits a topologically ordered dependency closure. Explicit `dependencies`, Material Pack texture channels, Effect Pack layer assets, and Look Pack slots are all resolved through the same registry. Cycles, missing nested assets, renderer incompatibility, and hash mismatches fail before rendering. Older v1 plans without the optional closure fields remain readable; newly compiled plans always include them.

## Required visual slots in v1

```text
background.base
board.skin
tile.material
interaction.preview
placement.confirmation
clear.primary
clear.tile-exit
hud.current-score
endgame.presentation
```

These slots are deliberately semantic. Their implementation may be Canvas code, a shader, layered 2.5D sprites, true geometry, a flipbook, or a DCC-baked transform track.

## Quality Gate v1

The first gate is structural rather than perceptual. It checks:

- Required slots and asset resolution.
- Renderer compatibility.
- Determinism and production content hashes.
- Material/effect compatibility.
- A primary energy layer and visible tile exit.
- Unsafe plugin permissions.
- Texture, triangle, and plugin-memory budgets.
- H.264-compatible dimensions.
- `frame-exact` timing constraints.

Visual A/B quality, overexposure, occlusion, flicker, safe-area, and material realism are later gates that require rendered frames.

## Current boundary

Headless Core v1 does **not** execute plugins, call Agents, render a new backend, or expose MCP. It establishes the contracts and compiler that those later systems must use.

The browser Studio now consumes this core through `src/integration/studioVariantBridge.ts`: the active project and Take are converted into a Creative Master, Look Packs are resolved by the shared Asset Registry, and video export is gated by the shared Variant Compiler and Quality Gate. The legacy `ProjectSpec` is still the authoring document; replacing it with a native Master/Variant workspace is a later migration.
