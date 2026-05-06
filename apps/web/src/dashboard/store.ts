import { writable } from 'svelte/store';

export const sidebarExpanded = writable(false);
export const ID = writable<string | null>(null);
export const autoTransitionEnabled = writable<boolean>(false);
export const walletAddress = writable<string | null>(null);

// Task sorting types and store
export type SortCriteria = 'created' | 'orderIndex' | 'positionX' | 'positionY';

export interface TaskSortState {
    criteria: SortCriteria;
    direction: 'asc' | 'desc';
}

// Create a shared store for task sorting preferences
export const taskSortStore = writable<TaskSortState>({
    criteria: 'created',
    direction: 'desc' // Newest first by default
});

export function openSidebar() {
	sidebarExpanded.set(true);
}

export function closeSidebar() {
	sidebarExpanded.set(false);
}

export function toggleSidebarExpanded() {
	sidebarExpanded.update(v => !v);
}

export const mapStore = writable({});

// Helper function to update sort state
export function updateTaskSort(criteria: SortCriteria, direction: 'asc' | 'desc') {
    taskSortStore.set({ criteria, direction });
}

// Cache for generated random positions (keyed by task key)
const generatedPositions = new Map<string, { x: number; y: number }>();

// Helper to get or generate a position for a task without one
function getOrGeneratePosition(key: string, position: { x: number; y: number } | undefined): { x: number; y: number } {
    if (position) return position;

    // Check cache first for consistent sorting
    if (generatedPositions.has(key)) {
        return generatedPositions.get(key)!;
    }

    // Generate random position in the "new tasks bucket" area (x: 0-100, y: 0-50)
    const generated = {
        x: Math.random() * 100,
        y: Math.random() * 50
    };
    generatedPositions.set(key, generated);
    return generated;
}

// Helper function to apply the same sorting logic as Tasks.svelte
export function sortTasks<T extends {
    created?: string;
    orderIndex?: number;
    position?: { x: number; y: number };
}>(
    tasks: Array<[string, T]>,
    sortState: TaskSortState
): Array<[string, T]> {
    const { criteria, direction } = sortState;

    return tasks.sort(([keyA, a], [keyB, b]) => {
        let valA: number, valB: number;

        switch (criteria) {
            case 'created':
                valA = a.created ? new Date(a.created).getTime() : 0;
                valB = b.created ? new Date(b.created).getTime() : 0;
                break;
            case 'positionX': {
                const posA = getOrGeneratePosition(keyA, a.position);
                const posB = getOrGeneratePosition(keyB, b.position);
                valA = posA.x;
                valB = posB.x;
                break;
            }
            case 'positionY': {
                const posA = getOrGeneratePosition(keyA, a.position);
                const posB = getOrGeneratePosition(keyB, b.position);
                valA = posA.y;
                valB = posB.y;
                break;
            }
            case 'orderIndex':
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
        if (direction === 'asc') {
            if (valA === Infinity && valB === Infinity) return 0;
            if (valA === Infinity) return 1;
            if (valB === Infinity) return -1;
            return valA - valB;
        } else { // direction === 'desc'
            if (valA === Infinity && valB === Infinity) return 0;
            if (valA === Infinity) return 1;
            if (valB === Infinity) return -1;
            return valB - valA;
        }
    });
}
