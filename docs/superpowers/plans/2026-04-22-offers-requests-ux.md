# Offers & Requests UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the `/offers` page into two visually distinct sections, each with its own search input and Add button, and extend the create-item modal with a lean subset of the Murmurations `offers_wants_prototype-v0.0.2` schema (`item_type`, `transaction_type`, `tags`, `expires_at`).

**Architecture:** All UI changes land in `src/components/Offers.svelte`. One new pure helper (`formatRelativeExpiry`) is extracted to `src/lib/util/relativeTime.ts` so it can be unit-tested. Items continue to be persisted via `holosphere.put(holonID, 'quests', item)`; the new Murmurations fields are added to the stored object alongside the existing `type: 'offer' | 'request'` marker.

**Tech Stack:** SvelteKit + TypeScript + Tailwind, Vitest for unit tests, HoloSphere (`quests` lens) for storage. Existing shared primitives (`FeatureToolbar`, `TitleBar`, `ToggleChip`) are reused without modification.

**Reference spec:** `docs/superpowers/specs/2026-04-22-offers-requests-ux-design.md`

---

## File Structure

- **Create:** `src/lib/util/relativeTime.ts` — pure helper `formatRelativeExpiry(expiresAtMs: number, nowMs: number): string`. Single responsibility, no Svelte or DOM deps.
- **Create:** `src/lib/util/relativeTime.test.ts` — Vitest suite for `formatRelativeExpiry`.
- **Modify:** `src/components/Offers.svelte` — all UI changes:
  - persisted-filter shape (split `searchQuery` into `searchQueryOffers` + `searchQueryRequests`)
  - trim global toolbar (remove global search and both Add buttons, keep toggles)
  - remove stats bar
  - render per-section header with icon + title + count + search + Add button
  - extend add modal with `item_type`, `transaction_type`, `tags`, `expires_at` fields
  - persist new fields to the stored item and set `exchange_type`
  - render compact meta row on each card

No other files are touched.

---

## Task 1: Add `formatRelativeExpiry` helper with tests

**Files:**
- Create: `src/lib/util/relativeTime.ts`
- Create: `src/lib/util/relativeTime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/util/relativeTime.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatRelativeExpiry } from './relativeTime';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const now = new Date('2026-04-22T12:00:00Z').getTime();

describe('formatRelativeExpiry', () => {
    it('returns "expired" for a past timestamp older than one day', () => {
        expect(formatRelativeExpiry(now - 3 * DAY_MS, now)).toBe('expired 3d ago');
    });

    it('returns "expired today" for a past timestamp within the last day', () => {
        expect(formatRelativeExpiry(now - 2 * HOUR_MS, now)).toBe('expired today');
    });

    it('returns "expires today" when the timestamp is within the next 24h', () => {
        expect(formatRelativeExpiry(now + 3 * HOUR_MS, now)).toBe('expires today');
    });

    it('returns "expires in Nd" for future timestamps', () => {
        expect(formatRelativeExpiry(now + 3 * DAY_MS, now)).toBe('expires in 3d');
        expect(formatRelativeExpiry(now + 1 * DAY_MS + 5 * MIN_MS, now)).toBe('expires in 1d');
    });

    it('returns "expires in 1d" for anything between 24h and 48h (rounds down)', () => {
        expect(formatRelativeExpiry(now + 47 * HOUR_MS, now)).toBe('expires in 1d');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/util/relativeTime.test.ts`
Expected: FAIL with `Failed to resolve import "./relativeTime"` (or similar missing-module error).

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/util/relativeTime.ts`:

```ts
const DAY_MS = 24 * 60 * 60 * 1000;

