/* route-constraints.test.mjs — the second result must never become the first.
 *
 * The checks that matter here are the refusals: a moved engine, an unreachable
 * one, a wrong schema, and a route the engine will not estimate. In every one
 * of those the direct first pass must still be returned intact, because it is a
 * measurement and it does not stop being one because the constrained result
 * failed.
 *
 * The engine is stubbed. This test proves the CARTRIDGE's contract — pinning,
 * verification, refusal and the preserved first pass. The mathematics itself is
 * proven in ventus-grid-engine by proofs/route-obstacles.proof.mjs, and
 * duplicating those assertions here would create exactly the second copy this
 * cartridge exists to avoid.
 *
 * Run: node tools/route-constraints.test.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import * as rc from '../src/route-constraints/route-constraints.js';

const here = dirname(fileURLToPath(import.meta.url));
const pinPath = join(here, '..', 'src', 'route-constraints', 'engine-pin.json');
const pin = JSON.parse(readFileSync(pinPath, 'utf8'));

const failures = [];
let passed = 0;
const check = (n, c) => { c ? passed += 1 : failures.push(n); };

/* A stand-in for the engine module, with the shape the cartridge relies on. */
const STUB_SOURCE = 'export const schema = "ventus-grid-engine.route-obstacles.v1";\n';
const STUB_SHA = createHash('sha256').update(STUB_SOURCE).digest('hex');

function stubEngine({ blocked = false } = {}) {
    return {
        schema: 'ventus-grid-engine.route-obstacles.v1',
        routeEstimate({ straightLineKm, crossings, corridorFactor }) {
            const undeclared = crossings.filter(c => c.widthM === undefined).map(c => c.type);
            if (blocked) {
                return { value: null, straightLineKm, schedule: { undeclaredLengths: undeclared, blockedBy: ['Open water / sea'] },
                    basis: 'blocked by open water' };
            }
            return { value: straightLineKm * corridorFactor, straightLineKm,
                schedule: { undeclaredLengths: undeclared, blockedBy: [] }, basis: 'ok' };
        }
    };
}

/* A fetch that serves our pin and our stub, with the pin's hash rewritten so
   the happy path verifies. */
function fetchFor({ source = STUB_SOURCE, sha = STUB_SHA, status = 200 } = {}) {
    const patched = { ...pin, engine: { ...pin.engine, contentSha256: sha } };
    return async (url) => {
        const s = String(url);
        if (s.endsWith('engine-pin.json')) return { ok: true, json: async () => patched };
        return { ok: status === 200, status, text: async () => source };
    };
}

/* ── The pin itself. ────────────────────────────────────────────────────── */

check('the pin names an exact engine commit, blob and content hash',
    /^[0-9a-f]{40}$/.test(pin.engine.commit)
    && /^[0-9a-f]{40}$/.test(pin.engine.gitBlob)
    && /^[0-9a-f]{64}$/.test(pin.engine.contentSha256));

check('the pin states that the direct first pass remains unchanged',
    /never a replacement/i.test(pin.firstPass.statement)
    && /stage 3/i.test(pin.firstPass.statement));

check('the pin explains why bytes are pinned rather than a URL trusted',
    /pins bytes, not URLs/i.test(pin.why));

/* ── The first pass, always. ────────────────────────────────────────────── */

check('the direct first pass returns the distance it was given, unmodified',
    rc.directFirstPass({ straightLineKm: 142.21 }).value === 142.21);

check('the first pass says in words that it is not a route',
    /is not a route/i.test(rc.directFirstPass({ straightLineKm: 10 }).basis));

/* ── Happy path. ────────────────────────────────────────────────────────── */
{
    rc.reset();
    const loaded = await rc.load({ fetchImpl: fetchFor(), importImpl: async () => stubEngine() });
    check('a module whose bytes match the pin loads', loaded.state === 'ready');

    const a = await rc.assess({ straightLineKm: 10, crossings: [{ type: 'motorway', widthM: 30, setbackM: 15 }], corridorFactor: 1.245, loaded });
    check('an assessed route returns both the first pass and the constrained result',
        a.state === 'assessed' && a.firstPass.value === 10
        && Math.abs(a.constrained.value - 12.45) < 1e-9);
    check('the engine commit travels with the answer', a.engineCommit === pin.engine.commit);
    check('a fully declared route reports declared coverage', a.coverage.state === 'declared');
    check('the note keeps the screening caveat and says it never replaces the first pass',
        /never in place of it/i.test(a.note));
}

