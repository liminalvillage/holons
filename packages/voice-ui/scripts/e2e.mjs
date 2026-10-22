#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Live end-to-end harness for the voice server. Drives REAL turns over the
// WebSocket and verifies their effects procedurally — the MCP leg is checked
// against HoloSphere through an independent mcp-ui client, never by trusting
// the agent's spoken reply (the whole point of the turn harness is that a
// reply can lie).
//
//   1. MCP write   "create a task called <marker>" must end in task_create,
//                  and the task must be readable back via lens_get_all on a
//                  second, independent mcp-ui instance (same relay/namespace).
//   2. Navigate    "go to the calendar" must push {type:'navigate'} validated
//                  against the views the client advertised.
//   3. Mute        with {type:'mute'} sent, a turn must produce its assistant
//                  text and ZERO tts frames.
//   4. Cleanup     the created task is lens_delete'd and verified gone.
//
// Prereqs: a running voice server (VOICE_WS, default ws://localhost:8788)
// with its LLM leg up, built ../mcp-ui/dist, and the relay reachable.
// NOTE: writes one throwaway task to E2E_HOLON — default 235114395 (personal
// holon), NEVER point it at a shared holon you don't want test noise in.
//
// Usage: pnpm -F @holons/voice-ui e2e

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = dirname(fileURLToPath(import.meta.url));
// Same env the voice server and mcp-ui read (HOLONS_APP/HOLOSPHERE_RELAYS —
// the namespace MUST match the server's or the verification reads see nothing).
loadDotenv({ path: resolve(here, '..', '..', '..', '.env') });

const WS_URL = process.env.VOICE_WS || 'ws://localhost:8788';
const HOLON = process.env.E2E_HOLON || '235114395';
const TURN_TIMEOUT_MS = 240_000;

const marker = Math.random().toString(36).slice(2, 6);
const TITLE = `Harness smoke ${marker}`;
const context = {
  app: 'kiosk',
  holon: HOLON,
  view: 'tasks',
  views: 'tasks,calendar,library,roles,status',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Voice client ───────────────────────────────────────────────────────────

class VoiceClient {
  constructor(ws) {
    this.ws = ws;
    this.listeners = new Set();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      for (const l of [...this.listeners]) l(msg);
    };
  }

  static connect(url) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      ws.onerror = () => rej(new Error(`cannot reach voice server at ${url}`));
      ws.onmessage = (ev) => {
        if (JSON.parse(String(ev.data)).type === 'ready') res(new VoiceClient(ws));
      };
    });
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  /**
   * Run one typed turn and collect its frames until the assistant reply
   * (the server sends exactly one per turn, after any corrective pass).
   */
  turn(text, ctx) {
    return new Promise((res, rej) => {
      const result = { tools: [], navigations: [], ttsFrames: 0, reply: '' };
      const timer = setTimeout(() => {
        this.listeners.delete(onFrame);
        rej(new Error(`turn "${text}" timed out after ${TURN_TIMEOUT_MS / 1000}s`));
      }, TURN_TIMEOUT_MS);
      const onFrame = (msg) => {
        if (msg.type === 'tool') result.tools.push(String(msg.name));
        if (msg.type === 'navigate') result.navigations.push(String(msg.view));
        if (msg.type === 'tts' || msg.type === 'tts_start') result.ttsFrames++;
        if (msg.type === 'assistant' || msg.type === 'error') {
          result.reply = String(msg.type === 'error' ? msg.message : msg.text);
          clearTimeout(timer);
          this.listeners.delete(onFrame);
          res(result);
        }
      };
      this.listeners.add(onFrame);
      this.send({ type: 'text', text, context: ctx });
    });
  }

  /** Keep counting late frames (TTS trails the assistant reply). */
  tally(result, ms) {
    const onFrame = (msg) => {
      if (msg.type === 'tts' || msg.type === 'tts_start') result.ttsFrames++;
    };
    this.listeners.add(onFrame);
    return sleep(ms).then(() => this.listeners.delete(onFrame));
  }

  close() {
    this.ws.close();
  }
}

// ── Independent MCP verifier ───────────────────────────────────────────────

async function mcpConnect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(here, '..', '..', 'mcp-ui', 'dist', 'index.js')],
    env: { ...process.env },
    stderr: 'ignore',
  });
  const client = new Client({ name: 'voice-e2e', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

async function lensGetAll(mcp, holon, lens) {
  const res = await mcp.callTool({ name: 'lens_get_all', arguments: { holon, lens } });
  const text = (res.content ?? [])
    .map((p) => (p.type === 'text' ? (p.text ?? '') : ''))
    .join('\n');
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

/** Retry an eventually-consistent read until it yields, or fail the run. */
async function eventually(fn, label, { tries = 6, delayMs = 3000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(delayMs);
  }
  console.log(`FAIL: ${label} (gave up after ${tries} tries)`);
  failures++;
  return null;
}

// ── The run ────────────────────────────────────────────────────────────────

console.log(`voice server: ${WS_URL} · holon: ${HOLON} · marker: "${TITLE}"`);
const voice = await VoiceClient.connect(WS_URL);
const mcp = await mcpConnect();

// 1. MCP write through the agent, verified against HoloSphere.
const t1 = await voice.turn(`create a task called "${TITLE}"`, context);
console.log(`   turn 1 tools: ${t1.tools.join(', ') || '(none)'} — reply: ${t1.reply.slice(0, 80)}`);
check(t1.tools.includes('task_create'), 'agent dispatched task_create over MCP');
const created = await eventually(
  async () =>
    (await lensGetAll(mcp, HOLON, 'quests')).find((it) =>
      String(it?.title ?? '').toLowerCase().includes(marker),
    ),
  'created task readable back from HoloSphere',
);
if (created) check(true, `task persisted and readable back (id ${created.id})`);

// 2. Navigation.
const t2 = await voice.turn('go to the calendar', context);
check(t2.navigations.includes('calendar'), 'navigate frame pushed with view=calendar');

// 3. Mute (fresh session — mute is per-connection state).
const mutedSession = await VoiceClient.connect(WS_URL);
mutedSession.send({ type: 'mute', muted: true });
const t3 = await mutedSession.turn('hello there', context);
await mutedSession.tally(t3, 4000);
check(t3.reply.length > 0 && t3.ttsFrames === 0, 'muted turn: text reply, zero TTS frames');
mutedSession.close();

// 4. Cleanup — delete the marker task and confirm it's gone.
if (created?.id) {
  await mcp.callTool({
    name: 'lens_delete',
    arguments: { holon: HOLON, lens: 'quests', id: String(created.id) },
  });
  const gone = await eventually(
    async () =>
      !(await lensGetAll(mcp, HOLON, 'quests')).some(
        (it) => String(it?.id) === String(created.id),
      ),
    'cleanup: marker task deleted from HoloSphere',
  );
  if (gone) check(true, 'cleanup: marker task deleted');
}

await mcp.close();
voice.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
