// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Store } from './store/index.js';
import type { MembershipTimeline } from './signing.js';

export const MEMBERS_LENS: '_members';
export const SETTINGS_LENS: 'settings';
/** Is this holon id a pubkey (a personal holon)? */
export function isPubkeyHolon(holon: unknown): holon is string;
/** Every signed `_members` envelope the store holds for a holon. */
export function membersEvents(store: Store, holon: string): any[];
/** The as-of-time membership fold of a holon's `_members` log. */
export function membersTimeline(store: Store, holon: string, pinnedGenesis?: string | null): MembershipTimeline;
/** The genesis author of the `_members` log, or null. */
export function membersGenesis(store: Store, holon: string): string | null;
/** The earliest self-signed `holonPubkey` declaration in `settings`, or null. */
export function settingsAnchor(store: Store, holon: string): string | null;
/** The key that speaks for a holon: its id (pubkey), its genesis, or its settings anchor; null when nothing signed says. */
export function holonAnchor(store: Store, holon: string): string | null;
/** The newest envelope at (lens, id) signed by `author`, decoded; null when none. */
export function itemByAuthor(store: Store, holon: string, lens: string, id: string, author: string): any | null;
/** Every item of a lens as signed by `author` (newest claim per id), tombstones dropped. */
export function itemsByAuthor(store: Store, holon: string, lens: string, author: string): any[];
/** Default grant policy: the holon itself, its anchor, or a current member of its log. */
export function isAcceptedSender(store: Store, holon: string, sender: string | null | undefined): boolean;
