// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Applications against the store: reading a fund's `flow_applications` log,
 * asking, taking back, and the admin's two answers.
 *
 * Approving is three writes, in the order that leaves the least behind if
 * one fails: link the applicant (a holon must be in the federation record
 * to be read back from a ring), place it on the outermost ring, then say so
 * on the log. Each is skipped when it already holds, so approving twice —
 * or after a failed third step — is safe.
 *
 * Eventually consistent: a lens that has not arrived reads as empty.
 */

import { isHolonAdmin, resolveHolonAuthority } from '../holosphere/authority.js';
import { idKind } from '../identity/ids.js';
import { syncFoundingAuthority } from '../protocol/founding.js';
import {
  FLOW_APPLICATIONS_LENS,
  buildApplication,
  buildApplicationVerdict,
  buildWithdrawal,
  foldApplications,
  type Application,
  type FoldedApplications,
} from './applications.js';
import { loadAllocationInputs, onwardParties } from './cascade-load.js';
import { linkSeatedHolons } from './seating.js';
import {
  readAllocationConfig,
  readApplicationsOpen,
  readZoneAssignments,
  readZonePeople,
  saveAllocationConfig,
} from './settings.js';

const quiet = <T>(p: Promise<T>, fallback: T): Promise<T> => p.then((v) => v ?? fallback).catch(() => fallback);

export interface ApplicationsContext extends FoldedApplications {
  /** Whether the fund takes applications. */
  open: boolean;
}

/** Does this key speak for this party, as far as this instance can see? */
/** How many applicant holons one read pulls to verify their senders. */
const VERIFY_PULLS = 20;

function speaksFor(holosphere: any) {
  const cache = new Map<string, ReturnType<typeof resolveHolonAuthority>['actors']>();
  return (pubkey: string, party: string, at: number): boolean => {
    const key = String(pubkey).toLowerCase();
    if (key === String(party).toLowerCase()) return true;
    if (!cache.has(party)) cache.set(party, resolveHolonAuthority(holosphere, party).actors);
    return !!cache.get(party)?.isAcceptedAt(key, at);
  };
}

/** A fund's applications, folded, and whether it is taking any. */
export async function loadApplications(holosphere: any, fundId: string): Promise<ApplicationsContext> {
  const fund = String(fundId ?? '');
  // Pull the lens before reading the log off the local store.
  await quiet(holosphere.getAll(fund, FLOW_APPLICATIONS_LENS), []);
  const [entries, settings] = await Promise.all([
    quiet<any[]>(Promise.resolve().then(() => holosphere.getLog(fund, FLOW_APPLICATIONS_LENS)), []),
    quiet<any>(holosphere.get(fund, 'settings', fund), null),
  ]);
  const fold = () =>
    foldApplications({
      entries,
      actors: resolveHolonAuthority(holosphere, fund).actors,
      actsFor: speaksFor(holosphere),
    });
  let folded = fold();
  // Whether a key speaks for a holon is read off that holon's own log, which
  // this instance may never have pulled: pull the ones still unverified, then
  // judge again.
  const unknown = [
    ...new Set(folded.applications.filter((a) => !a.verified && a.status === 'pending').map((a) => a.party)),
  ].filter((party) => idKind(party) === 'holon');
  if (unknown.length) {
    await Promise.all(unknown.slice(0, VERIFY_PULLS).map((party) => quiet(syncFoundingAuthority(holosphere, party), null)));
    folded = fold();
  }
  return { ...folded, open: readApplicationsOpen(settings) };
}

/** How long a burst of new entries is gathered before `onChange` is called once. */
export const APPLICATIONS_SETTLE_MS = 300;

/**
 * Call `onChange` whenever a fund's applications log gets a new entry — an
 * application, a withdrawal, an answer — from anyone, as the relays deliver
 * it. Returns the function that stops watching. Quiet where the instance
 * cannot watch: nothing is called, and stopping is a no-op.
 */
export function watchApplications(holosphere: any, fundId: string, onChange: () => void): () => void {
  const fund = String(fundId ?? '');
  if (!fund || typeof holosphere?.subscribeLog !== 'function') return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let off: (() => void) | null = null;
  try {
    off = holosphere.subscribeLog(
      fund,
      FLOW_APPLICATIONS_LENS,
      () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          onChange();
        }, APPLICATIONS_SETTLE_MS);
      },
      { replay: false },
    );
  } catch {
    off = null;
  }
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    off?.();
  };
}

