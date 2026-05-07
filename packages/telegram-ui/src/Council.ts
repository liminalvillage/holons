/**
 * @fileoverview AI-powered council for multi-perspective wisdom generation.
 * @module src/Council
 */

import OpenAI from 'openai';
import h3 from 'h3-js';
import {
  COUNCIL_PERSPECTIVES,
  emptyCell,
  type CouncilCell,
  type CouncilThread,
} from '@holons/core/council';

const MAX_POLLING_ATTEMPTS = 150; // 5 minutes at 2-second intervals

// Council perspectives are sourced from @holons/core/council so the web and
// AI UIs share the same prompt set.
const council: readonly string[] = COUNCIL_PERSPECTIVES;

// Minimal structural type for the bits of the bot/db this module touches.
type CommandHandler = (ctx: any) => any | Promise<any>;
interface BotLike {
  command(name: string, handler: CommandHandler): unknown;
}
interface DbLike {
  getGlobal(lens: string, id: string): Promise<any>;
  putGlobal(lens: string, value: any): Promise<unknown>;
}

/**
 * AI-powered council system for generating multi-perspective wisdom.
 *
 * Uses OpenAI Assistants API to generate wisdom from 12 different
 * perspectives representing various domains (health, business, climate, etc.).
 * Each perspective contributes to a holistic understanding of complex questions.
 *
 * @example
 * const council = new Council(bot, db);
 * // Use /wisdom <question> to get multi-perspective insights
 */
class Council {
  bot: BotLike;
  db: DbLike;
  openai: OpenAI;

  constructor(bot: BotLike, db: DbLike) {
    this.bot = bot;
    this.db = db;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI,
    });

    this.bot.command('wisdom', async (ctx: any) => {
      const question = ctx.message.text.split('/wisdom ')[1];
      const answer = await this.askQuestion(question, '802bfffffffffff');
      ctx.reply(answer);
    });

    this.bot.command('summary', async (ctx: any) => {
      const hex = ctx.message.text.split('/summary ')[1];
      const cell = await this.db.getGlobal('cell', hex);
      let summary = cell?.summary;
      if (!summary) {
        summary = await this.getChildSummary(hex);
      }
      ctx.reply(summary);
    });
  }

  async getChildSummary(hex: string): Promise<void> {
    const cellinfo = await this.getCellInfo(hex);
    const res = h3.getResolution(hex);
    const children = h3.cellToChildren(hex, res + 1);
    const childwisdom: string[] = [];

    for (let i = 0; i < children.length; i++) {
      // Legacy JS read `.summary` off the un-awaited Promise (always undefined);
      // awaiting first restores intended behaviour.
      const child = await this.getCellInfo(children[i]);
      if (child.summary) childwisdom.push(child.summary);
    }

    cellinfo.summary = await this.summarize(childwisdom.join('\n'));
    await this.db.putGlobal('cell', cellinfo);
  }

  async summarize(history: string): Promise<string> {
    const assistant = await this.openai.beta.assistants.retrieve(
      'asst_qhk79F8wV9BDNuwfOI80TqzC',
    );
    const thread = await this.openai.beta.threads.create();
    try {
      await this.openai.beta.threads.messages.create(thread.id, {
        role: 'user',
        content: history,
      });
      const run = await this.openai.beta.threads.runs.create(thread.id, {
        assistant_id: assistant.id,
      });

      let runStatus = await this.openai.beta.threads.runs.retrieve(thread.id, run.id);
      // Polling mechanism with timeout to prevent infinite loops
      let attempts = 0;
      while (runStatus.status !== 'completed' && attempts < MAX_POLLING_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        runStatus = await this.openai.beta.threads.runs.retrieve(thread.id, run.id);
        attempts++;
        if (runStatus.status === 'failed' || runStatus.status === 'cancelled') {
          throw new Error(
            `Run ${runStatus.status}: ${runStatus.last_error?.message || 'Unknown error'}`,
          );
        }
      }
      if (attempts >= MAX_POLLING_ATTEMPTS) {
        throw new Error('Polling timeout: run did not complete within 5 minutes');
      }
      // Get the latest messages from the thread
      const messages = await this.openai.beta.threads.messages.list(thread.id);
      const firstContent: any = messages.data[0].content[0];
      const summary = (firstContent?.text?.value ?? '')
        .replace(/```json\n/, '')
        .replace(/```/, '')
        .trim();
      return summary;
    } finally {
      // Clean up thread to prevent orphaned resources
      try {
        await this.openai.beta.threads.del(thread.id);
      } catch (cleanupError: any) {
        console.error('Error cleaning up thread:', cleanupError?.message);
      }
    }
  }

  async askQuestion(question: string, councilID: string): Promise<string> {
    const assistant = await this.openai.beta.assistants.retrieve(
      'asst_wMvKw4yfH8rn0Uv9yAPn1UMb',
    );
    const councilWisdom = await this.getThreads(councilID);
    const threads = councilWisdom.threads ?? [];
    //for each thread, create a message
    for (let i = 0; i < threads.length; i++) {
      await this.openai.beta.threads.messages.create(threads[i].id, {
        role: 'user',
        content: question,
      });
    }
    const runs: Array<{ id: string }> = [];
    for (let i = 0; i < threads.length; i++) {
      runs[i] = await this.openai.beta.threads.runs.create(threads[i].id, {
        assistant_id: assistant.id,
        instructions: council[i],
      });
    }
    let runStatus: any;
    // Polling mechanism with timeout to prevent infinite loops
    let attempts = 0;
    while (attempts < MAX_POLLING_ATTEMPTS) {
      let returned = 0;
      let failed = 0;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      for (let i = 0; i < threads.length; i++) {
        runStatus = await this.openai.beta.threads.runs.retrieve(threads[i].id, runs[i].id);
        if (runStatus.status == 'completed') returned += 1;
        else if (runStatus.status === 'failed' || runStatus.status === 'cancelled') failed += 1;
      }
      console.log(returned);
      if (returned == threads.length) break;
      if (failed > 0) throw new Error(`${failed} council member(s) failed to respond`);
      attempts++;
    }
    if (attempts >= MAX_POLLING_ATTEMPTS) {
      throw new Error('Polling timeout: council did not complete within 5 minutes');
    }
    //reset wisdom array
    councilWisdom.content.wisdom = [];
    //save results
    for (let i = 0; i < threads.length; i++) {
      // Get the latest messages from the thread
      const messages = await this.openai.beta.threads.messages.list(threads[i].id);
      const firstContent: any = messages.data[0].content[0];
      const answer = firstContent?.text?.value ?? '';
      councilWisdom.content.wisdom!.push(answer);
    }
    const summary = await this.summarize(councilWisdom.content.wisdom!.join('\n'));
    console.log(councilWisdom.content.wisdom);
    console.log('--------------------');
    console.log(summary);
    return summary;
  }

  async getCellInfo(id: string): Promise<CouncilCell> {
    let cellInfo: CouncilCell | null = await this.db.getGlobal('cell', id);
    if (!cellInfo) {
      cellInfo = emptyCell(id);
      await this.db.putGlobal('cell', cellInfo);
    }
    return cellInfo;
  }

  async getThreads(id: string): Promise<CouncilCell> {
    const cell = await this.getCellInfo(id);
    if (!cell.threads) {
      //create 12 threads
      const threads: CouncilThread[] = [];
      for (let i = 0; i < 12; i++) {
        threads.push(await this.openai.beta.threads.create());
      }
      cell.threads = threads;
    }
    return cell;
  }
}

export default Council;
