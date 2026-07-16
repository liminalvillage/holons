// SPDX-License-Identifier: AGPL-3.0-or-later
//
// In-browser tools for the kiosk's direct voice mode. Each tool reuses the
// exact write path the touch UI uses (core createTask / completion plan /
// borrow-return / membership toggles through the identity-aware writer), so a
// spoken action and a tapped one land identically in the graph — including
// the sourceRef redirection that keeps writes to federated items on their
// owner holon. Reads come from the layout's live lens subscriptions (the
// rawQuests/rawLibrary/rawRoles stores), so listing costs nothing.

import { get } from "svelte/store";
import type { AgentTool, ToolCall, ToolResult } from "@holons/ai-ui";
import { createTask, type Quest } from "@holons/core/tasks";
import { borrowItem, returnItem } from "@holons/core/library";
import { localFieldsToStored } from "@holons/core/datetime";
import {
  holonId,
  rawQuests,
  rawLibrary,
  rawRoles,
  visibleTabs,
  selectTab,
  type TabId,
} from "$lib/stores";
import { telegramUser, borrowActor } from "$lib/auth";
import { getHolosphere, getWriter, getLibraryDb } from "$lib/holosphere";
import { toggleJoin } from "$lib/membership";
import { checkComplete, recordCompletion } from "$lib/complete";
import { sourceRef, toPeople } from "$lib/data";

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

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
      "List the live items of one kind with their EXACT ids. Kinds: tasks (the backlog and calendar quests), library (borrowable things), roles.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["tasks", "library", "roles"] },
      },
      required: ["kind"],
    },
  },
  {
    name: "task_create",
    description:
      "Create a new task in the current holon. Optionally schedule it with date (and time) to make it a calendar event.",
    inputSchema: {
      type: "object",
      properties: {
        title: str("Task title"),
        description: str("Longer details (optional)"),
        category: str("Category label (optional)"),
        date: str("Scheduled local date YYYY-MM-DD (optional)"),
        time: str("Scheduled local time HH:MM, 24h (optional, requires date)"),
      },
      required: ["title"],
    },
  },
  {
    name: "task_update",
    description:
      "Edit an existing task/event: title, description, category, or schedule. Only pass the fields to change.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: str("EXACT id of the task, from the snapshot or list_items"),
        title: str("New title (optional)"),
        description: str("New description (optional)"),
        category: str("New category (optional)"),
        date: str("New local date YYYY-MM-DD (optional)"),
        time: str("New local time HH:MM, 24h (optional)"),
      },
      required: ["taskId"],
    },
  },
  {
    name: "task_toggle_join",
    description:
      "Join the current user to a task as a participant, or leave it if already joined.",
    inputSchema: {
      type: "object",
      properties: { taskId: str("EXACT id of the task") },
      required: ["taskId"],
    },
  },
  {
    name: "task_complete",
    description:
      "Mark a task completed (records the contribution accounting). Only a participant of the task can complete it.",
    inputSchema: {
      type: "object",
      properties: { taskId: str("EXACT id of the task") },
      required: ["taskId"],
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

function findQuest(taskId: string): Quest | undefined {
  return get(rawQuests).find((q) => String(q.id ?? "") === taskId);
}

/** Fresh copy from the graph, following a federated item to its owner holon. */
async function freshQuest(
  hid: string,
  local: Quest,
): Promise<{ holon: string; key: string; quest: Quest | null }> {
  const ref = sourceRef(local, String(local.id ?? ""));
  const holon = ref?.holon ?? hid;
  const key = ref?.key ?? String(local.id ?? "");
  try {
    const hs = await getHolosphere();
    const quest = ((await hs.get(holon, "quests", key)) as Quest) ?? null;
    return { holon, key, quest: quest ?? local };
  } catch {
    return { holon, key, quest: local };
  }
}

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
        return ok(call.id, `Now showing the ${tab.label} view.`);
      }

      case "list_items": {
        const kind = String(input.kind ?? "");
        if (kind === "tasks") return ok(call.id, digestTasks(get(rawQuests)));
        if (kind === "library") return ok(call.id, digestLibrary());
        if (kind === "roles") return ok(call.id, digestRoles());
        return fail(call.id, `Unknown kind "${kind}" (tasks|library|roles).`);
      }

      case "task_create": {
        const user = get(telegramUser);
        if (!user) return fail(call.id, LOGIN_REQUIRED);
        const title = String(input.title ?? "").trim();
        if (!title) return fail(call.id, "A title is required.");
        const task = createTask({
          holonId: hid,
          initiator: {
            id: user.id,
            username: user.username,
            firstName: user.first_name,
            lastName: user.last_name,
          },
          title,
          category: input.category ? String(input.category) : undefined,
        });
        task.id = newId();
        if (input.description) task.description = String(input.description);
        if (input.date) {
          const when = localFieldsToStored(
            String(input.date),
            input.time ? String(input.time) : "",
          );
          if (when) task.when = when;
        }
        const writer = await getWriter(hid);
        const saved = await writer.put("quests", task);
        return saved
          ? ok(call.id, `Created task "${title}" (id ${task.id}).`)
          : fail(call.id, "The write was denied — could not create the task.");
      }

      case "task_update": {
        const local = findQuest(String(input.taskId ?? ""));
        if (!local) {
          return fail(
            call.id,
            `No task with id "${String(input.taskId)}". Real items: ${digestTasks(get(rawQuests))}`,
          );
        }
        const { holon, quest } = await freshQuest(hid, local);
        if (!quest) return fail(call.id, "Task not found in the graph.");
        let when = quest.when;
        if (input.date) {
          when =
            localFieldsToStored(
              String(input.date),
              input.time ? String(input.time) : "",
            ) ?? when;
        }
        const updated: Quest = {
          ...quest,
          title: input.title ? String(input.title).trim() : quest.title,
          description: input.description
            ? String(input.description)
            : quest.description,
          category: input.category ? String(input.category) : quest.category,
          when,
        };
        const writer = await getWriter(holon);
        const saved = await writer.put("quests", updated);
        return saved
          ? ok(call.id, `Updated "${updated.title}".`)
          : fail(call.id, "The write was denied — could not save the task.");
      }

      case "task_toggle_join": {
        const user = get(telegramUser);
        if (!user) return fail(call.id, LOGIN_REQUIRED);
        const local = findQuest(String(input.taskId ?? ""));
        if (!local) {
          return fail(
            call.id,
            `No task with id "${String(input.taskId)}". Real items: ${digestTasks(get(rawQuests))}`,
          );
        }
        const id = String(local.id ?? "");
        const done = await toggleJoin(hid, id, user, sourceRef(local, id));
        return done
          ? ok(call.id, `Toggled participation on "${local.title}".`)
          : fail(call.id, "Could not update participation.");
      }

      case "task_complete": {
        const user = get(telegramUser);
        if (!user) return fail(call.id, LOGIN_REQUIRED);
        const local = findQuest(String(input.taskId ?? ""));
        if (!local) {
          return fail(
            call.id,
            `No task with id "${String(input.taskId)}". Real items: ${digestTasks(get(rawQuests))}`,
          );
        }
        const { holon, quest } = await freshQuest(hid, local);
        const check = checkComplete(quest ?? local, user.id);
        if (!check.ok) {
          const why =
            check.reason === "already-completed"
              ? "It is already completed."
              : check.reason === "stopped"
                ? "The task was stopped."
                : "Only a participant can complete it — the user must join the task first (task_toggle_join).";
          return fail(call.id, `Cannot complete "${local.title}": ${why}`);
        }
        const rec = await recordCompletion(holon, check.task);
        return rec.ok
          ? ok(call.id, `Completed "${local.title}" — contribution recorded.`)
          : fail(call.id, "Completion write failed.");
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
          const res = await borrowItem(db, holon, key, actor, due);
          return res.ok
            ? ok(call.id, `Borrowed "${title}" until ${due.toDateString()}.`)
            : fail(call.id, `Borrow failed: ${res.reason}.`);
        }
        const res = await returnItem(db, holon, key, actor);
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
