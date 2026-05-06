/**
 * Settings-hex helper.
 *
 * Reads `settings.hex` for a holon. Returns `null` when absent or unreachable
 * (callers should treat both the same).
 */

import type { HoloSphere } from 'holosphere';

export async function readSettingsHex(
	holosphere: HoloSphere,
	holonId: string
): Promise<string | null> {
	try {
		const settings: any = await (holosphere as any).get(holonId, 'settings', holonId);
		return settings && typeof settings.hex === 'string' && settings.hex
			? settings.hex
			: null;
	} catch {
		return null;
	}
}
