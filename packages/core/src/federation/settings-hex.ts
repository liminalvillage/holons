/**
 * Settings-hex helper.
 *
 * Reads `settings.hex` for a holon. Returns `null` when absent, unreachable,
 * or not a valid H3 cell (callers should treat all the same). The validity
 * check matters because legacy settings persisted a CSS color (`'#3b82f6'`)
 * as the hex default, which would otherwise leak out as a publish target.
 */

import type { HoloSphere } from 'holosphere';

export async function readSettingsHex(
	holosphere: HoloSphere,
	holonId: string
): Promise<string | null> {
	try {
		const settings: any = await (holosphere as any).get(holonId, 'settings', holonId);
		const hex = settings && typeof settings.hex === 'string' ? settings.hex : null;
		if (!hex) return null;
		return (holosphere as any).isValidH3?.(hex) ? hex : null;
	} catch {
		return null;
	}
}
