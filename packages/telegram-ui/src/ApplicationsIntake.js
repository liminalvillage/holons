// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

/**
 * @fileoverview POST /applications — community applications from the web.
 *
 * The website (liminalvillage.com/apply) never writes to Nostr itself: it
 * hands each application to this bot, which keeps it in the holon's
 * `applications` lens, sealed (see @holons/core/applications). This module
 * only wires HTTP: bearer auth, size, status codes.
 *
 *   APPLICATIONS_TOKEN  shared secret; unset → every request is refused
 *   APPLICATIONS_HOLON  the holon that keeps them (default: Liminal Village)
 *
 * @module src/ApplicationsIntake
 */

import { createHash, timingSafeEqual } from 'crypto';
import {
  APPLICATIONS_LENS,
  ApplicationsNotSealedError,
  DEFAULT_APPLICATIONS_HOLON,
  MAX_APPLICATION_BYTES,
  parseWebApplication,
  storeApplication,
} from '@holons/core/applications';

const digest = s => createHash('sha256').update(String(s)).digest();

/** Constant-time: does the request carry `Authorization: Bearer <token>`? */
export function bearerMatches(header, token) {
  if (!token) return false;
  const m = /^Bearer\s+(.+)$/i.exec(String(header ?? '').trim());
  if (!m) return false;
  return timingSafeEqual(digest(m[1].trim()), digest(token));
}

/**
 * The route handler. `getDb` answers the bot's holosphere instance;
 * `env` is read per request so a rotated token applies without a restart.
 * @param {{ getDb: () => any, env?: Record<string, string|undefined>, log?: Console }} deps
 */
export function applicationsHandler({
  getDb,
  env = process.env,
  log = console,
}) {
  return async (req, res) => {
    const token = env.APPLICATIONS_TOKEN;
    if (!token) {
      log.warn('[applications] APPLICATIONS_TOKEN is not set — refusing');
      return res.status(503).json({ error: 'applications intake is disabled' });
    }
    if (!bearerMatches(req.headers?.authorization, token)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (Number(req.headers?.['content-length'] ?? 0) > MAX_APPLICATION_BYTES) {
      return res.status(413).json({ error: 'application too large' });
    }

    const parsed = parseWebApplication(req.body);
    if (!parsed.ok) {
      return res.status(parsed.status).json({ error: parsed.error });
    }

    const holon = String(
      env.APPLICATIONS_HOLON || DEFAULT_APPLICATIONS_HOLON
    ).trim();
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'no database' });

    try {
      const { created } = await storeApplication(db, holon, parsed.record);
      log.info?.(
        `[applications] ${created ? 'stored' : 'already had'} ${parsed.record.id} in ${holon}/${APPLICATIONS_LENS} (sealed)`
      );
      return res.json({
        ok: true,
        holon,
        lens: APPLICATIONS_LENS,
        id: parsed.record.id,
      });
    } catch (err) {
      if (err instanceof ApplicationsNotSealedError) {
        log.error(`[applications] ${err.message}`);
        return res
          .status(503)
          .json({ error: 'applications are not sealed yet' });
      }
      log.error('[applications] store failed:', err);
      return res.status(500).json({ error: 'could not store the application' });
    }
  };
}

/** Mount POST /applications on an Express app. */
export function mountApplications(app, deps) {
  app.post('/applications', applicationsHandler(deps));
}