export function formatRelativeExpiry(expiresAtMs: number, nowMs: number): string {
    const deltaMs = expiresAtMs - nowMs;

    if (deltaMs >= DAY_MS) {
        const days = Math.floor(deltaMs / DAY_MS);
        return `expires in ${days}d`;
    }
    if (deltaMs >= 0) {
        return 'expires today';
    }
    const pastMs = -deltaMs;
    if (pastMs < DAY_MS) {
        return 'expired today';
    }
    const daysAgo = Math.floor(pastMs / DAY_MS);
    return `expired ${daysAgo}d ago`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/util/relativeTime.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/util/relativeTime.ts src/lib/util/relativeTime.test.ts
git commit -m "Add formatRelativeExpiry util for Offers card meta row"
```

---

## Task 2: Split persisted search into per-section keys

**Files:**
- Modify: `src/components/Offers.svelte:36-52`

- [ ] **Step 1: Replace the `filters` defaults and the `matchesFilters` body**

In `src/components/Offers.svelte`, find this block (around line 36):

```svelte
let filters = loadFilters('offers', {
    searchQuery: '',
    showFederated: false,
    showHolograms: true,
});
$: saveFilters('offers', filters);
$: includeFederatedOffers = filters.showFederated;
let loadingFederated = false;

function matchesFilters(item: any): boolean {
    const isHologram = item?._hologram?.isHologram === true;
    if (!filters.showHolograms && isHologram) return false;
    if (!filters.showFederated && isHologram) return false;
    const q = filters.searchQuery.trim().toLowerCase();
    if (!q) return true;
    return `${item.title ?? ''} ${item.description ?? ''}`.toLowerCase().includes(q);
}

$: offers = Object.values(store).filter((item) => {
    const classifiedType = classifyTask(item);
    if (classifiedType !== "offer") return false;
    return matchesFilters(item);
});
$: needs = Object.values(store).filter((item) => {
    const classifiedType = classifyTask(item);
    if (classifiedType !== "request" && classifiedType !== "need") return false;
    return matchesFilters(item);
});
```

Replace with:

```svelte
let filters = loadFilters('offers', {
    searchQueryOffers: '',
    searchQueryRequests: '',
    showFederated: false,
    showHolograms: true,
});
$: saveFilters('offers', filters);
$: includeFederatedOffers = filters.showFederated;
let loadingFederated = false;

function matchesVisibility(item: any): boolean {
    const isHologram = item?._hologram?.isHologram === true;
    if (!filters.showHolograms && isHologram) return false;
    if (!filters.showFederated && isHologram) return false;
    return true;
}

function matchesSearch(item: any, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const tagsText = Array.isArray(item.tags) ? item.tags.join(' ') : '';
    return `${item.title ?? ''} ${item.description ?? ''} ${tagsText}`
        .toLowerCase()
        .includes(q);
}

$: offers = Object.values(store).filter((item) => {
    if (classifyTask(item) !== 'offer') return false;
    if (!matchesVisibility(item)) return false;
    return matchesSearch(item, filters.searchQueryOffers);
});
$: needs = Object.values(store).filter((item) => {
    const t = classifyTask(item);
    if (t !== 'request' && t !== 'need') return false;
    if (!matchesVisibility(item)) return false;
    return matchesSearch(item, filters.searchQueryRequests);
});
```

- [ ] **Step 2: Verify the app still builds**

Run: `npm run check`
Expected: no type errors from `Offers.svelte` (file is `@ts-nocheck` at the top, so type errors are already suppressed; check must still succeed).

- [ ] **Step 3: Commit**

```bash
git add src/components/Offers.svelte
git commit -m "Offers: split persisted search into per-section keys"
```

---

## Task 3: Trim the global toolbar and remove the stats bar

**Files:**
- Modify: `src/components/Offers.svelte` (the `<FeatureToolbar>` block and the `<!-- Stats Bar -->` block)

- [ ] **Step 1: Replace the FeatureToolbar usage**

Find this block (around line 853):

```svelte
<FeatureToolbar
    onAdd={() => openAddModal('offer')}
    addLabel="Add Offer"
    bind:searchQuery={filters.searchQuery}
    searchPlaceholder="Search offers & requests…"
    bind:showFederated={filters.showFederated}
    bind:showHolograms={filters.showHolograms}
    federatedLoading={loadingFederated}
>
    <svelte:fragment slot="actions">
        <button
            type="button"
            class="icon-btn"
            on:click={() => openAddModal('request')}
            title="Add Request"
            aria-label="Add Request"
        >
            <ArrowDownCircle size="14" />
        </button>
    </svelte:fragment>
</FeatureToolbar>
```

Replace with (no Add button, no global search — `onAdd={null}` hides the Add button; omitting `searchQuery` hides the search input — both are supported by `FeatureToolbar.svelte:9` and `FeatureToolbar.svelte:14`):

```svelte
<FeatureToolbar
    onAdd={null}
    bind:showFederated={filters.showFederated}
    bind:showHolograms={filters.showHolograms}
    federatedLoading={loadingFederated}
/>
```

- [ ] **Step 2: Delete the Stats Bar block**

Find and delete this block entirely (around line 893–913 in the pre-change file):

```svelte
<!-- Stats Bar -->
<div class="stats-bar mb-4">
    <div class="stats-bar__item stats-bar__item--success">
        <span class="stats-bar__value">{offers.length}</span>
        <span class="stats-bar__label">Offers</span>
    </div>
    <div class="stats-bar__divider"></div>
    <div class="stats-bar__item stats-bar__item--info">
        <span class="stats-bar__value">{needs.length}</span>
        <span class="stats-bar__label">Requests</span>
    </div>
    <div class="stats-bar__divider"></div>
    <div class="stats-bar__item stats-bar__item--warning">
        <span class="stats-bar__value">{offers.length + needs.length - offers.concat(needs).filter((item) => item.participants?.length > 0).length}</span>
        <span class="stats-bar__label">Unassigned</span>
    </div>
    <div class="stats-bar__divider"></div>
    <div class="stats-bar__item">
        <span class="stats-bar__value">{offers.length + needs.length}</span>
        <span class="stats-bar__label">Total</span>
    </div>
</div>
```

- [ ] **Step 3: Verify the page still renders**

Run: `npm run dev`
Navigate to any holon's `/offers` page. Expected: no stats bar, no global search, no Add buttons at the top. Only the toggles remain in the toolbar. Offer and Request sections still render (with their old `<h2>` headers) and cards still show.

Stop the dev server (Ctrl+C).

- [ ] **Step 4: Commit**

```bash
git add src/components/Offers.svelte
git commit -m "Offers: trim global toolbar and remove stats bar"
```

---

## Task 4: Add per-section header with icon, count, search, and Add button

**Files:**
- Modify: `src/components/Offers.svelte`

- [ ] **Step 1: Replace the Offers section `<h2>` with a full section header**

Find this line (around the old line 929):

```svelte
<h2 class="text-2xl font-bold text-white mb-6">Active Offers</h2>
```

Replace with:

```svelte
<div class="section-header">
    <div class="section-header__title-group">
        <ArrowUpCircle size="20" />
        <h2 class="section-header__title">Offers</h2>
        <span class="section-header__count">({offers.length})</span>
    </div>
    <div class="section-header__controls">
        <div class="section-header__search">
            <Search size="14" class="section-header__search-icon" />
            <input
                type="search"
                class="section-header__search-input"
                placeholder="Search offers…"
                bind:value={filters.searchQueryOffers}
            />
        </div>
        <button
            type="button"
            class="add-btn"
            on:click={() => openAddModal('offer')}
            aria-label="Add Offer"
        >
            <Plus size="16" />
            <span>Add Offer</span>
        </button>
    </div>
</div>
```

- [ ] **Step 2: Replace the Requests section `<h2>` the same way**

Find this line (around the old line 1132):

```svelte
<h2 class="text-2xl font-bold text-white mb-6">Active Requests</h2>
```

Replace with:

```svelte
<div class="section-header">
    <div class="section-header__title-group">
        <ArrowDownCircle size="20" />
        <h2 class="section-header__title">Requests</h2>
        <span class="section-header__count">({needs.length})</span>
    </div>
    <div class="section-header__controls">
        <div class="section-header__search">
            <Search size="14" class="section-header__search-icon" />
            <input
                type="search"
                class="section-header__search-input"
                placeholder="Search requests…"
                bind:value={filters.searchQueryRequests}
            />
        </div>
        <button
            type="button"
            class="add-btn"
            on:click={() => openAddModal('request')}
            aria-label="Add Request"
        >
            <Plus size="16" />
            <span>Add Request</span>
        </button>
    </div>
</div>
```

- [ ] **Step 3: Add `Search` to the `svelte-feathers` import**

Find (around line 14):

```svelte
import { Gift, Plus, ArrowDownCircle, ArrowUpCircle } from 'svelte-feathers';
```

Replace with:

```svelte
import { Gift, Plus, ArrowDownCircle, ArrowUpCircle, Search } from 'svelte-feathers';
```

- [ ] **Step 4: Add the section-header styles**

Find the `<style>` block at the bottom of the file (starts at roughly line 1416). Inside it, after the existing `.task-card:hover .group { … }` rule, append:

```css
.section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
}

