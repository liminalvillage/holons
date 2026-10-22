# Voice: staged changes and the shared action catalogue

The kiosk's voice agent never writes to Holosphere from a turn. Every task
write it asks for is **staged** as a previewed change; the user reviews the
drawer, unticks what they don't want, and taps **Apply**. Only then does
anything reach the graph — signed by the kiosk's own key, as a tap would be.

```
utterance ─▶ agent loop (sequential tool dispatch)
              │ reads / UI tools   ─▶ run now      (list_items, navigate, plan_discard)
              │ task write tools   ─▶ stage        (@holons/core/actions: resolve → stage → merge)
              ▼
        review drawer (VoiceDrawer.svelte) ─▶ Apply (touch only) ─▶ applyChange(fresh record, op)
```

## Where things live

| Concern | Module |
|---|---|
| The action catalogue — `task_create`, `task_update`, `task_add_participant`, `task_remove_participant`, `task_toggle_participant`, `task_complete` — defined once as field specs | `packages/core/src/actions/catalogue.ts` (+ `spec.ts` → JSON schema for the LLM, `packages/mcp-ui/src/tools/catalogue.ts` → zod for MCP) |
| Resolving "it", "Marco", "at two" to real records | `packages/core/src/actions/resolve.ts`, matching in `match.ts` |
| The staged change (before/after/diff/op), merge rules, projection | `packages/core/src/actions/stage.ts` |
| Committing approved changes on the fresh record | `packages/core/src/actions/apply.ts` |
| Kiosk: pending plan store, kiosk ports (writer, hologram reflection, completion accounting) | `apps/kiosk/src/lib/voice/plan.ts` |
| Kiosk: drawer UI | `apps/kiosk/src/lib/components/VoiceDrawer.svelte` |
| Harness: staged audits, the "said done but only staged" check, sequential dispatch | `packages/ai-ui/src/harness.ts`, `providers/loop.ts` |

## Resolution rules (deterministic, in core)

- **Task**: exact `taskId` (cross-checked against what was said — a valid id can
  still be the wrong task) → `taskRef` / the utterance matched by title → the
  task in focus when nothing is named: the last staged target, then the open
  card. Several matches come back as candidates for the model to ask.
- **Person**: `user.id` in the roster → `user.name` / `user.username` matched
  over first name, last name, handle → the speaker when absent or "me".
- **Time**: a bare `time` keeps the task's day (or today); a bare `date` keeps
  its clock; either keeps the duration (`shiftSchedule`). An explicit end wins.

## Merge rules

Keyed by (owner holon, key, kind): a later schedule replaces the earlier one
("two… actually three" is one row); add + remove of the same person cancel;
an edit to a task that is itself still staged folds into its creation;
`complete` is a singleton. Later calls resolve against the *projected* tasks,
so "create X and add Marco to it" composes in one turn.

## Why Apply is touch-only

A misheard "yes" must never write. No tool can apply; the model is told so
(`STAGING_GUIDANCE`), and the harness corrects a reply that says a staged
change is *done* (`claimsDespiteStaging`). `plan_discard` exists for "never
mind".

## MCP parity

`packages/mcp-ui` registers the six task tools from the same catalogue (plus
legacy extras: ISO `when`/`until`, `persist`, `isAdmin`, bare `userId`) and
runs them through core's resolve → stage → apply, so an MCP write and a
kiosk-approved change take the same path. `tasks.catalogue.test.ts` fails if
a catalogue field is not accepted by an MCP tool.

## Not covered yet

- ws mode (the `@holons/voice-ui` server) still writes through MCP directly.
- Library borrow/return from voice still execute immediately.
- The web `AssistantWidget` has no drawer.

## Verifying

Build core and ai-ui dist first (`pnpm -F @holons/core build && pnpm -F
@holons/ai-ui build`), then drive the kiosk headlessly (`apps/kiosk` verify
skill) with typed transcripts: "add Marco to the kitchen and move it to 2pm"
→ two rows, graph unchanged; "actually 3pm" → the schedule row is replaced;
untick one, Apply → only the ticked one lands; "apply it" → nothing written.
