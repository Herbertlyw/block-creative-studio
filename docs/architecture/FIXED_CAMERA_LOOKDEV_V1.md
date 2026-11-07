# Fixed-camera 3D LookDev v1

## Problem

The original experimental Three.js renderer stacked several independent brightness mechanisms:

```text
very low roughness
high clearcoat
strong PMREM environment reflection
strong key/fill/rim lights
raised exposure
full-screen bloom
static material emissive
```

The result was not “more realistic”. It removed base color, flattened material identity and made every tile appear self-illuminated.

## Principle

```text
Material readability first
→ contact and volume second
→ event energy third
→ Hero bloom last
```

A static tile should remain readable without Bloom. Bloom belongs primarily to semantic energy layers such as clear sweeps, sparks, shockwaves and Hero events.

## Profiles

### Neutral LookDev

```text
neutral gray background
neutral key/fill light
low environment reflection
zero baseline bloom
zero clear bloom boost
```

Use this profile when importing or validating a material.

### Balanced Cinematic

```text
controlled environment reflection
moderate exposure
low baseline bloom
bounded clear-event bloom boost
```

This is the production-oriented default.

### High Energy

```text
higher clear-event bloom
lower threshold
stronger environment contribution
```

Use only after the material passes Neutral and Balanced review. It is an event-direction choice, not a material-quality baseline.

## Runtime controls

`StyleSpec.lookDev` stores:

```text
exposure
environmentIntensity
bloomStrength
bloomThreshold
bloomRadius
clearBloomBoost
```

These values are versioned with the project and included in the current-project Look hash.

The renderer applies them separately:

- exposure multiplies the lighting preset exposure;
- environment intensity scales tile, board and slot PMREM reflections;
- baseline Bloom is used outside clear events;
- clear Bloom boost is applied only around the event peak;
- threshold and radius control which HDR values spread and how far.

## Material changes

The built-in material baselines were normalized:

- plastic roughness and clearcoat were increased/reduced respectively;
- resin transmission no longer combines with sub-1 opacity in placement ghosts;
- glass keeps transmission but uses substantially lower clearcoat, iridescence and emissive output;
- board and slot surfaces use higher roughness and lower environment reflection.

## Lighting changes

A new `neutral-lookdev` lighting rig was added. Existing rigs were reduced to preserve color and volume. The old high-intensity values remain documented in Git history but are not production defaults.

## Bloom strategy

v1 uses thresholded HDR Bloom rather than a full selective-bloom render graph:

- ordinary material response is kept below the threshold as much as possible;
- clear particles and shockwave use HDR values so they can cross the threshold;
- Neutral LookDev disables Bloom completely;
- clear-event strength is resolved from `lookDev + quality + fx + progress`.

A future production renderer may replace this with a dedicated bloom-only pass. The v1 contract already separates baseline Bloom and event Bloom so that implementation can change without changing project semantics.

## Acceptance order

1. Neutral LookDev: base color, roughness, normal response and contact shadow.
2. Balanced Cinematic: environment reflection and silhouette readability.
3. Drag/placement: no sudden material identity shift.
4. Clear event: emission and Bloom peak remain bounded.
5. Cinematic export: no clipped highlights or persistent glow after the event.

## Still pending

- PBR Texture Set runtime;
- normal/roughness/metallic debug views;
- highlight-clipping heatmap;
- dedicated selective-bloom pass;
- imported GLB material validation;
- material-aware fragment geometry and fracture behavior;
- perceptual A/B quality gate.