/** Ask a fund to seat `party`. Refused when the fund is closed or the party already has an open ask. */
export async function applyToFund(
  holosphere: any,
  fundId: string,
  input: { party: string; name?: string; note?: string },
): Promise<{ id: string }> {
  const fund = String(fundId ?? '');
  const party = String(input.party ?? '').trim();
  if (!fund || !party) throw new Error('An application names the fund and the party asking');
  if (fund === party) throw new Error('A fund cannot apply to itself');
  const ctx = await loadApplications(holosphere, fund);
  if (!ctx.open) throw new Error('This fund is not taking applications');
  if (ctx.byParty[party]?.status === 'pending') throw new Error('An application is already waiting');
  const a = buildApplication({ party, name: input.name, note: input.note });
  const event = await holosphere.append(fund, FLOW_APPLICATIONS_LENS, a.item, { refs: a.refs });
  return { id: event.id };
}

/** Take a pending application back. */
export async function withdrawApplication(holosphere: any, fundId: string, party: string): Promise<{ id: string }> {
  const ctx = await loadApplications(holosphere, fundId);
  const open = ctx.byParty[String(party)];
  if (!open || open.status !== 'pending') throw new Error('There is no waiting application to take back');
  const a = buildWithdrawal({ applicationId: open.id, party: open.party });
  const event = await holosphere.append(String(fundId), FLOW_APPLICATIONS_LENS, a.item, { refs: a.refs });
  return { id: event.id };
}

async function decidable(holosphere: any, fundId: string, applicationId: string): Promise<Application> {
  if (!(await isHolonAdmin(holosphere, fundId))) throw new Error('Only an admin of the fund answers its applications');
  const ctx = await loadApplications(holosphere, fundId);
  const found = ctx.applications.find((a) => a.id === applicationId);
  if (!found) throw new Error('That application is not on this fund');
  if (found.status === 'withdrawn') throw new Error('That application was taken back');
  return found;
}

export interface ApprovedApplication {
  party: string;
  kind: 'holon' | 'person';
  ring: number;
  /** The link was made by this call (false: it was already there, or the party is a person). */
  linked: boolean;
  /** The seat was placed by this call (false: the party already sat on a ring). */
  placed: boolean;
  /**
   * The fund's split, as stored now, passes the party something. False when
   * the seat is on a ring that gets nothing — the fund keeps everything, or
   * pays by fixed shares — and the split must change for the seat to pay.
   */
  pays: boolean;
}

/**
 * Approve: federate the applicant when it is a holon, place it on the fund's
 * outermost ring unless it already sits on one, and attest the application.
 */
export async function approveApplication(
  holosphere: any,
  fundId: string,
  applicationId: string,
  opts: { ring?: number } = {},
): Promise<ApprovedApplication> {
  const fund = String(fundId ?? '');
  const application = await decidable(holosphere, fund, applicationId);
  const party = application.party;
  const kind: ApprovedApplication['kind'] = idKind(party) === 'holon' ? 'holon' : 'person';

  const settings = await quiet<any>(holosphere.get(fund, 'settings', fund), null);
  const config = readAllocationConfig(settings);
  const zones = readZoneAssignments(settings);
  const people = readZonePeople(settings);
  const nzones = Math.max(1, config.nzones);
  const wanted = Math.floor(Number(opts.ring));
  const ring = Number.isFinite(wanted) && wanted >= 1 ? Math.min(wanted, nzones) : nzones;

  // Value follows the split, not a lens: the link carries no data either way.
  const linked =
    kind === 'holon' &&
    (await linkSeatedHolons(holosphere, fund, [party], application.name ? { [party]: application.name } : {})).length > 0;

  const seated = kind === 'holon' ? zones[party] : people[party];
  const placed = !(Number(seated) >= 1);
  if (placed) {
    if (kind === 'holon') await saveAllocationConfig(holosphere, fund, {}, { ...zones, [party]: ring });
    else await saveAllocationConfig(holosphere, fund, {}, undefined, { ...people, [party]: ring });
  }

  if (application.status !== 'approved') {
    const a = buildApplicationVerdict(application.id, 'attest');
    await holosphere.append(fund, FLOW_APPLICATIONS_LENS, a.item, { refs: a.refs });
  }
  const after = await quiet(loadAllocationInputs(holosphere, fund), null);
  const pays = !!after && onwardParties(after, fund).includes(party);
  return { party, kind, ring: placed ? ring : Number(seated), linked, placed, pays };
}

/** Decline, with the reason the applicant will read. Touches neither the link nor the split. */
export async function declineApplication(holosphere: any, fundId: string, applicationId: string, reason?: string): Promise<{ id: string }> {
  const fund = String(fundId ?? '');
  const application = await decidable(holosphere, fund, applicationId);
  const a = buildApplicationVerdict(application.id, 'dispute', reason);
  const event = await holosphere.append(fund, FLOW_APPLICATIONS_LENS, a.item, { refs: a.refs });
  return { id: event.id };
}

/** Open or close a fund to applications. Admin only, like every settings write that counts. */
export async function setApplicationsOpen(holosphere: any, fundId: string, open: boolean): Promise<void> {
  await saveAllocationConfig(holosphere, String(fundId), {}, undefined, undefined, undefined, { applications: open ? 'open' : 'closed' });
}
