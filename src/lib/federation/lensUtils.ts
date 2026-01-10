/**
 * Shared lens utilities for federation components
 */

// All possible lenses that could be federated
export const ALL_LENSES = [
    'quests', 'offers', 'tags', 'expenses',
    'announcements', 'users', 'shopping', 'recurring', 'library'
] as const;

// Default commonly federated lenses
export const COMMON_LENSES = ['quests', 'offers', 'announcements'] as const;

// Lens icons mapping
const LENS_ICONS: Record<string, string> = {
    'quests': '🎯',
    'offers': '🎁',
    'tags': '🏷️',
    'expenses': '💰',
    'announcements': '📢',
    'users': '👥',
    'shopping': '🛒',
    'recurring': '🔄',
    'library': '📚'
};

/**
 * Normalize lens name for comparison (case-insensitive)
 */
export function normalizeLensName(lensName: string): string {
    return lensName.toLowerCase();
}

/**
 * Get canonical lens name (always lowercase)
 */
export function getCanonicalLensName(lensName: string): string {
    return lensName.toLowerCase();
}

/**
 * Check if a lens is in a lens array (case-insensitive)
 */
export function isLensInArray(lens: string, lensArray: string[] | undefined): boolean {
    if (!lensArray || !Array.isArray(lensArray)) return false;
    const normalizedLens = normalizeLensName(lens);
    return lensArray.some(l => normalizeLensName(l) === normalizedLens);
}

/**
 * Get icon for a lens type
 */
export function getLensIcon(lens: string): string {
    const normalizedLens = normalizeLensName(lens);
    return LENS_ICONS[normalizedLens] || '📦';
}

/**
 * Get status color class for a federation partner
 */
export function getStatusColor(status: string): string {
    switch (status) {
        case 'connected': return 'text-green-400';
        case 'pending': return 'text-yellow-400';
        case 'rejected': return 'text-red-400';
        case 'error': return 'text-red-400';
        case 'draft': return 'text-gray-400';
        default: return 'text-gray-400';
    }
}

/**
 * Get background color for status indicator
 */
export function getStatusBgColor(status: string): string {
    switch (status) {
        case 'connected': return 'bg-green-500';
        case 'pending': return 'bg-amber-500';
        case 'rejected': return 'bg-red-500';
        case 'error': return 'bg-red-500';
        case 'draft': return 'bg-gray-400';
        default: return 'bg-gray-500';
    }
}

/**
 * Shorten public key for display
 */
export function shortenPubKey(pubKey: string): string {
    if (!pubKey || pubKey.length < 20) return pubKey;
    return `${pubKey.slice(0, 10)}...${pubKey.slice(-8)}`;
}
