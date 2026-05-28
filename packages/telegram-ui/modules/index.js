/**
 * Modules barrel exports
 * Organizes all business logic modules
 */

// Core business modules
import Announcements from '../src/Announcements.js';
import Bigtalk from '../src/Bigtalk.js';
import CapitalGame from '../src/CapitalGame.js';
import Checklists from '../src/Checklists.js';
import Expenses from '../src/Expenses.js';
import H3 from '../src/H3.js';
import Holons from '../src/Holons.js';
import Library from '../src/Library.js';
import Lunation from '../src/Lunation.js';
import Onboarding from '../src/Onboarding.js';
import OneOnOne from '../src/OneOnOne.js';
import Quests from '../src/Quests.js';
import Roles from '../src/Roles.js';
import Scheduler from '../src/Scheduler.js';
import Server from '../src/Server.js';
import Settings from '../src/Settings.js';
import Shopping from '../src/Shopping.js';
import Tags from '../src/Tags.js';
import UI from '../src/UI.js';
import Users from '../Users.js';
// RSVP/Participation (exported with more descriptive name)
import Participation from '../src/RSVP.js';

export {
  Announcements,
  Bigtalk,
  CapitalGame,
  Checklists,
  Expenses,
  H3,
  Holons,
  Library,
  Lunation,
  Onboarding,
  OneOnOne,
  Quests,
  Roles,
  Scheduler,
  Server,
  Settings,
  Shopping,
  Tags,
  UI,
  Users,
  Participation,
};

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
export const getModulesByCategory = category => {
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
