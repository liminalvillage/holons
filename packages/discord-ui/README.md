# @holons/discord-ui

Discord UI for Holons. A slash-command bot that turns a Discord server into a
Holons community ("holon"), delegating all business logic to
[`@holons/core`](../core). It is the Discord counterpart to
[`@holons/telegram-ui`](../telegram-ui).

## Status

**Phase 3 — contribution scores, quest detail/filter, read-only settings.**
Builds on the Phase 1 runtime (gateway client, slash-command registration,
interaction router, embed/button UI helpers, guild→holon binding, `@holons/core`
context adapter) and the Phase 2 features. More telegram-parity features are
being ported in subsequent phases (see the roadmap below).

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
- `/join` · `/leave` · `/members` — holon membership (a member is a profile in
  the `users` lens, feeding expenses and scoring).
- `/task` · `/event` · `/offer` · `/request` — create quests; join/leave and
  complete via buttons, **appreciate** contributors once completed.
- `/quests` — list quests in the holon.
- `/shopping add <item>` · `/shopping list` — shared shopping list with toggle
  and "remove checked" buttons.
- `/expense <amount> <description> [currency] [split]` — record a shared cost.
- `/balances [currency]` — who owes whom (credit-matrix balances).
- `/checklist create|add|show|list` — checklists with per-item toggle buttons.
- `/quests [type]` — list quests (optionally filtered); each line shows its id.
- `/quest <id>` — reopen one quest as an interactive card.
- `/scores` — contribution leaderboard (REA + value equation, via core scoring).
- `/settings` — read-only holon configuration overview.

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

- ✅ **Phase 1** — runtime + quests/shopping vertical slice.
- ✅ **Phase 2** — membership (`/join` `/leave` `/members`), expenses/REA
  (`/expense` `/balances`), checklists (`/checklist`), quest appreciation.
- ✅ **Phase 3** — contribution scores (`/scores`), quest detail/filter
  (`/quest`, `/quests type:`), read-only settings (`/settings`).
- ⬜ Quests deeper (time logging, on-quest checklists, scheduling/recurring).
- ⬜ Tags, Roles/Onboarding, Scheduler/Reminders, Federation, Library,
  editable Settings.
- ⬜ Long tail: announcements, RSVP, rounds/rotation, booking, capital game.
