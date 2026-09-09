// SPDX-License-Identifier: AGPL-3.0-or-later
//
// In-browser tools for the kiosk's direct voice mode.
//
// Task writes are NOT performed here: the task tools come from the shared
// catalogue in @holons/core/actions (the same names and arguments the MCP
// server exposes) and are staged into the review drawer by voice/plan.ts —
// nothing lands until the user taps Apply. What this module still executes
// directly are reads (from the layout's live lens subscriptions, so listing
// costs nothing), UI actions (navigate, plan_discard) and, for now, the
// library borrow/return pair, which reuses the exact write path the touch UI
// uses — including the sourceRef redirection that keeps writes to federated
// items on their owner holon.

import { get } from "svelte/store";
import type { AgentTool, ToolCall, ToolResult } from "@holons/ai-ui";
import type { Quest } from "@holons/core/tasks";
import { TASK_ACTIONS, toJsonSchema } from "@holons/core/actions";
import {
  borrowItem,
  returnItem,
  recordBorrowAccounting,
  recordReturnAccounting,
} from "@holons/core/library";
import {
  holonId,
  holonName,
  rawLibrary,
  rawRoles,
  visibleTabs,
  type TabId,
} from "$lib/stores";
import { borrowActor } from "$lib/auth";
import { getLibraryDb } from "$lib/holosphere";
import { sourceRef, toPeople } from "$lib/data";
import { discardPlan, findChange, projectedQuests } from "$lib/voice/plan";
import { loadMembers } from "$lib/members";
import { personLabel } from "@holons/core/actions";

const str = (description: string) => ({ type: "string", description });

export const KIOSK_VOICE_TOOLS: AgentTool[] = [
  {
    name: "navigate",
    description:
      "Switch the kiosk screen to another view/tab. Only changes what is on screen, never data.",
    inputSchema: {
      type: "object",
      properties: {
        view: str('Target view id, one of the "views" list in the UI context'),
      },
      required: ["view"],
    },
  },
  {
    name: "list_items",
    description:
      "List the live items of one kind with their EXACT ids. Kinds: tasks (the backlog and calendar quests, including changes still pending review), library (borrowable things), roles, members (the people of this holon).",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["tasks", "library", "roles", "members"],
        },
      },
      required: ["kind"],
    },
  },
  // The task actions — one catalogue, shared with the MCP server. Every one of
  // them is staged for approval, never executed from here.
  ...TASK_ACTIONS.map(toJsonSchema),
  {
    name: "plan_discard",
    description:
      "Drop a proposed change from the review panel (or all of them) when the user changes their mind. Never needed to apply anything — only the user can apply, by touch.",
    inputSchema: {
      type: "object",
      properties: {
        change: str(
          'Which proposed change: the task title it targets, or "all". Omit for all.',
        ),
      },
    },
  },
  {
    name: "library_borrow",
    description: "Borrow a library item for the current user.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: str("EXACT id of the library item"),
        days: {
          type: "number",
          description: "Loan length in days (default 7)",
        },
      },
      required: ["itemId"],
    },
  },
  {
    name: "library_return",
    description: "Return a borrowed library item.",
    inputSchema: {
      type: "object",
      properties: { itemId: str("EXACT id of the library item") },
      required: ["itemId"],
    },
  },
];

// ── Digests (compact, spoken-friendly, id-bearing) ─────────────────────────

const CAP = 40;

export function digestTasks(quests: Quest[]): string {
  const rows = quests.slice(0, CAP).map((q) => ({
    id: String(q.id ?? ""),
    title: q.title,
    status: q.status,
    ...(q.when ? { when: q.when } : {}),
    ...(q.category ? { category: q.category } : {}),
    participants: toPeople(q.participants).map((p) => p.name),
  }));
  return JSON.stringify(rows);
}

function digestLibrary(): string {
  const rows = get(rawLibrary)
    .slice(0, CAP)
    .map((it) => {
      const r = it as Record<string, unknown>;
      return {
        id: String(r.id ?? ""),
        title: String(r.description ?? r.name ?? r.id ?? ""),
        borrowed: !!r.borrowed,
      };
    });
  return JSON.stringify(rows);
}

function digestRoles(): string {
  const rows = get(rawRoles)
    .slice(0, CAP)
    .map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        id: String(rec.id ?? ""),
        title: String(rec.title ?? rec.name ?? ""),
        holders: toPeople(rec.participants).map((p) => p.name),
      };
    });
  return JSON.stringify(rows);
}

