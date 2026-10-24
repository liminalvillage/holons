// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Federation requests waiting for this board's admins. A link has two
// halves, each its own holon's admins' word: when another holon's admin
// links to this one, this holon is ASKED (core `@holons/core/federation`
// requests). This module keeps the list current for the bound board — read
// on bind, on `kiosk:federation-changed`, and live off the `fedrequests`
// lens — so the account button and Settings can say something is waiting.
// Meaning (who counts, what is still pending) is core's.

import { writable } from "svelte/store";
import {
  FEDERATION_REQUESTS_LENS,
  answerFederationRequest,
  pendingFederationRequests,
  settleOwnFederationRequests,
  type FederationRequest,
} from "@holons/core/federation";
import type { HoloSphere } from "holosphere";
import { getHolosphere } from "./holosphere";
import type { MessageKey, Translator } from "./i18n";

export type { FederationRequest };

/** The pending requests of the bound board — empty unless this key can answer them. */
export const fedRequests = writable<FederationRequest[]>([]);

type Host = Pick<HoloSphere, "subscribe">;
type Loader = (hs: HoloSphere, holon: string) => Promise<FederationRequest[]>;

export interface WatchOptions {
  /** Coalesce bursts (one answer lands as several envelopes). */
  debounceMs?: number;
  /** Injectable for tests. */
  load?: Loader;
  /** Where `kiosk:federation-changed` is heard; none in tests/SSR. */
  target?: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
}

/**
 * The requests to show: first accept the ones this key asked of the board
 * itself (it now speaks for both halves — core decides), then list what
 * still waits for a person. A settle announces the changed link.
 */
export async function loadFedRequests(
  hs: HoloSphere,
  holon: string,
  deps: {
    settle?: typeof settleOwnFederationRequests;
    list?: Loader;
    target?: Pick<EventTarget, "dispatchEvent"> | null;
  } = {},
): Promise<FederationRequest[]> {
  const settle = deps.settle ?? settleOwnFederationRequests;
  const target =
    deps.target === undefined
      ? typeof window !== "undefined"
        ? window
        : null
      : deps.target;
  try {
    const settled = await settle(hs, holon);
    if (settled.length)
      target?.dispatchEvent(new CustomEvent("kiosk:federation-changed"));
  } catch {
    /* offline or not ours to write: the list still shows them */
  }
  return (deps.list ?? pendingFederationRequests)(hs, holon);
}

/**
 * Keep `onChange` fed with `holon`'s pending requests: one read now, one
 * after every change to the lens or a local federation edit. Returns a stop
 * function that drops the subscription, the listener and any timer.
 */
export function watchFedRequests(
  hs: HoloSphere,
  holon: string,
  onChange: (requests: FederationRequest[]) => void,
  opts: WatchOptions = {},
): () => void {
  const load = opts.load ?? loadFedRequests;
  const target =
    opts.target === undefined
      ? typeof window !== "undefined"
        ? window
        : null
      : opts.target;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;

  const refresh = async () => {
    const mine = ++seq;
    try {
      const list = await load(hs, holon);
      if (!stopped && mine === seq) onChange(list);
    } catch {
      /* offline: keep what is shown */
    }
  };
  const soon = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void refresh();
    }, opts.debounceMs ?? 600);
  };

  void refresh();
  let sub: { unsubscribe?: () => void } | null = null;
  try {
    sub = (hs as unknown as Host).subscribe(
      holon,
      FEDERATION_REQUESTS_LENS,
      soon,
    ) as unknown as { unsubscribe?: () => void };
  } catch {
    /* no live lens: bind and local edits still refresh */
  }
  target?.addEventListener("kiosk:federation-changed", soon);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    try {
      sub?.unsubscribe?.();
    } catch {
      /* best-effort teardown */
    }
    target?.removeEventListener("kiosk:federation-changed", soon);
  };
}

let stopBound: (() => void) | null = null;
let boundKey = "";

/**
 * Follow `holon`'s requests while this key may answer them (`may(standing,
 * 'federation')`); anyone else sees none. Idempotent per (holon, canAnswer).
 */
export function bindFedRequests(
  holon: string | null,
  canAnswer: boolean,
): void {
  const key = holon && canAnswer ? holon : "";
  if (key === boundKey) return;
  boundKey = key;
  stopBound?.();
  stopBound = null;
  fedRequests.set([]);
  if (!key) return;
  let stop: (() => void) | null = null;
  let cancelled = false;
  stopBound = () => {
    cancelled = true;
    stop?.();
  };
  void getHolosphere().then((hs) => {
    if (cancelled) return;
    stop = watchFedRequests(hs, key, (list) => {
      if (boundKey === key) fedRequests.set(list);
    });
  });
}

/** Accept or decline one request, then say so to every listener. */
export async function answerFedRequest(
  holon: string,
  req: FederationRequest,
  decision: "accept" | "decline",
): Promise<void> {
  const hs = await getHolosphere();
  await answerFederationRequest(hs, holon, req.from, decision);
  fedRequests.update((l) => l.filter((r) => r.from !== req.from));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("kiosk:federation-changed"));
  }
}

const LENS_LABEL_KEYS: Record<string, MessageKey> = {
  quests: "tabs.tasks",
  library: "tabs.library",
  roles: "tabs.roles",
  checklists: "tabs.checklists",
  stock: "tabs.stock",
};

/** A lens as the kiosk names it: its tab's label, else the lens id capitalised. */
export function fedLensLabel(tr: Translator, lens: string): string {
  const key = LENS_LABEL_KEYS[lens];
  return key ? tr(key) : lens.charAt(0).toUpperCase() + lens.slice(1);
}
