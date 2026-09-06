import argparse
import json
from pathlib import Path
import re
import subprocess
from repair_legacy import SOURCE_COMMIT, FILES, digest, repair

def verify(root, source, generation):
    def blob(repo, name, commit='HEAD'):
        return subprocess.check_output(['git', 'show', commit + ':' + name], cwd=repo)
    prefix = 'releases/' + generation + '/'
    manifest = json.loads(blob(root, prefix + 'manifest.json'))
    assert manifest['sourceCommit'] == SOURCE_COMMIT
    assert manifest['generation'] == generation
    expected_paths = {'legacy-cable-geometry/' + name for name in FILES} | {'legacy-cable-geometry/drawing-view-exit.js'}
    assert {entry['path'] for entry in manifest['files']} == expected_paths
    for entry in manifest['files']:
        actual = blob(root, prefix + entry['path'])
        assert len(actual) == entry['bytes'] and digest(actual) == entry['sha256'], entry['path']
        if 'sourcePath' in entry:
            original = blob(source, entry['sourcePath'], SOURCE_COMMIT)
            assert digest(original) == entry['sourceSha256'] and len(original) == entry['sourceBytes']
            expected, changes = repair(Path(entry['path']).name, original)
            if entry['path'].endswith('index.html'):
                expected = expected.replace(b'</body>', b'<script src="drawing-view-exit.js"></script>\n</body>')
                changes = {'drawingViewExitCartridgeInsertion': 1}
            assert changes == entry['syntaxRepairs']
        else:
            expected = blob(root, entry['ownerSourcePath'])
        assert actual == expected, entry['path']
        if entry['path'].endswith('.js'):
            subprocess.run(['node', '--check'], input=actual, check=True)
    html = blob(root, prefix + 'legacy-cable-geometry/index.html').decode('utf-8')
    scripts = re.findall(r'<script src="([^"]+)"', html)
    assert len(scripts) == 6 and {'legacy-cable-geometry/' + script for script in scripts} == expected_paths - {'legacy-cable-geometry/index.html'}
    print('PASS pinned legacy source, exact audited syntax changes, seven file hashes and complete script closure')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--generation', default='202609060432')
    args = parser.parse_args()
    verify(Path(__file__).resolve().parent.parent, args.source, args.generation)
