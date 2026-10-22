// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview The bot's AI: Claude, through @holons/core/ai — the same
 * key (ANTHROPIC_API_KEY), model (HOLONS_AI_MODEL, default claude-opus-5-5),
 * refusal fallback and error kinds as every other Holons surface.
 * @module src/AI
 */

import 'dotenv/config';
import {
  AIError,
  aiModel,
  complete,
  completeJSON,
  createClaude,
  toAIError,
} from '@holons/core/ai';
import locale from '../data/locales/en.json' with { type: 'json' };

/** A client + model for this process's env, built per call (the key may rotate). */
function claude() {
  return { client: createClaude(process.env), model: aiModel(process.env) };
}

/** The bot's guide to itself — the /help text — is what the agent knows. */
const ONBOARDING_SYSTEM = `You are the Holons Bot's onboarding guide, answering newcomers in a Telegram private chat.

Answer questions about Holons, holons, and how to use the bot, using the guide below as your source. Keep answers warm, brief and practical: a few short sentences in plain text without Markdown, because Telegram shows them as-is. Reply in the language the person writes in.

When a command helps, name it (for example /task or /settings). If the guide does not cover something, say you do not know and point them to the @HolonicDAO community chat, rather than describing a feature that may not exist.

They can type /done whenever they are ready to continue; mention it when they seem finished.

<guide>
${locale.translation.guide}
</guide>`;

/** How many questions one onboarding conversation takes before /done. */
export const ONBOARDING_MAX_QUESTIONS = 15;

/**
 * The onboarding agent: answer `prompt`, continuing `history` (the messages
 * of this conversation so far, as returned last time — append-only, so the
 * model's own thinking travels back unchanged).
 *
 * @param {Array<object>} history
 * @param {string} prompt
 * @returns {Promise<{history: Array<object>, text: string}>}
 */
export async function onboarding(history, prompt) {
  const messages = [...(history ?? []), { role: 'user', content: prompt }];
  const answer = await complete({
    ...claude(),
    system: ONBOARDING_SYSTEM,
    cacheSystem: true,
    messages,
    effort: 'low',
    maxTokens: 4000,
  });
  return {
    history: [...messages, { role: 'assistant', content: answer.content }],
    text: answer.text,
  };
}

/**
 * The questions (ids from `catalogue`) that best clarify what someone looking
 * for a place to thrive in described in `requirements`, most relevant first.
 *
 * @param {string} requirements
 * @param {Array<{id: string, topic: string, description: string}>} catalogue
 * @returns {Promise<{questions: Array<{id: string}>}>}
 */
export async function getQuestions(requirements, catalogue) {
  const ids = catalogue.map(q => q.id);
  const { output } = await completeJSON({
    ...claude(),
    system:
      'You match a person to the questionnaire questions that will best clarify their needs for a community to live in. ' +
      'Pick the 4 most relevant questions from the catalogue, most relevant first.\n\n' +
      `<catalogue>\n${JSON.stringify(catalogue)}\n</catalogue>`,
    user: requirements,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id'],
            properties: { id: { type: 'string', enum: ids } },
          },
        },
      },
    },
    effort: 'low',
    maxTokens: 2000,
  });
  const known = new Set(ids);
  const questions = (Array.isArray(output?.questions) ? output.questions : [])
    .map(q => ({ id: String(q?.id ?? '') }))
    .filter(q => known.has(q.id));
  return { questions };
}

/** A summary of a chat transcript: decisions, actions and open points. */
export async function summarize(history) {
  const answer = await complete({
    ...claude(),
    system:
      'Summarise this group chat transcript for its members: the main topics, decisions taken, actions with who owns them, and open questions. ' +
      'Be concise, in plain text without Markdown, in the language of the transcript.',
    messages: [
      { role: 'user', content: `<transcript>\n${history}\n</transcript>` },
    ],
    effort: 'low',
    maxTokens: 4000,
  });
  return answer.text;
}

/** The image types Claude reads. */
const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

function imageBlock(buffer, mime = 'image/jpeg') {
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: IMAGE_TYPES.has(mime) ? mime : 'image/jpeg',
      data: buffer.toString('base64'),
    },
  };
}

/** A line a member can read for a failed image call. */
function imageError(error) {
  const aiErr = error instanceof AIError ? error : toAIError(error);
  if (aiErr.kind === 'rate_limit') {
    return 'The image analysis service is busy right now — try again shortly.';
  }
  return 'The image analysis service is temporarily unavailable.';
}

/**
 * Items visible in a photo, for the community library.
 * @param {Buffer} imageBuffer
 * @param {string} itemType - Type hint for items (e.g. 'tools', 'books', 'any')
 * @returns {Promise<{items: Array<{name: string, value: number}>, error?: string}>}
 */
export async function extractItemsFromImage(imageBuffer, itemType = 'any') {
  const what =
    itemType === 'any'
      ? 'every distinct item that could be shared or borrowed in a community library'
      : `every ${itemType} that could be shared or borrowed`;
  try {
    const { output } = await completeJSON({
      ...claude(),
      system:
        'You catalogue items in photos for a community lending library. List only clearly identifiable items. ' +
        'Name each in 1-3 words (for a book, its title only, without the author), and estimate its second-hand value in euros as a whole number.',
      user: [
        imageBlock(imageBuffer),
        { type: 'text', text: `List ${what} in this photo.` },
      ],
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['items'],
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'value'],
              properties: {
                name: { type: 'string' },
                value: { type: 'integer' },
              },
            },
          },
        },
      },
      effort: 'low',
      maxTokens: 4000,
    });
    return { items: Array.isArray(output?.items) ? output.items : [] };
  } catch (error) {
    console.error('Error extracting items from image:', error);
    return { items: [], error: imageError(error) };
  }
}

/**
 * The writing on a photographed card, handwriting included.
 * @param {Buffer} imageBuffer
 * @param {string} mime
 * @returns {Promise<{text: string, error?: string}>}
 */
export async function transcribeImage(imageBuffer, mime = 'image/jpeg') {
  try {
    const { output } = await completeJSON({
      ...claude(),
      system:
        'You transcribe the writing on photographed cards exactly as written, handwriting included. ' +
        'Keep the original language and line breaks and add no commentary; use an empty string when nothing is legible.',
      user: [
        imageBlock(imageBuffer, mime),
        { type: 'text', text: 'Transcribe this card.' },
      ],
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: { text: { type: 'string' } },
      },
      effort: 'low',
      maxTokens: 4000,
    });
    return { text: typeof output?.text === 'string' ? output.text : '' };
  } catch (error) {
    console.error('Error transcribing image:', error);
    return { text: '', error: imageError(error) };
  }
}
