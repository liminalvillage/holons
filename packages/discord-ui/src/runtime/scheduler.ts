/**
 * Background reminder runtime. Ticks on an interval, scans the reminders of
 * every holon bound to a guild, and delivers any that are due to the channel
 * they were created in — then advances recurring ones or deletes one-shots.
 *
 * The scheduling math + persistence live in `@holons/core/scheduler`; this is
 * just the discord.js delivery loop. Reminders carry their own `channelId`, so
 * no guild→channel binding is needed.
 */
import { EmbedBuilder, type Client } from 'discord.js';
import {
  advanceReminder,
  deleteReminder,
  dueReminders,
  listReminders,
  saveReminder,
  type Reminder,
  type SchedulerDB,
} from '@holons/core/scheduler';
import type { HolonBindingStore, HoloStore } from '../types.js';
import { ACCENT } from '../ui/DiscordUI.js';
import { log } from '../utils/logger.js';

/** How often to scan for due reminders. */
const TICK_MS = 30_000;

export interface SchedulerDeps {
  holosphere: HoloStore;
  bindings: HolonBindingStore;
  client: Client;
}

export class SchedulerRuntime {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    if (this.timer) return;
    // unref so a pending tick never keeps the process alive on shutdown.
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    log.info('Reminder scheduler started', { intervalMs: TICK_MS });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Holon ids bound to at least one guild the bot is in. */
  private async boundHolons(): Promise<Set<string>> {
    const holons = new Set<string>();
    for (const guildId of this.deps.client.guilds.cache.keys()) {
      try {
        const holonId = await this.deps.bindings.get(guildId);
        if (holonId) holons.add(holonId);
      } catch {
        /* skip unreadable bindings */
      }
    }
    return holons;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return; // don't overlap slow ticks
    this.ticking = true;
    try {
      const db = this.deps.holosphere as unknown as SchedulerDB;
      const nowIso = new Date().toISOString();
      for (const holonId of await this.boundHolons()) {
        const reminders = await listReminders(db, holonId);
        for (const reminder of dueReminders(reminders, nowIso)) {
          await this.fire(reminder);
          const next = advanceReminder(reminder, nowIso);
          if (next) await saveReminder(db, next);
          else await deleteReminder(db, holonId, reminder.id);
        }
      }
    } catch (err) {
      log.warn('Reminder tick failed', { error: String(err) });
    } finally {
      this.ticking = false;
    }
  }

  private async fire(reminder: Reminder): Promise<void> {
    if (!reminder.channelId) return;
    try {
      const channel = await this.deps.client.channels.fetch(reminder.channelId);
      if (!channel?.isTextBased() || !('send' in channel)) return;
      const mention = reminder.createdBy ? `<@${reminder.createdBy}> ` : '';
      await channel.send({
        content: mention,
        embeds: [
          new EmbedBuilder()
            .setColor(ACCENT)
            .setTitle('⏰ Reminder')
            .setDescription(reminder.text),
        ],
      });
    } catch (err) {
      log.warn('Reminder delivery failed', {
        reminder: reminder.id,
        error: String(err),
      });
    }
  }
}
