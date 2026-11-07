# Full-video reference audit tools

These tools rebuild the machine-derived, every-frame audit used by
`docs/reference/v2/`. They do **not** ship the source recording or extracted
frames. Keep those files local.

## Requirements

- Python 3.11+
- `ffmpeg` and `ffprobe` on `PATH`
- NumPy (`python -m pip install -r requirements.txt`)

## Rebuild the frame/event indexes

```bash
python tools/reference_audit/analyze_video.py \
  "/path/to/reference.mp4" \
  --output-dir .reference-audit-work/generated \
  --manual-review tools/reference_audit/manual_review_v1.json
```

The analyzer decodes every source frame. It creates contiguous state intervals
that cover frame `0..N-1` without gaps, plus machine-candidate event windows.
Manually reviewed representative windows are appended from
`manual_review_v1.json` and are clearly labelled.

The machine windows are an indexing aid, not claims that every detected window
is a semantically exact move or clear. Visual truth still requires review of
Golden Scenes.

For a machine-only smoke test against a different clip, add
`--skip-manual-review`; reviewed windows are tied to the committed source SHA.

## Extract Golden Scene frames locally

```bash
python tools/reference_audit/extract_golden_frames.py \
  "/path/to/reference.mp4" \
  docs/reference/v2/GOLDEN_SCENE_INDEX_V1.json \
  --output-dir .reference-audit-work/golden
```

This extracts start/peak/end PNGs for every Golden Scene. The output directory
is ignored by Git because the public repository must not redistribute source
frames from the reference game.

## Validate committed audit data

```bash
npm run check:reference
```

The validator checks full frame coverage, source identity, event bounds, unique
semantic atom IDs, profile references, renderer mappings, and Golden Scene
references.
