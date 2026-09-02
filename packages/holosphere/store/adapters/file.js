// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Node file adapter: a JSON snapshot plus an append-only JSONL log per app.
//
//   <dir>/<app>.snapshot.json   full state as of the last compaction
//   <dir>/<app>.log.jsonl       one op per line appended since
//
// `open()` reads the snapshot, replays the log (tolerating a torn last line
// from a crash mid-append), and — when the log is non-empty — rewrites the
// snapshot and truncates the log, so a process always starts from a compact
// state. Appends are serialized through a promise chain. One process per
// directory (the same constraint the old radisk had).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { stateFromSnapshot, applyOp, toSnapshot } from './state.js';

const safeName = (s) => encodeURIComponent(String(s)).replace(/%/g, '_');

export function createFileAdapter({ dir = './holosphere-store', appName = 'holosphere' } = {}) {
    const base = path.resolve(dir);
    const snapshotPath = path.join(base, `${safeName(appName)}.snapshot.json`);
    const logPath = path.join(base, `${safeName(appName)}.log.jsonl`);
    let chain = Promise.resolve();
    let closed = false;

    const serial = (fn) => {
        const next = chain.then(fn, fn);
        chain = next.catch(() => {});
        return next;
    };

    async function readSnapshot() {
        try {
            const raw = await fsp.readFile(snapshotPath, 'utf8');
            return JSON.parse(raw);
        } catch (e) {
            if (e?.code === 'ENOENT') return null;
            console.warn(`[holosphere/store] unreadable snapshot ${snapshotPath}: ${e?.message} — starting empty`);
            return null;
        }
    }

    async function readLogOps() {
        let raw;
        try {
            raw = await fsp.readFile(logPath, 'utf8');
        } catch (e) {
            if (e?.code === 'ENOENT') return [];
            throw e;
        }
        const ops = [];
        const lines = raw.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            try {
                ops.push(JSON.parse(line));
            } catch {
                // A torn line can only be the last one (a crash mid-append).
                if (i < lines.length - 2) {
                    console.warn(`[holosphere/store] skipping corrupt log line ${i + 1} in ${logPath}`);
                }
            }
        }
        return ops;
    }

    async function writeSnapshot(snapshot) {
        const tmp = `${snapshotPath}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify(snapshot));
        await fsp.rename(tmp, snapshotPath);
        await fsp.writeFile(logPath, '');
    }

    return {
        kind: 'file',
        dir: base,
        snapshotPath,
        logPath,

        async open() {
            await fsp.mkdir(base, { recursive: true });
            const snapshot = await readSnapshot();
            const ops = await readLogOps();
            if (!ops.length) return snapshot;
            const state = stateFromSnapshot(snapshot);
            for (const op of ops) applyOp(state, op);
            const merged = toSnapshot(state);
            await writeSnapshot(merged);
            return merged;
        },

        append(ops) {
            if (closed || !ops.length) return Promise.resolve();
            const lines = ops.map((op) => JSON.stringify(op)).join('\n') + '\n';
            return serial(() => fsp.appendFile(logPath, lines));
        },

        snapshot(full) {
            return serial(() => writeSnapshot(full));
        },

        clear() {
            return serial(async () => {
                await fsp.rm(snapshotPath, { force: true });
                await fsp.rm(logPath, { force: true });
            });
        },

        async close() {
            closed = true;
            await chain;
        },

        /** Byte sizes of the files on disk (for status/diagnostics). */
        stats() {
            const size = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
            return { snapshotBytes: size(snapshotPath), logBytes: size(logPath) };
        },
    };
}
