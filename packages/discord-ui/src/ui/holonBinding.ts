/**
 * Guild -> holon binding. A Discord guild (server) is bound to exactly one
 * Holons holon; every command in that guild operates on the bound holon.
 *
 * Bindings are persisted in holosphere under a fixed system namespace so they
 * survive restarts, with an in-memory cache for hot reads.
 */
import type { HoloStore, HolonBindingStore } from '../types.js';
import { log } from '../utils/logger.js';

/** System namespace + bucket where guild->holon bindings live. */
export const BINDING_NAMESPACE = '__discord__';
export const BINDING_BUCKET = 'guildBindings';

interface BindingRecord {
  /** Holosphere keys each record by its `id` — here, the guild id. */
  id: string;
  holonId: string;
}

export class HolosphereHolonBindings implements HolonBindingStore {
  private cache = new Map<string, string>();

  constructor(private readonly holosphere: HoloStore) {}

  async get(guildId: string): Promise<string | null> {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    try {
      const record = (await this.holosphere.get(
        BINDING_NAMESPACE,
        BINDING_BUCKET,
        guildId
      )) as BindingRecord | null | undefined;
      if (record?.holonId) {
        this.cache.set(guildId, record.holonId);
        return record.holonId;
      }
    } catch (err) {
      log.warn('Failed to read guild binding', { guildId, error: String(err) });
    }
    return null;
  }

  async set(guildId: string, holonId: string): Promise<void> {
    const record: BindingRecord = { id: guildId, holonId };
    await this.holosphere.put(BINDING_NAMESPACE, BINDING_BUCKET, record);
    this.cache.set(guildId, holonId);
  }
}
