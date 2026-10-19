/**
 * @fileoverview Message tagging and categorization system.
 * @module src/Tags
 */

// Tag aggregation logic now lives in `@holons/core/tags`; this module is the
// Telegram shell (command parsing + replies) over it.
import { CARDS_TAG, getTagEntries, tagCard, tagMessage, type TagsDB } from '@holons/core/tags';
import { transcribeImage } from './AI.js';
import { hostTelegramPicture } from './Pictures.js';

// Minimal structural types so we don't depend on the full Telegraf surface
// area in this UI-only handler. The bot/db are duck-typed against what this
// module actually uses.
type CommandHandler = (ctx: any) => any | Promise<any>;
interface BotLike {
  command(name: string, handler: CommandHandler): unknown;
}
type DbLike = TagsDB;

/** Reads the writing off an image. Injectable so tests need no network. */
type Transcribe = (image: Buffer, mime: string) => Promise<{ text: string; error?: string }>;
interface TagsOptions {
  transcribe?: Transcribe;
  /** Clock in unix seconds. */
  now?: () => number;
}

/** How long `/card` waits for the photo before the request lapses. */
const CARD_WAIT_SEC = 15 * 60;

const IMAGE_MIMES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** The file_id of the image a message carries: its largest photo size, or an image document. */
function imageFileId(message: any): string | null {
  const photo = message?.photo;
  if (Array.isArray(photo) && photo.length > 0) return photo[photo.length - 1].file_id;
  if (message?.document?.mime_type?.startsWith('image/')) return message.document.file_id;
  return null;
}

/**
 * Tag management system for categorizing messages and content.
 *
 * Allows users to tag messages with keywords for organization and retrieval.
 * Tags are stored per-holon and can be searched and listed.
 *
 * @example
 * const tags = new Tags(bot, db);
 * // Reply to a message with /tag keyword1 keyword2
 */
export default class Tags {
  bot: BotLike;
  db: DbLike;
  transcribe: Transcribe;
  now: () => number;
  /** Who was asked to send a card photo, keyed by chat + user. */
  pendingCards: Map<string, { at: number }> = new Map();

  constructor(bot: BotLike, db: DbLike, options: TagsOptions = {}) {
    this.bot = bot;
    this.db = db;
    this.transcribe = options.transcribe ?? transcribeImage;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));

    this.bot.command('card', (ctx: any) => this.card(ctx));

    this.bot.command('tag', async (ctx: any) => {
      if (!ctx.message.reply_to_message) {
        return ctx.reply('Please reply to a message you want to tag.');
      }

      const tags: string[] = ctx.message.text.split(' ').slice(1);
      if (tags.length === 0) {
        return ctx.reply('Please provide at least one tag.');
      }

      const messageId: number = ctx.message.reply_to_message.message_id;
      // Holon ids are always strings — coerce Telegram's numeric chat id here.
      const holonId: string = ctx.message.chat.id.toString();
      const messageContent: string | undefined = ctx.message.reply_to_message.text;

      for (let i = 0; i < tags.length; i++) {
        await tagMessage(this.db, holonId, tags[i], {
          holonId,
          messageId,
          messageContent,
        });
      }

      ctx.reply('Message tagged successfully.');
    });

    // Query tagged messages
    this.bot.command('gettag', async (ctx: any) => {
      const holonId: string = ctx.message.chat.id.toString();
      const tag: string | undefined = ctx.message.text.split(' ')[1];
      if (!tag) {
        return ctx.reply('Please specify a tag.');
      }

      const entries = await getTagEntries(this.db, holonId, tag);

      if (entries.length === 0) {
        return ctx.reply('No messages found for this tag.');
      }

      const response = entries.map((entry) => entry.messageContent).join('\n');
      ctx.reply(response);
    });
  }

  /**
   * `/card` — file a photographed card under the `cards` tag. Used as a reply
   * to a photo it reads that photo; otherwise it waits for the sender's next one.
   * (A photo captioned `/card` arrives through the bot's photo handler.)
   */
  async card(ctx: any) {
    const replied = ctx.message?.reply_to_message;
    if (imageFileId(replied)) return this.saveCard(ctx, replied);

    this.pendingCards.set(this.cardKey(ctx.chat.id, ctx.from.id), { at: this.now() });
    return ctx.reply('📷 Send me the photo of the card and I will save its writing under #cards.');
  }

  cardKey(chatId: number | string, userId: number | string): string {
    return `${chatId}:${userId}`;
  }

  /** True while this user's `/card` in this chat is still waiting for its photo. */
  isWaitingForCard(chatId: number | string, userId: number | string): boolean {
    const key = this.cardKey(chatId, userId);
    const pending = this.pendingCards.get(key);
    if (!pending) return false;
    if (this.now() - pending.at > CARD_WAIT_SEC) {
      this.pendingCards.delete(key);
      return false;
    }
    return true;
  }

  /** Handle a photo meant as a card (to be called from the bot's photo handler). */
  async handleCardPhoto(ctx: any) {
    return this.saveCard(ctx, ctx.message);
  }

  /** Read the writing on `source`'s image and file it, with the picture, under `cards`. */
  async saveCard(ctx: any, source: any) {
    this.pendingCards.delete(this.cardKey(ctx.chat.id, ctx.from.id));

    const picture = imageFileId(source);
    if (!picture) {
      return ctx.reply('Please send the card as a photo.');
    }
    const replyTo = { reply_parameters: { message_id: source.message_id } };

    try {
      const fileUrl = new URL(String(await ctx.telegram.getFileLink(picture)));
      const extension = fileUrl.pathname.split('.').pop()?.toLowerCase() ?? '';
      const mime = IMAGE_MIMES[extension];
      if (!mime) {
        return ctx.reply('❌ Unsupported image format. Please send a JPG, PNG, or WEBP image.', replyTo);
      }

      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`image download failed: ${response.status}`);
      const image = Buffer.from(await response.arrayBuffer());

      const result = await this.transcribe(image, mime);
      if (result.error) {
        return ctx.reply(`⚠️ ${result.error}\n\nThe card was not saved. Please try again later.`, replyTo);
      }
      const text = (result.text ?? '').trim();
      if (!text) {
        return ctx.reply('I could not read any writing on this card. Try with a clearer photo.', replyTo);
      }

      await tagCard(this.db, ctx.chat.id.toString(), {
        messageId: source.message_id,
        text,
        picture: await hostTelegramPicture(ctx.telegram, picture),
      });
      return ctx.reply(`🗂 Saved under #${CARDS_TAG}:\n\n${text}`, replyTo);
    } catch (error) {
      // Never log the file URL: it carries the bot token.
      console.error('Error processing card photo:', (error as Error)?.message);
      return ctx.reply('Error processing the card. Please try again.', replyTo);
    }
  }
}
