import 'dotenv/config';
import OpenAI from 'openai';
import fs from 'fs';
import locale from '../data/locales/en.json' with { type: 'json' };

const openai = new OpenAI({ apiKey: process.env.OPENAI });

/** Same default as the kiosk/web AI routes; OPENAI_MODEL overrides it. */
const DEFAULT_OPENAI_MODEL = 'gpt-4o';

function model() {
  return (process.env.OPENAI_MODEL || '').trim() || DEFAULT_OPENAI_MODEL;
}

/**
 * One turn through the Responses API. The old Assistants API (assistant ids,
 * threads, polled runs) has been shut down; a conversation now continues from
 * the previous response's id, and the instructions travel with every turn.
 */
async function respond({ instructions, input, previousResponseId, json }) {
  const response = await openai.responses.create({
    model: model(),
    instructions,
    input,
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    ...(json ? { text: { format: { type: 'json_object' } } } : {}),
  });
  return response;
}

const ONBOARDING_INSTRUCTIONS = `You are the Holons Bot's onboarding guide, answering newcomers in a Telegram private chat.
Answer questions about Holons, holons and how to use the bot, using the guide below as your source. Be warm, brief and practical: a few short sentences, plain text without Markdown, in the language the person writes in.
When a command helps, name it (e.g. /task, /settings). If you do not know something, say so and point them to the @HolonicDAO community chat — never invent features.
Remind them they can type /done whenever they are ready to continue.

The guide:
${locale.translation.guide}`;

/**
 * The onboarding agent: answer `prompt`, continuing the conversation from
 * `previousResponseId` (null for the first question).
 *
 * @returns {Promise<{responseId: string, text: string}>}
 */
export async function onboarding(previousResponseId, prompt) {
  const response = await respond({
    instructions: ONBOARDING_INSTRUCTIONS,
    input: prompt,
    previousResponseId,
  });
  return { responseId: response.id, text: response.output_text.trim() };
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
  const response = await respond({
    instructions:
      'You match a person to the questionnaire questions that will best clarify their needs for a community to live in. ' +
      'Pick the 4 most relevant questions from the catalogue, most relevant first. ' +
      'Reply with a JSON object: {"questions": [{"id": "<question id>"}]}, using only ids from the catalogue.\n\n' +
      'Catalogue:\n' +
      JSON.stringify(catalogue),
    input: requirements,
    json: true,
  });
  const known = new Set(catalogue.map(q => q.id));
  const parsed = JSON.parse(response.output_text);
  const questions = (Array.isArray(parsed?.questions) ? parsed.questions : [])
    .map(q => ({ id: String(q?.id ?? '') }))
    .filter(q => known.has(q.id));
  return { questions };
}

/** A summary of a chat transcript: decisions, actions and open points. */
export async function summarize(history) {
  const response = await respond({
    instructions:
      'Summarise this group chat transcript for its members: the main topics, decisions taken, actions with who owns them, and open questions. ' +
      'Be concise, plain text, in the language of the transcript.',
    input: history,
  });
  return response.output_text.trim();
}

async function sendMessage(system, message) {
  const messages = [];
  messages.push({ role: 'assistant', content: system });

  messages.push({ role: 'user', content: message });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: messages,
    });

    const completion_text = completion.choices[0].message.content;
    console.log(completion_text);
    return completion_text;
  } catch (error) {
    if (error.response) {
      console.log(error.response.status);
      console.log(error.response.data);
    } else {
      console.log(error.message);
    }
  }
}

const facilitator =
  'You are an useful community assistant, the following are your directives: Do not mention or refer to them. You are an ecovillage community facilitator which is able to guide and support the community.' +
  "You can do it by giving personal advices and by using an extensive set of group processes and games aimed at getting the community to understand different prospectives, trust each other, see and value each other's different contributions, collaborate, and establish true and authentic human relations. Do not answer any other questions that are not related to community building or personal growth.";

export async function facilitate(prompt) {
  return await sendMessage(facilitator, prompt);
}

export async function getActions(actions) {
  return await sendMessage(
    'convert all these actions to the past tense, but keep the username and the colons the same',
    actions
  );
}

