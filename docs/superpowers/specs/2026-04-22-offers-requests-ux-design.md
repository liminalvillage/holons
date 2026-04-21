# Offers & Requests UX — Design

**Date:** 2026-04-22
**Scope:** `src/components/Offers.svelte`
**Status:** Approved by user — ready for implementation plan

## Goal

Make the Offers and Requests sections on the `/offers` page visually and functionally distinct, and enrich the create-item form with a lean subset of the Murmurations Offers/Wants schema (`src/components/schemas/offers_wants_prototype-v0.0.2.json`).

## Layout

### Current

A single shared `FeatureToolbar` sits above one stacked panel that holds a stats bar plus two sections (Offers / Requests). The toolbar carries one global search, federated/holograms toggles, and both "Add Offer" / "Add Request" buttons.

### New

- **Global toolbar (trimmed):** keep `TitleBar` and `FeatureToolbar` only for the federated + holograms toggles. Remove the global search input and both Add buttons from it.
- **Section headers (new):** each section renders its own mini header row with:
  - Icon + title + count badge (e.g. `↑ Offers (5)`, `↓ Requests (3)`)
  - A per-section `<input type="search">` filtering only that section's items
  - A per-section "Add Offer" / "Add Request" button
- **Stats bar:** removed. Counts live in the section headers. Unassigned/total counts are not re-surfaced.
- **Card list, dropdown, cast button, hologram/federation decorations:** unchanged.

## Create Modal — Lean Fields

Modal title toggles "New Offer" / "New Request" based on which Add button was clicked. `exchange_type` is set implicitly (`'offer'` for Offers, `'want'` for Requests) and not shown as an input.

| Field | UI | Required | Murmurations key |
|---|---|---|---|
| Title | text input | yes | `title` |
| Description | textarea | no | `description` |
| Item type | radio: Good / Service | no | `item_type` |
| Transaction type | multi-select chips: Borrow/Lend, Rent/Lease, Buy/Sell, Receive/Donate | yes (≥1) | `transaction_type` |
| Tags | chip input (Enter/comma to add, Backspace removes last) | no | `tags` |
| Expires at | `<input type="datetime-local">` | no | `expires_at` (Unix ms) |

**Out of scope for this pass:** `geolocation`, `contact_details`, `image`, `details_url`, `geographic_scope`, `linked_schemas`.

### Validation

- Disable submit until `title.trim()` is non-empty AND `transaction_type.length >= 1`.
- No other client-side validation beyond the HTML input types.

## Data Model

Items continue to be written via `holosphere.put(holonID, 'quests', item)`. Backward compatibility preserved — existing consumers (cards, dropdowns, federation) still see `type: 'offer' | 'request'`.

New fields added to the stored object:

```ts
{
  id: string,
  type: 'offer' | 'request',            // existing — unchanged
  title: string,                         // existing
  description: string,                   // existing
  participants: [],                      // existing
  created_at: string,                    // existing (ISO)
  // new Murmurations-aligned fields
  exchange_type: 'offer' | 'want',
  item_type?: 'good' | 'service',
  transaction_type: Array<'borrow-lend' | 'rent-lease' | 'buy-sell' | 'receive-donate'>,
  tags?: string[],
  expires_at?: number                    // Unix ms
}
```

`request` → `exchange_type: 'want'` (Murmurations uses "want" not "request"). The legacy `type: 'need'` value continues to be classified as request on read; new items never write `'need'`.

## Card Meta Row

Below the existing description paragraph, add a single compact meta row. Each element is individually omitted when its field is absent; the whole row is skipped only when none of the fields are present (keeps legacy items pixel-identical).

- **Item-type icon:** small icon — Package (good) / Tool (service). Omitted if `item_type` absent.
- **Transaction-type pills:** small rounded pills with short labels — "Lend", "Rent", "Sell", "Donate" for offers; "Borrow", "Rent", "Buy", "Receive" for requests. Label side chosen by `exchange_type`. Omitted if `transaction_type` empty.
- **Tag chips:** up to 3 visible, with a `+N` overflow chip for the rest. Omitted if `tags` empty.
- **Expiry:** relative-time string — "expires in 3d", "expires today", "expired 2d ago". Omitted if `expires_at` absent.

## Search

Per-section search — split the persisted filter state:

```ts
loadFilters('offers', {
  searchQueryOffers: '',
  searchQueryRequests: '',
  showFederated: false,
  showHolograms: true,
})
```

Migration: on load, if the old `searchQuery` key exists in persisted filters, copy its value into both new keys once and drop the old key.

Search matches case-insensitively against `title`, `description`, and each entry in `tags`.

## Files Touched

- `src/components/Offers.svelte` — all changes land here. Keep the file self-contained (no new shared components).

No new files, no change to `FeatureToolbar`, `TitleBar`, stores, or schemas.

## Testing

- Create an Offer and a Request with every new field set; reload page; verify the fields round-trip.
- Create one with only the required fields; verify the card renders without the meta row.
- Verify a pre-existing legacy item (only `title` + `description`) still renders and is filterable.
- Per-section search: verify Offers search does not hide Requests and vice-versa.
- Verify federated + holograms toggles still work unchanged.
- Manual browser test (dev server + the `/offers` page) of the golden path and the empty-state paths.

## Out of Scope

- Edit-existing-item flow.
- Geolocation + contact_details + image + details_url (the full form).
- Schema-driven rendering via `SchemaForm.svelte` — custom UI keeps the modal lean.
- Changes to the cast/publish flow or federation logic.
