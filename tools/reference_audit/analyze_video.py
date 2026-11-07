#!/usr/bin/env python3
"""Build a gap-free full-frame state index and candidate event index.

The analyzer intentionally separates two evidence levels:

* machine-derived coverage/candidates: every decoded frame is processed;
* manual-reviewed representative events: loaded from a reviewed JSON file.

It is a retrieval and audit tool, not a claim that heuristics recover the
reference game's private rules or exact event semantics.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

import numpy as np

PIPELINE_VERSION = "reference-audit-0.2.0"
ANALYSIS_WIDTH = 133
ANALYSIS_HEIGHT = 224

SOURCE_ROIS: dict[str, tuple[int, int, int, int]] = {
    "full": (0, 0, 1064, 1788),
    "hud": (0, 0, 1064, 300),
    "score": (350, 120, 715, 290),
    "board": (70, 300, 1002, 1232),
    "board_inner": (90, 320, 990, 1220),
    "rack": (0, 1260, 1064, 1640),
    "between_board_rack": (0, 1215, 1064, 1405),
    "center_feedback": (100, 360, 964, 1180),
    "endgame_card": (250, 610, 820, 1450),
}


@dataclass(frozen=True)
class VideoMetadata:
    file_name: str
    sha256: str
    width: int
    height: int
    nominal_fps: float
    duration_seconds: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path, help="Local source video.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(".reference-audit-work/generated"),
        help="Destination for generated JSON indexes.",
    )
    parser.add_argument(
        "--manual-review",
        type=Path,
        default=Path(__file__).with_name("manual_review_v1.json"),
        help="Reviewed representative event windows.",
    )
    parser.add_argument(
        "--skip-manual-review",
        action="store_true",
        help="Generate machine-only indexes without loading reviewed event windows.",
    )
    parser.add_argument(
        "--keep-features",
        action="store_true",
        help="Write compressed feature arrays for diagnostics.",
    )
    return parser.parse_args()


def require_executable(name: str) -> str:
    executable = shutil.which(name)
    if executable is None:
        raise RuntimeError(f"Required executable is not on PATH: {name}")
    return executable


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_rate(value: str | None) -> float:
    if not value or value in {"0/0", "N/A"}:
        return 0.0
    numerator, denominator = value.split("/", 1)
    return float(numerator) / float(denominator)


def probe_video(video: Path) -> VideoMetadata:
    ffprobe = require_executable("ffprobe")
    command = [
        ffprobe,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,avg_frame_rate,r_frame_rate:format=duration",
        "-of",
        "json",
        str(video),
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    payload = json.loads(result.stdout)
    streams = payload.get("streams") or []
    if not streams:
        raise RuntimeError("No video stream found.")
    stream = streams[0]
    rate = parse_rate(stream.get("avg_frame_rate")) or parse_rate(stream.get("r_frame_rate"))
    duration = float((payload.get("format") or {}).get("duration") or 0.0)
    if rate <= 0:
        raise RuntimeError("Unable to determine a positive source frame rate.")
    return VideoMetadata(
        file_name=video.name,
        sha256=sha256_file(video),
        width=int(stream["width"]),
        height=int(stream["height"]),
        nominal_fps=rate,
        duration_seconds=duration,
    )


def scaled_rois(width: int, height: int) -> dict[str, tuple[int, int, int, int]]:
    sx = ANALYSIS_WIDTH / width
    sy = ANALYSIS_HEIGHT / height
    result: dict[str, tuple[int, int, int, int]] = {}
    for name, (x1, y1, x2, y2) in SOURCE_ROIS.items():
        result[name] = (
            max(0, int(x1 * sx)),
            max(0, int(y1 * sy)),
            min(ANALYSIS_WIDTH, max(1, int(np.ceil(x2 * sx)))),
            min(ANALYSIS_HEIGHT, max(1, int(np.ceil(y2 * sy)))),
        )
    return result


def rgb_to_gray(rgb: np.ndarray) -> np.ndarray:
    # Integer BT.601 approximation, fast and deterministic.
    values = rgb.astype(np.uint16)
    return ((77 * values[..., 0] + 150 * values[..., 1] + 29 * values[..., 2]) >> 8).astype(np.uint8)


def color_masks(patch: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    values = patch.astype(np.float32) / 255.0
    maximum = values.max(axis=-1)
    minimum = values.min(axis=-1)
    saturation = np.divide(
        maximum - minimum,
        np.maximum(maximum, 1e-6),
        out=np.zeros_like(maximum),
        where=maximum > 0,
    )
    red = values[..., 0]
    green = values[..., 1]
    blue = values[..., 2]

    # The reference background is green/teal. Exclude moderate-dark pixels
    # dominated by green while keeping bright, saturated lime tiles.
    background_green = (green > red * 1.08) & (green > blue * 1.08) & (maximum < 0.83)
    saturated_tile = (saturation > 0.37) & (maximum > 0.47) & ~background_green
    lime_tile = (green > 0.58) & (red < 0.58) & (blue < 0.48) & (saturation > 0.40)
    tile_like = saturated_tile | lime_tile
    white = (saturation < 0.18) & (maximum > 0.86)
    bright_color = (saturation > 0.33) & (maximum > 0.82)
    return tile_like, white, bright_color


def decode_features(video: Path, metadata: VideoMetadata) -> dict[str, np.ndarray]:
    ffmpeg = require_executable("ffmpeg")
    rois = scaled_rois(metadata.width, metadata.height)
    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-vsync",
        "0",
        "-i",
        str(video),
        "-an",
        "-vf",
        f"scale={ANALYSIS_WIDTH}:{ANALYSIS_HEIGHT}:flags=fast_bilinear",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, bufsize=32 * 1024 * 1024)
    if process.stdout is None:
        raise RuntimeError("ffmpeg did not provide stdout.")

    frame_size = ANALYSIS_WIDTH * ANALYSIS_HEIGHT * 3
    batch_frames = 180
    previous_gray: dict[str, np.ndarray] = {}
    chunks: dict[str, list[np.ndarray]] = {
        "board_diff": [],
        "rack_diff": [],
        "score_diff": [],
        "feedback_diff": [],
        "board_bright": [],
        "board_white_frac": [],
        "center_feedback_white_frac": [],
        "center_feedback_bright_color_frac": [],
        "between_board_rack_tile_frac": [],
        "rack_tile_frac": [],
        "full_dark_frac": [],
    }

    pending = bytearray()
    frame_count = 0
    while True:
        raw = process.stdout.read(frame_size * batch_frames)
        if raw:
            pending.extend(raw)
        complete_frames = len(pending) // frame_size
        if complete_frames == 0:
            if not raw:
                break
            continue

        count = min(batch_frames, complete_frames)
        byte_count = count * frame_size
        batch_bytes = bytes(pending[:byte_count])
        del pending[:byte_count]
        rgb = np.frombuffer(batch_bytes, dtype=np.uint8).reshape(
            count,
            ANALYSIS_HEIGHT,
            ANALYSIS_WIDTH,
            3,
        )
        gray = rgb_to_gray(rgb)

        for name, feature_name in (
            ("board", "board_diff"),
            ("rack", "rack_diff"),
            ("score", "score_diff"),
            ("center_feedback", "feedback_diff"),
        ):
            x1, y1, x2, y2 = rois[name]
            patch = gray[:, y1:y2, x1:x2]
            differences = np.empty(count, dtype=np.float32)
            previous = previous_gray.get(name)
            differences[0] = 0.0 if previous is None else float(
                np.abs(patch[0].astype(np.int16) - previous.astype(np.int16)).mean()
            )
            if count > 1:
                differences[1:] = np.abs(
                    patch[1:].astype(np.int16) - patch[:-1].astype(np.int16)
                ).mean(axis=(1, 2))
            chunks[feature_name].append(differences)
            previous_gray[name] = patch[-1].copy()

        bx1, by1, bx2, by2 = rois["board"]
        board_gray = gray[:, by1:by2, bx1:bx2]
        chunks["board_bright"].append((board_gray > 220).mean(axis=(1, 2), dtype=np.float32))
        chunks["full_dark_frac"].append((gray < 45).mean(axis=(1, 2), dtype=np.float32))

        for name, feature_names in (
            ("board", (None, "board_white_frac", None)),
            ("center_feedback", (None, "center_feedback_white_frac", "center_feedback_bright_color_frac")),
            ("between_board_rack", ("between_board_rack_tile_frac", None, None)),
            ("rack", ("rack_tile_frac", None, None)),
        ):
            x1, y1, x2, y2 = rois[name]
            patch = rgb[:, y1:y2, x1:x2]
            tile_like, white, bright_color = color_masks(patch)
            tile_name, white_name, bright_name = feature_names
            if tile_name:
                chunks[tile_name].append(tile_like.mean(axis=(1, 2), dtype=np.float32))
            if white_name:
                chunks[white_name].append(white.mean(axis=(1, 2), dtype=np.float32))
            if bright_name:
                chunks[bright_name].append(bright_color.mean(axis=(1, 2), dtype=np.float32))

        frame_count += count
        if frame_count // 3000 != (frame_count - count) // 3000:
            print(f"decoded {frame_count} frames", file=sys.stderr, flush=True)

        if not raw and not pending:
            break

    if pending:
        raise RuntimeError(f"Truncated raw frame payload: {len(pending)} trailing bytes.")
    return_code = process.wait()
    if return_code != 0:
        raise RuntimeError(f"ffmpeg exited with code {return_code}.")
    if frame_count == 0:
        raise RuntimeError("No frames decoded.")
    return {
        name: np.concatenate(values).astype(np.float32, copy=False)
        for name, values in chunks.items()
    }


def rolling_mean(values: np.ndarray, window: int) -> np.ndarray:
    kernel = np.ones(window, dtype=np.float32)
    total = np.convolve(values, kernel, mode="same")
    counts = np.convolve(np.ones_like(values), kernel, mode="same")
    return total / np.maximum(counts, 1)


def rolling_stat(values: np.ndarray, window: int, reducer: Callable[[np.ndarray], float]) -> np.ndarray:
    radius_left = window // 2
    radius_right = window - radius_left
    output = np.empty_like(values, dtype=np.float32)
    for index in range(len(values)):
        start = max(0, index - radius_left)
        end = min(len(values), index + radius_right)
        output[index] = reducer(values[start:end])
    return output


def rolling_max(values: np.ndarray, window: int) -> np.ndarray:
    return rolling_stat(values, window, lambda chunk: float(np.max(chunk)))


def rolling_median(values: np.ndarray, window: int) -> np.ndarray:
    return rolling_stat(values, window, lambda chunk: float(np.median(chunk)))


def fill_short_gaps(mask: np.ndarray, maximum_gap: int) -> np.ndarray:
    result = mask.copy()
    index = 0
    while index < len(result):
        if result[index]:
            index += 1
            continue
        start = index
        while index < len(result) and not result[index]:
            index += 1
        if start > 0 and index < len(result) and index - start <= maximum_gap:
            result[start:index] = True
    return result


def remove_short_runs(mask: np.ndarray, minimum_length: int) -> np.ndarray:
    result = mask.copy()
    index = 0
    while index < len(result):
        if not result[index]:
            index += 1
            continue
        start = index
        while index < len(result) and result[index]:
            index += 1
        if index - start < minimum_length:
            result[start:index] = False
    return result


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return mask.copy()
    kernel = np.ones(radius * 2 + 1, dtype=np.int16)
    return np.convolve(mask.astype(np.int16), kernel, mode="same") > 0


def clean(mask: np.ndarray, *, gap: int = 0, minimum_length: int = 1, dilation: int = 0) -> np.ndarray:
    result = mask.copy()
    if gap:
        result = fill_short_gaps(result, gap)
    if minimum_length > 1:
        result = remove_short_runs(result, minimum_length)
    if dilation:
        result = dilate(result, dilation)
    return result


def runs(mask: np.ndarray) -> Iterable[tuple[int, int]]:
    index = 0
    while index < len(mask):
        if not mask[index]:
            index += 1
            continue
        start = index
        while index < len(mask) and mask[index]:
            index += 1
        yield start, index - 1


def classify(features: dict[str, np.ndarray]) -> tuple[list[dict[str, Any]], dict[str, np.ndarray]]:
    board_diff = rolling_mean(features["board_diff"], 5)
    rack_diff = rolling_mean(features["rack_diff"], 5)
    score_diff = rolling_max(features["score_diff"], 5)
    feedback_diff = rolling_mean(features["feedback_diff"], 5)
    board_bright = rolling_max(features["board_bright"], 5)
    board_white = rolling_max(features["board_white_frac"], 5)
    feedback_white = rolling_max(features["center_feedback_white_frac"], 5)
    feedback_color = rolling_max(features["center_feedback_bright_color_frac"], 5)
    between = features["between_board_rack_tile_frac"]
    between_delta = between - rolling_median(between, 61)
    rack_tile = features["rack_tile_frac"]

    endgame = clean(features["full_dark_frac"] > 0.12, gap=2, minimum_length=3)
    clear = clean(
        (board_bright > 0.027)
        | (board_white > 0.018)
        | ((board_diff > 4.5) & (score_diff > 3.0)),
        gap=18,
        minimum_length=5,
        dilation=3,
    ) & ~endgame
    score = clean(score_diff > 0.65, gap=10, minimum_length=3, dilation=2) & ~endgame
    board_motion = clean(board_diff > 0.55, gap=7, minimum_length=3, dilation=2) & ~endgame
    rack_motion = clean(rack_diff > 0.22, gap=8, minimum_length=2, dilation=2) & ~endgame
    feedback = clean(
        (feedback_white > 0.012) | ((feedback_color > 0.27) & (feedback_diff > 1.5)),
        gap=16,
        minimum_length=4,
        dilation=2,
    ) & ~endgame
    drag = clean(
        (between_delta > 0.035) | (between > 0.19),
        gap=12,
        minimum_length=5,
        dilation=2,
    ) & ~clear & ~endgame

    refresh_seed = np.zeros(len(board_diff), dtype=bool)
    for index in range(8, len(refresh_seed) - 8):
        before = float(np.median(rack_tile[max(0, index - 20):max(1, index - 5)]))
        after = float(np.median(rack_tile[index + 5:min(len(rack_tile), index + 22)]))
        if before < 0.045 and after - before > 0.035 and rack_diff[index] > 0.08:
            refresh_seed[index] = True
    tray_refresh = clean(refresh_seed, gap=30, minimum_length=1, dilation=20) & ~endgame
    placement = (score | board_motion) & ~clear & ~drag & ~tray_refresh & ~endgame

    primary: list[str] = []
    active_systems: list[tuple[str, ...]] = []
    for index in range(len(board_diff)):
        systems = ["scene.base"]
        if board_motion[index]: systems.append("board.motion")
        if score[index]: systems.append("hud.score-transition")
        if rack_motion[index]: systems.append("tray.motion")
        if drag[index]: systems.append("interaction.drag-or-pickup")
        if tray_refresh[index]: systems.append("tray.refresh")
        if clear[index]: systems.append("clear.presentation")
        if feedback[index]: systems.append("feedback.overlay")
        if endgame[index]: systems.append("endgame.modal")
        active_systems.append(tuple(systems))

        if endgame[index]: state = "endgame-modal"
        elif clear[index] and feedback[index]: state = "clear-plus-feedback"
        elif clear[index]: state = "clear-presentation"
        elif drag[index]: state = "piece-manipulation"
        elif tray_refresh[index]: state = "tray-refresh"
        elif placement[index]: state = "placement-resolution"
        elif board_motion[index] or rack_motion[index] or score[index] or feedback[index]: state = "active-transition"
        else: state = "steady-play"
        primary.append(state)

    compressed: list[tuple[int, int, tuple[str, tuple[str, ...]]]] = []
    start = 0
    key = (primary[0], active_systems[0])
    for index in range(1, len(primary)):
        current = (primary[index], active_systems[index])
        if current != key:
            compressed.append((start, index - 1, key))
            start = index
            key = current
    compressed.append((start, len(primary) - 1, key))

    changed = True
    while changed:
        changed = False
        merged: list[tuple[int, int, tuple[str, tuple[str, ...]]]] = []
        index = 0
        while index < len(compressed):
            start, end, current_key = compressed[index]
            if (
                end - start + 1 < 3
                and index > 0
                and index + 1 < len(compressed)
                and merged[-1][2] == compressed[index + 1][2]
            ):
                previous_start, _, previous_key = merged.pop()
                _, next_end, _ = compressed[index + 1]
                merged.append((previous_start, next_end, previous_key))
                index += 2
                changed = True
            else:
                merged.append((start, end, current_key))
                index += 1
        compressed = merged

    intervals = [
        {
            "id": f"frame-state-{serial:04d}",
            "startFrame": int(start),
            "endFrame": int(end),
            "primaryState": state,
            "activeSystems": list(systems),
            "confidence": "machine-high" if state == "steady-play" else "machine-derived",
        }
        for serial, (start, end, (state, systems)) in enumerate(compressed)
    ]
    masks = {
        "score": score,
        "drag": drag,
        "clear": clear,
        "tray_refresh": tray_refresh,
        "feedback": feedback,
        "endgame": endgame,
        "salience": features["board_diff"] + features["feedback_diff"] + features["score_diff"] * 0.2,
        "board_bright": features["board_bright"],
    }
    return intervals, masks


def add_times(records: list[dict[str, Any]], fps: float) -> None:
    for record in records:
        record["startTimeSeconds"] = round(record["startFrame"] / fps, 6)
        record["endTimeSeconds"] = round((record["endFrame"] + 1) / fps, 6)


def events_from_mask(
    mask: np.ndarray,
    event_type: str,
    prefix: str,
    salience: np.ndarray,
    fps: float,
    metadata: Callable[[int, int], dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for serial, (start, end) in enumerate(runs(mask), 1):
        peak = start + int(np.argmax(salience[start:end + 1]))
        event: dict[str, Any] = {
            "id": f"{prefix}-{serial:04d}",
            "type": event_type,
            "startFrame": int(start),
            "peakFrame": int(peak),
            "endFrame": int(end),
            "confidence": "machine-candidate",
            "reviewStatus": "unreviewed",
        }
        if metadata:
            event.update(metadata(start, end))
        output.append(event)
    add_times(output, fps)
    return output


def load_manual_events(path: Path, source_sha: str, frame_count: int, fps: float) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    expected_sha = payload.get("sourceVideoSha256")
    if expected_sha and expected_sha != source_sha:
        raise RuntimeError(
            f"Manual review source SHA does not match video: {expected_sha} != {source_sha}"
        )
    events: list[dict[str, Any]] = []
    for raw in payload.get("events", []):
        start = int(raw["startFrame"])
        peak = int(raw["peakFrame"])
        end = int(raw["endFrame"])
        if not (0 <= start <= peak <= end < frame_count):
            raise RuntimeError(f"Manual event is outside source bounds: {raw.get('id')}")
        events.append({
            **raw,
            "startFrame": start,
            "peakFrame": peak,
            "endFrame": end,
            "confidence": "manual-reviewed",
            "reviewStatus": "reviewed",
        })
    add_times(events, fps)
    return events


def validate_coverage(intervals: list[dict[str, Any]], frame_count: int) -> None:
    expected = 0
    for interval in intervals:
        if interval["startFrame"] != expected:
            raise RuntimeError(
                f"Frame coverage gap/overlap before {interval['id']}: expected {expected}, "
                f"found {interval['startFrame']}"
            )
        if interval["endFrame"] < interval["startFrame"]:
            raise RuntimeError(f"Invalid interval: {interval['id']}")
        expected = interval["endFrame"] + 1
    if expected != frame_count:
        raise RuntimeError(f"Coverage ends at {expected - 1}, expected {frame_count - 1}.")


def main() -> int:
    arguments = parse_args()
    video = arguments.video.expanduser().resolve()
    if not video.is_file():
        raise FileNotFoundError(video)

    metadata = probe_video(video)
    features = decode_features(video, metadata)
    frame_count = len(features["board_diff"])
    fps = metadata.nominal_fps
    intervals, masks = classify(features)
    validate_coverage(intervals, frame_count)
    add_times(intervals, fps)

    events: list[dict[str, Any]] = []
    salience = masks["salience"]
    events.extend(events_from_mask(masks["score"], "score-animation-window", "score", salience, fps))
    events.extend(events_from_mask(masks["drag"], "piece-manipulation-window", "drag", salience, fps))
    events.extend(events_from_mask(
        masks["clear"],
        "clear-presentation-window",
        "clear",
        salience,
        fps,
        metadata=lambda start, end: {
            "maxBoardBrightFraction": round(float(np.max(masks["board_bright"][start:end + 1])), 6)
        },
    ))
    events.extend(events_from_mask(masks["tray_refresh"], "tray-refresh-window", "refresh", salience, fps))
    events.extend(events_from_mask(masks["feedback"], "feedback-overlay-window", "feedback", salience, fps))
    events.extend(events_from_mask(masks["endgame"], "endgame-modal", "endgame", salience, fps))
    if not arguments.skip_manual_review:
        events.extend(load_manual_events(arguments.manual_review, metadata.sha256, frame_count, fps))
    events.sort(key=lambda event: (event["startFrame"], event["type"], event["id"]))

    covered_frames = sum(interval["endFrame"] - interval["startFrame"] + 1 for interval in intervals)
    state_index = {
        "schemaVersion": "1.0.0",
        "pipelineVersion": PIPELINE_VERSION,
        "sourceVideo": {
            "fileName": metadata.file_name,
            "sha256": metadata.sha256,
            "width": metadata.width,
            "height": metadata.height,
            "nominalFps": round(fps, 6),
            "frameCount": frame_count,
            "durationSeconds": round(frame_count / fps, 6),
        },
        "analysisMethod": {
            "coverage": "every decoded source frame",
            "frameSampling": "none",
            "featureFrameSize": [ANALYSIS_WIDTH, ANALYSIS_HEIGHT],
            "machinePass": [
                "ROI frame difference",
                "brightness/white-pixel activity",
                "rack tile-mass change",
                "board/rack/score/feedback tracks",
            ],
            "manualReview": [
                "whole-video contact sheet",
                "salience peaks",
                "dense representative event windows",
            ],
            "semanticCaveat": (
                "Machine-derived intervals provide complete temporal coverage and event candidates; "
                "they are not pixel-perfect manual labels. Reviewed events are marked separately."
            ),
        },
        "coverage": {
            "firstFrame": 0,
            "lastFrame": frame_count - 1,
            "coveredFrames": covered_frames,
            "gapFrames": 0,
            "overlapFrames": 0,
            "intervalCount": len(intervals),
        },
        "stateVocabulary": sorted({interval["primaryState"] for interval in intervals}),
        "intervals": intervals,
    }
    event_index = {
        "schemaVersion": "1.0.0",
        "pipelineVersion": PIPELINE_VERSION,
        "sourceVideoSha256": metadata.sha256,
        "eventCount": len(events),
        "reviewedEventCount": sum(event.get("reviewStatus") == "reviewed" for event in events),
        "events": events,
    }

    arguments.output_dir.mkdir(parents=True, exist_ok=True)
    (arguments.output_dir / "FULL_FRAME_STATE_INDEX_V1.json").write_text(
        json.dumps(state_index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (arguments.output_dir / "EVENT_INSTANCE_INDEX_V1.json").write_text(
        json.dumps(event_index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if arguments.keep_features:
        np.savez_compressed(arguments.output_dir / "frame_features.npz", **features)

    print(json.dumps({
        "video": str(video),
        "sha256": metadata.sha256,
        "frames": frame_count,
        "fps": fps,
        "intervals": len(intervals),
        "events": len(events),
        "reviewedEvents": event_index["reviewedEventCount"],
        "outputDir": str(arguments.output_dir),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(f"reference audit failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
