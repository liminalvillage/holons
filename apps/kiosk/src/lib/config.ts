// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Kiosk configuration. The kiosk shows a single hub holon (read-only until a
// Telegram login). Which holon and which Holosphere app namespace are resolved
// here, in priority order so a caretaker can re-point the screen without a
// rebuild — or from the in-app Settings panel, which writes the same keys:
//
//   holon : ?holon=<id>  →  URL path /<id|label>  →  subdomain map (holons.ts)  →  Settings / localStorage  →  VITE_KIOSK_HOLON  →  (unset → setup)
//   app   : ?app=<name>  →  Settings / localStorage  →  VITE_KIOSK_APP    →  "Holons"
//
// The kiosk reads PRODUCTION by default: the app namespace falls back to
// "Holons" (not the shared dev `HOLONS_APP`, which the web/bot point at
// HolonsDebug), and the Gun peer falls back to the production relay. Override
// only via the kiosk-specific `VITE_KIOSK_APP` / `VITE_KIOSK_PEER`.
//
// The wire itself is selectable too: `VITE_KIOSK_BACKEND=nostr` plus
// `VITE_KIOSK_RELAYS=wss://…` moves reads and writes onto a Nostr relay
// instead of the Gun peer (see `resolveBackend`).
//
// The query-param overrides are persisted to localStorage so a one-time setup
// URL survives reloads and power-cycles of the entrance display.

import { holonForHost, holonForPath } from "./holons";
import type { TaskSort } from "./data";

/** Production Gun relay the entrance display reads from by default. */
export const PRODUCTION_PEER = "https://gun.holons.io/gun";

const HOLON_KEY = "kiosk_holon";
const APP_KEY = "kiosk_app";
const FEDERATED_KEY = "kiosk_federated";
const LIBRARY_KEY = "kiosk_library";
const ROLES_KEY = "kiosk_roles";
const CHECKLISTS_KEY = "kiosk_checklists";
const STATUS_KEY = "kiosk_status";
const FLOWS_KEY = "kiosk_flows";
const PINNED_KEY = "kiosk_pinned";
const BRAND_NAME_KEY = "kiosk_brand_name";
const BRAND_LOGO_KEY = "kiosk_brand_logo";
const ACCENT_KEY = "kiosk_accent";
const THEME_KEY = "kiosk_theme";
const THEME_RESOLVED_KEY = "kiosk_theme_resolved";
const GEO_KEY = "kiosk_geo";
const TASK_VIEW_KEY = "kiosk_task_view";
const TASK_SORT_KEY = "kiosk_task_sort";
const LIBRARY_VIEW_KEY = "kiosk_library_view";
const ROLES_VIEW_KEY = "kiosk_roles_view";
const CAL_VIEW_KEY = "kiosk_cal_view";
const LIBRARY_CAL_VIEW_KEY = "kiosk_library_cal_view";
const VOICE_KEY_KEY = "kiosk_voice_key";
const LANG_KEY = "kiosk_lang";
const LANG_RESOLVED_KEY = "kiosk_lang_resolved";

/** The kiosk's default accent (teal). */
export const DEFAULT_ACCENT = "#0e6b66";

/** How the day/night palette is chosen. `auto` follows local sunrise/sunset. */
export type ThemeMode = "auto" | "light" | "dark";

/**
 * Hours (device-local) the fixed-schedule fallback treats as night, used only
 * when geolocation is unavailable: dark from 19:00 until 07:00.
 */
export const DARK_FALLBACK_START_HOUR = 19;
export const DARK_FALLBACK_END_HOUR = 7;

/** Base URL of the full web dashboard the "holon" header button opens. */
export const DASHBOARD_BASE = "https://dashboard.holons.io";

/** Link to a holon's full dashboard, e.g. https://dashboard.holons.io/<id>. */
export function dashboardUrl(holonId: string): string {
  return `${DASHBOARD_BASE}/${encodeURIComponent(holonId)}`;
}

