import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { makeLLM, makeSTT, makeTTS } from './factory.js';

describe('loadConfig provider selection', () => {
  it('defaults every leg to api', () => {
    const c = loadConfig({});
    expect(c.llm).toBe('api');
    expect(c.stt).toBe('api');
    expect(c.tts).toBe('api');
  });

  it('VOICE_PROVIDER=local flips all legs', () => {
    const c = loadConfig({ VOICE_PROVIDER: 'local' });
    expect([c.llm, c.stt, c.tts]).toEqual(['local', 'local', 'local']);
  });

  it('per-leg override beats the master switch', () => {
    const c = loadConfig({ VOICE_PROVIDER: 'local', TTS_PROVIDER: 'api' });
    expect(c.llm).toBe('local');
    expect(c.stt).toBe('local');
    expect(c.tts).toBe('api');
  });

  it('parses the voice tool filter', () => {
    const def = loadConfig({});
    expect(Array.isArray(def.toolPrefixes)).toBe(true);
    expect(def.toolPrefixes).toContain('task');
    expect(loadConfig({ VOICE_TOOLS: 'all' }).toolPrefixes).toBeNull();
    expect(loadConfig({ VOICE_TOOLS: 'task, library' }).toolPrefixes).toEqual([
      'task',
      'library',
    ]);
  });

  it('forwards HOLONS_* vars to the MCP subprocess env', () => {
    const c = loadConfig({ HOLONS_ACTOR_ID: '42', OTHER: 'x' });
    expect(c.mcp.env.HOLONS_ACTOR_ID).toBe('42');
    expect(c.mcp.env.OTHER).toBeUndefined();
  });

  it('builds the provider each leg selects', () => {
    const api = loadConfig({});
    expect(makeLLM(api).name).toBe('anthropic');
    expect(makeSTT(api).name).toBe('openai');
    expect(makeTTS(api).name).toBe('openai');

    const local = loadConfig({ VOICE_PROVIDER: 'local' });
    expect(makeLLM(local).name).toBe('openai-compat');
    expect(makeSTT(local).name).toBe('whispercpp');
    expect(makeTTS(local).name).toBe('kokoro');
  });
});
