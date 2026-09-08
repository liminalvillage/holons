// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Attach the ledger projection to a HoloSphere instance.
 *
 * After every `put` / `delete` on a lens with economic meaning (see
 * `LEDGER_LENSES`), the write is re-read as ValueFlows records by
 * `planLedger` and the `rea_events` lens is brought in line: new records are
 * written, stale ones retracted. The primary write is never blocked — a
 * ledger failure is logged and swallowed — and the ledger lens itself is
 * never re-projected, so there is no recursion.
 *
 * `createHoloSphere` calls this for every instance it builds, which is how
 * the bot, the kiosk, the dashboard and the MCP server all account the same
 * way without each remembering to: core owns the meaning of a write.
 *
 * Skipped on purpose:
 *   - private (password) writes — the encrypted space is not a shared ledger;
 *   - global tables (`holon == null`);
 *   - hologram pointers and full-copy federation propagation
 *     (`preserveFederationMeta`): mirrors of a record someone else accounts;
 *   - writes redirected by a hologram at the target are accounted where they
 *     land (the source holon), the same place the record itself goes.
 */

import { economicEventProblems, normalizeReaEvent } from './valueflows.js';
import { LEDGER_LENSES, REA_EVENTS_LENS, planLedger, type LedgerContext, type LedgerUpsert } from './ledger.js';
import type { REAEvent } from './event-store.js';

/** The slice of a HoloSphere instance the projection touches. */
export interface LedgerHost {
  put(holon: string | null, lens: string, data: any, passwordOrOptions?: any, options?: any): Promise<any>;
  delete(holon: string | null, lens: string, key: string, password?: any, options?: any): Promise<any>;
  isHologram?(data: unknown): boolean;
  parseSoulPath?(soul: string): { holon: string; lens: string; key: string } | null;
  store?: {
    get(holon: string, lens: string, id: string): { item?: unknown } | undefined;
    list(holon: string, lens: string, opts?: { includeDeleted?: boolean }): Array<{ item?: unknown }>;
  };
}

export interface AttachLedgerOptions {
  /** Report a ledger failure; defaults to `console.warn`. */
  log?: (message: string, error?: unknown) => void;
  /** Clock, for tests. */
  now?: () => number;
}

const ATTACHED = Symbol.for('holons.ledger.attached');

/** True when `attachLedger` already wrapped this instance. */
export function hasLedger(host: unknown): boolean {
  return !!host && typeof host === 'object' && (host as any)[ATTACHED] === true;
}

function splitArgs(passwordOrOptions: unknown, options: unknown): { password: string | null; options: Record<string, any> } {
  if (passwordOrOptions && typeof passwordOrOptions === 'object') {
    const o = passwordOrOptions as Record<string, any>;
    return { password: o.password ?? null, options: o };
  }
  return {
    password: typeof passwordOrOptions === 'string' && passwordOrOptions ? passwordOrOptions : null,
    options: (options && typeof options === 'object' ? options : {}) as Record<string, any>,
  };
}

function localItem(host: LedgerHost, holon: string, lens: string, key: string): Record<string, unknown> | null {
  try {
    const rec = host.store?.get(holon, lens, key);
    const item = rec?.item;
    if (!item || typeof item !== 'object') return null;
    if ((item as any)._deleted === true) return null;
    return item as Record<string, unknown>;
  } catch {
    return null;
  }
}

