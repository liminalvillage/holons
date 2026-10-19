// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Links from the bot into the Flows explorer (apps/flows): the same split a
// command prints as text, as a diagram someone can follow from one party to
// the next. `FLOWS_ADDRESS` says where the explorer is served; while it is
// unset the bot simply prints no link.

/** The explorer's base URL, or '' when this bot has not been told one. */
const flowsBase = () =>
  String(process.env.FLOWS_ADDRESS || '')
    .trim()
    .replace(/\/+$/, '');

/**
 * The explorer page of a person (`p`) or of a holon — a fund, a project, a
 * Pot (`h`). '' when the explorer is not configured or there is no id.
 */
export function flowsUrl(kind, id) {
  const base = flowsBase();
  const party = String(id ?? '').trim();
  if (!base || !party || (kind !== 'p' && kind !== 'h')) return '';
  return `${base}/${kind}/${encodeURIComponent(party)}`;
}

/** `label: url` as the last line of a reply, or nothing. */
export function flowsLine(label, kind, id) {
  const url = flowsUrl(kind, id);
  return url ? `\n${label}: ${url}` : '';
}
