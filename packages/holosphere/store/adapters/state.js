// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Plain-object persistence state shared by the adapters: a snapshot is the
// full state, an op is one incremental change. Adapters that keep a log
// (file) or retain state (memory) fold ops into a state with `applyOp` and
// turn it back into a snapshot with `toSnapshot`.
//
// Ops:
//   { t: 'rec',      v: record }        record replaced at v.addr
//   { t: 'evt',      v: event }         signed event stored under v.id
//   { t: 'evt-del',  id }               signed event dropped (superseded)
//   { t: 'priv',     k, v }             private ciphertext stored
//   { t: 'priv-del', k }                private ciphertext dropped
//   { t: 'key',      k, v }             received sealed-content key row stored
//   { t: 'key-del',  k }                received key row dropped
//   { t: 'cur',      k, v }             sync cursor for a lens key
//
// Snapshot:
//   { records: record[], events: event[], private: [k, v][], keys: [k, v][], cursors: [k, v][] }

export function emptyState() {
    return {
        records: new Map(),
        events: new Map(),
        private: new Map(),
        keys: new Map(),
        cursors: new Map(),
    };
}

export function stateFromSnapshot(snapshot) {
    const state = emptyState();
    if (!snapshot) return state;
    for (const rec of snapshot.records || []) state.records.set(rec.addr, rec);
    for (const evt of snapshot.events || []) state.events.set(evt.id, evt);
    for (const [k, v] of snapshot.private || []) state.private.set(k, v);
    for (const [k, v] of snapshot.keys || []) state.keys.set(k, v);
    for (const [k, v] of snapshot.cursors || []) state.cursors.set(k, v);
    return state;
}

export function toSnapshot(state) {
    return {
        records: Array.from(state.records.values()),
        events: Array.from(state.events.values()),
        private: Array.from(state.private.entries()),
        keys: Array.from(state.keys.entries()),
        cursors: Array.from(state.cursors.entries()),
    };
}

export function applyOp(state, op) {
    switch (op.t) {
        case 'rec': state.records.set(op.v.addr, op.v); break;
        case 'evt': state.events.set(op.v.id, op.v); break;
        case 'evt-del': state.events.delete(op.id); break;
        case 'priv': state.private.set(op.k, op.v); break;
        case 'priv-del': state.private.delete(op.k); break;
        case 'key': state.keys.set(op.k, op.v); break;
        case 'key-del': state.keys.delete(op.k); break;
        case 'cur': state.cursors.set(op.k, op.v); break;
        default: break; // unknown ops are ignored so newer logs stay readable
    }
}

export function applyOps(state, ops) {
    for (const op of ops) applyOp(state, op);
    return state;
}