.section-header__title-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #fff;
}

.section-header__title {
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1;
}

.section-header__count {
    color: #9ca3af;
    font-size: 1rem;
    font-weight: 500;
}

.section-header__controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
}

.section-header__search {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 12rem;
}

.section-header__search-icon {
    position: absolute;
    left: 0.625rem;
    top: 50%;
    transform: translateY(-50%);
    color: #9ca3af;
    pointer-events: none;
}

.section-header__search-input {
    width: 100%;
    background: #374151;
    border: 1px solid #4b5563;
    border-radius: 0.5rem;
    color: #fff;
    font-size: 0.875rem;
    padding: 0.5rem 0.75rem 0.5rem 2rem;
    transition: border-color 150ms ease;
}

.section-header__search-input:focus {
    outline: none;
    border-color: #3b82f6;
}

.section-header__search-input::placeholder {
    color: #6b7280;
}
```

- [ ] **Step 5: Verify visually**

Run: `npm run dev`
Navigate to `/<holon>/offers`. Expected:
- Offers section now has its own row with `↑ Offers (N)` on the left, a search input and "Add Offer" button on the right.
- Requests section has the same pattern with `↓ Requests (N)`.
- Typing in the Offers search filters only the Offers list; typing in the Requests search filters only the Requests list.
- Clicking "Add Offer" opens the modal with title "New Offer"; clicking "Add Request" opens it with title "New Request".

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/components/Offers.svelte
git commit -m "Offers: add per-section headers with own search and Add button"
```

