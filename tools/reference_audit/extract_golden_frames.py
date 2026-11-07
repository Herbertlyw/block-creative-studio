#!/usr/bin/env python3
"""Extract start/peak/end frames for committed Golden Scene definitions.

All requested source frames are decoded in one ffmpeg pass. This is much faster
than seeking from the beginning once per scene while preserving exact frame
numbers for constant-frame-rate reference captures.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("index", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path(".reference-audit-work/golden"))
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    arguments = parse_args()
    video = arguments.video.expanduser().resolve()
    index_path = arguments.index.expanduser().resolve()
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise RuntimeError("ffmpeg is required on PATH.")
    if not video.is_file():
        raise FileNotFoundError(video)

    payload: dict[str, Any] = json.loads(index_path.read_text(encoding="utf-8"))
    digest = sha256_file(video)
    expected = payload.get("sourceVideoSha256")
    if expected and expected != digest:
        raise RuntimeError(f"Source SHA mismatch: {digest} != {expected}")

    scenes = payload.get("scenes", [])
    requested_frames = sorted({
        int(scene[field])
        for scene in scenes
        for field in ("startFrame", "peakFrame", "endFrame")
    })
    if not requested_frames:
        raise RuntimeError("Golden Scene index has no requested frames.")

    arguments.output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="block-creative-golden-") as temporary:
        temporary_path = Path(temporary)
        select_expression = "+".join(f"eq(n\\,{frame})" for frame in requested_frames)
        subprocess.run([
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-vsync",
            "0",
            "-i",
            str(video),
            "-vf",
            f"select={select_expression}",
            "-start_number",
            "0",
            str(temporary_path / "%05d.png"),
        ], check=True)

        decoded = sorted(temporary_path.glob("*.png"))
        if len(decoded) != len(requested_frames):
            raise RuntimeError(
                f"Expected {len(requested_frames)} selected frames, ffmpeg produced {len(decoded)}."
            )
        frame_sources = dict(zip(requested_frames, decoded, strict=True))

        manifest: list[dict[str, Any]] = []
        for scene in scenes:
            scene_id = str(scene["id"])
            output = arguments.output_dir / scene_id
            output.mkdir(parents=True, exist_ok=True)
            files: dict[str, str] = {}
            for label, field in (("start", "startFrame"), ("peak", "peakFrame"), ("end", "endFrame")):
                frame = int(scene[field])
                destination = output / f"{label}-{frame:05d}.png"
                shutil.copy2(frame_sources[frame], destination)
                files[label] = str(destination.relative_to(arguments.output_dir))
            manifest.append({
                "id": scene_id,
                "purpose": scene.get("purpose"),
                "expectedAtoms": scene.get("expectedAtoms", []),
                "files": files,
            })

    (arguments.output_dir / "manifest.json").write_text(
        json.dumps({"sourceVideoSha256": digest, "scenes": manifest}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Extracted {len(manifest)} Golden Scenes to {arguments.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
