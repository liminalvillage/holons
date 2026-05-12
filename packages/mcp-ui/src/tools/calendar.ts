// @holons/mcp-ui — calendar domain tools.
// Wraps `@holons/core/calendar` (iCal feed, RSVP toggle) plus a thin
// event-create helper that persists to HoloSphere directly.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  generateICalFeed,
  toggleRSVP,
  isAttending,
  rsvpDisplayName,
  type HolonEvent,
  type RSVPUser,
} from '@holons/core/calendar';
import type { ToolDeps } from './index.js';

type TextContent = { type: 'text'; text: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

function ok(payload: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

function fail(message: string, extra?: Record<string, unknown>): ToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({ success: false, error: message, ...extra }, null, 2),
      },
    ],
  };
}

/** Coerce whatever HoloSphere returns into an array of records. */
function asArray<T = any>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object') return Object.values(v as Record<string, T>);
  return [];
}

/** Quests/events with a `when` field are the iCal-eligible entries. */
function toHolonEvents(items: any[]): HolonEvent[] {
  return items
    .filter((it) => it && typeof it === 'object' && it.when)
    .map((it) => ({
      id: String(it.id ?? it.key ?? `e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
      title: String(it.title ?? 'Untitled Event'),
      description: it.description,
      location: it.location,
      when: String(it.when),
      ends: it.ends || it.until || undefined,
      participants: Array.isArray(it.participants) ? it.participants : undefined,
      status: it.status,
      category: it.category,
    }));
}

export function registerCalendarTools(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'calendar_ical_feed',
    'Generate an iCal feed (RFC 5545 .ics text) for a holon. Pulls scheduled quests and events from HoloSphere and runs them through @holons/core/calendar.generateICalFeed.',
    { holon: z.string().describe('Holon ID (chat ID / DAO ID)') },
    async ({ holon }): Promise<ToolResult> => {
      try {
        const h = await deps.getHoloSphere();
        const [profile, quests, events] = await Promise.all([
          h.get(holon, 'profile', holon).catch(() => null),
          h.getAll(holon, 'quests').catch(() => []),
          h.getAll(holon, 'events').catch(() => []),
        ]);
        const holonName =
          profile?.name || profile?.title || 'Holon Calendar';
        const items = [...asArray(quests), ...asArray(events)];
        const calendarEvents = toHolonEvents(items);
        const ical = generateICalFeed(calendarEvents, holonName, holon);
        return ok({
          success: true,
          holon,
          holonName,
          eventCount: calendarEvents.length,
          ical,
        });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    'calendar_rsvp_toggle',
    'Toggle a user\'s RSVP state for a holon event. With `status` ("yes"/"no"/"maybe") the state is set explicitly; otherwise it flips. Persists the user record back to HoloSphere.',
    {
      holon: z.string().describe('Holon ID'),
      eventId: z.string().describe('Event / message key to RSVP against'),
      userId: z.union([z.string(), z.number()]).describe('User ID'),
      status: z
        .enum(['yes', 'no', 'maybe'])
        .optional()
        .describe('Force a specific status. Omit to toggle.'),
    },
    async ({ holon, eventId, userId, status }): Promise<ToolResult> => {
      try {
        const h = await deps.getHoloSphere();
        const userKey = String(userId);
        const existing = (await h
          .get(holon, 'users', userKey)
          .catch(() => null)) as RSVPUser | null;
        const user: RSVPUser =
          existing && typeof existing === 'object'
            ? existing
            : { id: userId };

        let updated: RSVPUser;
        if (status) {
          // Explicit set — bypass toggle so callers can be idempotent.
          // `maybe` clears the flag (no boolean state exists for it).
          if (typeof user.participated !== 'object' || !user.participated) {
            user.participated = {};
          }
          const key = String(eventId);
          if (status === 'maybe') delete user.participated[key];
          else user.participated[key] = status === 'yes';
          updated = user;
        } else {
          updated = toggleRSVP(user, eventId);
        }
        await h.put(holon, 'users', updated);
        const attending = Boolean(updated.participated?.[String(eventId)]);
        return ok({
          success: true,
          holon,
          eventId,
          userId,
          attending,
          status: status ?? (attending ? 'yes' : 'no'),
        });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    'calendar_rsvp_is_attending',
    'Check whether a user is marked attending for an event/message key. Pure wrapper over @holons/core/calendar.isAttending — no HoloSphere reads.',
    {
      user: z
        .string()
        .describe('RSVP user record as JSON. Must include `participated` map keyed by event/message id.'),
      eventKey: z
        .union([z.string(), z.number()])
        .describe('Event / message key to check attendance for'),
    },
    async ({ user, eventKey }): Promise<ToolResult> => {
      try {
        const parsed = JSON.parse(user) as RSVPUser;
        const attending = isAttending(parsed, eventKey);
        return ok({ success: true, attending });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    'calendar_rsvp_display_name',
    'Render a display name for an RSVP participant, falling back through first_name / username / id. Pure wrapper over @holons/core/calendar.rsvpDisplayName.',
    {
      participant: z
        .string()
        .describe('Participant / RSVP user record as JSON ({ id, username?, first_name?, second_name? })'),
    },
    async ({ participant }): Promise<ToolResult> => {
      try {
        const parsed = JSON.parse(participant) as RSVPUser;
        const name = rsvpDisplayName(parsed);
        return ok({ success: true, name });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // No `createEvent` helper in @holons/core/calendar yet — build inline.
  server.tool(
    'calendar_event_create',
    'Create a calendar event in a holon. Persists to the `events` lens via HoloSphere. No Telegram or browser side-effects.',
    {
      holon: z.string().describe('Holon ID'),
      title: z.string().describe('Event title'),
      when: z.string().describe('Start time (ISO date string)'),
      until: z.string().optional().describe('End time (ISO date string)'),
      description: z.string().optional(),
      category: z.string().optional(),
    },
    async ({ holon, title, when, until, description, category }): Promise<ToolResult> => {
      try {
        const h = await deps.getHoloSphere();
        const actor = deps.resolveActor();
        const event = {
          id: `e_${Date.now()}`,
          version: '0.1',
          holon,
          title,
          description: description || '',
          type: 'event',
          status: 'upcoming',
          date: Date.now(),
          when,
          until: until || '',
          category: category || undefined,
          participants: [] as unknown[],
          initiator: actor,
        };
        await h.put(holon, 'events', event);
        return ok({ success: true, holon, event });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }
  );
}
