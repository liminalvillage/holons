// SPDX-License-Identifier: AGPL-3.0-or-later
import type { NostrEvent } from './store/index.js';

/** App-specific parameterized-replaceable envelope (NIP-78 / NIP-33). */
export const HOLOSPHERE_KIND: 30078;
/** Append-only log entries: a regular kind, stored and never replaced. */
export const HOLOSPHERE_LOG_KIND: 1808;
export const LOG_REF_MARKERS: readonly ['prev', 'basis', 'attests', 'disputes'];

export interface LogRefs {
  prev: string[];
  basis: string[];
  attests: string[];
  disputes: string[];
  other: string[];
}

export type LogRefsInput =
  | Partial<Record<'prev' | 'basis' | 'attests' | 'disputes', string | string[]>>
  | Array<{ id: string; marker?: string } | string>;

export function generateSecretKey(): Uint8Array;
export function getPublicKey(sk: Uint8Array | string): string;
export function getEventHash(event: object): string;
export function normalizeSecretKey(sk: Uint8Array | string): Uint8Array | string;
export function toNsec(sk: Uint8Array | string): string;

export function buildEvent(params: {
  holon: string;
  lens: string;
  item: { id: string | number } & Record<string, unknown>;
  sk: Uint8Array | string;
  kind?: number;
  created_at?: number;
  extraTags?: string[][];
}): NostrEvent;

export function buildLogEvent(params: {
  holon: string;
  lens: string;
  item: Record<string, unknown>;
  sk: Uint8Array | string;
  created_at?: number;
  refs?: LogRefsInput;
  extraTags?: string[][];
}): NostrEvent;

export function logRefs(event: { tags?: string[][] } | null | undefined): LogRefs;
export function signEvent(event: { kind?: number; created_at?: number; tags?: string[][]; content?: string }, sk: Uint8Array | string): NostrEvent;
export function verifyEvent(event: unknown): boolean;
export function eventToItem(event: { content: string }): any;
export function tag(event: { tags?: string[][] }, name: string): string | undefined;