---

## Task 5: Extend the create modal with Murmurations lean fields

**Files:**
- Modify: `src/components/Offers.svelte`

- [ ] **Step 1: Replace the modal state and `openAddModal` + `createNewItem` functions**

Find this block (around line 20):

```svelte
// Add offer/request modal state
let showAddModal = false;
let addModalType: 'offer' | 'request' = 'offer';
let newItemTitle = '';
let newItemDescription = '';
```

Replace with:

```svelte
// Add offer/request modal state
let showAddModal = false;
let addModalType: 'offer' | 'request' = 'offer';
let newItemTitle = '';
let newItemDescription = '';
let newItemItemType: 'good' | 'service' | '' = '';
let newItemTransactionTypes: string[] = [];
let newItemTagInput = '';
let newItemTags: string[] = [];
let newItemExpiresAtLocal = ''; // datetime-local value (empty = no expiry)

const TRANSACTION_TYPES = [
    { value: 'borrow-lend',   offerLabel: 'Lend',   requestLabel: 'Borrow' },
    { value: 'rent-lease',    offerLabel: 'Rent',   requestLabel: 'Rent' },
    { value: 'buy-sell',      offerLabel: 'Sell',   requestLabel: 'Buy' },
    { value: 'receive-donate',offerLabel: 'Donate', requestLabel: 'Receive' },
];
```

