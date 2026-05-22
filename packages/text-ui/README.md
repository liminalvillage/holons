# @holons/text-ui

A framework-agnostic **text / CLI / REPL** interface for Holons. It parses a
command line, dispatches through `@holons/core/commands`, and renders the
result as text — so the CLI triggers exactly the same actions as the web,
Telegram, AI, and MCP interfaces.

## Run

```bash
pnpm -F @holons/text-ui build
pnpm -F @holons/text-ui exec holons --help     # usage
pnpm -F @holons/text-ui exec holons            # interactive REPL
pnpm -F @holons/text-ui exec holons "task 'fix the roof'"   # one-shot
```

Dev (watch rebuild): `pnpm -F @holons/text-ui dev`.

No environment variables are required — Holosphere I/O goes through
`@holons/core`.

## Layout

| File | Role |
| --- | --- |
| `src/cli.ts` | Entry point (`bin: holons`). REPL or one-shot execution. |
| `src/parser.ts` | Parses the command line into a core command + args. |
| `src/renderer.ts` | Formats core results as plain text. |
| `src/commands.ts` | Loads the `@holons/core/commands` registry. |

To support a new action, add it to `@holons/core/commands`; this UI picks it up
through the shared registry — do not re-implement domain logic here.

Tests: `pnpm -F @holons/text-ui test` (parser/renderer specs). See the root
[`CONTRIBUTING.md`](../../CONTRIBUTING.md).
