// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Where the dashboard's DNA pages point. There is one editor for a holon's
// DNA — the kiosk's, on hubs.network — so "Edit DNA" leaves for it.

/** The kiosk origin; overridable for a local kiosk (`VITE_HUBS_URL`). */
export const HUBS_ORIGIN: string = ((import.meta.env?.VITE_HUBS_URL as string | undefined) || 'https://hubs.network').replace(/\/+$/, '');

const seg = (holon: string): string => encodeURIComponent(holon);

export const dnaHref = (holon: string): string => `/${seg(holon)}/dna`;
export const applyHref = (holon: string): string => `/${seg(holon)}/apply`;
export const holonHref = (holon: string): string => `/${seg(holon)}`;
export const editDnaHref = (holon: string): string => `${HUBS_ORIGIN}/${seg(holon)}/dna?edit`;