/** Where the landing page sends people who want to read the protocol. */
export const DOCS_URL = "https://docs.holons.io";
/** The open community chat (feedback, questions, what others are building). */
export const COMMUNITY_URL = "https://t.me/HolonicDAO";
/** The source. Holons is AGPL-3.0-or-later; the landing page says so. */
export const SOURCE_URL = "https://github.com/HolonicLabs/holons";

/**
 * The Telegram bot a holon is started with. Public by design (it ends up in
 * every deep link on the landing page); override per-deploy with
 * `VITE_TELEGRAM_BOT_USERNAME` when a fork runs its own bot.
 */
export function resolveBotUsername(): string {
  const env = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined;
  const v = (env && String(env).trim().replace(/^@/, "")) || "";
  return /^[A-Za-z0-9_]{3,}$/.test(v) ? v : "HolonsBot";
}

/**
 * "Start a holon": Telegram's own add-to-group chooser. `?startgroup=<payload>`
 * opens the group picker (with "create a new group" right there), adds the bot
 * to the chosen chat, and delivers the payload as the group's first `/start` —
 * which is where the bot posts the link back to this screen. That round trip
 * IS the onboarding: the group is the holon, so there is nothing to sign up for.
 */
export function addToGroupUrl(payload = "hub"): string {
  return `https://t.me/${resolveBotUsername()}?startgroup=${encodeURIComponent(payload)}`;
}

/** "Talk to the bot first": a private chat, i.e. the visitor's personal holon. */
export function botChatUrl(payload = "hub"): string {
  return `https://t.me/${resolveBotUsername()}?start=${encodeURIComponent(payload)}`;
}

function readParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get(name);
  return v && v.trim() ? v.trim() : null;
}

function persisted(key: string): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persist(key: string, value: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — ignore, fall back to env each load */
  }
}

