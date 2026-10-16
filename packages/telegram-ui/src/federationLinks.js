// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Linking two holons from Telegram — the one path every bot command takes.
//
// A link has two halves, each its own holon's admins' word (see
// @holons/core/federation requests.ts). The bot's key is admin of every
// chat it set up, so it COULD write both halves; it must not decide for a
// group whose people did not ask. So the partner's half is written directly
// only when the person running the command is a creator/administrator of
// the partner chat too; otherwise the partner's admins are asked
// (FederationRequests.js posts the request in their group).

import i18next from 'i18next';
import {
  removeFederationPartner,
  setFederationPartner,
} from '@holons/core/federation';

const ADMIN = new Set(['creator', 'administrator']);

/** A translated line with an inline default (see Settings.ts `translated`). */
export function translated(language, key, defaultValue, vars = {}) {
  const text = i18next.t(key, { lng: language, defaultValue, ...vars });
  if (typeof text === 'string' && text.trim()) return text;
  return defaultValue.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    String(vars[k] ?? '')
  );
}

/**
 * Must the partner's admins be asked? Yes, unless `userId` is a creator or
 * administrator of the partner chat (a negative Telegram chat id). Any other
 * partner (a keyed holon, a pubkey, an unknown id) is always asked.
 */
export async function shouldAskPartner(telegram, target, userId) {
  const t = String(target ?? '');
  if (!/^-\d+$/.test(t) || !telegram || userId == null) return true;
  try {
    const member = await telegram.getChatMember(t, Number(userId));
    return !ADMIN.has(member?.status);
  } catch {
    return true;
  }
}

/** Who runs this command, and where: what `linkHolons` needs from a Telegraf ctx. */
export async function linkContext(ctx, target) {
  const userId = ctx?.from?.id;
  const askPartner = await shouldAskPartner(ctx?.telegram, target, userId);
  const chat = ctx?.chat ?? ctx?.callbackQuery?.message?.chat;
  const holonName = chat?.title || undefined;
  return { askPartner, holonName };
}

/**
 * Write `source`'s half with these lenses; the partner's half directly or by
 * request. `askPartner` defaults to true — a caller that knows the person is
 * an admin on both sides says so.
 */
export async function linkHolons(hs, source, target, options = {}) {
  const {
    lensConfig = { inbound: [], outbound: [] },
    partnerName = null,
    askPartner = true,
    holonName,
  } = options;
  const outcome = await setFederationPartner(
    hs,
    String(source),
    String(target),
    {
      inbound: Array.isArray(lensConfig.inbound) ? lensConfig.inbound : [],
      outbound: Array.isArray(lensConfig.outbound) ? lensConfig.outbound : [],
      ...(partnerName ? { partnerName } : {}),
      ...(holonName ? { holonName } : {}),
      ...(lensConfig.hops !== undefined ? { hops: lensConfig.hops } : {}),
      askPartner,
    }
  );
  hs.clearCache?.('federation');
  return { success: outcome.self === 'linked', outcome };
}

/** Drop `source`'s half; the partner's directly or by request. */
export async function unlinkHolons(hs, source, target, options = {}) {
  const { askPartner = true, holonName } = options;
  const outcome = await removeFederationPartner(
    hs,
    String(source),
    String(target),
    {
      askPartner,
      ...(holonName ? { holonName } : {}),
    }
  );
  hs.clearCache?.('federation');
  return { success: outcome.self === 'removed', outcome };
}

/** One line saying what happened on the partner's side, or null when there is nothing to say. */
export function outcomeText(outcome, partnerName, language = 'en') {
  const partner = partnerName || '';
  if (!outcome) return null;
  if (outcome.self === 'held')
    return translated(
      language,
      'fedHeld',
      "⚠️ The bot can't change this holon's federation: its key is not an admin here."
    );
  switch (outcome.partner) {
    case 'linked':
      return translated(
        language,
        'fedLinkedBoth',
        '🔗 Linked on both sides with {{partner}}.',
        { partner }
      );
    case 'removed':
      return translated(
        language,
        'fedRemovedBoth',
        '✂️ Unlinked on both sides from {{partner}}.',
        { partner }
      );
    case 'requested':
      return outcome.self === 'removed'
        ? translated(
            language,
            'fedUnlinkAsked',
            "✂️ Unlinked here. {{partner}}'s admins were asked to remove it on their side too.",
            { partner }
          )
        : translated(
            language,
            'fedAsked',
            "⏳ Asked {{partner}}'s admins to accept — the link counts on their side once they do.",
            { partner }
          );
    default:
      return null;
  }
}
