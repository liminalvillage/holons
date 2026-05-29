# @holons/discord-ui

Discord UI for Holons. A slash-command bot that turns a Discord server into a
Holons community ("holon"), delegating all business logic to
[`@holons/core`](../core). It is the Discord counterpart to
[`@holons/telegram-ui`](../telegram-ui).

## Status

**Phase 1 — runtime foundation + first vertical slice.** This package ships the
bot runtime (gateway client, slash-command registration, an interaction router,
embed/button UI helpers, guild→holon binding, and a `@holons/core` context
adapter) plus a working slice of features. More telegram-parity features are
being ported in subsequent phases (see the table below).

## Architecture

```
index.ts            → boot: create holosphere + client, register, login
core/DiscordBot.ts  → lifecycle orchestration
core/ServiceContainer.ts → DI container (ported from telegram-ui)
runtime/client.ts        → discord.js Client (Guilds intent)
runtime/registerCommands → REST slash-command registration
runtime/router.ts        → single interactionCreate dispatcher
context.ts               → builds a @holons/core CommandContext per interaction
ui/customId.ts           → encode/parse component customIds (feature:action:args)
ui/format.ts             → pure, testable embed/list formatters
ui/DiscordUI.ts          → EmbedBuilder / ButtonBuilder helpers
ui/holonBinding.ts       → guild → holon mapping (persisted in holosphere)
features/                → one module per feature (slash cmds + handlers)
```

Each **feature** owns one or more top-level slash commands and the
buttons/selects/modals they spawn. Adding a feature to `features/index.ts` wires
it into both registration and routing.

### Telegram → Discord mapping

| Telegram (telegraf)        | Discord (discord.js)                         |
| -------------------------- | -------------------------------------------- |
| `bot.command('x')`         | slash command (`SlashCommandBuilder`)        |
| `ctx.reply()`              | `interaction.reply()` (embeds)               |
| inline keyboard buttons    | `ButtonBuilder` + `ActionRowBuilder`         |
| inline keyboard menus      | `StringSelectMenuBuilder`                    |
| scenes / wizards           | modals + component collectors                |
| editable "hologram" msg    | stored message id + `message.edit()`         |
| per-chat → holon           | per-guild → holon (`/holon bind`)            |

## Commands (current)

- `/holon bind <id>` · `/holon current` — bind the server to a holon.
- `/task` · `/event` · `/offer` · `/request` — create quests; join/leave and
  complete via buttons.
- `/quests` — list quests in the holon.
- `/shopping add <item>` · `/shopping list` — shared shopping list with toggle
  and "remove checked" buttons.

## Development

```bash
# from the monorepo root
pnpm install
pnpm -F @holons/discord-ui typecheck
pnpm -F @holons/discord-ui test

# run the bot (needs a .env — see .env.example)
pnpm dev:discord
# (re)register slash commands out of band
pnpm -F @holons/discord-ui register
```

Set `DISCORD_TOKEN`, `DISCORD_APP_ID`, and (for instant dev updates)
`DISCORD_GUILD_ID` in `.env`. See [`.env.example`](./.env.example).

## Roadmap (telegram parity)

Quests (time logging, checklists, scheduling, appreciation) → Checklists/Tags →
Expenses/REA → Roles/Users/Onboarding → Scheduler/Reminders → Federation →
Library → Settings → the long tail (announcements, RSVP, rounds, booking, …).