function forget(key: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ── The bot round trip ──────────────────────────────────────────────────────
//
// Starting a holon leaves this site for Telegram, and Telegram has no way to
// hand anything back. So we leave ourselves a note: when the visitor returns to
// this tab, the landing page opens the "your holon is ready" step instead of
// making them find it again. The note expires so a screen someone poked at
// last month doesn't greet the next visitor with it.

const BOT_HANDOFF_KEY = "kiosk_bot_handoff_at";
const BOT_HANDOFF_TTL_MS = 6 * 60 * 60 * 1000;

/** Note that this device just left for Telegram to start (or open) a holon. */
export function markBotHandoff(): void {
  persist(BOT_HANDOFF_KEY, String(Date.now()));
}

/** Did this device leave for the bot recently enough to still be mid-flow? */
export function returningFromBot(now = Date.now()): boolean {
  const at = Number(persisted(BOT_HANDOFF_KEY) ?? "");
  if (!Number.isFinite(at) || at <= 0) return false;
  if (now - at > BOT_HANDOFF_TTL_MS) {
    forget(BOT_HANDOFF_KEY);
    return false;
  }
  return true;
}

/** The round trip is over — the visitor landed on a holon. */
export function clearBotHandoff(): void {
  forget(BOT_HANDOFF_KEY);
}

/** Resolve the Holosphere app namespace this kiosk connects to. */
export function resolveAppName(): string {
  const fromParam = readParam("app");
  if (fromParam) persist(APP_KEY, fromParam);
  const env = import.meta.env.VITE_KIOSK_APP as string | undefined;
  return fromParam || persisted(APP_KEY) || (env && String(env)) || "Holons";
}

/** Gun peer(s) the kiosk reads from — the production relay unless overridden. */
export function resolvePeers(): string[] {
  const env = import.meta.env.VITE_KIOSK_PEER as string | undefined;
  const peer = (env && String(env).trim()) || PRODUCTION_PEER;
  return [peer];
}

/**
 * Relay URL(s) the kiosk syncs over on the `nostr` backend. Kiosk-scoped
 * `VITE_KIOSK_RELAYS` wins so a single screen can be flipped without moving
 * the whole monorepo; `VITE_HOLOSPHERE_RELAYS` (the name the web app reads)
 * is honoured as the shared fallback. Empty → no relays configured.
 */
export function resolveRelays(): string[] {
  const env =
    (import.meta.env.VITE_KIOSK_RELAYS as string | undefined) ||
    (import.meta.env.VITE_HOLOSPHERE_RELAYS as string | undefined) ||
    "";
  return String(env)
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * Which Holosphere backend carries the wire: "gun" (default — the production
 * Gun peer) or "nostr" (the relay is the wire and Gun runs peerless as the
 * local cache). Selecting `nostr` without any relay would make holosphere fall
 * back to Gun anyway, so an unconfigured relay list keeps us on "gun".
 */
export function resolveBackend(): "gun" | "nostr" {
  const env =
    (import.meta.env.VITE_KIOSK_BACKEND as string | undefined) ||
    (import.meta.env.VITE_HOLOSPHERE_BACKEND as string | undefined) ||
    "gun";
  const want = String(env).trim().toLowerCase();
  return want === "nostr" && resolveRelays().length ? "nostr" : "gun";
}

/**
 * Signing mode for the `gun` backend: "off" (default), "shadow" or "enforce".
 *
 * On the gun backend the SIGNER is the publisher — with relays configured,
 * `shadow` keeps Gun as the wire (so the kiosk still sees everything on
 * gun.holons.io) while every write is additionally published to the relay as a
 * signed NIP-01 event. `enforce` additionally narrows reads to trusted keys,
 * which is not what a public entrance display wants — keep it for testing.
 *
 * Ignored on the `nostr` backend, where the relay transport owns publishing and
 * the signer is created envelope-only during init.
 */
export function resolveSigningMode(): "off" | "shadow" | "enforce" {
  const env =
    (import.meta.env.VITE_KIOSK_SIGNING as string | undefined) ||
    (import.meta.env.VITE_HOLOSPHERE_SIGNING as string | undefined) ||
    "off";
  const want = String(env).trim().toLowerCase();
  return want === "shadow" || want === "enforce" ? want : "off";
}

/**
 * The Telegram Mini App serving the signing-key vault (routes/key), as
 * "<botUsername>/<appShortName>" — e.g. "HolonsBot/keys", registered in
 * BotFather. Unset → the key-link flow is hidden and writes stay signed by
 * the device key alone.
 */
export function resolveMiniapp(): string | null {
  const env = import.meta.env.VITE_KIOSK_MINIAPP as string | undefined;
  const v = (env && String(env).trim().replace(/^@/, "")) || "";
  return /^[A-Za-z0-9_]+\/[A-Za-z0-9_]+$/.test(v) ? v : null;
}

/** Resolve the holon id this kiosk displays, or null if not configured. */
export function resolveHolonId(): string | null {
  const fromParam = readParam("holon");
  if (fromParam) persist(HOLON_KEY, fromParam);
  // The URL path (`site.com/<id>` or a registered label) and a registered
  // subdomain (liminal.hubs.network → liminal) are authoritative for that URL —
  // one deploy serves every holon. Neither is persisted: visiting another
  // holon's link must not re-point this device. `?holon=` still overrides.
  const fromPath =
    typeof window !== "undefined"
      ? holonForPath(window.location.pathname)
      : null;
  const fromSubdomain =
    typeof window !== "undefined"
      ? holonForHost(window.location.hostname)
      : null;
  const env = import.meta.env.VITE_KIOSK_HOLON as string | undefined;
  return (
    fromParam ||
    fromPath ||
    fromSubdomain ||
    persisted(HOLON_KEY) ||
    (env ? String(env) : null)
  );
}

/** Persist the holon id chosen from the in-app Settings panel. */
export function setHolonId(id: string): void {
  persist(HOLON_KEY, id.trim());
}

/**
 * Unpin the screen: forget the remembered holon so the kiosk falls back to
 * whatever the URL says, and — at the bare root — to the home page. Note that
 * a holon named by the PATH or the HOST still wins on the next load; clearing
 * is paired with a trip back to `/` in the Settings panel.
 */
export function clearHolonId(): void {
  forget(HOLON_KEY);
}

/**
 * Whose items every content view shows — the "Show" pill:
 * `personal` (only items involving the logged-in user), `all` (everything in
 * this holon), or `networked` (this holon plus its federation partners).
 * One device-wide choice shared by every view.
 */
export type Scope = "personal" | "all" | "networked";

const SCOPE_KEY = "kiosk_scope";

/**
 * Derive the scope from what's on disk, honouring pre-scope-pill devices.
 * Priority: an explicit `kiosk_scope` wins; else a legacy per-view "personal"
 * mode (the deliberate phone-in-hand choice — migrating it to all/networked
 * would suddenly show everyone's items); else the legacy federated toggle;
 * else `all`. Pure so the matrix is testable.
 */
export function scopeFromLegacy(v: {
  scope: string | null;
  federated: string | null;
  taskView: string | null;
  libraryView: string | null;
  rolesView: string | null;
}): Scope {
  if (v.scope === "personal" || v.scope === "all" || v.scope === "networked")
    return v.scope;
  if (
    v.taskView === "personal" ||
    v.libraryView === "personal" ||
    v.rolesView === "personal"
  )
    return "personal";
  if (v.federated === "1") return "networked";
  return "all";
}

/** Resolve the persisted scope (re-mapping legacy keys on every load). */
export function resolveScope(): Scope {
  return scopeFromLegacy({
    scope: persisted(SCOPE_KEY),
    federated: persisted(FEDERATED_KEY),
    taskView: persisted(TASK_VIEW_KEY),
    libraryView: persisted(LIBRARY_VIEW_KEY),
    rolesView: persisted(ROLES_VIEW_KEY),
  });
}

/** Persist the scope chosen from a view's Show pill. */
export function setScope(scope: Scope): void {
  persist(SCOPE_KEY, scope);
}

/**
 * A caretaker's preference for an optional content tab (Library / Roles):
 * explicitly shown, explicitly hidden, or — the default — `auto`, where the
 * tab appears exactly when its lens has content. Auto is stored as *absence*
 * of the key, so a device the caretaker never configured follows the content.
 */
export type TabPref = "on" | "off" | "auto";

function resolveTabPref(key: string): TabPref {
  const v = persisted(key);
  return v === "1" ? "on" : v === "0" ? "off" : "auto";
}

function setTabPref(key: string, pref: TabPref): void {
  if (pref === "auto") forget(key);
  else persist(key, pref === "on" ? "1" : "0");
}

/** The Library tab preference; `auto` (content-driven) unless the caretaker chose. */
export function resolveLibraryPref(): TabPref {
  return resolveTabPref(LIBRARY_KEY);
}

/** Persist the Library-tab preference (`auto` clears the stored choice). */
export function setLibraryPref(pref: TabPref): void {
  setTabPref(LIBRARY_KEY, pref);
}

/** The Roles tab preference; `auto` (content-driven) unless the caretaker chose. */
export function resolveRolesPref(): TabPref {
  return resolveTabPref(ROLES_KEY);
}

/** Persist the Roles-tab preference (`auto` clears the stored choice). */
export function setRolesPref(pref: TabPref): void {
  setTabPref(ROLES_KEY, pref);
}

/** The Lists (checklists) tab preference — same tri-state as Library/Roles. */
export function resolveChecklistsPref(): TabPref {
  return resolveTabPref(CHECKLISTS_KEY);
}

/** Persist the Lists-tab preference (`auto` clears the stored choice). */
export function setChecklistsPref(pref: TabPref): void {
  setTabPref(CHECKLISTS_KEY, pref);
}

/**
 * Whether the optional Status tab (a ranked contribution leaderboard) is shown.
 * Off by default — a caretaker opts in from Settings, since not every hub wants
 * to surface member rankings on the screen.
 */
export function resolveStatusEnabled(): boolean {
  return persisted(STATUS_KEY) === "1";
}

/** Persist the Status-tab toggle. */
export function setStatusEnabled(on: boolean): void {
  persist(STATUS_KEY, on ? "1" : "0");
}

/**
 * Whether the Flows board is shown. Like Status, a pure caretaker opt-in
 * rather than content-driven: a hub with expenses still may not want its
 * finances on a screen by the door.
 */
export function resolveFlowsEnabled(): boolean {
  return persisted(FLOWS_KEY) === "1";
}

/** Persist the Flows-tab toggle. */
export function setFlowsEnabled(on: boolean): void {
  persist(FLOWS_KEY, on ? "1" : "0");
}

/**
 * The tab the kiosk is pinned to, or null to auto-rotate. Pinning lets a
 * caretaker park the screen on one view (e.g. always the Calendar). Persisted so
 * it survives a power-cycle. The id is validated against live tabs by the caller.
 */
export function resolvePinnedTab(): string | null {
  return persisted(PINNED_KEY);
}

/** Persist (or clear, when null) the pinned tab. */
export function setPinnedTab(id: string | null): void {
  if (id) persist(PINNED_KEY, id);
  else forget(PINNED_KEY);
}

/**
 * The kiosk's display name, shown in the header beside the logo. A caretaker can
 * override the holon's own name here; null means "use the holon's name".
 */
export function resolveBrandName(): string | null {
  return persisted(BRAND_NAME_KEY);
}

/** Persist (or clear, when blank) the custom display name. */
export function setBrandName(name: string): void {
  const trimmed = name.trim();
  if (trimmed) persist(BRAND_NAME_KEY, trimmed);
  else forget(BRAND_NAME_KEY);
}

/**
 * A custom logo for the header, stored as a data URL (uploaded image) or any
 * image URL. null means "use the bundled kiosk logo".
 */
export function resolveBrandLogo(): string | null {
  return persisted(BRAND_LOGO_KEY);
}

/** Persist (or clear, when null/blank) the custom header logo. */
export function setBrandLogo(value: string | null): void {
  if (value && value.trim()) persist(BRAND_LOGO_KEY, value);
  else forget(BRAND_LOGO_KEY);
}

/**
 * OpenAI API key for the serverless "direct" voice mode. Settings no longer
 * offers a field for it — a deploy holds its key server-side (/api/ai/voice,
 * /api/ai/breakdown) instead — but a key an earlier build stored on THIS
 * device is still honoured, so a kiosk already set up that way keeps speaking.
 * The VITE_OPENAI_API_KEY env var remains as a dev/self-hosted fallback;
 * anything baked that way is readable by whoever can load the site.
 */
export function resolveVoiceKey(): string | null {
  const device = deviceVoiceKey();
  if (device) return device;
  const env = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
  return env && env.trim() ? env.trim() : null;
}

/**
 * Just the key stored on THIS device (no env fallback). Its presence is an
 * explicit "speak via the API" choice a caretaker made in an earlier build, so
 * the voice mode resolution lets it outrank a VITE_VOICE_WS_URL baked into the
 * build — a dev machine's localhost WS URL means nothing on a kiosk device.
 * Nothing writes this key any more; clearing one means clearing the device's
 * site data.
 */
export function deviceVoiceKey(): string | null {
  const stored = persisted(VOICE_KEY_KEY);
  return stored && stored.trim() ? stored.trim() : null;
}

/** The accent colour (hex), used for the teal-derived UI. Defaults to teal. */
export function resolveAccent(): string {
  return persisted(ACCENT_KEY) || DEFAULT_ACCENT;
}

/** Persist (or reset to default, when blank) the accent colour. */
export function setAccent(value: string | null): void {
  if (value && value.trim() && value.trim() !== DEFAULT_ACCENT) {
    persist(ACCENT_KEY, value.trim());
  } else {
    forget(ACCENT_KEY);
  }
}

/** Resolve the caretaker's theme preference; `auto` (sunset-driven) by default. */
export function resolveThemeMode(): ThemeMode {
  const v = persisted(THEME_KEY);
  return v === "light" || v === "dark" ? v : "auto";
}

/** Persist (or reset to `auto`, when auto) the theme preference. */
export function setThemeMode(mode: ThemeMode): void {
  if (mode === "auto") forget(THEME_KEY);
  else persist(THEME_KEY, mode);
}

/**
 * How the UI language is chosen. `auto` (the default, stored as absence of
 * the key) follows the holon's `settings.language`, then the device locale.
 */
export type LangMode = "auto" | "en" | "it" | "es";

/** Resolve the caretaker's language preference; `auto` by default. */
export function resolveLangMode(): LangMode {
  const v = persisted(LANG_KEY);
  return v === "en" || v === "it" || v === "es" ? v : "auto";
}

/** Persist (or reset to `auto`, when auto) the language preference. */
export function setLangMode(mode: LangMode): void {
  if (mode === "auto") forget(LANG_KEY);
  else persist(LANG_KEY, mode);
}

/**
 * Mirror of the last *resolved* language, read by the pre-hydration script in
 * app.html so a reload paints the right `<html lang>` even in `auto` mode.
 */
export function setResolvedLang(l: "en" | "it" | "es"): void {
  persist(LANG_RESOLVED_KEY, l);
}

/**
 * How the Tasks view lays out the backlog: the post-it wall, a compact list,
 * a one-card-at-a-time swipe deck, or the auto-arranged dependency graph.
 * Anyone can switch it from the view's Layout pill; the choice sticks per
 * device. Whose tasks appear is the orthogonal `Scope` above.
 */
export type TaskViewMode = "cards" | "list" | "swipe" | "graph";

/** Below this width the kiosk is a phone, not a wall display (matches TabBar). */
const MOBILE_MAX_WIDTH_PX = 560;

/**
 * True on a phone-sized display: EITHER dimension under the mobile breakpoint,
 * so a rotated phone is still a phone. Tablets and wall displays (both
 * dimensions larger) are not — they keep kiosk behaviours like auto-rotation.
 */
export function isPhoneDisplay(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(
    `(max-width: ${MOBILE_MAX_WIDTH_PX}px), (max-height: ${MOBILE_MAX_WIDTH_PX}px)`,
  ).matches;
}

/**
 * Resolve the Tasks view mode. A saved choice always wins; with none, phones
 * default to the one-hand swipe deck and larger displays to the post-it wall.
 */
export function resolveTaskView(): TaskViewMode {
  const v = persisted(TASK_VIEW_KEY);
  if (v === "cards" || v === "list" || v === "swipe" || v === "graph") return v;
  // Legacy "personal" mode rendered the list; the me-filter lives in the scope now.
  if (v === "personal") return "list";
  const mobile =
    typeof window !== "undefined" &&
    window.matchMedia?.(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`).matches;
  return mobile ? "swipe" : "cards";
}

/** Persist the Tasks view mode. */
export function setTaskView(mode: TaskViewMode): void {
  persist(TASK_VIEW_KEY, mode);
}

/** The Tasks backlog ordering (the Sort pill); `loved` unless chosen. */
export function resolveTaskSort(): TaskSort {
  const v = persisted(TASK_SORT_KEY);
  return v === "new" || v === "manual" ? v : "loved";
}

/** Persist the Tasks backlog ordering. */
export function setTaskSort(sort: TaskSort): void {
  persist(TASK_SORT_KEY, sort);
}

/**
 * How the Library view lays out the things: the icon card grid, a compact
 * list, or the booking calendar (when each thing is out). Same Layout pill as
 * the Tasks view; the choice sticks per device. `swipe` is the one-at-a-time
 * Card pager (id matches the Tasks deck's).
 */
export type LibraryViewMode = "cards" | "list" | "swipe" | "calendar";

/** Resolve the Library view mode; the card grid (wall) is the default. */
export function resolveLibraryView(): LibraryViewMode {
  const v = persisted(LIBRARY_VIEW_KEY);
  if (v === "cards" || v === "list" || v === "swipe" || v === "calendar")
    return v;
  // Legacy "personal" mode rendered the compact rows — closest is the list.
  if (v === "personal") return "list";
  return "cards";
}

/** Persist the Library view mode. */
export function setLibraryView(mode: LibraryViewMode): void {
  persist(LIBRARY_VIEW_KEY, mode);
}

/**
 * How the Roles board lays out the roles: compact rows, today-holder cards
 * (wall) or the Mon→Sun week grid. Same Layout pill as the other views; the
 * choice sticks per device.
 */
export type RolesViewMode = "cards" | "list" | "week";

/** Resolve the Roles view mode; the cards are the default. */
export function resolveRolesView(): RolesViewMode {
  const v = persisted(ROLES_VIEW_KEY);
  if (v === "cards" || v === "list" || v === "week") return v;
  // Legacy "personal" mode rendered the filtered week grid.
  if (v === "personal") return "week";
  return "cards";
}

/** Persist the Roles view mode. */
export function setRolesView(mode: RolesViewMode): void {
  persist(ROLES_VIEW_KEY, mode);
}

/**
 * The Calendar's time window (its Layout pill): one day, the week, or the
 * month grid. Same per-device stickiness as the other views' layout choices.
 */
export type CalendarMode = "day" | "week" | "month";

/** Resolve the Calendar mode; the single day is the default. */
export function resolveCalendarView(): CalendarMode {
  const v = persisted(CAL_VIEW_KEY);
  return v === "week" || v === "month" ? v : "day";
}

/** Persist the Calendar mode. */
export function setCalendarView(mode: CalendarMode): void {
  persist(CAL_VIEW_KEY, mode);
}

/**
 * The Library booking calendar's own window. It runs the same CalendarView,
 * but it answers a different question — "which stretches is this thing gone
 * for?" — so it keeps its own default (the month grid, where a span reads as
 * a stretch) and its own stickiness, rather than inheriting whatever the
 * Calendar tab was last left on.
 */
export function resolveLibraryCalendarView(): CalendarMode {
  const v = persisted(LIBRARY_CAL_VIEW_KEY);
  return v === "day" || v === "week" ? v : "month";
}

/** Persist the Library booking calendar's window. */
export function setLibraryCalendarView(mode: CalendarMode): void {
  persist(LIBRARY_CAL_VIEW_KEY, mode);
}

/**
 * Remember the palette last shown so a reload/power-cycle can restore it before
 * the controller recomputes — this is what the boot script in `app.html` reads
 * to avoid a flash of the wrong theme.
 */
export function setResolvedTheme(theme: "light" | "dark"): void {
  persist(THEME_RESOLVED_KEY, theme);
}

/** Last known device coordinates, cached so sunset tracking survives offline. */
export function resolveGeo(): { lat: number; lng: number } | null {
  const raw = persisted(GEO_KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { lat?: unknown; lng?: unknown };
    if (typeof o.lat === "number" && typeof o.lng === "number") {
      return { lat: o.lat, lng: o.lng };
    }
  } catch {
    /* corrupt entry — ignore, fall back to fixed hours */
  }
  return null;
}

/** Cache the latest geolocation fix for offline sunrise/sunset computation. */
export function setGeo(geo: { lat: number; lng: number }): void {
  persist(GEO_KEY, JSON.stringify(geo));
}

/** Seconds each view is shown before the kiosk auto-advances to the next. */
export const FLIP_INTERVAL_MS = 16_000;

/**
 * Stillness required before any autoplay (tab rotation, auto-scroll glide)
 * kicks in: minutes with no interaction while the page is actually visible.
 * Time spent on another browser tab never counts — the countdown restarts
 * from zero when the page becomes visible again.
 */
export const RESUME_AFTER_IDLE_MS = 300_000;

/**
 * Idle grace after the last touch before the header chrome (brand, search,
 * account, clock, tabs) fades away for an unobstructed, immersive board. Any
 * interaction brings it straight back.
 */
export const IDLE_HIDE_MS = 12_000;
