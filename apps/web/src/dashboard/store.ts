import { writable } from "svelte/store";

export const sidebarExpanded = writable(false);
export const ID = writable<string | null>(null);
export const autoTransitionEnabled = writable<boolean>(false);
export const walletAddress = writable<string | null>(null);

// Task sorting types and store
export type SortCriteria = "created" | "orderIndex" | "positionX" | "positionY";

export interface TaskSortState {
  criteria: SortCriteria;
  direction: "asc" | "desc";
}

// Create a shared store for task sorting preferences
export const taskSortStore = writable<TaskSortState>({
  criteria: "created",
  direction: "desc", // Newest first by default
});

export function openSidebar() {
  sidebarExpanded.set(true);
}

export function closeSidebar() {
  sidebarExpanded.set(false);
}

export function toggleSidebarExpanded() {
  sidebarExpanded.update((v) => !v);
}

export const mapStore = writable({});

// Helper function to update sort state
export function updateTaskSort(
  criteria: SortCriteria,
  direction: "asc" | "desc",
) {
  taskSortStore.set({ criteria, direction });
}

// Cache for generated random positions (keyed by task key)
const generatedPositions = new Map<string, { x: number; y: number }>();

// Helper to get or generate a position for a task without one
function getOrGeneratePosition(
  key: string,
  position: { x: number; y: number } | undefined,
): { x: number; y: number } {
  if (position) return position;

  // Check cache first for consistent sorting
  if (generatedPositions.has(key)) {
    return generatedPositions.get(key)!;
  }

  // Generate random position in the "new tasks bucket" area (x: 0-100, y: 0-50)
  const generated = {
    x: Math.random() * 100,
    y: Math.random() * 50,
  };
  generatedPositions.set(key, generated);
  return generated;
}

// Pull a millisecond timestamp out of an id when the record carries no
// creation timestamp at all. Quest ids are either:
//   - base36 millisecond prefix: `Date.now().toString(36) + Math.random()...`
//     produces ~9 leading lowercase-alphanum chars in the modern code path.
//   - decimal millisecond prefix: legacy bot/web ids of the shape
//     `${Date.now()}${randomTail}` — 13 leading digits.
// Without this last-resort fallback, a list of pre-`created` records would
// all hash to value `0`, the diff would be zero, and asc/desc would both
// return input order — the "date and date-reversed give the same list" bug.
function timestampFromKey(key: string): number {
  const base36 = key.match(/^[0-9a-z]{7,10}/);
  if (base36) {
    const n = parseInt(base36[0], 36);
    // Sanity-clamp: plausible Date.now() range (2017-08 → ~2050).
    if (n > 1500000000000 && n < 2500000000000) return n;
  }
  const dec = key.match(/^\d{13}/);
  if (dec) {
    const n = parseInt(dec[0], 10);
    if (n > 1500000000000 && n < 2500000000000) return n;
  }
  return 0;
}

// Read either the canonical `created` (ISO string) or the legacy bot-side
// `date` (ms epoch). Older bot records used `date`; all new writes set
// `created`. Read both so the date sort works regardless of who wrote the
// record. Returns ms since epoch, or NaN if neither field carries a
// parseable timestamp (callers fall back to id-derived timestamp below).
function createdMs(q: { created?: string; date?: number | string }): number {
  if (typeof q.created === "string") {
    const t = Date.parse(q.created);
    if (Number.isFinite(t)) return t;
  }
  if (typeof q.date === "number" && Number.isFinite(q.date)) return q.date;
  if (typeof q.date === "string") {
    const n = parseInt(q.date, 10);
    if (Number.isFinite(n) && String(n) === q.date) return n;
    const t = Date.parse(q.date);
    if (Number.isFinite(t)) return t;
  }
  return NaN;
}

// Helper function to apply the same sorting logic as Tasks.svelte
export function sortTasks<
  T extends {
    created?: string;
    date?: number | string;
    orderIndex?: number;
    position?: { x: number; y: number };
  },
>(tasks: Array<[string, T]>, sortState: TaskSortState): Array<[string, T]> {
  const { criteria, direction } = sortState;

  return tasks.sort(([keyA, a], [keyB, b]) => {
    let valA: number, valB: number;

    switch (criteria) {
      case "created":
        // Falls back to a timestamp parsed from the id when the
        // record has neither field (legacy data, hand-written
        // imports) so asc/desc still produce different orders.
        valA = createdMs(a) || timestampFromKey(keyA);
        valB = createdMs(b) || timestampFromKey(keyB);
        break;
      case "positionX": {
        const posA = getOrGeneratePosition(keyA, a.position);
        const posB = getOrGeneratePosition(keyB, b.position);
        valA = posA.x;
        valB = posB.x;
        break;
      }
      case "positionY": {
        const posA = getOrGeneratePosition(keyA, a.position);
        const posB = getOrGeneratePosition(keyB, b.position);
        valA = posA.y;
        valB = posB.y;
        break;
      }
      case "orderIndex":
      default:
        valA = a.orderIndex ?? Infinity;
        valB = b.orderIndex ?? Infinity;
        // If orderIndex is the same, sort by key (ID) as a stable secondary sort
        if (valA === valB) {
          return keyA.localeCompare(keyB);
        }
        break;
    }

    // General comparison for asc/desc
    if (direction === "asc") {
      if (valA === Infinity && valB === Infinity) return 0;
      if (valA === Infinity) return 1;
      if (valB === Infinity) return -1;
      return valA - valB;
    } else {
      // direction === 'desc'
      if (valA === Infinity && valB === Infinity) return 0;
      if (valA === Infinity) return 1;
      if (valB === Infinity) return -1;
      return valB - valA;
    }
  });
}
