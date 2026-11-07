# Interface decisions v1

These names merge into Headless Core. They are not a second type system.

| Concept | Module | Notes |
|---|---|---|
| `FrameRenderRequest` | `src/headless/contracts.ts`, `frameRequest.ts` | Read-only; presentation-frame time; design or video pixels |
| `PreparedResources` | `src/headless/contracts.ts` | Readiness + missing slots; load failure refuses capture |
| `FrameRenderResult` | `src/headless/contracts.ts` | Status `rendered / failed / blocked` |
| `CalibrationCase` | `src/headless/contracts.ts`, `calibration.ts` | Source PTS and take frame stored separately |
| `MaterialRuntimeDescriptor` | `src/headless/contracts.ts`, `materialRuntime.ts` | Compiled from MaterialPack; fracture remains pending |
| `ReferencePassId` | contracts + `src/reference2d/passes.ts` | Draw order preserved |
| `DiagnosticViewId` | contracts + Inspector + StudioScene | Reads runtime materials, not name swatches |
| `FIXED_SHOT_PROFILE` | `src/renderer/shotProfile.ts` | Fallback shot when Plan metadata is missing |
| `ShotExecution` | `src/renderer/planShotAdapter.ts` | Plan camera/layout → cinematic viewport/zoom; pose/FOV still fallback |
| `MaterialBehaviorProfile` kinematics | `src/renderer/materialFracture.ts` | Shard scale/motion only; not G-buffer fracture |

Bloom remains **threshold-bloom**. Selective bloom is not claimed.

CLI does not set `rendered: true`. Browser WebCodecs export is a separate capability.
