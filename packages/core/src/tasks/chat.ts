// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// A chat per task. Messages are records of the `taskchat` lens in the task's
// HOME holon (local-first: they sync, cache and enforce like any lens), and
// each is also projected as a NIP-29 kind-9 in the task's group
// (`@holons/core/nostr` chatCodec). Who may write is the home holon's
// membership — the same rule every lens read applies — so a task needs no
// group state of its own. A hologram of the task resolves to its source
// (`taskRef`), so everyone looking at one task shares one chat.
//
// A private task has no chat yet: its audience would have to be mirrored
// onto every message, and a kind 9 would leak the text.

import type { HoloSphere } from 'holosphere';
import { may } from '../holosphere/capabilities.js';
import type { WriteStanding } from '../holosphere/authority.js';
import { sourceRef } from '../holosphere/provenance.js';
import { TASKCHAT_LENS, taskChatGroupId, type TaskChatRecord } from '../nostr/codecs/chat.js';

export { TASKCHAT_LENS, taskChatGroupId };

/** Where a task really lives: the record every viewer's chat and board hang off. */
export interface TaskRef {
  holon: string;
  key: string;
}

/** The canonical task behind `rec` as seen from `viewingHolon` under `localId`. */
export function taskRef(rec: unknown, viewingHolon: string, localId: string | number): TaskRef {
  const id = String(localId);
  return sourceRef(rec, id) ?? { holon: String(viewingHolon), key: id };
}

export interface TaskChatMessage {
  id: string;
  task: string;
  text: string;
  /** Unix ms. */
  at: number;
  /** Hex pubkey of the key that signed the message, when known. */
  author: string | null;
}

export const TASK_CHAT_MAX_LENGTH = 4000;

/** Can this task have a chat at all? (Not while it is private.) */
export function taskChatAvailable(hs: HoloSphere, ref: TaskRef): boolean {
  const h = hs as unknown as { isPrivate?: (holon: string, lens: string, item?: string) => boolean };
  try {
    return !h.isPrivate?.(ref.holon, 'quests', ref.key);
  } catch {
    return true;
  }
}

/** Would a message from a key with this standing count? */
export function mayPostTaskChat(standing: WriteStanding | null | undefined): boolean {
  return !!standing && may(standing, 'content');
}

type StoreCarrier = {
  currentPubkey?: string;
  store?: { getEvents?: (holon: string, lens: string, id: string) => Array<{ pubkey?: string; created_at?: number }> };
};

/** The signer of the newest envelope for this message, else what the record says. */
function authorOf(hs: HoloSphere, holon: string, rec: TaskChatRecord, id: string): string | null {
  try {
    const events = (hs as unknown as StoreCarrier).store?.getEvents?.(holon, TASKCHAT_LENS, id) ?? [];
    const newest = [...events].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
    if (newest?.pubkey) return newest.pubkey;
  } catch {
    /* store without envelopes: fall back */
  }
  return typeof rec.author === 'string' && rec.author ? rec.author : null;
}

function toMessage(hs: HoloSphere, ref: TaskRef, rec: unknown): TaskChatMessage | null {
  const r = rec as TaskChatRecord | null;
  if (!r || typeof r !== 'object' || r._deleted) return null;
  if (String(r.task ?? '') !== ref.key) return null;
  const text = typeof r.text === 'string' ? r.text.trim() : '';
  if (!text || r.id === undefined || r.id === null) return null;
  const id = String(r.id);
  return { id, task: ref.key, text, at: Number(r.at) || 0, author: authorOf(hs, ref.holon, r, id) };
}

const byTime = (a: TaskChatMessage, b: TaskChatMessage) => a.at - b.at || a.id.localeCompare(b.id);

/** Post a message to a task's chat. Throws on empty / oversize text or a private task. */
export async function sendTaskChatMessage(
  hs: HoloSphere,
  ref: TaskRef,
  text: string,
  opts: { now?: () => number; random?: () => string } = {},
): Promise<TaskChatMessage> {
  const body = String(text ?? '').trim();
  if (!body) throw new Error('Empty message');
  if (body.length > TASK_CHAT_MAX_LENGTH) throw new Error(`Message longer than ${TASK_CHAT_MAX_LENGTH} characters`);
  if (!taskChatAvailable(hs, ref)) throw new Error('A private task has no chat');
  const at = (opts.now ?? Date.now)();
  const rand = (opts.random ?? (() => Math.random().toString(36).slice(2, 8)))();
  const id = `${at.toString(36)}-${rand}`;
  const author = (hs as unknown as StoreCarrier).currentPubkey || undefined;
  const record: TaskChatRecord = { id, task: ref.key, text: body, at, ...(author ? { author } : {}) };
  const res = (await hs.put(ref.holon, TASKCHAT_LENS, record)) as unknown;
  if (res === false || (res && typeof res === 'object' && (res as { success?: boolean }).success === false)) {
    throw new Error('Message not saved');
  }
  return { id, task: ref.key, text: body, at, author: author ?? null };
}

/** A task's messages, oldest first. */
export async function listTaskChat(hs: HoloSphere, ref: TaskRef): Promise<TaskChatMessage[]> {
  const all = ((await hs.getAll(ref.holon, TASKCHAT_LENS)) ?? []) as unknown[];
  return all.map((r) => toMessage(hs, ref, r)).filter((m): m is TaskChatMessage => !!m).sort(byTime);
}

/**
 * Follow a task's chat: `onChange` gets every message, oldest first, on the
 * snapshot and on each change. One lens subscription; call the returned
 * function to release it.
 */
export function watchTaskChat(
  hs: HoloSphere,
  ref: TaskRef,
  onChange: (messages: TaskChatMessage[]) => void,
): () => void {
  const messages = new Map<string, TaskChatMessage>();
  let active = true;
  let queued = false;
  const emit = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (active) onChange([...messages.values()].sort(byTime));
    });
  };
  const sub = hs.subscribe(ref.holon, TASKCHAT_LENS, (data: unknown, key?: string) => {
    if (!active) return;
    const id = key ?? (data as { id?: unknown } | null)?.id;
    const msg = toMessage(hs, ref, data);
    if (msg) messages.set(msg.id, msg);
    else if (id !== undefined && id !== null && messages.delete(String(id))) emit();
    if (msg) emit();
  });
  // An empty chat replays nothing: say so once.
  emit();
  return () => {
    active = false;
    sub.unsubscribe();
  };
}
