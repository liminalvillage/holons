// Effective HoloSphere appName resolution for the web client.
//
// Default comes from VITE_HOLONS_APP (or env mode). In dev builds a localStorage
// override lets you flip into production data without changing .env — see the
// toggle in BrowserPanel's footer. Three call sites read this:
//   - routes/+layout.svelte (HoloSphere construction)
//   - dashboard/browser/BrowserPanel.svelte (footer label + toggle)
//   - components/Map.svelte (presence-cache namespace)

const STORAGE_KEY = 'holons_app_override';

// Override is dev-only. Production builds ignore localStorage entirely — no
// amount of devtools fiddling can connect a prod build to HolonsDebug data.
// The DEV check is inlined as a constant so the dead branch tree-shakes away.
const ALLOW_OVERRIDE = import.meta.env.DEV === true;

function envDefault(): string {
    const v = import.meta.env.VITE_HOLONS_APP;
    if (v) return String(v);
    return import.meta.env.MODE === 'production' ? 'Holons' : 'HolonsDebug';
}

/** Read the override without falling back. Returns null in prod or off-browser. */
export function getAppNameOverride(): string | null {
    if (!ALLOW_OVERRIDE) return null;
    if (typeof localStorage === 'undefined') return null;
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

/** The appName the page should actually connect with. */
export function getEffectiveAppName(): string {
    return getAppNameOverride() || envDefault();
}

/** The env-driven default — what the page would use without an override. */
export function getDefaultAppName(): string {
    return envDefault();
}

/** Persist (or clear) the override. No-op in prod. Caller reloads. */
export function setAppNameOverride(name: string | null): void {
    if (!ALLOW_OVERRIDE) return;
    if (typeof localStorage === 'undefined') return;
    try {
        if (name == null) localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, name);
    } catch {
        // localStorage quota / privacy mode — silently no-op
    }
}