/* ── Unknown coverage is a state, not a zero. ───────────────────────────── */
{
    rc.reset();
    const loaded = await rc.load({ fetchImpl: fetchFor(), importImpl: async () => stubEngine() });
    const a = await rc.assess({ straightLineKm: 10, crossings: [{ type: 'railway' }], corridorFactor: 1.245, loaded });
    check('a crossing with no width declared reports UNKNOWN coverage and names it',
        a.coverage.state === 'unknown' && a.coverage.undeclared.includes('railway'));
    check('the coverage note says unknown coverage is a state and not a zero',
        /state, not a zero/i.test(a.coverage.note));
}

/* ── The engine refusing is not the cartridge failing. ──────────────────── */
{
    rc.reset();
    const loaded = await rc.load({ fetchImpl: fetchFor(), importImpl: async () => stubEngine({ blocked: true }) });
    const a = await rc.assess({ straightLineKm: 142.21, crossings: [{ type: 'open_water' }], corridorFactor: 1.245, loaded });
    check('a route the engine will not estimate returns no-result, not an error',
        a.state === 'no-result' && a.constrained.value === null);
    check('and the direct first pass is STILL returned intact, because it is a measurement',
        a.firstPass.value === 142.21);
    check('the note says the first pass stands and is unchanged',
        /first pass above stands and is unchanged/i.test(a.note));
}

/* ── Integrity failures. Each must refuse, and each must keep the first pass. ── */
{
    rc.reset();
    const moved = await rc.load({
        fetchImpl: fetchFor({ source: 'export const schema = "something-else";\n' }),
        importImpl: async () => stubEngine()
    });
    check('a module whose bytes differ from the pin is REFUSED', moved.state === 'refused');
    check('the refusal says the engine has moved and names the pinned commit',
        /does not match the pinned bytes/i.test(moved.reason) && moved.reason.includes(pin.engine.commit.slice(0, 7)));
    check('the refusal says a route assessment must not change because a dependency changed',
        /must not change because a\s+dependency changed/i.test(moved.reason.replace(/\s+/g, ' '))
        || /must not change because a dependency changed/i.test(moved.reason.replace(/\s+/g, ' ')));

    const a = await rc.assess({ straightLineKm: 55, crossings: [], corridorFactor: 1.245, loaded: moved });
    check('after a pin mismatch the assessment refuses but STILL returns the first pass',
        a.state === 'refused' && a.firstPass.value === 55 && a.constrained === null);
    check('the refusal note says only the second result is unavailable',
        /Only the constraint-aware\s+second result is unavailable/i.test(a.note.replace(/\s+/g, ' '))
        || /only the constraint-aware second result is unavailable/i.test(a.note.replace(/\s+/g, ' ')));
}

{
    rc.reset();
    const down = await rc.load({ fetchImpl: fetchFor({ status: 503 }), importImpl: async () => stubEngine() });
    check('an unreachable engine is refused with its HTTP status',
        down.state === 'refused' && /HTTP 503/.test(down.reason));
}

{
    rc.reset();
    const wrongSchema = await rc.load({
        fetchImpl: fetchFor(),
        importImpl: async () => ({ schema: 'ventus-grid-engine.route-obstacles.v2', routeEstimate: () => ({}) })
    });
    check('a module with an unexpected schema is refused even when its bytes hash correctly',
        wrongSchema.state === 'refused' && /declares schema/i.test(wrongSchema.reason));
}

/* ── The boundary. ──────────────────────────────────────────────────────── */
{
    const callable = Object.keys(rc).filter(k => typeof rc[k] === 'function');
    check('the cartridge exposes no router, optimiser or pricing function',
        callable.every(n => !/route(r|Find)|optimi[sz]e|cost|price|permit/i.test(n)));
    check('what is not implemented is stated, not left as an empty space',
        ['automatedRouting', 'cost', 'permission'].every(k => k in rc.NOT_IMPLEMENTED));
    check('the cartridge holds no copy of the crossing mathematics',
        !readFileSync(join(here, '..', 'src', 'route-constraints', 'route-constraints.js'), 'utf8')
            .match(/OBSTACLES\s*=|trenchless:\s*true/));
}

if (failures.length) {
    console.error('route-constraints test FAILED (' + failures.length + ' of '
        + (failures.length + passed) + '):\n- ' + failures.join('\n- '));
    process.exit(1);
}
console.log('route-constraints test PASS — ' + passed + ' checks');
