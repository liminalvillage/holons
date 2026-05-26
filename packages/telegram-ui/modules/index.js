/**
 * Modules barrel exports
 * Organizes all business logic modules
 */

// Core business modules
export { default as Announcements } from '../src/Announcements.js';
export { default as Bigtalk } from '../src/Bigtalk.js';
export { default as CapitalGame } from '../src/CapitalGame.js';
export { default as Checklists } from '../src/Checklists.js';
export { default as Expenses } from '../src/Expenses.js';
export { default as H3 } from '../src/H3.js';
export { default as Holons } from '../src/Holons.js';
export { default as Library } from '../src/Library.js';
export { default as Lunation } from '../src/Lunation.js';
export { default as Onboarding } from '../src/Onboarding.js';
export { default as OneOnOne } from '../src/OneOnOne.js';
export { default as Quests } from '../src/Quests.js';
export { default as Roles } from '../src/Roles.js';
export { default as Scheduler } from '../src/Scheduler.js';
export { default as Server } from '../src/Server.js';
export { default as Settings } from '../src/Settings.js';
export { default as Shopping } from '../src/Shopping.js';
export { default as Tags } from '../src/Tags.js';
export { default as UI } from '../src/UI.js';
export { default as Users } from '../Users.js';

// RSVP/Participation (exported with more descriptive name)
export { default as Participation } from '../src/RSVP.js';

// Request handlers
export * as Requests from '../src/Requests.js';

/**
 * Module categories for organized access
 */
export const coreModules = {
  Server,
  Settings,
  UI,
  Users,
};

export const questModules = {
  Quests,
  Checklists,
  Scheduler,
};

export const communityModules = {
  Holons,
  Roles,
  Announcements,
  OneOnOne,
};

export const utilityModules = {
  Bigtalk,
  Library,
  Shopping,
  Expenses,
  Tags,
  H3,
  Lunation,
};

export const gameModules = {
  CapitalGame,
  Participation,
};

/**
 * Get modules by category
 */
export const getModulesByCategory = (category) => {
  switch (category) {
    case 'core':
      return coreModules;
    case 'quest':
      return questModules;
    case 'community':
      return communityModules;
    case 'utility':
      return utilityModules;
    case 'game':
      return gameModules;
    default:
      throw new Error(`Unknown module category: ${category}`);
  }
};