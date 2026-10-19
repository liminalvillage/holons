// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Asking a fund for a seat, and answering. The rules are core's
// (`@holons/core/flows` applications): anyone may ask, on the fund's own
// log; only the fund's admins answer; approving links the applicant and
// places it on the outermost ring.
//
// An application lives on the FUND, and there is no way to ask the network
// "where did I apply". So the funds a party applied to from this device are
// remembered here, and their logs are read again to say where each stands.

import {
  applyToFund,
  approveApplication,
  declineApplication,
  loadApplications,
  setApplicationsOpen,
  withdrawApplication,
  type Application,
  type ApplicationsContext,
} from "@holons/core/flows";
import { refine } from "./graph";
import { getHolosphere } from "./holosphere";

const KEY = "flows_applied";

type Remembered = Record<string, string[]>;

function remembered(): Remembered {
  try {
    const doc = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return doc && typeof doc === "object" ? (doc as Remembered) : {};
  } catch {
    return {};
  }
}

function remember(party: string, fund: string): void {
  try {
    const doc = remembered();
    doc[party] = [...new Set([fund, ...(doc[party] ?? [])])].slice(0, 40);
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch {
    /* private mode: the fund's own page still shows the status */
  }
}

const EMPTY: ApplicationsContext = {
  applications: [],
  byParty: {},
  pending: [],
  open: true,
};

/** A fund's applications. Quiet: a fund that cannot be read has none. */
export async function fundApplications(
  fund: string,
): Promise<ApplicationsContext> {
  try {
    return await loadApplications(await getHolosphere(), fund);
  } catch {
    return EMPTY;
  }
}

export interface MyApplication {
  fund: string;
  application: Application;
}

/** Where each application `party` made from this device stands, newest first. */
export async function myApplications(party: string): Promise<MyApplication[]> {
  const fundsAsked = remembered()[party] ?? [];
  const read = await Promise.all(
    fundsAsked.map(async (fund) => ({
      fund,
      application: (await fundApplications(fund)).byParty[party] ?? null,
    })),
  );
  return read
    .filter((r): r is MyApplication => !!r.application)
    .sort((a, z) => z.application.createdAt - a.application.createdAt);
}

export async function apply(
  fund: string,
  input: { party: string; name?: string; note?: string },
): Promise<void> {
  await applyToFund(await getHolosphere(), fund, input);
  remember(input.party, fund);
}

export async function withdraw(fund: string, party: string): Promise<void> {
  await withdrawApplication(await getHolosphere(), fund, party);
}

/** Approve, then redraw the fund's split so the new seat is on screen. */
export async function approve(fund: string, applicationId: string) {
  const out = await approveApplication(
    await getHolosphere(),
    fund,
    applicationId,
  );
  void refine(fund, true);
  return out;
}

export async function decline(
  fund: string,
  applicationId: string,
  reason?: string,
): Promise<void> {
  await declineApplication(await getHolosphere(), fund, applicationId, reason);
}

export async function setOpen(fund: string, open: boolean): Promise<void> {
  await setApplicationsOpen(await getHolosphere(), fund, open);
}
