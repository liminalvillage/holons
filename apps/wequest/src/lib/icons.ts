// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Icon path map from the WeQuest design doc — lucide-style strokes, one entry
// per glyph, paths pipe-separated. Rendered by Icon.svelte.

export const ICON_PATHS = {
  wheat:
    "M2 22 16 8|M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z|M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z|M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z|M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z",
  wrench:
    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
  heart:
    "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z",
  sprout:
    "M7 20h10|M10 20c5.5-2.5.8-6.4 3-10|M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z|M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z",
  droplet:
    "M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z",
  zap: "M13 2 4.09 12.11a1 1 0 0 0 .77 1.64H11l-1 8.25 8.91-10.11a1 1 0 0 0-.77-1.64H13z",
  book: "M12 7v14|M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",
  mic: "M12 19v3|M19 10v2a7 7 0 0 1-14 0v-2|M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z",
  lock: "M7 11V7a5 5 0 0 1 10 0v4|M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z",
  vote: "M9 12l2 2 4-4|M3 5h18v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  flame:
    "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2|M22 21v-2a4 4 0 0 0-3-3.87|M16 3.13a4 4 0 0 1 0 7.75|M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
  bag: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z|M3 6h18|M16 10a4 4 0 0 1-8 0",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z|M12 6v6l4 2",
  repeat:
    "m17 2 4 4-4 4|M3 11v-1a4 4 0 0 1 4-4h14|m7 22-4-4 4-4|M21 13v1a4 4 0 0 1-4 4H3",
  bike: "M18.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z|M5.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z|M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2z|M12 17.5V14l-3-3 4-3 2 3h2",
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** Pick a glyph for a need from its text/category — keyword heuristics. */
export function iconForText(text: string): IconName {
  const t = String(text || "").toLowerCase();
  if (/bread|flour|sourdough|bake|pasta|grain|wheat/.test(t)) return "wheat";
  if (/water|milk|drink|oil/.test(t)) return "droplet";
  if (/drill|tool|hammer|wrench|repair|fix/.test(t)) return "wrench";
  if (/care|child|nonna|sit|help|company/.test(t)) return "heart";
  if (/ride|transport|carry|deliver|bike|run/.test(t)) return "bike";
  if (/book|read/.test(t)) return "book";
  if (/light|socket|electr|power/.test(t)) return "zap";
  return "sprout";
}
