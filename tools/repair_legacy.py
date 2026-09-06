"""Reconstruct the six-file legacy Cable UI from pinned Git bytes and repair paste syntax."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess

SOURCE_COMMIT = '9d364a218b91cf0fda1807bc9705a6616b63e62f'
FILES = ['index.html', 'app.js', 'data-core.js', 'data-lv.js', 'data-mv-hv.js', 'data-solar.js']
EXPECTED = {
    'app.js': {'ellipsis': 10, 'doubleQuotes': 762, 'singleQuotes': 12, 'fenceLines': 6},
    'data-core.js': {'ellipsis': 0, 'doubleQuotes': 10, 'singleQuotes': 0, 'fenceLines': 8},
    'data-lv.js': {'ellipsis': 0, 'doubleQuotes': 0, 'singleQuotes': 0, 'fenceLines': 2},
}

def repair(name, original):
    if name not in EXPECTED:
        return original, {}
    source = original.decode('utf-8')
    counts = {'ellipsis': source.count('\u2026'), 'doubleQuotes': source.count('\u201c') + source.count('\u201d'),
              'singleQuotes': source.count('\u2018') + source.count('\u2019'),
              'fenceLines': len(re.findall(r'^```\s*$', source, re.MULTILINE))}
    assert counts == EXPECTED[name], (name, counts)
    source = source.translate(str.maketrans({'\u2026': '...', '\u201c': '"', '\u201d': '"', '\u2018': "'", '\u2019': "'"}))
    source = re.sub(r'^```[^\S\n]*\n?', '', source, flags=re.MULTILINE)
    return source.encode('utf-8'), counts

def digest(data):
    return hashlib.sha256(data).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    generation = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M')
    destination = root / 'releases' / generation
    assert not destination.exists(), 'Immutable generation already exists'
    files = []
    for name in FILES:
        source_path = 'cable_geometry/' + name
        original = subprocess.check_output(['git', 'show', SOURCE_COMMIT + ':' + source_path], cwd=args.source)
        repaired, changes = repair(name, original)
        if name == 'index.html':
            assert repaired.count(b'</body>') == 1
            repaired = repaired.replace(b'</body>', b'<script src="drawing-view-exit.js"></script>\n</body>')
            changes = {'drawingViewExitCartridgeInsertion': 1}
        if name.endswith('.js'):
            subprocess.run(['node', '--check'], input=repaired, check=True)
        target = destination / 'legacy-cable-geometry' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(repaired)
        files.append({'path': 'legacy-cable-geometry/' + name, 'bytes': len(repaired), 'sha256': digest(repaired),
                      'sourcePath': source_path, 'sourceBytes': len(original), 'sourceSha256': digest(original), 'syntaxRepairs': changes})
    guard_path = 'src/legacy-cable/drawing-view-exit.js'
    guard = (root / guard_path).read_bytes().replace(b'\r\n', b'\n')
    (destination / 'legacy-cable-geometry/drawing-view-exit.js').write_bytes(guard)
    files.append({'path': 'legacy-cable-geometry/drawing-view-exit.js', 'bytes': len(guard), 'sha256': digest(guard), 'ownerSourcePath': guard_path})
    manifest = {'schema': 'cable.legacy-syntax-repair.v1', 'generation': generation,
                'sourceRepository': 'https://github.com/Ventusltd/globalgrid2050', 'sourceCommit': SOURCE_COMMIT,
                'scope': 'Restore the legacy Cable tool: remove pasted Markdown fences, restore JavaScript delimiters/operators, and keep an exit reachable in Drawing View. Equations, data values and design assumptions are retained.',
                'files': files, 'status': 'candidate awaiting actual browser and numerical checks'}
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'generation': generation, 'files': len(files)}))

if __name__ == '__main__':
    main()