- [ ] **Step 2: Update `openAddModal` to reset all new fields**

Find (around line 787):

```svelte
function openAddModal(type: 'offer' | 'request') {
    addModalType = type;
    newItemTitle = '';
    newItemDescription = '';
    showAddModal = true;
}
```

Replace with:

```svelte
function openAddModal(type: 'offer' | 'request') {
    addModalType = type;
    newItemTitle = '';
    newItemDescription = '';
    newItemItemType = '';
    newItemTransactionTypes = [];
    newItemTagInput = '';
    newItemTags = [];
    newItemExpiresAtLocal = '';
    showAddModal = true;
}

function toggleTransactionType(value: string) {
    if (newItemTransactionTypes.includes(value)) {
        newItemTransactionTypes = newItemTransactionTypes.filter((v) => v !== value);
    } else {
        newItemTransactionTypes = [...newItemTransactionTypes, value];
    }
}

function handleTagKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        const trimmed = newItemTagInput.trim().replace(/,$/, '');
        if (trimmed && !newItemTags.includes(trimmed)) {
            newItemTags = [...newItemTags, trimmed];
        }
        newItemTagInput = '';
    } else if (event.key === 'Backspace' && newItemTagInput === '' && newItemTags.length > 0) {
        newItemTags = newItemTags.slice(0, -1);
    }
}

function removeTag(tag: string) {
    newItemTags = newItemTags.filter((t) => t !== tag);
}
```

- [ ] **Step 3: Update `createNewItem` to persist the new fields**

Find (around line 795):

```svelte
async function createNewItem() {
    if (!holosphere || !holonID || !newItemTitle.trim()) return;

    const newItem = {
        id: crypto.randomUUID(),
        type: addModalType,
        title: newItemTitle.trim(),
        description: newItemDescription.trim(),
        participants: [],
        created_at: new Date().toISOString()
    };

    try {
        await holosphere.put(holonID, 'quests', newItem);
        showAddModal = false;
        newItemTitle = '';
        newItemDescription = '';
    } catch (error: any) {
        if (error?.name === 'AuthorizationError') {
            notifyWriteDenied('Unable to save - no write permission for this holon');
        } else {
            console.error('[Offers.svelte] Error creating item:', error);
        }
    }
}
```

Replace with:

```svelte
async function createNewItem() {
    if (!holosphere || !holonID || !newItemTitle.trim()) return;
    if (newItemTransactionTypes.length === 0) return;

    const expiresAtMs = newItemExpiresAtLocal
        ? new Date(newItemExpiresAtLocal).getTime()
        : undefined;

    const newItem: Record<string, any> = {
        id: crypto.randomUUID(),
        type: addModalType,
        exchange_type: addModalType === 'offer' ? 'offer' : 'want',
        title: newItemTitle.trim(),
        description: newItemDescription.trim(),
        transaction_type: [...newItemTransactionTypes],
        participants: [],
        created_at: new Date().toISOString()
    };
    if (newItemItemType) newItem.item_type = newItemItemType;
    if (newItemTags.length > 0) newItem.tags = [...newItemTags];
    if (expiresAtMs && !Number.isNaN(expiresAtMs)) newItem.expires_at = expiresAtMs;

    try {
        await holosphere.put(holonID, 'quests', newItem);
        showAddModal = false;
    } catch (error: any) {
        if (error?.name === 'AuthorizationError') {
            notifyWriteDenied('Unable to save - no write permission for this holon');
        } else {
            console.error('[Offers.svelte] Error creating item:', error);
        }
    }
}
```

- [ ] **Step 4: Replace the modal body with the new form fields**

Find the `<div class="p-6 space-y-4">` block inside the `{#if showAddModal}` (around lines 1373–1395) that currently contains only Title + Description. Replace it with:

