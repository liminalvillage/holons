/**
 * Shared contracts for the Discord UI: the storage surface we use from
 * holosphere, the per-interaction context handed to features, and the
 * `Feature` interface every command module implements.
 */
import type {
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import type { CommandContext } from '@holons/core/commands';
import type { ParsedCustomId } from './ui/customId.js';

/**
 * Minimal slice of the HoloSphere instance the bot touches. Mirrors the
 * `(holonId, bucket, key)` access pattern used across all Holons UIs.
 * `getAll` resolves to an array of records (each typically carrying an `id`).
 */
export interface HoloStore {
  get(holonId: string, bucket: string, key?: string | number): Promise<unknown>;
  getAll(holonId: string, bucket: string): Promise<unknown[]>;
  put(holonId: string, bucket: string, value: unknown): Promise<unknown>;
  delete?(
    holonId: string,
    bucket: string,
    key: string | number
  ): Promise<unknown>;
}

/** The acting Discord user, normalised for `@holons/core`. */
export interface DiscordUser {
  id: string;
  username?: string;
}

/** Persisted mapping of Discord guild -> Holons holon id. */
export interface HolonBindingStore {
  get(guildId: string): Promise<string | null>;
  set(guildId: string, holonId: string): Promise<void>;
}

/**
 * Everything a feature handler needs for one interaction. Built once per
 * incoming interaction by the router (see `context.ts`).
 */
export interface InvocationContext {
  /** The bot's HoloSphere instance. */
  holosphere: HoloStore;
  /** Holon bound to the originating guild, or null if none is bound yet. */
  holonId: string | null;
  /** Holosphere application namespace. */
  appName: string;
  /** Guild -> holon binding store (used by the `holon` feature). */
  bindings: HolonBindingStore;
  /** Build a `@holons/core` CommandContext for the acting user. */
  core(user: DiscordUser): CommandContext;
}

/** A registrable slash command — anything exposing a name and `toJSON()`. */
export interface SlashCommandSpec {
  name: string;
  toJSON(): unknown;
}

/**
 * A self-contained slice of bot functionality. Owns one or more top-level
 * slash commands and (optionally) the buttons/selects/modals they spawn,
 * namespaced under `id` in their customIds.
 */
export interface Feature {
  /** customId namespace and registry key (e.g. `'quests'`). */
  id: string;
  /** Top-level slash commands this feature registers. */
  commands: SlashCommandSpec[];
  /** Handle one of this feature's slash commands. */
  handleCommand(
    interaction: ChatInputCommandInteraction,
    ctx: InvocationContext
  ): Promise<void>;
  /** Handle a button or select-menu interaction (customId starts `id:`). */
  handleComponent?(
    interaction: MessageComponentInteraction,
    parsed: ParsedCustomId,
    ctx: InvocationContext
  ): Promise<void>;
  /** Handle a modal submit (customId starts `id:`). */
  handleModal?(
    interaction: ModalSubmitInteraction,
    parsed: ParsedCustomId,
    ctx: InvocationContext
  ): Promise<void>;
}
