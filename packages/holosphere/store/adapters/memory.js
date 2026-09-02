// SPDX-License-Identifier: AGPL-3.0-or-later
//
// In-memory adapter: nothing is persisted. The default for tests, serverless
// functions and one-shot scripts. With `retain: true` the adapter keeps a copy
// of everything appended so a second store opened on the SAME adapter
// instance hydrates from it — the way tests exercise reopen/hydrate paths.

import { emptyState, applyOps, toSnapshot, stateFromSnapshot } from './state.js';

export function createMemoryAdapter({ retain = false } = {}) {
    let state = retain ? emptyState() : null;
    return {
        kind: 'memory',
        async open() {
            return state ? toSnapshot(state) : null;
        },
        async append(ops) {
            if (state) applyOps(state, ops);
        },
        async snapshot(full) {
            if (retain) state = stateFromSnapshot(full);
        },
        async clear() {
            if (retain) state = emptyState();
        },
        async close() {},
    };
}
