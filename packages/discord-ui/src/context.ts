/**
 * Builds the per-interaction `InvocationContext` handed to feature handlers.
 * Resolves the originating guild's bound holon and exposes a `core()` factory
 * that produces a `@holons/core` CommandContext for the acting user.
 */
import type { CommandContext } from '@holons/core/commands';
import type {
  DiscordUser,
  HoloStore,
  HolonBindingStore,
  InvocationContext,
} from './types.js';
import { config } from './utils/config.js';
import { log } from './utils/logger.js';

export interface BuildContextOptions {
  holosphere: HoloStore;
  bindings: HolonBindingStore;
  /** Originating guild id, or null for DMs / non-guild interactions. */
  guildId: string | null;
}

export async function buildInvocationContext(
  opts: BuildContextOptions
): Promise<InvocationContext> {
  const { holosphere, bindings, guildId } = opts;
  const holonId = guildId ? await bindings.get(guildId) : null;

  return {
    holosphere,
    holonId,
    appName: config.appName,
    bindings,
    core(user: DiscordUser): CommandContext {
      return {
        source: 'discord',
        userId: user.id,
        userName: user.username,
        holonId: holonId ?? undefined,
        holosphere,
        logger: log,
      };
    },
  };
}
