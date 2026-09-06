/**
 * route-constraints — the constraint-aware SECOND result.
 *
 * DEVELOPMENT-PLAN.md stage 3 says it plainly: "Keep direct connection/distance
 * as the first pass, always available. Manual or optional constraint-aware
 * routing remains a second result, not a replacement." This cartridge is that
 * second result, and it is built so it cannot become the first one — `assess()`
 * always returns the direct distance, unmodified, alongside whatever the
 * constraint assessment concludes, and the direct figure is present even when
 * the constrained one refuses.
 *
 * WHERE THE MATHEMATICS LIVES, AND WHY NOT HERE.
 * The crossing classification and geometry are `engine/route-obstacles.js` in
 * ventus-grid-engine. This cartridge carries no copy of them. A copy would
 * drift: the engine's proofs would go on passing against the engine while this
 * repository quietly computed something else, and the divergence would be
 * invisible because both would still look right.
 *
 * WHY THE BYTES ARE PINNED AND VERIFIED, NOT JUST FETCHED.
 * Reading a live URL trades one risk for another: no drift, but no control
 * either — an engine change would alter a route assessment here with nothing
 * recording that it had. So `engine-pin.json` records the exact commit, git
 * blob and SHA-256 this cartridge was proven against, and `load()` hashes what
 * it actually receives and refuses to proceed if it differs. That is this
 * repository's own discipline — it pins bytes, not URLs — applied to a
 * dependency it does not own.
 *
 * FAIL CLOSED, VISIBLY.
 * Every failure path returns a state and a reason. There is no silent fallback
 * to a local copy, no default corridor factor, and no partial answer dressed up
 * as a complete one. `unknown coverage` is a real state here, per stage 4:
 * a crossing declared without a width is counted and named, never costed at
 * zero, because a zero that looks like an answer is worse than no answer.
 */

const PIN_URL = new URL('./engine-pin.json', import.meta.url);

let cached = null;

async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Load and verify the pinned engine module.
 *
 * Resolves to { state: 'ready', engine, pin } or { state: 'refused', reason }.
 * It never throws for an integrity failure: a refusal is a result the caller
 * has to render, not an exception to swallow.
 */
export async function load({ fetchImpl = fetch, importImpl } = {}) {
    if (cached) return cached;

    let pin;
    try {
        pin = await (await fetchImpl(PIN_URL)).json();
    } catch (e) {
        return { state: 'refused', reason: `the engine pin could not be read: ${e.message}` };
    }

    const { servedUrl, contentSha256, schemaExpected, commit, module } = pin.engine;

    let text;
    try {
        const response = await fetchImpl(servedUrl, { cache: 'no-store' });
        if (!response.ok) {
            return { state: 'refused', reason: `the engine module returned HTTP ${response.status} from ${servedUrl}` };
        }
        text = await response.text();
    } catch (e) {
        return { state: 'refused', reason: `the engine module could not be fetched: ${e.message}` };
    }

    const actual = await sha256Hex(text);
    if (actual !== contentSha256) {
        return {
            state: 'refused',
            reason:
                `the engine module served from ${servedUrl} does not match the pinned bytes. ` +
                `Pinned ${contentSha256.slice(0, 12)}… at commit ${commit.slice(0, 7)}, received ${actual.slice(0, 12)}…. ` +
                `The engine has moved since this cartridge was proven against it. Re-verify ${module} ` +
                `and update engine-pin.json deliberately — a route assessment must not change because a ` +
                `dependency changed underneath it.`
        };
    }

    let engine;
    try {
        engine = importImpl ? await importImpl(servedUrl) : await import(/* @vite-ignore */ servedUrl);
    } catch (e) {
        return { state: 'refused', reason: `the engine module hashed correctly but did not import: ${e.message}` };
    }

    if (engine.schema !== schemaExpected) {
        return {
            state: 'refused',
            reason: `the engine module declares schema "${engine.schema}", the pin expects "${schemaExpected}"`
        };
    }

    cached = { state: 'ready', engine, pin };
    return cached;
}

/** Discard the cached module. Used by tests and after a pin change. */
export function reset() { cached = null; }

/**
 * The first pass, preserved.
 *
 * Returned by `assess()` unconditionally, including when the constrained
 * assessment refuses. It is a measurement and it does not stop being one
 * because a route is difficult.
 */
export function directFirstPass({ straightLineKm }) {
    return {
        quantity: 'direct_distance_km',
        value: straightLineKm,
        unit: 'km',
        basis:
            'The direct point-to-point distance. This is the first pass and is always available. ' +
            'It is not a route and does not claim to be; it is the measurement every other figure ' +
            'here is derived from.'
    };
}

/**
 * The second result: direct first pass, plus a constraint-aware assessment.
 *
 * `crossings` are DECLARED by the user, per stage 3's "manual or optional
 * constraint-aware routing". Nothing here discovers a constraint from a map.
 */
export async function assess({ straightLineKm, crossings = [], corridorFactor, loaded = null }) {
    const first = directFirstPass({ straightLineKm });
    const mod = loaded || await load();

    if (mod.state !== 'ready') {
        return {
            state: 'refused',
            firstPass: first,
            constrained: null,
            reason: mod.reason,
            note:
                'The direct first pass above is unaffected and remains valid. Only the constraint-aware ' +
                'second result is unavailable.'
        };
    }

    let estimate;
    try {
        estimate = mod.engine.routeEstimate({ straightLineKm, crossings, corridorFactor });
    } catch (e) {
        return {
            state: 'refused', firstPass: first, constrained: null,
            reason: `the engine refused these inputs: ${e.message}`,
            note: 'The direct first pass above is unaffected and remains valid.'
        };
    }

    const undeclared = estimate.schedule.undeclaredLengths;
    return {
        state: estimate.value === null ? 'no-result' : 'assessed',
        firstPass: first,
        constrained: estimate,
        coverage: undeclared.length
            ? { state: 'unknown', undeclared,
                note: `${undeclared.length} declared crossing(s) carry no width or setback and contribute ` +
                      `no length: ${undeclared.join(', ')}. They are counted as present and explicitly not ` +
                      `costed. Unknown coverage is a state, not a zero.` }
            : { state: 'declared', undeclared: [], note: 'Every declared crossing carries a width and a setback.' },
        engineCommit: mod.pin.engine.commit,
        note:
            estimate.value === null
                ? 'No constrained result: the engine refused to apply a corridor factor to this route. ' +
                  'The direct first pass above stands and is unchanged.'
                : 'A screening estimate, presented beside the first pass and never in place of it. ' +
                  'Not a route, not a constructability assessment, not a consenting design.'
    };
}

export const NOT_IMPLEMENTED = Object.freeze({
    automatedRouting:
        'This cartridge does not find a route. Crossings are declared by the user. An automated router needs the route graph, land ownership, ground conditions and consenting constraints described in DEVELOPMENT-PLAN.md stage 4, none of which are present yet.',
    cost:
        'Stage 5 compares trenching and drilling alternatives including costs. No cost model exists here, and a length is not a price.',
    permission:
        'Whether a crossing is permitted is the asset owner\'s and regulator\'s answer. Network Rail asset protection alone commonly governs the programme regardless of engineering feasibility.'
});
