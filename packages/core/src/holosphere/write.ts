/**
 * Identity-aware writes.
 *
 * `writeWithIdentity` wraps `holosphere.put` so every call:
 *   1. attaches the current `actingAs` identity (so federated permission
 *      checks see who is doing the write), and
 *   2. catches `AuthorizationError` / "Write access denied" and turns it
 *      into a `false` return + optional UI notification — non-auth errors
 *      still bubble up.
 *
 * Both UIs depend on this single implementation so behaviour stays identical.
 */

import type { HoloSphere } from 'holosphere';
import { canWriteToHolon, resolveActingAs, type ActingAsResolver } from './identity.js';

/** Options for {@link writeWithIdentity}. */
export interface WriteWithIdentityOptions {
  /** Resolver for the acting-as identity. */
  actingAs?: ActingAsResolver;
  /** Optional callback invoked when the write is denied. */
  onDenied?: (info: WriteDeniedInfo) => void;
  /** Suppress the `onDenied` callback for this call (errors still logged). */
  silent?: boolean;
  /**
   * Write to the given holon/key even when a hologram already sits there.
   *
   * HoloSphere normally follows a hologram — a record mirrored here BY
   * REFERENCE — and redirects the write to the source holon, which is what
   * editing a federated record should do. Un-mirroring is the exception: the
   * pointer itself is the thing being changed, so the write has to land on the
   * local key instead of chasing it to someone else's graph.
   */
  disableHologramRedirection?: boolean;
}

/** Information passed to {@link WriteWithIdentityOptions.onDenied}. */
export interface WriteDeniedInfo {
  holonId: string;
  lensName: string;
  actingAs: string | null;
  message: string;
}

function isAuthError(error: any): boolean {
  return (
    error?.name === 'AuthorizationError' ||
    typeof error?.message === 'string' && error.message.includes('Write access denied')
  );
}

/**
 * Write `data` to `holonId`/`lensName`, attaching `actingAs` and gracefully
 * handling authorization failures.
 *
 * Returns `true` on success, `false` when the write was denied. Re-throws
 * any other error.
 */
export async function writeWithIdentity(
  holosphere: HoloSphere,
  holonId: string,
  lensName: string,
  data: unknown,
  options: WriteWithIdentityOptions = {}
): Promise<boolean> {
  const actingAs = await resolveActingAs(options.actingAs ?? null);

  try {
    await holosphere.put(holonId, lensName, data as object, {
      actingAs,
      ...(options.disableHologramRedirection ? { disableHologramRedirection: true } : {}),
    } as any);
    return true;
  } catch (error: any) {
    if (isAuthError(error)) {
      const info: WriteDeniedInfo = {
        holonId,
        lensName,
        actingAs,
        message: error?.message || 'Write access denied',
      };
      if (!options.silent && options.onDenied) {
        options.onDenied(info);
      }
      console.warn('[writeWithIdentity] Write denied:', {
        holonId: holonId?.slice(0, 12) + '...',
        lensName,
        actingAs: actingAs?.slice(0, 12) + '...',
        error: error.message,
      });
      return false;
    }
    throw error;
  }
}

/** A pre-bound writer for repeated writes against a single holon. */
export interface HolonWriter {
  put(
    lensName: string,
    data: unknown,
    options?: { silent?: boolean; disableHologramRedirection?: boolean }
  ): Promise<boolean>;
  canWrite(lensName: string): Promise<boolean>;
}

/**
 * Create a `HolonWriter` bound to a holon — useful for components or services
 * that issue many writes against the same target. Identity + denial handling
 * are captured once here.
 */
export function createHolonWriter(
  holosphere: HoloSphere,
  holonId: string,
  options: { actingAs?: ActingAsResolver; onDenied?: (info: WriteDeniedInfo) => void } = {}
): HolonWriter {
  return {
    put: (lensName, data, callOpts) =>
      writeWithIdentity(holosphere, holonId, lensName, data, {
        actingAs: options.actingAs,
        onDenied: options.onDenied,
        silent: callOpts?.silent,
        disableHologramRedirection: callOpts?.disableHologramRedirection,
      }),

    canWrite: (lensName) => canWriteToHolon(holosphere, holonId, lensName, options.actingAs ?? null),
  };
}
