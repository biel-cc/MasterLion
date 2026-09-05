#!/usr/bin/env python3
"""Run all fireworks SVG checks and render PNGs with CairoSVG.

Requires cairosvg in the chosen Python runtime and a loadable Cairo library.
Usage: python3 render_exports.py /absolute/path/to/fireworks-tech-graph
"""
import json
import sys
from pathlib import Path

import cairosvg

OUT = Path(__file__).resolve().parent
sys.path.insert(0, str(Path(sys.argv[1]).resolve() / 'scripts'))
from validate_svg import run_check

results = {}
for file in sorted(OUT.glob('*.svg')):
    checks = {}
    for check in ('xml', 'markers', 'collisions', 'geometry', 'composition'):
        passed, details = run_check(file, check)
        checks[check] = {'ok': passed, 'details': details}
    if not all(item['ok'] for item in checks.values()):
        raise ValueError(f'{file.name}: {checks}')
    cairosvg.svg2png(url=str(file), write_to=str(file.with_suffix('.png')), output_width=2400)
    results[file.stem] = {'checks': checks, 'png_width': 2400, 'render_ok': True}
    print(file.name, 'PASS', flush=True)

(OUT / 'validation.json').write_text(json.dumps({
    'automated': results, 'renderer': 'CairoSVG', 'visual_review': 'pending'
}, ensure_ascii=False, indent=2) + '\n')
