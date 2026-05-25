# @holons/core — Lens schemas

One JSON Schema per Holosphere **lens**. These are the schemas you register
via [`holosphere.setSchema(lens, schema)`](https://www.npmjs.com/package/holosphere)
and that get applied by `put()` when the HoloSphere is constructed with
`{ strict: true }`.

## Shape contract

Holosphere's `setSchema` enforces this meta-schema (from `holosphere/schema.js`):

- Top level: `type: "object"`, with `properties` and a non-empty `required` array.
- Every property in `properties` must itself have a single-string `type`
  (i.e. `"type": "string"`, not `"type": ["string", "number"]`). Pick one and
  stringify on write — Holosphere keys are strings, so numeric ids get
  coerced anyway.
- We omit the top-level `$schema` declaration because Holosphere uses
  Ajv 2019; the default meta-schema is 2019-09 and any draft-07 keywords
  we use (`format`, `oneOf`, `const`, `not`) are still recognised.

## Registering

```ts
import { createHoloSphere } from '@holons/core/holosphere';
import questsSchema from '@holons/core/schemas/quests.json' with { type: 'json' };

const hs = await createHoloSphere({ appName: 'Holons', strict: true });
await hs.setSchema('quests', questsSchema);
// from here on, put(holonId, 'quests', data) validates against questsSchema
```

## Lenses

| Lens | Key strategy | Required | Notes |
| --- | --- | --- | --- |
| [`quests`](quests.json) | per-record `id` | `id`, `title`, `type` | `oneOf`: proposals (`type: "proposal"`) require `participants`+`stoppers`; quests/events/recurring require `status`. |
| [`expenses`](expenses.json) | per-record `id` | `id`, `created`, `amount`, `currency`, `paidBy` | |
| [`users`](users.json) | per-user `id` | `id`, `username` | Profile schema v0.3. |
| [`checklists`](checklists.json) | per-record `id`; singleton key `'shopping'` holds the ShoppingChecklist | `id`, `items` | One lens, two shapes — `type` distinguishes. |
| [`library`](library.json) | per-item `id` | `id`, `type`, `category` | |
| [`roles`](roles.json) | slugified `id` | `id`, `title` | |
| [`tags`](tags.json) | tag name | `id`, `content` | |
| [`events`](events.json) | per-event `id` | `id`, `title`, `type` | Quest subtype (`type: "event"`). Distinct lens from `quests` in the bot. |
| [`rea_events`](rea_events.json) | per-event `id` | `id`, `timestamp` | Intentionally loose — UIs add fields freely. |
| [`appreciations`](appreciations.json) | `Date.now().toString()` | `id`, `from`, `to`, `amount`, `date` | |
| [`advisor_library`](advisor_library.json) | slugified name | `id`, `name`, `type`, `lens`, `characterSpec` | `oneOf` on `type`: archetype / real / mythic, each requires different `characterSpec` keys. |
| [`previous_rituals`](previous_rituals.json) | per-ritual `id` | `id`, `title`, `date` | |
| [`ritual_origin`](ritual_origin.json) | singleton (holonId) | `origin_ritual`, `wish`, `values`, `advisors`, `created` | |
| [`ritual_session`](ritual_session.json) | `session_id` | `session_id`, `wish_statement` | |
| [`settings`](settings.json) | singleton (holonId) | `id`, `name` | |
| [`canvases`](canvases.json) | per-canvas `id` | `id` | Referenced by `Quest.canvasId`. |

## Not included (no write sites in repo)

`offers`, `announcements`, `recurring`, `council_values`, `summaries`,
`profile` (holon-level), `design_session_<id>`, `previous_ritual_<id>` —
either dead code, type-only declarations, or per-id keys that aren't
generic lenses. Add a schema here when a real write site appears.
