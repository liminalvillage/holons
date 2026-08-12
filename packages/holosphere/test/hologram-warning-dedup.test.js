// The janitor-parseable "Hologram at <h>/<l>/<k> did not resolve" warning is
// deduped per (local path, soul) pair per session: a lens with cold or dead
// pointers used to re-warn on EVERY read attempt (each getAll, each subscribe
// fire, each timed re-resolve), burying the console. The line itself must
// keep firing once — a console-hook garbage collector parses it — but only
// once, until the pointer successfully resolves (which clears the memo so a
// future regression warns again).

import {
    warnHologramUnresolvedOnce,
    clearHologramUnresolvedWarning,
} from '../hologram.js';

const JANITOR_PATTERN =
    /^Hologram at ([^/]+)\/([^/]+)\/([^ ]+) did not resolve \(soul=([^)]+)\); skipping\.$/;

describe('unresolved-hologram warning dedup', () => {
    let warnings;
    let origWarn;

    beforeEach(() => {
        warnings = [];
        origWarn = console.warn;
        console.warn = (...args) => { if (typeof args[0] === 'string') warnings.push(args[0]); };
    });

    afterEach(() => {
        console.warn = origWarn;
    });

    test('warns once per (path, soul) pair, keeping the janitor-parseable shape', () => {
        const soul = 'app/source-holon/quests/q1';
        warnHologramUnresolvedOnce('holon-a', 'quests', 'q1', soul);
        warnHologramUnresolvedOnce('holon-a', 'quests', 'q1', soul);
        warnHologramUnresolvedOnce('holon-a', 'quests', 'q1', soul);

        expect(warnings).toHaveLength(1);
        const match = JANITOR_PATTERN.exec(warnings[0]);
        expect(match).toBeTruthy();
        expect(match[1]).toBe('holon-a');
        expect(match[2]).toBe('quests');
        expect(match[3]).toBe('q1');
        expect(match[4]).toBe(soul);
    });

    test('distinct pointers each get their own warning', () => {
        const soul = 'app/source-holon/quests/q2';
        warnHologramUnresolvedOnce('holon-b', 'quests', 'q2', soul);
        warnHologramUnresolvedOnce('holon-c', 'quests', 'q2', soul); // other local path
        warnHologramUnresolvedOnce('holon-b', 'quests', 'q2', 'app/other/quests/q2'); // other soul

        expect(warnings).toHaveLength(3);
    });

    test('a successful resolve clears the memo so a later failure re-warns', () => {
        const soul = 'app/source-holon/quests/q3';
        warnHologramUnresolvedOnce('holon-d', 'quests', 'q3', soul);
        clearHologramUnresolvedWarning('holon-d', 'quests', 'q3', soul);
        warnHologramUnresolvedOnce('holon-d', 'quests', 'q3', soul);

        expect(warnings).toHaveLength(2);
    });
});
