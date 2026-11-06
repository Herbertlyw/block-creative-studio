import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'scripts' / 'inspect-reference-video.py'


class ReferenceVideoInspection(unittest.TestCase):
    def test_cfr_and_vfr_and_missing_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cfr, vfr = root / 'cfr.mp4', root / 'vfr.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=128x96:rate=30:duration=1',
                            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(cfr)], check=True)
            subprocess.run(['ffmpeg', '-v', 'error', '-i', str(cfr), '-vf', r'select=not(eq(n\,3))',
                            '-fps_mode', 'passthrough', '-c:v', 'libx264', str(vfr)], check=True)
            cmd = ['python3', str(SCRIPT)]
            output = root / 'result'
            subprocess.run(cmd + [str(cfr), '--output-dir', str(output), '--frames', '0,12,29'], check=True, capture_output=True)
            result = json.loads((output / 'measurement.json').read_text())
            self.assertEqual(result['source']['frameCount'], 30)
            self.assertEqual(result['source']['audio'], [])
            self.assertFalse(result['manualApproval'])
            self.assertTrue(all(not item['confirmed'] for item in result['observations']))
            raw = lambda path: subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
            direct = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(cfr), '-vf', r'select=eq(n\,12)', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
            self.assertEqual(raw(output / 'frame-000012.png'), direct)
            failed = subprocess.run(cmd + [str(vfr), '--output-dir', str(root / 'vfr')], capture_output=True, text=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertIn('变帧率', failed.stderr)
            self.assertFalse((root / 'vfr').exists())
            self.assertNotEqual(subprocess.run(cmd + [str(cfr), '--output-dir', str(output)], capture_output=True).returncode, 0)


if __name__ == '__main__':
    unittest.main()
