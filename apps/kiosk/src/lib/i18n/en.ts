// SPDX-License-Identifier: AGPL-3.0-or-later
//
// English catalog — the source of truth. Keys are dot-namespaced by the
// component/module that owns the string; `{name}` marks an interpolation
// slot. `it.ts` and `es.ts` must cover exactly this key set (enforced by
// their `Record<MessageKey, Msg>` type and the parity spec).

import type { Msg } from "./types";

export const en = {
  // Shared
  "common.auto": "Auto",
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.apply": "Apply",
  "common.send": "Send",
  "common.untitled": "Untitled",

  // Relative dates (calendar-day distances)
  "dates.today": "today",
  "dates.tomorrow": "tomorrow",
  "dates.yesterday": "yesterday",
  "dates.daysAgo": "{n}d ago",
  "dates.inDays": "in {n}d",

  // Roles
  "roles.untitledRole": "Untitled role",

  // Library status chips
  "library.available": "available",
  "library.returnBy": "return {when}",
  "library.withYou": "with you",
  "library.outWith": "out · {who}",
  "library.out": "out",

  // Tabs
  "tabs.tasks": "Tasks",
  "tabs.calendar": "Calendar",
  "tabs.library": "Library",
  "tabs.checklists": "Lists",
  "tabs.roles": "Roles",
  "tabs.status": "Status",

  // Pill segments (shared layout/sort vocabulary)
  "pills.card": "Card",
  "pills.list": "List",
  "pills.wall": "Wall",
  "pills.week": "Week",
  "pills.day": "Day",
  "pills.month": "Month",
  "pills.loved": "Loved",
  "pills.new": "New",
  "pills.manual": "Manual",
  "pills.view": "View",
  "pills.sort": "Sort",
  "pills.tasksLayout": "Tasks layout",
  "pills.tasksOrder": "Tasks order",
  "pills.libraryLayout": "Library layout",
  "pills.rolesLayout": "Roles layout",
  "pills.calendarView": "Calendar view",

  // Show (scope) pill
  "scope.personal": "Personal",
  "scope.local": "Local",
  "scope.global": "Global",
  "scope.show": "Show",
  "scope.aria": "Whose items to show",

  // Header bar
  "tabbar.search": "Search…",
  "tabbar.searchAria": "Search visible content",
  "tabbar.clearSearch": "Clear search",
  "tabbar.suggestions": "Search suggestions",
  "tabbar.categories": "Categories",
  "tabbar.people": "People",
  "tabbar.menu": "Menu",
  "tabbar.login": "Log in",
  "tabbar.views": "Views",
  "tabbar.pinnedTitle": "Pinned — long-press to unpin",
  "tabbar.pinTitle": "Long-press to pin",
  "tabbar.unpinTab": "Unpin {tab}",
  "tabbar.pinTab": "Pin to {tab}",
  "tabbar.unpinView": "Unpin this view",
  "tabbar.pinView": "Pin this view",

  // User menu
  "menu.notSignedIn": "Not signed in",
  "menu.dashboard": "Open full dashboard",
  "menu.pasteCard": "Paste copied card",
  "menu.settings": "Settings",
  "menu.logout": "Log out",
  "menu.loginTelegram": "Log in with Telegram",

  // Completion confirmation
  "complete.title": "Complete this task?",
  "complete.lead":
    "Confirm who took part — they'll be credited in the holon's accounting.",
  "complete.addMemberAria": "Add a member",
  "complete.addMember": "Add a member…",
  "complete.confirm": "Complete",

  // Settings panel
  "settings.title": "Kiosk settings",
  "settings.holon": "Holon",
  "settings.holonPlaceholder": "holon id",
  "settings.displayName": "Display name",
  "settings.displayNamePlaceholder": "shown in the header",
  "settings.logo": "Logo",
  "settings.logoSub": "— optional; the name shows as text otherwise",
  "settings.logoPreview": "Logo preview",
  "settings.namePlaceholder": "name",
  "settings.upload": "Upload…",
  "settings.useDefault": "Use default",
  "settings.notImage": "Please choose an image file.",
  "settings.imageTooLarge": "Image is too large — keep it under 512 KB.",
  "settings.imageReadError": "Could not read that image.",
  "settings.accent": "Accent colour",
  "settings.accentAria": "Accent {color}",
  "settings.customAccent": "Custom accent",
  "settings.appearance": "Appearance",
  "settings.appearanceSub": "— Auto follows local sunset",
  "settings.light": "Light",
  "settings.dark": "Dark",
  "settings.language": "Language",
  "settings.languageSub": "— Auto follows the holon's language",
  "settings.libraryTab": "Library tab",
  "settings.libraryTabSub":
    "— shows by itself when the library has items; flip to force",
  "settings.libraryTabAria": "Show the Library tab",
  "settings.rolesTab": "Roles tab",
  "settings.rolesTabSub": "— shows by itself when roles exist; flip to force",
  "settings.rolesTabAria": "Show the Roles tab",
  "settings.listsTab": "Lists tab",
  "settings.listsTabSub":
    "— shows by itself when checklists exist; flip to force",
  "settings.listsTabAria": "Show the Lists tab",
  "settings.statusTab": "Status tab",
  "settings.statusTabSub": "— a ranked contribution leaderboard",
  "settings.statusTabAria": "Show the Status tab",
  "settings.location": "Location",
  "settings.locationSub": "— the H3 cell this holon claims on the shared map",
  "settings.checking": "Checking…",
  "settings.change": "Change…",
  "settings.setLocation": "Set location…",
  "settings.federation": "Federation",
  "settings.federationSub":
    "— partner holons this screen shares with · changes apply immediately",
  "settings.voice": "Voice",
  "settings.voiceSub":
    "— OpenAI API key for spoken interaction, kept on this device only; empty = the deploy's shared key (the one AI breakdown uses), if configured",

  // Federation editor
  "fed.loading": "Loading partners…",
  "fed.loadError": "Could not load federation — try again.",
  "fed.none": "No partners yet — link a holon below to share boards.",
  "fed.hint": "Receive = show their items here · Send = share ours with them",
  "fed.lensAria": "{lens} federation",
  "fed.off": "Off",
  "fed.receive": "Receive",
  "fed.send": "Send",
  "fed.both": "Both",
  "fed.tapAgainUnlink": "Tap again to unlink",
  "fed.unlink": "Unlink {name}",
  "fed.linking": "Linking…",
  "fed.link": "Link",
  "fed.selfLink": "That's this holon.",
  "fed.linkError": "Could not link that holon — try again.",
  "fed.changeError": "Change didn't save — try again.",
  "fed.unlinkError": "Unlink didn't save — try again.",

  // Location (hex) picker
  "hex.aria": "Pick a location",
  "hex.kicker": "Claim your cell",
  "hex.title": "Where does this holon stand?",
  "hex.hint":
    "Tap the hex your holon lives in — zoom out for a wider, more private cell.",
  "hex.searchPlaceholder": "Search an address or place…",
  "hex.searching": "searching…",
  "hex.locating": "Locating…",
  "hex.myLocation": "My location",
  "hex.nothingSelected": "nothing selected yet",
  "hex.manualPlaceholder": "…or paste an H3 cell id",
  "hex.check": "Check",
  "hex.claiming": "Claiming…",
  "hex.thisIsHome": "This is home",
  "hex.noGeo":
    "No geolocation on this device — tap the map or paste a cell id.",
  "hex.denied": "Location denied — tap the map or paste a cell id.",
  "hex.invalidCell": "That's not a valid H3 cell id.",
  "hex.claimed": "Location claimed — this holon is on the map.",
  "hex.saveError": "Could not save the location — try again.",

  // Voice overlay
  "voice.unmute": "Unmute spoken replies",
  "voice.mute": "Mute spoken replies",
  "voice.listening": "listening…",
  "voice.thinking": "thinking",
  "voice.transcribing": "transcribing",
  "voice.speaking": "speaking…",
  "voice.typePlaceholder": "Paste or type a transcript…",

  // Setup screen (no holon configured)
  "setup.title": "No holon configured",
  "setup.body":
    "Point this screen at a holon: open Settings and enter a holon id, open the kiosk at /<holon id>, open it once with a ?holon=<id> parameter, or set VITE_KIOSK_HOLON in the root .env. Settings and ?holon= are remembered on this device.",
  "setup.openSettings": "Open settings",

  // Shell
  "layout.resync": "Live view stalled — resyncing…",

  // Clipboard (copy/paste cards)
  "clipboard.copied": "Card copied — paste it in any holon (or any chat).",
  "clipboard.copyFailed": "Couldn't reach the clipboard.",
  "clipboard.noHolon": "Point the kiosk at a holon first.",
  "clipboard.loginToPaste": "Log in to paste the copied card.",
  "clipboard.pasted": 'Pasted "{title}".',
  "clipboard.pastedLibrary": 'Pasted "{title}" into the library.',
  "clipboard.alreadyInLibrary": '"{title}" is already in this library.',
  "clipboard.pasteCardFailed": "Couldn't paste the card.",
  "clipboard.pasteFailed": "Couldn't paste — {reason}",
  "clipboard.writeFailed": "write failed",
  "clipboard.blocked": "Clipboard blocked — press Ctrl/Cmd+V instead.",
  "clipboard.noCard": "No copied card in the clipboard.",

  // AI breakdown errors
  "breakdown.badKey": "OpenAI rejected this device's API key.",
  "breakdown.rateLimit": "OpenAI rate limit hit — try again shortly.",
  "breakdown.failed": "AI breakdown failed (HTTP {status}).",
} as const satisfies Record<string, Msg>;

export type MessageKey = keyof typeof en;
