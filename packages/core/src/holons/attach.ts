// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The holon's NIP-29 state follows its settings and its DNA. The 39000
// `about` is the purpose gene's blurb, so an admin who writes the holon's
// settings doc, or writes or removes a gene, on any surface republishes the
// group state (`publishGroupState`, which sends only what changed) — no
// surface has to remember to. This is the ONE publisher of an instance's
// 39000/39001: the `settings` projection codec emits none, so no settings
// write can put back an `about` built without the genes. Wired by
// `createHoloSphere`.

import type { HoloSphere } from 'holosphere';
import { bytesToHex } from '@noble/hashes/utils';
import { GENES_LENS } from '../dna/genes.js';
import { writeAcceptance } from '../holosphere/authority.js';
import { may, type Capability } from '../holosphere/capabilities.js';
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

/** The holon's own settings doc (keyed by the holon id), not another record of the lens. */
function isHolonSettingsDoc(holon: unknown, data: any): boolean {
  return data.id !== undefined && data.id !== null && String(data.id) === String(holon).trim();
}

/**
 * After this instance writes or removes a gene of a holon it may edit the
 * DNA of, or writes the settings doc of a holon whose seats it speaks for
 * (an admin, both), republish that holon's group state. Never fails the
 * write: a failure is logged and swallowed.
 */
export function attachGroupState<T extends GroupStateHost>(host: T, opts: AttachGroupStateOptions = {}): T {
  if ((host as unknown as Record<symbol, unknown>)[ATTACHED]) return host;
  const log = opts.log ?? ((message: string, error?: unknown) => console.warn(message, error ?? ''));
  const signerOf = opts.signer ?? (() => instanceSigner(host));
  const rawPut = host.put;
  const rawDelete = host.delete;

  async function republish(holon: unknown, action: Capability): Promise<void> {
    if (holon == null || !isRegistrableHolon(holon)) return;
    const h = String(holon).trim();
    try {
      const signer = signerOf();
      if (!signer) return;
      if (!may(await writeAcceptance(host as unknown as HoloSphere, h), action)) return;
      await publishGroupState(host as unknown as HoloSphere, h, signer, { appName: host.appname });
    } catch (err) {
      log(`[holons] group state of ${h} not republished after a ${action === 'dna' ? 'DNA' : 'settings'} change`, err);
    }
  }

  host.put = async function groupStatePut(this: T, holon: any, lens: any, data: any, passwordOrOptions: any = null, options: any = {}) {
    const result = await rawPut.call(this, holon, lens, data, passwordOrOptions, options);
    const password = typeof passwordOrOptions === 'string' ? passwordOrOptions : passwordOrOptions?.password;
    const own = !password && data && typeof data === 'object' && !data._federation && !(host.isHologram?.(data) ?? false);
    if (own && lens === GENES_LENS) await republish(holon, 'dna');
    // The group state names who is seated: only a key that may seat speaks for it.
    else if (own && lens === 'settings' && isHolonSettingsDoc(holon, data)) await republish(holon, 'members');
    return result;
  };
  host.delete = async function groupStateDelete(this: T, holon: any, lens: any, key: any, ...rest: any[]) {
    const result = await rawDelete.call(this, holon, lens, key, ...rest);
    if (lens === GENES_LENS && !rest[0]) await republish(holon, 'dna');
    return result;
  };
  Object.defineProperty(host, ATTACHED, { value: true, enumerable: false });
  return host;
}
