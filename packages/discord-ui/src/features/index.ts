/**
 * Feature registry. Adding a feature here wires its slash commands into
 * registration and its handlers into the router — no other changes needed.
 */
import type { Feature } from '../types.js';
import { checklistsFeature } from './checklists.js';
import { expensesFeature } from './expenses.js';
import { holonFeature } from './holon.js';
import { questsFeature } from './quests.js';
import { scoresFeature } from './scores.js';
import { settingsFeature } from './settings.js';
import { shoppingFeature } from './shopping.js';
import { usersFeature } from './users.js';

export const features: Feature[] = [
  holonFeature,
  usersFeature,
  questsFeature,
  shoppingFeature,
  expensesFeature,
  checklistsFeature,
  scoresFeature,
  settingsFeature,
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