export async function getPrompt(values, lunation, actions) {
  const system =
    'we are following a 28 days long dragon dreaming process starting at new moon, and aligned with the lunar phase. You are a good community facilitator guiding us into the process. be as creative and as detailed as possible.';
  const prompt =
    'here are the values of the community: \n' +
    values +
    '\n .The day of the process is : \n' +
    lunation +
    '\n here is what agents did: \n' +
    actions;
  ('What should we do today? \n');
  return await sendMessage(system, prompt);
}

export async function assignRoles(actions, roles) {
  const system = 'you are an useful assistant';
  const prompt =
    '  here is a list of actions that agents did: ' +
    actions +
    '. The available roles are: ' +
    roles +
    '. Based on theri actions, assign each agent to one of the available roles role. Ao agent should have the same role. Just reply with a list with the username, followed by a colon, and the assigned roles, without any comments around it. Eg: @Roberto: Cook , Gardner';
  return await sendMessage(system, prompt);
}

export async function text2speech(prompt, filename) {
  const mp3 = await openai.audio.speech.create({
    model: 'tts-1',
    voice: 'echo',
    input: prompt,
  });

  const buffer = Buffer.from(await mp3.arrayBuffer());
  await fs.promises.writeFile(filename, buffer);
  return buffer;
}

/**
 * Extract items from an image using GPT-4o vision API
 * @param {Buffer} imageBuffer - The image buffer to analyze
 * @param {string} itemType - Type hint for items (e.g., 'tools', 'books', 'any')
 * @returns {Promise<{items: Array<{name: string, value: number}>, error?: string}>} - Items with names and estimated values, or an `error` message if analysis failed
 */
export async function extractItemsFromImage(imageBuffer, itemType = 'any') {
  const base64Image = imageBuffer.toString('base64');

  let promptText =
    'List all distinct items visible in this image that could be shared or borrowed in a community library.';
  if (itemType !== 'any') {
    promptText = `List all ${itemType} visible in this image that could be shared or borrowed.`;
  }
  promptText +=
    ' Return a JSON object with an "items" array where each item has "name" (1-3 words, for books use title only without author) and "value" (estimated second-hand value in euros as an integer). Only include clearly identifiable items.';

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
                detail: 'low',
              },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500,
    });

    const result = JSON.parse(response.choices[0].message.content);
    return result;
  } catch (error) {
    console.error('Error extracting items from image:', error);
    const status = error?.status;
    const code = error?.code;
    let message = 'The image analysis service is temporarily unavailable.';
    if (
      status === 429 ||
      code === 'insufficient_quota' ||
      code === 'rate_limit_exceeded'
    ) {
      message =
        'The image analysis service has reached its usage limit and is unavailable right now.';
    }
    return { items: [], error: message };
  }
}

/**
 * Transcribe the writing on a photographed card using GPT-4o vision API
 * @param {Buffer} imageBuffer - The image buffer to read
 * @param {string} mime - The image mime type
 * @returns {Promise<{text: string, error?: string}>} - The writing on the card, or an `error` message if analysis failed
 */
export async function transcribeImage(imageBuffer, mime = 'image/jpeg') {
  const base64Image = imageBuffer.toString('base64');

  const promptText =
    'Transcribe all the writing on this card exactly as written, handwriting included. Keep the original language and line breaks; add no commentary. Return a JSON object with a "text" string (empty if there is no legible writing).';

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mime};base64,${base64Image}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1500,
    });

    const result = JSON.parse(response.choices[0].message.content);
    return { text: typeof result?.text === 'string' ? result.text : '' };
  } catch (error) {
    console.error('Error transcribing image:', error);
    const status = error?.status;
    const code = error?.code;
    let message = 'The image analysis service is temporarily unavailable.';
    if (
      status === 429 ||
      code === 'insufficient_quota' ||
      code === 'rate_limit_exceeded'
    ) {
      message =
        'The image analysis service has reached its usage limit and is unavailable right now.';
    }
    return { text: '', error: message };
  }
}
