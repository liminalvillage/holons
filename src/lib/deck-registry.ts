import type { HoloSphere } from 'holosphere';

const DECK_REGISTRY_TABLE = 'deck_registry';

export interface DeckRegistryEntry {
  deckId: string;
  holonId: string;
  createdBy: string;      // pubkey of creator
  createdAt: string;      // ISO timestamp
  name?: string;          // optional deck name
}

/**
 * Register a deck in the global registry (called when generating PDF)
 */
export async function registerDeck(
  holosphere: HoloSphere,
  deckId: string,
  holonId: string,
  name?: string
): Promise<void> {
  const entry: DeckRegistryEntry = {
    deckId,
    holonId,
    createdBy: holosphere.client?.publicKey || 'anonymous',
    createdAt: new Date().toISOString(),
    name
  };
  await holosphere.writeGlobal(DECK_REGISTRY_TABLE, deckId, entry);
}

/**
 * Look up holon ID from deck ID
 */
export async function getHolonIdForDeck(
  holosphere: HoloSphere,
  deckId: string
): Promise<string | null> {
  const entry = await holosphere.getGlobal(DECK_REGISTRY_TABLE, deckId);
  return entry?.holonId || null;
}
