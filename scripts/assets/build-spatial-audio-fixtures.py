"""Original synthetic water/fire loops for the opt-in spatial audio example. Python stdlib only."""
from pathlib import Path
import math
import random
import struct
import wave

out = Path(__file__).resolve().parents[2] / 'examples' / 'data-scene-native' / 'assets' / 'audio'
out.mkdir(parents=True, exist_ok=True)
rate, count = 22050, 22050
for kind in ('water', 'fire'):
    rng, smooth, values = random.Random(713), 0.0, []
    for i in range(count):
        smooth = .92 * smooth + .08 * rng.uniform(-1, 1)
        value = smooth * .6 if kind == 'water' else smooth * .35 + .025 * math.sin(2 * math.pi * 180 * i / rate)
        # Equal taper at the loop boundary prevents a discontinuity.
        edge = min(1, i / 220, (count - 1 - i) / 220)
        values.append(struct.pack('<h', int(value * edge * 12000)))
    with wave.open(str(out / f'{kind}.wav'), 'wb') as audio:
        audio.setparams((1, 2, rate, count, 'NONE', 'not compressed'))
        audio.writeframes(b''.join(values))
