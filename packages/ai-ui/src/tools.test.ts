import { describe, expect, it } from 'vitest';
import { toolsFromRegistry, toolFromCommand } from './tools.js';
import { getFallbackRegistry } from './commands.js';

describe('toolsFromRegistry', () => {
  it('produces at least the 3 fallback tools', () => {
    const tools = toolsFromRegistry();
    expect(tools.length).toBeGreaterThanOrEqual(3);
    const names = tools.map((t) => t.name);
    expect(names).toContain('createTask');
    expect(names).toContain('logHours');
    expect(names).toContain('addToShoppingList');
  });

  it('marks required params in the JSON schema', () => {
    const cmd = getFallbackRegistry().get('createTask');
    expect(cmd).toBeDefined();
    const tool = toolFromCommand(cmd!);
    const schema = tool.input_schema as {
      type: string;
      properties: Record<string, { type: string }>;
      required?: string[];
    };
    expect(schema.type).toBe('object');
    expect(schema.required).toContain('holonId');
    expect(schema.required).toContain('title');
    expect(schema.required).not.toContain('description');
    expect(schema.properties.holonId.type).toBe('string');
  });

  it('coerces numeric param types to JSON Schema number', () => {
    const cmd = getFallbackRegistry().get('logHours')!;
    const tool = toolFromCommand(cmd);
    const props = (tool.input_schema as { properties: Record<string, { type: string }> })
      .properties;
    expect(props.hours.type).toBe('number');
  });
});