```svelte
<div class="p-6 space-y-4">
    <div>
        <label for="item-title" class="block text-sm font-medium text-gray-300 mb-2">Title</label>
        <input
            id="item-title"
            type="text"
            bind:value={newItemTitle}
            placeholder={addModalType === 'offer' ? 'What are you offering?' : 'What do you need?'}
            class="w-full px-4 py-3 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors"
        />
    </div>

    <div>
        <label for="item-description" class="block text-sm font-medium text-gray-300 mb-2">Description (optional)</label>
        <textarea
            id="item-description"
            bind:value={newItemDescription}
            placeholder="Add more details..."
            rows="3"
            class="w-full px-4 py-3 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors resize-none"
        ></textarea>
    </div>

    <div>
        <span class="block text-sm font-medium text-gray-300 mb-2">Item type</span>
        <div class="flex gap-4">
            <label class="inline-flex items-center gap-2 text-gray-200">
                <input
                    type="radio"
                    name="item-type"
                    value="good"
                    bind:group={newItemItemType}
                    class="accent-indigo-500"
                />
                Good
            </label>
            <label class="inline-flex items-center gap-2 text-gray-200">
                <input
                    type="radio"
                    name="item-type"
                    value="service"
                    bind:group={newItemItemType}
                    class="accent-indigo-500"
                />
                Service
            </label>
        </div>
    </div>

    <div>
        <span class="block text-sm font-medium text-gray-300 mb-2">
            Transaction type
            <span class="text-red-400">*</span>
        </span>
        <div class="flex flex-wrap gap-2">
            {#each TRANSACTION_TYPES as tx}
                {@const label = addModalType === 'offer' ? tx.offerLabel : tx.requestLabel}
                {@const selected = newItemTransactionTypes.includes(tx.value)}
                <button
                    type="button"
                    class="px-3 py-1 rounded-full text-sm border transition-colors"
                    class:bg-indigo-500={selected}
                    class:border-indigo-500={selected}
                    class:text-white={selected}
                    class:bg-gray-700={!selected}
                    class:border-gray-600={!selected}
                    class:text-gray-300={!selected}
                    on:click={() => toggleTransactionType(tx.value)}
                >
                    {label}
                </button>
            {/each}
        </div>
    </div>

    <div>
        <label for="item-tags" class="block text-sm font-medium text-gray-300 mb-2">Tags</label>
        <div class="flex flex-wrap gap-2 p-2 bg-gray-700 rounded-lg border border-gray-600 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
            {#each newItemTags as tag}
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/30 text-indigo-100 text-sm">
                    {tag}
                    <button
                        type="button"
                        class="hover:text-white"
                        on:click={() => removeTag(tag)}
                        aria-label={`Remove tag ${tag}`}
                    >&times;</button>
                </span>
            {/each}
            <input
                id="item-tags"
                type="text"
                bind:value={newItemTagInput}
                on:keydown={handleTagKeydown}
                placeholder={newItemTags.length === 0 ? 'Add tags (Enter or , to add)' : ''}
                class="flex-1 min-w-[6rem] bg-transparent text-white outline-none text-sm py-1"
            />
        </div>
    </div>

    <div>
        <label for="item-expires-at" class="block text-sm font-medium text-gray-300 mb-2">Expires at (optional)</label>
        <input
            id="item-expires-at"
            type="datetime-local"
            bind:value={newItemExpiresAtLocal}
            class="w-full px-4 py-3 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors"
        />
    </div>
</div>
```

- [ ] **Step 5: Update the modal submit button's `disabled` expression**

Find (around line 1405):

```svelte
<button
    class="btn btn--primary"
    on:click={createNewItem}
    disabled={!newItemTitle.trim()}
>
    Create {addModalType === 'offer' ? 'Offer' : 'Request'}
</button>
```

Replace with:

```svelte
<button
    class="btn btn--primary"
    on:click={createNewItem}
    disabled={!newItemTitle.trim() || newItemTransactionTypes.length === 0}
>
    Create {addModalType === 'offer' ? 'Offer' : 'Request'}
</button>
```

- [ ] **Step 6: Manual verification**

