import { describe, it, expect } from 'vitest';
import { features, commandIndex, featureIndex } from './index.js';

describe('feature registry', () => {
  it('registers unique slash command names', () => {
    const names = features.flatMap(f => f.commands.map(c => c.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it('maps every command name to its owning feature', () => {
    const index = commandIndex();
    expect(index.get('task')?.id).toBe('quests');
    expect(index.get('quests')?.id).toBe('quests');
    expect(index.get('shopping')?.id).toBe('shopping');
    expect(index.get('holon')?.id).toBe('holon');
    expect(index.get('join')?.id).toBe('members');
    expect(index.get('members')?.id).toBe('members');
    expect(index.get('expense')?.id).toBe('expenses');
    expect(index.get('balances')?.id).toBe('expenses');
    expect(index.get('checklist')?.id).toBe('checklists');
    expect(index.get('quest')?.id).toBe('quests');
    expect(index.get('scores')?.id).toBe('scores');
    expect(index.get('settings')?.id).toBe('settings');
  });

  it('maps every feature id to its feature', () => {
    const index = featureIndex();
    for (const feature of features) {
      expect(index.get(feature.id)).toBe(feature);
    }
  });

  it('produces valid command JSON for registration', () => {
    for (const feature of features) {
      for (const command of feature.commands) {
        const json = command.toJSON() as { name: string; description: string };
        expect(json.name).toMatch(/^[-_\p{L}\p{N}]{1,32}$/u);
        expect(typeof json.description).toBe('string');
      }
    }
  });
});
