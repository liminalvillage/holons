# @holons/ai-ui

A natural-language interface for Holons. It runs a Claude
([Anthropic SDK](https://docs.anthropic.com/)) tool-use loop where each
`@holons/core` command is exposed as a tool — so plain English like
*"create a task to fix the roof and assign it to me"* turns into the same core
actions every other UI performs.

## Run

```bash
export ANTHROPIC_API_KEY=sk-ant-...            # required
pnpm -F @holons/ai-ui build
pnpm -F @holons/ai-ui exec holons-ai "create a task to fix the roof"
echo "list open tasks" | pnpm -F @holons/ai-ui start   # stdin also works
```

Dev (watch rebuild): `pnpm -F @holons/ai-ui dev`.

| Env var | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | Authenticates the Claude API client. |
| `HOLONS_AI_MODEL` | no | Override the default Claude model. |

## Layout

| File | Role |
| --- | --- |
| `src/cli.ts` | Entry point (`bin: holons-ai`). Reads argv/stdin, runs the loop, prints the final reply. |
| `src/agent.ts` | The Claude tool-use loop (request → tool calls → result). |
| `src/tools.ts` | Maps `@holons/core` commands to Claude tool definitions. |
| `src/commands.ts` | Resolves the `@holons/core/commands` registry. |

New capabilities come from adding commands to `@holons/core/commands`; they
become tools here automatically. Don't put domain logic in this package.

Tests: `pnpm -F @holons/ai-ui test`. See [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md).