function localLedger(host: LedgerHost, holon: string): REAEvent[] {
  try {
    const recs = host.store?.list(holon, REA_EVENTS_LENS) ?? [];
    const out: REAEvent[] = [];
    for (const r of recs) {
      const item = r?.item;
      if (item && typeof item === 'object' && (item as any)._deleted !== true) {
        out.push(normalizeReaEvent(item as Record<string, unknown>) as REAEvent);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Where the write actually lands. HoloSphere follows a hologram at the target
 * (or the record's own source envelope) to the owner's graph; the ledger
 * entry belongs there too.
 */
function resolveTarget(
  host: LedgerHost,
  holon: string,
  lens: string,
  data: Record<string, unknown>,
  options: Record<string, any>,
): { holon: string; lens: string; key: string } {
  const key = String(data.id ?? '');
  if (options.disableHologramRedirection) return { holon, lens, key };
  const env = data._hologram as Record<string, unknown> | undefined;
  if (env && typeof env.sourceHolon === 'string') {
    const soul = typeof env.soul === 'string' ? host.parseSoulPath?.(env.soul) : null;
    return {
      holon: (env.sourceHolon as string) ?? soul?.holon ?? holon,
      lens: (typeof env.sourceLens === 'string' ? env.sourceLens : soul?.lens) ?? lens,
      key: String((env.sourceKey as string | undefined) ?? soul?.key ?? key),
    };
  }
  const atPath = key ? host.store?.get(holon, lens, key)?.item : undefined;
  if (atPath && host.isHologram?.(atPath) && typeof (atPath as any).soul === 'string') {
    const soul = host.parseSoulPath?.((atPath as any).soul);
    if (soul) return { holon: soul.holon, lens: soul.lens, key: soul.key };
  }
  return { holon, lens, key };
}

/**
 * Does the stored record already say everything `next` says? Compared on
 * `next`'s own keys, so bookkeeping fields the store adds on its side never
 * force a rewrite.
 */
function alreadyStored(stored: REAEvent, next: REAEvent): boolean {
  const s = stored as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  for (const k of Object.keys(n)) {
    if (n[k] === undefined) continue;
    if (stable(s[k]) !== stable(n[k])) return false;
  }
  return true;
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

async function applyPlan(
  host: LedgerHost,
  rawPut: LedgerHost['put'],
  rawDelete: LedgerHost['delete'],
  holon: string,
  upserts: LedgerUpsert[],
  deletes: string[],
  existing: REAEvent[],
  writeOptions: Record<string, any>,
  log: NonNullable<AttachLedgerOptions['log']>,
): Promise<void> {
  const byId = new Map(existing.map((e) => [e.id, e] as const));
  for (const u of upserts) {
    const prior = byId.get(u.event.id);
    if (prior && u.onlyIfAbsent) continue;
    let event = u.event;
    if (prior && !u.pinTime) {
      event = { ...event, timestamp: prior.timestamp, hasPointInTime: prior.hasPointInTime };
    }
    if (prior && alreadyStored(prior, event)) continue;
    const problems = economicEventProblems(event);
    if (problems.length) {
      log(`[ledger] skipping ${event.id}: ${problems.join('; ')}`);
      continue;
    }
    try {
      await rawPut.call(host, holon, REA_EVENTS_LENS, event, writeOptions);
    } catch (err) {
      log(`[ledger] failed to write ${event.id}`, err);
    }
  }
  for (const id of deletes) {
    try {
      await rawDelete.call(host, holon, REA_EVENTS_LENS, id, null, writeOptions);
    } catch (err) {
      log(`[ledger] failed to retract ${id}`, err);
    }
  }
}

/**
 * Wrap `host.put` / `host.delete` so every write to a ledger lens keeps
 * `rea_events` in line. Idempotent: attaching twice is a no-op. Returns the
 * same instance.
 */
export function attachLedger<T extends LedgerHost>(host: T, opts: AttachLedgerOptions = {}): T {
  if (hasLedger(host)) return host;
  const log = opts.log ?? ((message: string, error?: unknown) => console.warn(message, error ?? ''));
  const now = opts.now ?? (() => Date.now());
  const rawPut = host.put;
  const rawDelete = host.delete;

  const ledgerWriteOptions = (options: Record<string, any>): Record<string, any> => {
    const out: Record<string, any> = {};
    if (options.actingAs !== undefined) out.actingAs = options.actingAs;
    if (options.local !== undefined) out.local = options.local;
    return out;
  };

  const project = async (ctx: LedgerContext, options: Record<string, any>): Promise<void> => {
    const plan = planLedger(ctx);
    if (!plan.upserts.length && !plan.deletes.length) return;
    await applyPlan(host, rawPut, rawDelete, ctx.holonId, plan.upserts, plan.deletes, ctx.existing, ledgerWriteOptions(options), log);
  };

  host.put = async function ledgerPut(this: T, holon: any, lens: any, data: any, passwordOrOptions: any = null, options: any = {}) {
    const { password, options: opts2 } = splitArgs(passwordOrOptions, options);
    const eligible =
      holon != null &&
      typeof lens === 'string' &&
      LEDGER_LENSES.includes(lens) &&
      !password &&
      !opts2.preserveFederationMeta &&
      data &&
      typeof data === 'object' &&
      !(host.isHologram?.(data) ?? false);

    let target: { holon: string; lens: string; key: string } | null = null;
    let prev: Record<string, unknown> | null = null;
    if (eligible) {
      try {
        target = resolveTarget(host, String(holon), lens, data, opts2);
        if (!LEDGER_LENSES.includes(target.lens) || !target.key) target = null;
        else prev = localItem(host, target.holon, target.lens, target.key);
      } catch (err) {
        log('[ledger] could not resolve write target', err);
        target = null;
      }
    }

    const result = await rawPut.call(this, holon, lens, data, passwordOrOptions, options);

    if (target) {
      try {
        const key = target.key || String(data.id ?? '');
        const next = data._deleted === true ? null : (data as Record<string, unknown>);
        await project(
          {
            holonId: target.holon,
            lens: target.lens,
            key,
            next,
            prev,
            existing: localLedger(host, target.holon),
            actor: opts2.actingAs ?? null,
            now: now(),
          },
          opts2,
        );
      } catch (err) {
        log('[ledger] projection failed', err);
      }
    }
    return result;
  } as T['put'];

  host.delete = async function ledgerDelete(this: T, holon: any, lens: any, key: any, password: any = null, options: any = {}) {
    const eligible =
      holon != null && typeof lens === 'string' && LEDGER_LENSES.includes(lens) && !password && key != null;
    const prev = eligible ? localItem(host, String(holon), lens, String(key)) : null;
    const result = await rawDelete.call(this, holon, lens, key, password, options);
    if (eligible) {
      try {
        await project(
          {
            holonId: String(holon),
            lens,
            key: String(key),
            next: null,
            prev,
            existing: localLedger(host, String(holon)),
            actor: options?.actingAs ?? null,
            now: now(),
          },
          options && typeof options === 'object' ? options : {},
        );
      } catch (err) {
        log('[ledger] projection failed', err);
      }
    }
    return result;
  } as T['delete'];

  Object.defineProperty(host, ATTACHED, { value: true, enumerable: false, configurable: true });
  return host;
}
