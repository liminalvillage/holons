// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SankeyLayoutLink, SankeyLayoutNode } from "@holons/core/flows";

/** One party as a row of a list under a diagram. */
export interface FlowListRow {
  id: string;
  label: string;
  kind: string;
  /** The value as text, already formatted. */
  value: string;
  /** A second line under the name. */
  note?: string;
}

/** What a tap on a diagram chose. */
export type Selection =
  | { type: "node"; node: SankeyLayoutNode }
  | { type: "link"; link: SankeyLayoutLink };

/** One button of an account's action row. */
export interface AccountAction {
  id: string;
  icon: import("./icons").IconName;
  label: string;
  /** A link instead of a button. */
  href?: string;
  disabled?: boolean;
  /** The one the account is for: drawn filled. */
  main?: boolean;
}
