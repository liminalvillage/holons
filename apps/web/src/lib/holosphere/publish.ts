/**
 * Publish to Federation — web wrapper.
 *
 * Thin Svelte-aware adapter around `@holons/core/federation`. Re-exports the
 * core API surface and provides a `publishToFederation` that wires in:
 *   - the current `nostrPublicKey` store (federation source identity), and
 *   - the local `notifyWriteDenied` toast for write-permission errors.
 *
 * The core implementation lives in `packages/core/src/federation/`.
 */

import { get } from "svelte/store";
import {
  publishToFederation as corePublishToFederation,
  type PublishContext,
  type PublishOptions,
  type PublishOutcome,
  type PublishTarget,
} from "@holons/core/federation";
import { nostrPublicKey } from "$lib/stores/nostr";
import { notifyWriteDenied } from "$lib/stores/writeNotifications";

export {
  getFederationSnapshot,
  readSettingsHex,
  type FederationSnapshot,
} from "@holons/core/federation";

export type { PublishContext, PublishOptions, PublishOutcome, PublishTarget };

export async function publishToFederation(
  ctx: PublishContext,
  target: PublishTarget,
  opts: PublishOptions = {},
): Promise<PublishOutcome> {
  const federationSourceId =
    opts.federationSourceId ?? get(nostrPublicKey) ?? ctx.holonId;

  return corePublishToFederation(ctx, target, {
    ...opts,
    federationSourceId,
    onWriteDenied:
      opts.onWriteDenied ??
      (({ message }) => {
        notifyWriteDenied(message);
      }),
  });
}
