// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Flows board's period, as words: the preset's name, or the custom
// bounds as dates. The bounds themselves are core's business
// (`windowFromChoice`); this only says them in the viewer's language.

import {
  FLOWS_WINDOW_PRESETS,
  windowFromChoice,
  windowSpanDays,
  type FlowsWindowChoice,
  type FlowsWindowPreset,
} from "@holons/core/flows";
import type { MessageKey, Translator } from "./i18n";

export const WINDOW_PRESETS = FLOWS_WINDOW_PRESETS;

export const WINDOW_PRESET_LABELS: Record<FlowsWindowPreset, MessageKey> = {
  week: "flows.windowWeek",
  lunation: "flows.windowLunation",
  month: "flows.windowMonth",
  "30": "flows.window30",
  "90": "flows.window90",
  year: "flows.windowYear",
  all: "flows.windowAll",
  custom: "flows.windowCustom",
};

/** The period as the board names it: a preset's name, or the custom dates. */
export function describeWindow(
  choice: FlowsWindowChoice,
  tr: Translator,
  locale: string,
  now = Date.now(),
): string {
  if (choice.preset !== "custom")
    return tr(WINDOW_PRESET_LABELS[choice.preset] ?? "flows.window90");
  const w = windowFromChoice(choice, now);
  const day = (ts: number) =>
    new Date(ts).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  if (w.from != null && w.to != null) return `${day(w.from)} – ${day(w.to)}`;
  if (w.from != null) return tr("flows.windowSince", { date: day(w.from) });
  if (w.to != null) return tr("flows.windowUntil", { date: day(w.to) });
  return tr("flows.windowAll");
}

/** "{n} days" for a bounded period; empty when it is open at the start. */
export function describeWindowSpan(
  choice: FlowsWindowChoice,
  tr: Translator,
  now = Date.now(),
): string {
  const days = windowSpanDays(windowFromChoice(choice, now), now);
  return days == null ? "" : tr("flows.windowDays", { n: String(days) });
}
