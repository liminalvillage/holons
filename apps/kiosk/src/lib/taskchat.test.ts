// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it as spec } from "vitest";
import { chatRows, type TaskChatMessage } from "./taskchat";

const at = (d: string) => new Date(d).getTime();
const msg = (
  id: string,
  when: string,
  author: string | null,
): TaskChatMessage => ({
  id,
  task: "q1",
  text: id,
  at: at(when),
  author,
});

describe("chat rows", () => {
  spec("a day line before each day, own messages marked, runs grouped", () => {
    const rows = chatRows(
      [
        msg("a", "2026-10-14T09:00:00", "me"),
        msg("b", "2026-10-14T09:01:00", "me"),
        msg("c", "2026-10-14T09:02:00", "you"),
        msg("d", "2026-10-15T08:00:00", "you"),
      ],
      "me",
    );
    expect(
      rows.map((r) =>
        r.kind === "day"
          ? "day"
          : `${r.key}${r.mine ? "*" : ""}${r.first ? "^" : ""}`,
      ),
    ).toEqual(["day", "a*^", "b*", "c^", "day", "d^"]);
  });

  spec("nobody signed in: nothing is mine", () => {
    const rows = chatRows([msg("a", "2026-10-14T09:00:00", null)], null);
    expect(rows.filter((r) => r.kind === "message" && r.mine)).toEqual([]);
  });
});
