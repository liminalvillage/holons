import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Actor } from '../identity.js';

export interface ToolDeps {
  getHoloSphere: () => Promise<any>;
  resolveActor: (override?: Partial<Actor>) => Actor;
}

const DOMAINS = [
  'holosphere',
  'tasks',
  'expenses',
  'scoring',
  'calendar',
  'users',
  'checklists',
  'dna',
  'library',
  'needs',
  'shopping',
  'federation',
  'commands',
  'settings',
  'roles',
  'announcements',
  'tags',
  'scheduler',
];

export async function registerAllTools(server: McpServer, deps: ToolDeps): Promise<void> {
  for (const domain of DOMAINS) {
    try {
      const mod: any = await import(`./${domain}.js`);
      const registerName = `register${domain[0].toUpperCase()}${domain.slice(1)}Tools`;
      if (typeof mod[registerName] === 'function') {
        mod[registerName](server, deps);
      }
    } catch {
      // Domain file not yet present in this worktree — skip silently.
    }
  }
}
