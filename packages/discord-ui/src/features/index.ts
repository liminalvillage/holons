/**
 * Feature registry. Adding a feature here wires its slash commands into
 * registration and its handlers into the router — no other changes needed.
 */
import type { Feature } from '../types.js';
import { announcementsFeature } from './announcements.js';
import { calendarFeature } from './calendar.js';
import { checklistsFeature } from './checklists.js';
import { dashboardFeature } from './dashboard.js';
import { dnaFeature } from './dna.js';
import { expensesFeature } from './expenses.js';
import { federationFeature } from './federation.js';
import { holonFeature } from './holon.js';
import { libraryFeature } from './library.js';
import { questsFeature } from './quests.js';
import { remindersFeature } from './reminders.js';
import { rolesFeature } from './roles.js';
import { rsvpFeature } from './rsvp.js';
import { scoringFeature } from './scoring.js';
import { settingsFeature } from './settings.js';
import { shoppingFeature } from './shopping.js';
import { tagsFeature } from './tags.js';
import { usersFeature } from './users.js';

export const features: Feature[] = [
  holonFeature,
  usersFeature,
  questsFeature,
  shoppingFeature,
  expensesFeature,
  checklistsFeature,
  calendarFeature,
  libraryFeature,
  scoringFeature,
  federationFeature,
  settingsFeature,
  dnaFeature,
  rolesFeature,
  announcementsFeature,
  tagsFeature,
  rsvpFeature,
  remindersFeature,
  dashboardFeature,
];

/** Map of slash command name -> owning feature. */
export function commandIndex(list: Feature[] = features): Map<string, Feature> {
  const index = new Map<string, Feature>();
  for (const feature of list) {
    for (const command of feature.commands) index.set(command.name, feature);
  }
  return index;
}

/** Map of customId namespace (feature id) -> owning feature. */
export function featureIndex(list: Feature[] = features): Map<string, Feature> {
  const index = new Map<string, Feature>();
  for (const feature of list) index.set(feature.id, feature);
  return index;
}
