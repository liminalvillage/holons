// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

/**
 * @fileoverview Each service as its own Telegram Mini App, the way Elinor is
 * one app for shifts. A service is registered with BotFather (/newapp) under
 * its kiosk tab id as the short name, pointing at that tab's kiosk path —
 * `tasks` → https://hubs.network/tasks — and the bot's buttons open it on a
 * holon with `t.me/<bot>/<service>?startapp=<holon id>`. The kiosk reads the
 * holon from the start param and logs the person in from the launch itself.
 *
 * Telegram can't tell us which short names a bot has registered, so the
 * services that are live are listed in MINI_APPS (comma-separated, e.g.
 * `MINI_APPS=tasks`); an unlisted one keeps its old link.
 */

import i18next from 'i18next';
import { Markup } from 'telegraf';
import type { InlineKeyboardButton } from 'telegraf/types';

/** The services this bot has registered as Mini Apps (MINI_APPS). */
export function miniApps(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    String(env.MINI_APPS ?? '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * The link that opens `service` as a Mini App on `holonId`, or null when the
 * service isn't registered or the holon can't ride as a start param
 * (Telegram allows `[A-Za-z0-9_-]{1,512}`).
 */
export function miniAppUrl(
  botUsername: string | undefined,
  service: string,
  holonId: string | number,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const holon = String(holonId ?? '').trim();
  if (!botUsername || !miniApps(env).has(service)) return null;
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(holon)) return null;
  return `https://t.me/${botUsername}/${service}?startapp=${holon}`;
}

/** The locale key of each service's Open button label. */
const LABEL_KEYS: Record<string, [key: string, fallback: string]> = {
  tasks: ['openTasksApp', 'Open tasks'],
  calendar: ['openCalendarApp', 'Open calendar'],
  shifts: ['openShiftsApp', 'Open shifts'],
  library: ['openLibraryApp', 'Open library'],
  checklists: ['openChecklistsApp', 'Open lists'],
  roles: ['openRolesApp', 'Open roles'],
  stock: ['openStockApp', 'Open stock'],
  offers: ['openOffersApp', 'Open needs & offers'],
  flows: ['openFlowsApp', 'Open flows'],
  status: ['openStatusApp', 'Open status'],
};

/**
 * The inline button that opens `service` as a Mini App on `holonId` — the
 * one Open button every listing command carries — or null when the service
 * isn't registered (MINI_APPS), so the caller keeps its old link.
 */
export function miniAppButton(
  ctx: { botInfo?: { username?: string } },
  service: string,
  holonId: string | number,
  lng: string
): InlineKeyboardButton.UrlButton | null {
  const url = miniAppUrl(ctx.botInfo?.username, service, holonId);
  if (!url) return null;
  const [key, defaultValue] = LABEL_KEYS[service] ?? [
    'openApp',
    `Open ${service}`,
  ];
  return Markup.button.url(`✅ ${i18next.t(key, { lng, defaultValue })}`, url);
}
