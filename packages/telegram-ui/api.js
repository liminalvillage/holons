#!/usr/bin/env node
/**
 * HolonsBot Task API — standalone HTTP server
 * Creates quests in HoloSphere and sends formatted messages via Telegram bot API
 * Usage: node api.js [--port 3101]
 */
// Load monorepo root .env (single source of truth) before reading process.env.
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '../../.env') });
loadDotenv();

import http from 'http';

const BOT_TOKEN = process.env.BOT_TOKEN;
const PEER = process.env.HOLONS_PEER || 'https://gun.holons.io/gun';
const APP = process.env.HOLONS_APP || 'HolonsDebug';
const PORT = parseInt(
  process.argv[process.argv.indexOf('--port') + 1] || '3101'
);

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN required in .env');
  process.exit(1);
}

let hs;
async function getHS() {
  if (hs) return hs;
  const { HoloSphere } = await import('holosphere');
  hs = new HoloSphere(APP, false, null, { peers: [PEER] });
  await new Promise(r => setTimeout(r, 2000));
  return hs;
}

async function tgSend(chatId, text, replyMarkup) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  return res.json();
}

function formatQuest(quest) {
  const lines = [`| Task: ${quest.title.padEnd(200)}`];
  lines.push(`| 💡 by: Atlas (AI)`);
  if (quest.description) lines.push(`| 📝 ${quest.description}`);
  if (quest.category) lines.push(`| 📑 category: ${quest.category}`);
  if (quest.when) {
    try {
      const d = new Date(quest.when);
      lines.push(
        `| 📅 ${d.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      );
    } catch {
      lines.push(`| 📅 ${quest.when}`);
    }
  }
  if (quest.until) {
    try {
      const d = new Date(quest.until);
      lines.push(
        `| 🔚 ${d.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      );
    } catch {
      lines.push(`| 🔚 ${quest.until}`);
    }
  }
  return lines.join('\n');
}

function questButtons(questId) {
  return {
    inline_keyboard: [
      [
        { text: '👍 appreciate', callback_data: `appreciate_quest_${questId}` },
        { text: '🙋 join', callback_data: `participate_quest_${questId}` },
      ],
      [
        { text: '✅ complete', callback_data: `complete_quest_${questId}` },
        { text: '📅 schedule', callback_data: `schedule_quest_${questId}` },
      ],
      [{ text: '⚙️ more actions', callback_data: `more_actions_${questId}` }],
    ],
  };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'POST' && req.url === '/quest') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', async () => {
      try {
        const { chatId, title, description, type, category, when, until } =
          JSON.parse(body);
        if (!chatId || !title) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'chatId and title required' }));
          return;
        }
        const h = await getHS();
        const holon = String(chatId);
        const quest = {
          id: h.generateId ? h.generateId() : `q_${Date.now()}`,
          version: '0.1',
          holon,
          title,
          description: description || '',
          type: type || 'task',
          status: 'ongoing',
          created: new Date().toISOString(),
          participants: [],
          appreciation: [],
          category: category || '',
          when: when || '',
          until: until || '',
          initiator: { id: chatId, first_name: 'Atlas', username: 'atlas_ai' },
        };

        await h.put(holon, 'quests', quest);
        const text = formatQuest(quest);
        const tgResult = await tgSend(chatId, text, questButtons(quest.id));

        res.writeHead(200);
        res.end(
          JSON.stringify({
            success: true,
            questId: quest.id,
            telegram: tgResult,
          })
        );
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.end(
    JSON.stringify({
      name: 'holonsbot-task-api',
      usage:
        'POST /quest {chatId, title, description?, type?, category?, when?, until?}',
    })
  );
});

server.listen(PORT, () => console.log(`HolonsBot Task API on port ${PORT}`));
