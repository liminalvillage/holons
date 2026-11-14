// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The holon's NIP-29 state follows its DNA. The 39000 `about` is the
// purpose gene's blurb, so an admin who writes or removes a gene on any
// surface republishes the group state (`publishGroupState`, which sends
// only what changed) — no surface has to remember to. Wired by
// `createHoloSphere`.

import type { HoloSphere } from 'holosphere';
import { bytesToHex } from '@noble/hashes/utils';
import { GENES_LENS } from '../dna/genes.js';
import { writeAcceptance } from '../holosphere/authority.js';
import { may } from '../holosphere/capabilities.js';
import { signerFromSecretKey, type NostrSigner } from '../holosphere/signers.js';
import { isRegistrableHolon } from '../holosphere/registry.js';
import { publishGroupState } from './index.js';

export interface GroupStateHost {
  put(holon: string | null, lens: string, data: any, passwordOrOptions?: any, options?: any): Promise<any>;
  delete(holon: string | null, lens: string, key: string, password?: any, options?: any): Promise<any>;
  isHologram?(data: unknown): boolean;
  appname?: string;
}

export interface AttachGroupStateOptions {
  /** Signs the state; default: the instance's own key, whichever is logged in at the time. */
  signer?: () => NostrSigner | null;
  /** Report a failure; defaults to `console.warn`. */
  log?: (message: string, error?: unknown) => void;
}

const ATTACHED = Symbol.for('holons.groupstate.attached');

/** The instance's current key as a signer (the kiosk swaps keys at login). */
function instanceSigner(host: object): NostrSigner | null {
  const sk = (host as { _privateKey?: Uint8Array | string | null })._privateKey;
  if (!sk) return null;
  try {
    return signerFromSecretKey(typeof sk === 'string' ? sk : bytesToHex(sk));
  } catch {
    return null;
  }
}

/**
 * After this instance writes or removes a gene of a holon it may edit the
 * DNA of (an admin), republish that holon's group state. Never blocks or
 * fails the write: a failure is logged and swallowed.
 */
export function attachGroupState<T extends GroupStateHost>(host: T, opts: AttachGroupStateOptions = {}): T {
  if ((host as unknown as Record<symbol, unknown>)[ATTACHED]) return host;
  const log = opts.log ?? ((message: string, error?: unknown) => console.warn(message, error ?? ''));
  const signerOf = opts.signer ?? (() => instanceSigner(host));
  const rawPut = host.put;
  const rawDelete = host.delete;

  async function republish(holon: unknown): Promise<void> {
    if (holon == null || !isRegistrableHolon(holon)) return;
    const h = String(holon).trim();
    try {
      const signer = signerOf();
      if (!signer) return;
      if (!may(await writeAcceptance(host as unknown as HoloSphere, h), 'dna')) return;
      await publishGroupState(host as unknown as HoloSphere, h, signer, { appName: host.appname });
    } catch (err) {
      log(`[holons] group state of ${h} not republished after a DNA change`, err);
    }
  }

  host.put = async function groupStatePut(this: T, holon: any, lens: any, data: any, passwordOrOptions: any = null, options: any = {}) {
    const result = await rawPut.call(this, holon, lens, data, passwordOrOptions, options);
    const password = typeof passwordOrOptions === 'string' ? passwordOrOptions : passwordOrOptions?.password;
    if (lens === GENES_LENS && !password && data && typeof data === 'object' && !data._federation && !(host.isHologram?.(data) ?? false)) await republish(holon);
    return result;
  };
  host.delete = async function groupStateDelete(this: T, holon: any, lens: any, key: any, ...rest: any[]) {
    const result = await rawDelete.call(this, holon, lens, key, ...rest);
    if (lens === GENES_LENS && !rest[0]) await republish(holon);
    return result;
  };
  Object.defineProperty(host, ATTACHED, { value: true, enumerable: false });
  return host;
}
