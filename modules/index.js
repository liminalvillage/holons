/**
 * Modules barrel exports
 * Organizes all business logic modules
 */

// Core business modules
export { default as Announcements } from '../Announcements.js';
export { default as Bigtalk } from '../Bigtalk.js';
export { default as CapitalGame } from '../CapitalGame.js';
export { default as Checklists } from '../Checklists.js';
export { default as Council } from '../Council.js';
export { default as DB } from '../DB.js';
export { default as Expenses } from '../Expenses.js';
export { default as H3 } from '../H3.js';
export { default as Holons } from '../Holons.js';
export { default as Library } from '../Library.js';
export { default as Lunation } from '../Lunation.js';
export { default as Onboarding } from '../Onboarding.js';
export { default as OneOnOne } from '../OneOnOne.js';
export { default as Quests } from '../Quests.js';
export { default as Roles } from '../Roles.js';
export { default as Scheduler } from '../Scheduler.js';
export { default as Server } from '../Server.js';
export { default as Settings } from '../Settings.js';
export { default as Shopping } from '../Shopping.js';
export { default as Tags } from '../Tags.js';
export { default as UI } from '../UI.js';
export { default as Users } from '../Users.js';

// RSVP/Participation (exported with more descriptive name)
export { default as Participation } from '../RSVP.js';

// Request handlers
export * as Requests from '../Requests.js';

/**
 * Module categories for organized access
 */
export const coreModules = {
  DB,
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
  Council,
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