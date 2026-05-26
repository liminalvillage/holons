/**
 * Active Holon Identity Store
 *
 * When a user is a member of multiple holons, they must select which holon
 * they're "acting as" when writing to federated holons.
 *
 * This store tracks:
 * - The currently selected holon identity (actingAsHolon)
 * - The list of holons the current user is a member of
 */

import { writable, derived, get } from "svelte/store";

interface HolonMembership {
  id: string;
  name: string;
  isOwner: boolean;
}

// The holon the user is currently acting on behalf of
export const activeHolonIdentity = writable<string | null>(null);

// List of holons the current user is a member of
export const userHolons = writable<HolonMembership[]>([]);

// Derived store that returns the current active holon info
export const activeHolonInfo = derived(
  [activeHolonIdentity, userHolons],
  ([$activeHolonIdentity, $userHolons]) => {
    if (!$activeHolonIdentity) return null;
    return $userHolons.find((h) => h.id === $activeHolonIdentity) || null;
  },
);

// Store functions
export const activeHolonIdentityStore = {
  /**
   * Set the active holon identity
   */
  setActiveHolon(holonId: string | null) {
    activeHolonIdentity.set(holonId);
    if (holonId) {
      localStorage.setItem("activeHolonIdentity", holonId);
    } else {
      localStorage.removeItem("activeHolonIdentity");
    }
  },

  /**
   * Update the list of holons the user is a member of
   */
  setUserHolons(holons: HolonMembership[]) {
    userHolons.set(holons);

    // Auto-select the first holon if none is selected
    const current = get(activeHolonIdentity);
    if (!current && holons.length > 0) {
      // Prefer owned holons, then first membership
      const owned = holons.find((h) => h.isOwner);
      this.setActiveHolon(owned?.id || holons[0].id);
    }

    // If current selection is no longer valid, reset
    if (current && !holons.find((h) => h.id === current)) {
      if (holons.length > 0) {
        const owned = holons.find((h) => h.isOwner);
        this.setActiveHolon(owned?.id || holons[0].id);
      } else {
        this.setActiveHolon(null);
      }
    }
  },

  /**
   * Add a holon to the user's memberships
   */
  addMembership(holon: HolonMembership) {
    userHolons.update((holons) => {
      if (holons.find((h) => h.id === holon.id)) {
        return holons; // Already exists
      }
      return [...holons, holon];
    });
  },

  /**
   * Remove a holon from the user's memberships
   */
  removeMembership(holonId: string) {
    userHolons.update((holons) => holons.filter((h) => h.id !== holonId));

    // If we removed the active holon, select another
    const current = get(activeHolonIdentity);
    if (current === holonId) {
      const remaining = get(userHolons);
      if (remaining.length > 0) {
        const owned = remaining.find((h) => h.isOwner);
        this.setActiveHolon(owned?.id || remaining[0].id);
      } else {
        this.setActiveHolon(null);
      }
    }
  },

  /**
   * Initialize from localStorage
   */
  init() {
    const stored = localStorage.getItem("activeHolonIdentity");
    if (stored) {
      activeHolonIdentity.set(stored);
    }
  },

  /**
   * Clear all identity state
   */
  clear() {
    activeHolonIdentity.set(null);
    userHolons.set([]);
    localStorage.removeItem("activeHolonIdentity");
  },

  /**
   * Get the current active holon ID
   */
  getActiveHolon(): string | null {
    return get(activeHolonIdentity);
  },

  /**
   * Check if a holon is the currently active one
   */
  isActiveHolon(holonId: string): boolean {
    return get(activeHolonIdentity) === holonId;
  },
};

export default activeHolonIdentityStore;
