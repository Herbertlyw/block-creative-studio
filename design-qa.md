# TapTile Stack Studio design QA

## Source truth

- Visual reference set: `D:\0824-AE(AI大模型)\图02\01.png` through `30.png`.
- Gameplay evidence set: `D:\0824-AE(AI大模型)\8.25换牌面叉乘结果去水印版（只放视频）`.
- Shared video format verified by FFprobe: 1080×1920, 30 fps, H.264, yuv420p.

## Visual comparison

- Before comparison: `C:\Users\admin\AppData\Local\Temp\taptile-tile-audit-20260902\04-current-vs-reference-tile-closeups.png`.
- Final combined close-up comparison: `D:\block-creative-studio\artifacts\design-qa\tile-material-comparison-final.png`.
- Final full editor capture: `D:\block-creative-studio\artifacts\design-qa\taptile-pixel-grid-1440.png`.
- Reviewed at 1440×900 and the minimum supported desktop width of 1180×760.

The default tile now matches the repeated reference cues: warm ivory face, neutral gray sidewall, compact contact shadow, restrained bevel, and one consistent top-left light direction. The prior blue-white tile is retained as the separate Ice material.

## Interaction QA

- Empty-stage marquee selection.
- Shift additive selection.
- Ctrl+A select all and Escape clear.
- Rigid multi-tile drag with relative-position preservation.
- Batch delete, duplicate, face replacement, layer change, scale, rotation, lock, align, and distribute.
- Center, edge, seam, and equal-spacing smart snap.
- Arbitrary non-negative layers and high-layer z ordering.
- Material switching and project autosave.

Browser smoke result: marquee selected 5 tiles; group-drag delta spread ≤0.0001%; batch delete removed exactly 5; Ctrl+A selected all remaining tiles; multi-align edge spread 0 px; console errors 0.

## Surface review

- Typography: no clipped primary labels at 1440 or 1180 desktop widths.
- Spacing: toolbar compression at 1180 was corrected by preventing wrapped controls and hiding the secondary snap readout.
- Color/contrast: selected, snap-target, disabled, and dimmed states remain distinguishable.
- Image quality: the generated warm tile surface is a local 512×512 raster asset and is not stretched from a screenshot.
- Copy: selection help now documents marquee, Shift add, group drag, Ctrl+A, and Escape.
- Responsive scope: this is an explicitly desktop-only authoring workbench; the repository still enforces an 1180 px minimum width.

final result: passed

