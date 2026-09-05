# Cable Trench or Drill

Owner of the standalone Cable Geometry Visualiser and future civil-route assessment cartridges. The first release preserves the original v7 tool's UI, calculations, drawing, export and browser print bytes. It does not implement automatic trench-versus-drill route selection.

The immutable baseline is imported from GlobalGrid commit `4185020ade7da01869b4ffc0ee1d2656608da716`. `latest.json` pins its manifest, and the manifest hashes each runtime file and its original Git blob. Module Layout and DC/AC Topology Review links remain separately owned by `layout-tool`; the consumer must compose those pinned sibling routes. No other tool implementation is duplicated here. An older historical Cable baseline remains in the immutable layout-tool release; new ownership moves here without rewriting that history.

Run `python -B tools/test_verify.py`, then `python -B tools/verify.py --source <globalgrid-checkout> --expected-origin 4185020ade7da01869b4ffc0ee1d2656608da716`. CI runs the same checks and retains a compact receipt. Byte/syntax verification does not establish engineering suitability or all browser behavior.

Read [DEVELOPMENT-PLAN.md](DEVELOPMENT-PLAN.md) for the distinct trenching and directional-drilling stages. Keep the existing direct first-pass engine unchanged.

## Derived render-readiness cartridge

`src/cable-geometry/render-readiness.js` observes the original snapshot after the three geometry canvases are drawn. `window.CableGeometryRender.getState()` reports pending, ready or failed, an observed-render revision, and SHA-256 of the exact original snapshot text. It never calls or replaces the geometry calculations. A ready receipt establishes snapshot completion, not an approved construction design.

`tools/derive_cable.py` composes a fresh, unique UTC-minute release from the committed baseline; it refuses an existing timestamp. `derived-latest.json` pins that derived manifest while `latest.json` continues to pin the original. Each derived manifest records the baseline commit, exact single script insertion, original member hashes and cartridge source. Original sibling navigation is resolved by the consuming layer package's explicit owner pins.

Run `python -B tools/test_verify_derived.py` and `python -B tools/verify_derived.py`. Chrome evidence is stored outside Git under `offline-screenshots/architecture-reload-20260905/next-fifty/cable-signal-preflight`: desktop and phone viewport tests check route-name blur, pending before render, snapshot hash equality, repeated redraw revisions, and actual canvas geometry. These preview checks are distinct from the subsequent deployed consumer tests.