export function digestMembers(
  members: Array<{
    id: string | number;
    username?: string;
    first_name?: string;
    last_name?: string;
  }>,
): string {
  return JSON.stringify(
    members
      .slice(0, 60)
      .map((m) => ({ id: String(m.id), name: personLabel(m) })),
  );
}

// ── Dispatch ────────────────────────────────────────────────────────────────

const ok = (id: string, content: string): ToolResult => ({
  id,
  content,
  isError: false,
});
const fail = (id: string, content: string): ToolResult => ({
  id,
  content,
  isError: true,
});

const LOGIN_REQUIRED =
  "No one is logged in on this kiosk. Ask the user to log in with Telegram (the account button in the header) first.";

/**
 * Execute one voice-agent tool call against the kiosk's live state. The
 * `onNavigate` callback owns the actual tab switch side-effect so the widget
 * can also surface it.
 */
export async function dispatchKioskTool(
  call: ToolCall,
  onNavigate: (view: TabId) => void,
): Promise<ToolResult> {
  const hid = get(holonId);
  if (!hid) return fail(call.id, "No holon is configured on this kiosk.");
  const input = call.input ?? {};

  try {
    switch (call.name) {
      case "navigate": {
        const view = String(input.view ?? "").trim();
        const tab = get(visibleTabs).find((t) => t.id === view);
        if (!tab) {
          return fail(
            call.id,
            `Unknown view "${view}". Valid views: ${get(visibleTabs)
              .map((t) => t.id)
              .join(", ")}.`,
          );
        }
        onNavigate(tab.id);
        return ok(call.id, `Now showing the ${tab.id} view.`);
      }

      case "list_items": {
        const kind = String(input.kind ?? "");
        if (kind === "tasks")
          return ok(call.id, digestTasks(projectedQuests()));
        if (kind === "library") return ok(call.id, digestLibrary());
        if (kind === "roles") return ok(call.id, digestRoles());
        if (kind === "members")
          return ok(call.id, digestMembers(await loadMembers(hid)));
        return fail(
          call.id,
          `Unknown kind "${kind}" (tasks|library|roles|members).`,
        );
      }

      case "plan_discard": {
        const ref = String(input.change ?? "").trim();
        if (!ref || ref.toLowerCase() === "all") {
          const n = discardPlan();
          return ok(
            call.id,
            n ? `Discarded ${n} proposed change(s).` : "Nothing was pending.",
          );
        }
        const change = findChange(ref);
        if (!change)
          return fail(call.id, `No proposed change matches "${ref}".`);
        discardPlan(change.id);
        return ok(
          call.id,
          `Discarded the proposed change to "${change.title}".`,
        );
      }

      case "library_borrow":
      case "library_return": {
        const actor = borrowActor();
        if (!actor) return fail(call.id, LOGIN_REQUIRED);
        const itemId = String(input.itemId ?? "");
        const local = get(rawLibrary).find(
          (it) => String(it.id ?? "") === itemId,
        );
        if (!local) {
          return fail(
            call.id,
            `No library item with id "${itemId}". Real items: ${digestLibrary()}`,
          );
        }
        const ref = sourceRef(local, itemId);
        const holon = ref?.holon ?? hid;
        const key = ref?.key ?? itemId;
        const db = await getLibraryDb();
        const title = String(
          (local as Record<string, unknown>).description ?? itemId,
        );
        if (call.name === "library_borrow") {
          const days = typeof input.days === "number" ? input.days : 7;
          const due = new Date(Date.now() + days * 86_400_000);
          const res = await borrowItem(db, holon, key, actor, due, {
            actingHolon: hid,
            actingHolonName: get(holonName) || null,
          });
          // Same bookkeeping as a tapped borrow (DetailModal): the credit
          // charge into the expenses lens. The REA events come from the
          // ledger projection on the library write itself.
          if (res.ok && res.item)
            await recordBorrowAccounting({ db }, holon, actor, res.item);
          return res.ok
            ? ok(call.id, `Borrowed "${title}" until ${due.toDateString()}.`)
            : fail(call.id, `Borrow failed: ${res.reason}.`);
        }
        const res = await returnItem(db, holon, key, actor);
        if (res.ok && res.item)
          await recordReturnAccounting({ db }, holon, actor, res.item);
        return res.ok
          ? ok(call.id, `Returned "${title}".`)
          : fail(call.id, `Return failed: ${res.reason}.`);
      }

      default:
        return fail(call.id, `Unknown tool "${call.name}".`);
    }
  } catch (err) {
    return fail(call.id, err instanceof Error ? err.message : String(err));
  }
}
