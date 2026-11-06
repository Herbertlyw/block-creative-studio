#!/usr/bin/env python3
"""Measure a local CFR source and optionally extract exact, unreviewed frames."""
import argparse
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def run(*args):
    return subprocess.run(args, check=True, capture_output=True)


def inspect(source):
    data = json.loads(run('ffprobe', '-v', 'error', '-show_streams', '-show_format',
                          '-show_frames', '-select_streams', 'v:0',
                          '-show_entries', 'stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,time_base:format=duration:frame=best_effort_timestamp',
                          '-of', 'json', str(source)).stdout)
    stream = data['streams'][0]
    rate = Fraction(stream['avg_frame_rate'])
    timebase = Fraction(stream['time_base'])
    if rate <= 0 or timebase <= 0:
        raise ValueError('无法确定有效帧率或时间基准')
    timestamps = [int(frame['best_effort_timestamp']) for frame in data.get('frames', [])]
    if len(timestamps) < 2:
        raise ValueError('视频不足两帧或缺少帧时间戳')
    # Half a tick permits rounding to the nearest representable timestamp.
    first = timestamps[0]
    for index, pts in enumerate(timestamps):
        if index and pts <= timestamps[index - 1]:
            raise ValueError(f'帧 {index} 的时间戳重复或倒退')
        if abs((pts - first) * timebase - Fraction(index, 1) / rate) > timebase / 2 + Fraction(1, 10**9):
            raise ValueError(f'检测到变帧率或不连续时间戳（帧 {index}）；暂不支持精确映射')
    audio = json.loads(run('ffprobe', '-v', 'error', '-select_streams', 'a', '-show_entries',
                           'stream=index,codec_name,sample_rate,channels', '-of', 'json', str(source)).stdout)['streams']
    run('ffmpeg', '-v', 'error', '-xerror', '-i', str(source), '-map', '0:v:0', '-f', 'null', '-')
    digest = hashlib.sha256()
    with source.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(chunk)
    return {'version': '1.0.0', 'source': {'name': source.name, 'sha256': digest.hexdigest(),
            'width': stream['width'], 'height': stream['height'], 'codec': stream['codec_name'],
            'fps': str(rate), 'frameCount': len(timestamps), 'firstTimestamp': first,
            'timeBase': str(timebase), 'durationSeconds': data.get('format', {}).get('duration'),
            'audio': audio}, 'timing': {'mode': 'constant', 'timestampTicks': timestamps},
            'observations': [], 'candidates': [], 'manualApproval': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('video', type=Path)
    parser.add_argument('--output-dir', type=Path, required=True, help='新建输出目录，不覆盖已有结果')
    parser.add_argument('--frames', default='', help='逗号分隔的零基帧号')
    args = parser.parse_args()
    result = inspect(args.video)
    frames = sorted({int(i) for i in args.frames.split(',') if i.strip()})
    if any(i < 0 or i >= result['source']['frameCount'] for i in frames):
        raise ValueError('请求帧超出范围')
    args.output_dir.mkdir(parents=True, exist_ok=False)
    for frame in frames:
        path = args.output_dir / f'frame-{frame:06d}.png'
        run('ffmpeg', '-v', 'error', '-xerror', '-i', str(args.video), '-vf',
            f'select=eq(n\\,{frame})', '-fps_mode', 'passthrough', '-frames:v', '1', str(path))
        result['observations'].append({'frame': frame, 'sourceTimestampTicks': result['timing']['timestampTicks'][frame],
             'file': path.name, 'origin': 'author-selected-frame', 'confidence': 'unreviewed', 'confirmed': False})
    (args.output_dir / 'measurement.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'source': result['source'], 'selectedFrames': frames, 'manualApproval': False}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, ZeroDivisionError, subprocess.CalledProcessError) as exc:
        detail = exc.stderr.decode(errors='replace').strip() if isinstance(exc, subprocess.CalledProcessError) and exc.stderr else str(exc)
        print(f'视频检查失败：{detail}', file=sys.stderr)
        sys.exit(1)
