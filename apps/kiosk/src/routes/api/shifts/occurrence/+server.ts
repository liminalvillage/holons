// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The coordinator's side of the shift protocol: publish (or republish) and
// retract kind-31923 occurrences, signed with the deployment's SHIFT
// COORDINATOR key — `deriveShiftCoordinatorKey(NOSTR_DERIVATION_SECRET)`,
// the same key on every surface holding the secret, so the bot, the web and
// this kiosk all publish ONE coordinator's schedule (Elinor's model: one
// coordinator per deployment, addressable events that replace each other).
// The key never leaves this server; the browser says what to publish.
//
// GET                        → { pubkey, allowed }  who this deploy publishes
//                              as, and whether the session may drive it
// POST { occurrences: […] }  → sign + publish each occurrence (batch)
// DELETE { occurrences: […] } → one NIP-09 retraction naming them all
//
// Who may drive it: any logged-in session (the kiosk's caretaker model — the
// person at the screen), narrowed by `KIOSK_SHIFT_MANAGERS` (comma-separated
// Telegram ids) when a deploy sets it. Key logins can never publish
// occurrences: the coordinator is a service identity, not theirs.
//
// Needs `NOSTR_DERIVATION_SECRET`. Without it every verb answers 501 and the
// board stays read-only for the coordinator, like RSVPs do.

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";
import { createIdentityContext } from "@holons/core/holosphere";
import {
  SHIFT_OCCURRENCE_KIND,
  createShiftRelayClient,
  isValidDate,
  isValidShiftCode,
  parseShiftAddress,
  parseShiftDTag,
  type ShiftOccurrence,
} from "@holons/core/shifts";
import {
  authConfig,
  verifySessionIdentity,
  SESSION_COOKIE,
} from "$lib/server/telegramAuth";

