// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

// Android fires `contextmenu` on a touch long-press, and the menu it pops
// cancels the pointer underneath: every hold gesture on the kiosk (lift a
// drawer chip to schedule it, hold an empty hour to draw an event, hold a
// sticky note to reorder it) dies at ~500 ms with the native menu on top.
// iOS is covered by `-webkit-touch-callout: none`; this is the Android half.
//
// Only a touch/pen press is swallowed — a mouse right-click still opens the
// browser menu — and never inside a field, where the menu IS the way to
// paste. Kept as a pure decision so it has a test.

/** Pointer types whose long-press pops a menu that eats the gesture. */
const HOLD_POINTERS: readonly string[] = ["touch", "pen"];

/** Where the native menu stays: text entry. */
const EDITABLE =
  "input, textarea, select, [contenteditable=''], [contenteditable='true']";

/**
 * Should this `contextmenu` be swallowed? `pointerType` is the type of the
 * last pointerdown (the menu event itself doesn't carry one everywhere).
 */
export function swallowsContextMenu(
  pointerType: string | null | undefined,
  target: EventTarget | null,
): boolean {
  if (!pointerType || !HOLD_POINTERS.includes(pointerType)) return false;
  // Duck-typed: the tests run without a DOM, and a window/document target
  // has no `closest` and is never a field.
  const el =
    target && typeof (target as Element).closest === "function"
      ? (target as Element)
      : null;
  if (el?.closest(EDITABLE)) return false;
  return true;
}