Run: `npm run dev`
Navigate to `/<holon>/offers`. Click "Add Offer". Expected:
- Form shows Title, Description, Item type (Good/Service), Transaction type (Lend/Rent/Sell/Donate), Tags, Expires at.
- "Create Offer" is disabled until a Title is entered AND at least one Transaction type is selected.
- Enter a title, select "Lend" and "Donate", type `tag1,` — a "tag1" chip appears. Type `tag2` and press Enter — "tag2" chip appears. Press Backspace in the empty tag input — "tag2" is removed.
- Pick a future date/time in "Expires at". Click "Create Offer" — the new offer appears in the Offers section.
- Open "Add Request". Transaction-type chips now read "Borrow / Rent / Buy / Receive".

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/components/Offers.svelte
git commit -m "Offers: add Murmurations fields (item_type, transaction_type, tags, expires_at) to create modal"
```

---

## Task 6: Render the compact meta row on each card

**Files:**
- Modify: `src/components/Offers.svelte`

- [ ] **Step 1: Import the relative-time helper**

Find (around line 7):

```svelte
import { formatDate, formatTime } from "../utils/date";
```

Add directly below it:

```svelte
import { formatRelativeExpiry } from "$lib/util/relativeTime";
```

- [ ] **Step 2: Add a `getTransactionLabel` helper above the markup**

The `TRANSACTION_TYPES` constant already added in Task 5 holds both the offer- and request-side labels, so reuse it instead of duplicating. In the `<script>` block, near the other pure helpers (e.g. above `function classifyTask`, around line 590), add:

```ts
function getTransactionLabel(value: string, side: 'offer' | 'request'): string {
    const entry = TRANSACTION_TYPES.find((t) => t.value === value);
    if (!entry) return value;
    return side === 'offer' ? entry.offerLabel : entry.requestLabel;
}
```

- [ ] **Step 3: Add the reusable meta-row markup**

Just before the `</style>` tag at the end of the file, add nothing (styles will be appended separately in Step 5). First, locate the end of the Offers card `<div class="flex-1 min-w-0">` block — specifically, immediately after the existing `{#if offer.description}…{/if}` block (around line 1019):

```svelte
{#if offer.description}
    <p class="text-sm text-gray-700 truncate">
        {offer.description}
    </p>
{/if}
```

Insert the following right after the closing `{/if}`:

```svelte
{#if offer.item_type || (offer.transaction_type && offer.transaction_type.length > 0) || (offer.tags && offer.tags.length > 0) || offer.expires_at}
    <div class="meta-row">
        {#if offer.item_type}
            <span class="meta-row__icon" title={offer.item_type === 'good' ? 'Good' : 'Service'}>
                {offer.item_type === 'good' ? '📦' : '🛠️'}
            </span>
        {/if}
        {#if offer.transaction_type}
            {#each offer.transaction_type as tx}
                <span class="meta-row__pill">{getTransactionLabel(tx, 'offer')}</span>
            {/each}
        {/if}
        {#if offer.tags}
            {#each offer.tags.slice(0, 3) as tag}
                <span class="meta-row__chip">#{tag}</span>
            {/each}
            {#if offer.tags.length > 3}
                <span class="meta-row__chip">+{offer.tags.length - 3}</span>
            {/if}
        {/if}
        {#if offer.expires_at}
            <span class="meta-row__expiry">{formatRelativeExpiry(offer.expires_at, Date.now())}</span>
        {/if}
    </div>
{/if}
```

- [ ] **Step 4: Do the same for the Requests section**

In the Requests section, find the analogous block (around line 1221) that ends with:

```svelte
{#if need.description}
    <p class="text-sm text-gray-700 truncate">
        {need.description}
    </p>
{/if}
```

Insert right after it (note the `'request'` label side):

```svelte
{#if need.item_type || (need.transaction_type && need.transaction_type.length > 0) || (need.tags && need.tags.length > 0) || need.expires_at}
    <div class="meta-row">
        {#if need.item_type}
            <span class="meta-row__icon" title={need.item_type === 'good' ? 'Good' : 'Service'}>
                {need.item_type === 'good' ? '📦' : '🛠️'}
            </span>
        {/if}
        {#if need.transaction_type}
            {#each need.transaction_type as tx}
                <span class="meta-row__pill">{getTransactionLabel(tx, 'request')}</span>
            {/each}
        {/if}
        {#if need.tags}
            {#each need.tags.slice(0, 3) as tag}
                <span class="meta-row__chip">#{tag}</span>
            {/each}
            {#if need.tags.length > 3}
                <span class="meta-row__chip">+{need.tags.length - 3}</span>
            {/if}
        {/if}
        {#if need.expires_at}
            <span class="meta-row__expiry">{formatRelativeExpiry(need.expires_at, Date.now())}</span>
        {/if}
    </div>
{/if}
```

- [ ] **Step 5: Add the meta-row styles**

Inside the `<style>` block, append after the `.section-header__*` rules added in Task 4:

```css
.meta-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.5rem;
}

.meta-row__icon {
    font-size: 0.875rem;
    line-height: 1;
}

.meta-row__pill {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    background: rgba(17, 24, 39, 0.15);
    color: #1f2937;
    font-size: 0.7rem;
    font-weight: 500;
}

.meta-row__chip {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    background: rgba(99, 102, 241, 0.2);
    color: #3730a3;
    font-size: 0.7rem;
    font-weight: 500;
}

.meta-row__expiry {
    font-size: 0.7rem;
    color: #374151;
    margin-left: auto;
}
```

- [ ] **Step 6: Manual verification — round-trip the new fields**

Run: `npm run dev`
Navigate to `/<holon>/offers`. Create an Offer with:
- Title: "Drill"
- Item type: Good
- Transaction types: Lend, Donate
- Tags: `tool`, `diy`, `power`, `handheld` (four tags)
- Expires at: two days from now

Expected on the Offers list:
- Card shows the old title/description as before.
- Below the description, a single meta row shows: 📦 icon, "Lend" pill, "Donate" pill, `#tool`, `#diy`, `#power`, `+1`, and "expires in 2d" on the right.

Create a Request with only Title + Transaction type "Borrow". Expected:
- Card shows a meta row with a single "Borrow" pill and no other elements.

Reload the page. Expected: both items render identically (fields persisted correctly).

Confirm that a legacy item (one that existed before this change, i.e., only `title` + `description`) renders **without** a meta row.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/components/Offers.svelte
git commit -m "Offers: render meta row (item_type, transaction_type, tags, expiry) on cards"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: existing suites plus the new `formatRelativeExpiry` suite all pass.

- [ ] **Step 2: Run the type/check pass**

Run: `npm run check`
Expected: no new errors introduced by the change. `Offers.svelte` is `@ts-nocheck`, so TypeScript errors from that file are still suppressed — but imports and references must resolve.

- [ ] **Step 3: Full manual walkthrough**

Run: `npm run dev`. Check each case:

| Case | Expected |
|---|---|
| `/<holon>/offers` loads | Page renders with global toolbar (toggles only), two sections each with its own header/search/Add button. |
| Toggle "Federated" on | Federated items still appear with their hologram/federation decorations. |
| Toggle "Holograms" off | Hologram-marked items disappear from both sections. |
| Offers search "drill" | Only Offers list filters; Requests list is unaffected. |
| Requests search "help" | Only Requests list filters; Offers list is unaffected. |
| Create Offer with all new fields | Appears in Offers section with full meta row. |
| Create Request with only title + one transaction type | Appears in Requests section with only the transaction pill in the meta row. |
| Legacy item (pre-change) | Renders unchanged (no meta row). |
| Reload | All created items persist with their Murmurations fields. |

Stop the dev server.

- [ ] **Step 4: Confirm no unintended files are dirty**

Run: `git status`
Expected: working tree clean (all changes already committed across Tasks 1–6).