/** Relays to publish to — must include the one the board reads. */
function shiftRelays(): string[] {
  const raw =
    (env.KIOSK_SHIFT_RELAYS || "").trim() ||
    (env.VITE_KIOSK_SHIFT_RELAYS || "").trim() ||
    (env.SHIFTS_RELAYS || "").trim() ||
    "wss://relay.commonshub.dev";
  return raw
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

/** The coordinator pubkey this deploy pins, if any. */
function pinnedCoordinator(): string | null {
  const v = (
    env.KIOSK_SHIFT_COORDINATOR ||
    env.VITE_KIOSK_SHIFT_COORDINATOR ||
    env.SHIFTS_COORDINATOR_PUBKEY ||
    ""
  )
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{64}$/.test(v) ? v : null;
}

/** Telegram ids allowed to manage shifts; empty = every logged-in Telegram session. */
function managers(): Set<string> {
  return new Set(
    (env.KIOSK_SHIFT_MANAGERS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

type Gate =
  | {
      ok: true;
      signer: NonNullable<
        ReturnType<
          ReturnType<typeof createIdentityContext>["coordinatorSigner"]
        >
      >;
      telegramId: string;
    }
  | { ok: false; status: number; error: string };

async function gate(cookie: string | undefined): Promise<Gate> {
  const secret = (env.NOSTR_DERIVATION_SECRET || "").trim();
  if (!secret) {
    return {
      ok: false,
      status: 501,
      error: "NOSTR_DERIVATION_SECRET is not configured",
    };
  }
  const identity = await verifySessionIdentity(cookie, authConfig().jwtSecret);
  if (!identity) return { ok: false, status: 401, error: "Not logged in" };
  if (identity.kind !== "telegram") {
    return {
      ok: false,
      status: 403,
      error: "Only a Telegram login can manage shifts",
    };
  }
  const telegramId = String(identity.profile.id);
  const allowed = managers();
  if (allowed.size && !allowed.has(telegramId)) {
    return {
      ok: false,
      status: 403,
      error: "This account may not manage shifts",
    };
  }
  const signer = createIdentityContext({
    derivationSecret: secret,
  }).coordinatorSigner();
  if (!signer)
    return { ok: false, status: 500, error: "Key derivation failed" };
  // A deploy that pins a DIFFERENT coordinator (Elinor's, say) must not
  // publish under ours: the board would never show what we wrote.
  const pinned = pinnedCoordinator();
  if (pinned && pinned !== signer.pubkey) {
    return {
      ok: false,
      status: 409,
      error:
        "This deploy trusts another coordinator's occurrences; ours would not show",
    };
  }
  return { ok: true, signer, telegramId };
}

export const GET: RequestHandler = async ({ cookies }) => {
  const secret = (env.NOSTR_DERIVATION_SECRET || "").trim();
  if (!secret) {
    return json(
      { error: "NOSTR_DERIVATION_SECRET is not configured" },
      { status: 501 },
    );
  }
  const pubkey = createIdentityContext({
    derivationSecret: secret,
  }).coordinatorPubkey();
  if (!pubkey) return json({ error: "Key derivation failed" }, { status: 500 });
  const g = await gate(cookies.get(SESSION_COOKIE));
  const pinned = pinnedCoordinator();
  return json({
    pubkey,
    allowed: g.ok,
    ...(g.ok ? {} : { reason: g.error }),
    ...(pinned && pinned !== pubkey ? { pinned } : {}),
  });
};

interface OccurrenceInput {
  groupId: string;
  date: string;
  code: string;
  title: string;
  start: number;
  end: number;
  tzid?: string;
  location?: string;
  capacity?: number;
  description?: string;
  timeRange?: string;
}

function readOccurrence(raw: unknown): OccurrenceInput | string {
  if (!raw || typeof raw !== "object") return "Expected an occurrence object";
  const r = raw as Record<string, unknown>;
  const groupId = String(r.groupId ?? "").trim();
  if (!/^(-?\d+|[A-Za-z0-9_]+)$/.test(groupId)) return "Invalid groupId";
  const date = String(r.date ?? "");
  if (!isValidDate(date)) return `Invalid date "${date}"`;
  const code = String(r.code ?? "");
  if (!isValidShiftCode(code)) return `Invalid code "${code}"`;
  const title = String(r.title ?? "")
    .trim()
    .slice(0, 80);
  if (!title) return "A title is required";
  const start = Number(r.start);
  const end = Number(r.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
    return "end must be after start (unix seconds)";
  }
  const capacity =
    r.capacity === undefined || r.capacity === null
      ? undefined
      : Number(r.capacity);
  if (
    capacity !== undefined &&
    (!Number.isInteger(capacity) || capacity < 0 || capacity > 100)
  ) {
    return "capacity must be 0–100";
  }
  const out: OccurrenceInput = { groupId, date, code, title, start, end };
  if (typeof r.tzid === "string" && r.tzid.trim())
    out.tzid = r.tzid.trim().slice(0, 64);
  if (typeof r.location === "string" && r.location.trim())
    out.location = r.location.trim().slice(0, 120);
  if (capacity !== undefined) out.capacity = capacity;
  if (typeof r.description === "string" && r.description.trim())
    out.description = r.description.trim().slice(0, 300);
  if (typeof r.timeRange === "string" && r.timeRange.trim())
    out.timeRange = r.timeRange.trim().slice(0, 20);
  return out;
}

const MAX_BATCH = 200;

export const POST: RequestHandler = async ({ request, cookies }) => {
  const g = await gate(cookies.get(SESSION_COOKIE));
  if (!g.ok) return json({ error: g.error }, { status: g.status });

  let body: { occurrences?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const list = Array.isArray(body.occurrences) ? body.occurrences : [];
  if (!list.length)
    return json({ error: "Nothing to publish" }, { status: 400 });
  if (list.length > MAX_BATCH)
    return json({ error: `At most ${MAX_BATCH} at once` }, { status: 400 });
  const inputs: OccurrenceInput[] = [];
  for (const raw of list) {
    const r = readOccurrence(raw);
    if (typeof r === "string") return json({ error: r }, { status: 400 });
    inputs.push(r);
  }

  const client = createShiftRelayClient({
    relays: shiftRelays(),
    maxWait: 4000,
  });
  const published: ShiftOccurrence[] = [];
  const failed: { key: string; error: string }[] = [];
  try {
    for (const input of inputs) {
      try {
        const { occurrence, results } = await client.publishOccurrence({
          signer: g.signer,
          ...input,
        });
        const accepted = results.filter((r) => r.status === "fulfilled").length;
        if (accepted) published.push(occurrence);
        else {
          const first = results.find(
            (r): r is PromiseRejectedResult => r.status === "rejected",
          );
          failed.push({
            key: `${input.date}-${input.code}`,
            error: String(first?.reason ?? "no relay accepted it"),
          });
        }
      } catch (err) {
        failed.push({
          key: `${input.date}-${input.code}`,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    client.close();
  }
  const status = published.length ? 200 : 502;
  return json(
    { ok: published.length > 0, pubkey: g.signer.pubkey, published, failed },
    { status },
  );
};

export const DELETE: RequestHandler = async ({ request, cookies }) => {
  const g = await gate(cookies.get(SESSION_COOKIE));
  if (!g.ok) return json({ error: g.error }, { status: g.status });

  let body: { occurrences?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const list = Array.isArray(body.occurrences) ? body.occurrences : [];
  if (!list.length)
    return json({ error: "Nothing to retract" }, { status: 400 });
  if (list.length > MAX_BATCH)
    return json({ error: `At most ${MAX_BATCH} at once` }, { status: 400 });
  const targets: { address: string; id?: string; pubkey: string }[] = [];
  for (const raw of list) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const address = String(r.address ?? "");
    const addr = parseShiftAddress(address);
    const key = addr && parseShiftDTag(addr.dTag);
    if (
      !addr ||
      addr.kind !== SHIFT_OCCURRENCE_KIND ||
      !key ||
      key.kind !== "shift"
    ) {
      return json(
        { error: `Not a shift occurrence address: ${address}` },
        { status: 400 },
      );
    }
    // Only our own: NIP-09 lets an author retract its own events and nothing
    // else, so a foreign coordinate would be a silent no-op on the relay and
    // a lie on the board.
    if (addr.pubkey.toLowerCase() !== g.signer.pubkey) {
      return json(
        { error: `Not published by this coordinator: ${address}` },
        { status: 403 },
      );
    }
    const id =
      typeof r.id === "string" && /^[0-9a-f]{64}$/.test(r.id)
        ? r.id
        : undefined;
    targets.push({ address, ...(id ? { id } : {}), pubkey: addr.pubkey });
  }
  const reason =
    typeof body.reason === "string"
      ? body.reason.trim().slice(0, 200)
      : undefined;

  const client = createShiftRelayClient({
    relays: shiftRelays(),
    maxWait: 4000,
  });
  try {
    const { event, results } = await client.deleteOccurrences({
      signer: g.signer,
      occurrences: targets,
      reason,
    });
    const accepted = results.filter((r) => r.status === "fulfilled").length;
    if (!accepted) {
      const first = results.find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      return json(
        { error: `No relay accepted the retraction: ${first?.reason}` },
        { status: 502 },
      );
    }
    return json({
      ok: true,
      id: event.id,
      retracted: targets.map((t) => t.address),
      relaysAccepted: accepted,
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Retraction failed" },
      { status: 502 },
    );
  } finally {
    client.close();
  }
};
