import { describe, it, expect } from 'vitest';
import { buildInvocationContext } from './context.js';
import type { HoloStore, HolonBindingStore } from './types.js';

const noopStore: HoloStore = {
  get: async () => null,
  getAll: async () => [],
  put: async () => undefined,
};

function bindingsWith(map: Record<string, string>): HolonBindingStore {
  return {
    get: async guildId => map[guildId] ?? null,
    set: async () => undefined,
  };
}

describe('buildInvocationContext', () => {
  it('resolves the bound holon for a guild', async () => {
    const ctx = await buildInvocationContext({
      holosphere: noopStore,
      bindings: bindingsWith({ g1: 'holon-42' }),
      guildId: 'g1',
    });
    expect(ctx.holonId).toBe('holon-42');
  });

  it('has a null holon when the guild is unbound', async () => {
    const ctx = await buildInvocationContext({
      holosphere: noopStore,
      bindings: bindingsWith({}),
      guildId: 'unknown',
    });
    expect(ctx.holonId).toBeNull();
  });

  it('builds a discord-sourced core CommandContext for the user', async () => {
    const ctx = await buildInvocationContext({
      holosphere: noopStore,
      bindings: bindingsWith({ g1: 'holon-42' }),
      guildId: 'g1',
    });
    const core = ctx.core({ id: 'u9', username: 'alice' });
    expect(core.source).toBe('discord');
    expect(core.userId).toBe('u9');
    expect(core.userName).toBe('alice');
    expect(core.holonId).toBe('holon-42');
    expect(core.holosphere).toBe(noopStore);
  });
});
