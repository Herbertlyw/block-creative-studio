#!/usr/bin/env python3
"""Render a compiled BCS .blend file to a deterministic H.264 review movie."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time

import bpy


QUALITY = {
    "draft": {"crf": "MEDIUM", "preset": "REALTIME"},
    "standard": {"crf": "HIGH", "preset": "GOOD"},
    "cinematic": {"crf": "PERC_LOSSLESS", "preset": "GOOD"},
}


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--quality", choices=sorted(QUALITY), default="standard")
    parser.add_argument("--frame-start", type=int)
    parser.add_argument("--frame-end", type=int)
    return parser.parse_args(values)


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_report(path: str, report: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


def main() -> None:
    args = parse_args()
    started = time.perf_counter()
    source = os.path.abspath(bpy.data.filepath)
    output = os.path.abspath(args.output)
    report_path = os.path.abspath(args.report)
    scene = bpy.context.scene
    original_start = int(scene.frame_start)
    original_end = int(scene.frame_end)
    frame_start = original_start if args.frame_start is None else int(args.frame_start)
    frame_end = original_end if args.frame_end is None else int(args.frame_end)
    if not source or not os.path.isfile(source):
        raise RuntimeError("A saved .blend source is required.")
    if frame_start < original_start or frame_end > original_end or frame_end < frame_start:
        raise RuntimeError(
            f"Requested frame range {frame_start}..{frame_end} escapes scene range "
            f"{original_start}..{original_end}."
        )
    if not output.lower().endswith(".mp4"):
        raise RuntimeError("Output must use the .mp4 extension.")

    os.makedirs(os.path.dirname(output), exist_ok=True)
    profile = QUALITY[args.quality]
    scene.frame_start = frame_start
    scene.frame_end = frame_end
    scene.render.resolution_percentage = 100
    # Blender 5.x partitions output formats by media type; VIDEO must be selected
    # before FFMPEG becomes a legal file_format enum value.
    scene.render.image_settings.media_type = "VIDEO"
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = profile["crf"]
    scene.render.ffmpeg.ffmpeg_preset = profile["preset"]
    scene.render.ffmpeg.gopsize = max(1, int(round(scene.render.fps / scene.render.fps_base)) * 2)
    scene.render.ffmpeg.use_max_b_frames = True
    scene.render.ffmpeg.max_b_frames = 2
    scene.render.ffmpeg.audio_codec = "NONE"
    scene.render.use_file_extension = True
    scene.render.filepath = output

    base_report = {
        "contract": "bcs.blender-video-render-report",
        "contractVersion": "1.0.0",
        "source": {"path": source, "sha256": sha256_file(source)},
        "blender": {
            "version": bpy.app.version_string,
            "engine": str(scene.render.engine),
        },
        "render": {
            "width": int(scene.render.resolution_x),
            "height": int(scene.render.resolution_y),
            "fps": float(scene.render.fps / scene.render.fps_base),
            "frameStart": frame_start,
            "frameEnd": frame_end,
            "frameCount": frame_end - frame_start + 1,
            "durationSeconds": (frame_end - frame_start + 1) / float(scene.render.fps / scene.render.fps_base),
            "quality": args.quality,
            "constantRateFactor": profile["crf"],
            "preset": profile["preset"],
        },
        "warnings": [],
        "errors": [],
    }
    try:
        bpy.ops.render.render(animation=True)
        if not os.path.isfile(output) or os.path.getsize(output) <= 0:
            raise RuntimeError(f"Blender did not create a non-empty movie at {output}.")
        report = {
            **base_report,
            "status": "passed",
            "output": {
                "path": output,
                "sha256": sha256_file(output),
                "byteLength": os.path.getsize(output),
            },
            "metrics": {"renderDurationMs": round((time.perf_counter() - started) * 1000)},
        }
    except Exception as error:  # Blender must leave a machine-readable failure behind.
        report = {
            **base_report,
            "status": "failed",
            "output": {"path": output, "sha256": "", "byteLength": 0},
            "metrics": {"renderDurationMs": round((time.perf_counter() - started) * 1000)},
            "errors": [str(error)],
        }
        write_report(report_path, report)
        raise
    write_report(report_path, report)
    print(f"BCS_BLENDER_VIDEO_REPORT={report_path}")


if __name__ == "__main__":
    main()
