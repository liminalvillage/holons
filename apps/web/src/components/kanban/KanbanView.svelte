<script lang="ts">
  import { onMount, getContext } from 'svelte';
  import { dndzone } from 'svelte-dnd-action';
  import KanbanColumn from './KanbanColumn.svelte';
  import { DEFAULT_COLUMNS, type KanbanColumn as KanbanColumnType, type KanbanConfig } from './types';
  import type { HoloSphere, ResolvedHologramMeta } from 'holosphere';
  import { createEventDispatcher } from 'svelte';

  interface Quest {
    id: string;
    title: string;
    description?: string;
    when?: string;
    status: 'ongoing' | 'completed' | 'recurring' | 'repeating';
    category?: string;
    participants: Array<{
      id: string;
      username: string;
      firstName?: string;
      lastName?: string;
    }>;
    type?: 'task' | 'quest' | 'event' | 'recurring';
    kanbanColumnId?: string;
    kanbanOrderIndex?: number;
    _hologram?: ResolvedHologramMeta;
  }

  interface CardItem {
    id: string;
    key: string;
    quest: Quest;
  }

  interface Props {
    filteredQuests: [string, Quest][];
    holonID: string;
    showCompleted: boolean;
    resolveDependencyTitle?: (id: string) => string | undefined;
    onDependencyClick?: (id: string) => void;
  }

  let {
    filteredQuests,
    holonID,
    showCompleted,
    resolveDependencyTitle,
    onDependencyClick,
  }: Props = $props();

  const dispatch = createEventDispatcher<{
    taskClick: { key: string; quest: Quest };
  }>();

  const holosphere = getContext<HoloSphere>('holosphere');

  let columns = $state<KanbanColumnType[]>([]);
  let isLoading = $state(true);
  let showAddColumn = $state(false);
  let newColumnName = $state('');

  // The board fills the space from its own top down to the bottom of the
  // viewport, measured live — so the whole interface fits the screen instead
  // of overflowing. (The old fixed `100vh - 280px` ignored the real, variable
  // chrome above the board.) Each column then scrolls its own cards.
  let boardEl = $state<HTMLElement | null>(null);
  let boardHeight = $state<number | null>(null);

  $effect(() => {
    if (!boardEl || typeof window === 'undefined') return;
    const el = boardEl;
    const recompute = () => {
      const top = el.getBoundingClientRect().top;
      // Leave room for the board's bottom padding + the surrounding card padding.
      boardHeight = Math.max(240, Math.round(window.innerHeight - top - 40));
    };
    recompute();
    window.addEventListener('resize', recompute);
    // Recompute when anything above the board reflows (filters, banners, etc.).
    const ro = new ResizeObserver(recompute);
    ro.observe(document.body);
    return () => {
      window.removeEventListener('resize', recompute);
      ro.disconnect();
    };
  });

  const flipDurationMs = 200;

  // Group quests by column
  const cardsByColumn = $derived.by(() => {
    const groups: Record<string, CardItem[]> = {};

    // Initialize empty arrays for all columns
    columns.forEach(col => {
      groups[col.id] = [];
    });

    // Find default column
    const defaultColumnId = columns.find(c => c.isDefault)?.id || columns[0]?.id;

    // Distribute quests to columns
    filteredQuests.forEach(([key, quest]) => {
      // Skip completed tasks if not showing completed
      if (!showCompleted && quest.status === 'completed') return;

      const columnId = quest.kanbanColumnId || defaultColumnId;
      if (!groups[columnId]) {
        groups[columnId] = [];
      }
      groups[columnId].push({
        id: quest.id,
        key,
        quest
      });
    });

    // Sort cards within each column by orderIndex
    Object.keys(groups).forEach(colId => {
      groups[colId].sort((a, b) =>
        (a.quest.kanbanOrderIndex ?? Number.MAX_SAFE_INTEGER) - (b.quest.kanbanOrderIndex ?? Number.MAX_SAFE_INTEGER)
      );
    });

    return groups;
  });

  // Column items for drag reordering
  let columnItems = $state<Array<KanbanColumnType & { id: string }>>([]);
  // Same protection as KanbanColumn — if `columns` updates mid-drag (e.g.,
  // saveKanbanConfig echoes back), don't clobber the live drag list.
  let isDraggingColumns = $state(false);

  $effect(() => {
    if (isDraggingColumns) return;
    columnItems = columns.map(c => ({ ...c }));
  });

  onMount(async () => {
    await loadKanbanConfig();
  });

  async function loadKanbanConfig() {
    isLoading = true;
    try {
      const config = await holosphere.get(holonID, 'kanban-config', 'config');
      if (config?.columns?.length) {
        columns = config.columns.sort((a: KanbanColumnType, b: KanbanColumnType) => a.orderIndex - b.orderIndex);
      } else {
        // Initialize with default columns
        columns = [...DEFAULT_COLUMNS];
        await saveKanbanConfig();
      }
    } catch (error) {
      console.error('Error loading kanban config:', error);
      columns = [...DEFAULT_COLUMNS];
    }
    isLoading = false;
  }

  async function saveKanbanConfig() {
    try {
      const config: KanbanConfig = {
        id: 'config',
        columns: columns.map((c, i) => ({ ...c, orderIndex: i })),
        updatedAt: new Date().toISOString()
      };
      await holosphere.put(holonID, 'kanban-config', config);
    } catch (error) {
      console.error('Error saving kanban config:', error);
    }
  }

  function handleCardClick(key: string, quest: Quest) {
    dispatch('taskClick', { key, quest });
  }

  async function handleCardsReorder(columnId: string, cards: CardItem[]) {
    // Only write the cards whose column or order actually changed, and
    // run the writes in parallel — a cross-column drop fires this for
    // both source and destination columns, so naive sequential writes
    // multiply network round-trips fast.
    const writes: Promise<unknown>[] = [];
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (card.quest.kanbanColumnId === columnId && card.quest.kanbanOrderIndex === i) continue;
      writes.push(
        holosphere.put(holonID, 'quests', {
          ...card.quest,
          kanbanColumnId: columnId,
          kanbanOrderIndex: i
        })
      );
    }
    if (writes.length === 0) return;
    try {
      await Promise.all(writes);
    } catch (error) {
      console.error('Error updating quest position:', error);
    }
  }

  function handleColumnDndConsider(e: CustomEvent) {
    isDraggingColumns = true;
    columnItems = e.detail.items;
  }

  async function handleColumnDndFinalize(e: CustomEvent) {
    isDraggingColumns = false;
    columnItems = e.detail.items;
    columns = columnItems.map((c, i) => ({ ...c, orderIndex: i }));
    await saveKanbanConfig();
  }

  async function handleColumnEdit(updatedColumn: KanbanColumnType) {
    columns = columns.map(c => c.id === updatedColumn.id ? updatedColumn : c);
    await saveKanbanConfig();
  }

  async function handleColumnDelete(columnId: string) {
    if (columns.length <= 1) {
      alert('Cannot delete the last column');
      return;
    }

    // Move cards from the deleted column to the default column, appending
    // them to the end with fresh order indices so they don't collide with
    // existing cards' positions.
    const defaultColumn = columns.find(c => c.isDefault && c.id !== columnId) || columns.find(c => c.id !== columnId);
    if (defaultColumn) {
      const cardsToMove = cardsByColumn[columnId] || [];
      const startIndex = (cardsByColumn[defaultColumn.id] || []).length;
      const writes = cardsToMove.map((card, i) =>
        holosphere.put(holonID, 'quests', {
          ...card.quest,
          kanbanColumnId: defaultColumn.id,
          kanbanOrderIndex: startIndex + i
        })
      );
      try {
        await Promise.all(writes);
      } catch (error) {
        console.error('Error moving quest:', error);
      }
    }

    columns = columns.filter(c => c.id !== columnId);
    await saveKanbanConfig();
  }

  async function handleAddColumn() {
    if (!newColumnName.trim()) return;

    const newColumn: KanbanColumnType = {
      id: `col-${Date.now()}`,
      name: newColumnName.trim(),
      orderIndex: columns.length
    };

    columns = [...columns, newColumn];
    newColumnName = '';
    showAddColumn = false;
    await saveKanbanConfig();
  }
</script>

<div class="kanban-container">
  {#if isLoading}
    <div class="loading">
      <div class="spinner"></div>
      <p>Loading board...</p>
    </div>
  {:else}
    <div
      class="kanban-board"
      bind:this={boardEl}
      style={boardHeight != null ? `height: ${boardHeight}px` : ''}
      use:dndzone={{
        items: columnItems,
        flipDurationMs,
        type: 'columns',
        dropTargetStyle: {}
      }}
      onconsider={handleColumnDndConsider}
      onfinalize={handleColumnDndFinalize}
    >
      {#each columnItems as column (column.id)}
        <KanbanColumn
          {column}
          {holonID}
          cards={cardsByColumn[column.id] || []}
          {resolveDependencyTitle}
          {onDependencyClick}
          onCardClick={handleCardClick}
          onCardsReorder={handleCardsReorder}
          onColumnEdit={handleColumnEdit}
          onColumnDelete={handleColumnDelete}
        />
      {/each}

      <!-- Add Column Button -->
      <div class="add-column">
        {#if showAddColumn}
          <div class="add-column-form">
            <input
              type="text"
              bind:value={newColumnName}
              placeholder="Column name..."
              class="column-input"
              onkeydown={(e) => {
                if (e.key === 'Enter') handleAddColumn();
                if (e.key === 'Escape') { showAddColumn = false; newColumnName = ''; }
              }}
            />
            <div class="add-column-actions">
              <button class="btn-add" onclick={handleAddColumn}>Add</button>
              <button class="btn-cancel" onclick={() => { showAddColumn = false; newColumnName = ''; }} aria-label="Cancel adding column">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>
        {:else}
          <button class="add-column-btn" onclick={() => showAddColumn = true}>
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
            </svg>
            Add Column
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .kanban-container {
    height: 100%;
    overflow: hidden;
    padding: 1rem 0;
  }

  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 200px;
    color: var(--color-text-muted);
  }

  .spinner {
    width: 2rem;
    height: 2rem;
    border: 3px solid var(--color-bg-tertiary);
    border-top-color: var(--color-accent-light);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-bottom: 0.75rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .kanban-board {
    display: flex;
    gap: 1rem;
    /* Fallback height before the measured value (above) takes over on mount;
       the inline `height` keeps the board within the viewport at runtime. */
    height: calc(100dvh - 240px);
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0 1rem 1rem;
    scroll-snap-type: x mandatory;
  }

  .kanban-board > :global(*) {
    scroll-snap-align: start;
  }

  .add-column {
    flex: 0 0 280px;
    min-width: 280px;
  }

  .add-column-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    padding: 1rem;
    background-color: rgba(31, 41, 55, 0.5);
    border: 2px dashed var(--color-bg-tertiary);
    border-radius: 0.75rem;
    color: var(--color-text-muted);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .add-column-btn:hover {
    background-color: rgba(31, 41, 55, 0.8);
    border-color: var(--color-accent-light);
    color: var(--color-text-secondary);
  }

  .add-column-form {
    background-color: var(--color-bg-secondary);
    border-radius: 0.75rem;
    padding: 0.75rem;
  }

  .column-input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    background-color: var(--color-bg-tertiary);
    border: 1px solid var(--color-border-light);
    border-radius: 0.375rem;
    color: #f3f4f6;
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
    outline: none;
  }

  .column-input:focus {
    border-color: var(--color-accent-light);
  }

  .add-column-actions {
    display: flex;
    gap: 0.5rem;
  }

  .btn-add {
    flex: 1;
    padding: 0.5rem;
    background-color: var(--color-accent-light);
    border: none;
    border-radius: 0.375rem;
    color: var(--color-text-primary);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-add:hover {
    background-color: var(--color-accent);
  }

  .btn-cancel {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    background-color: var(--color-bg-tertiary);
    border: none;
    border-radius: 0.375rem;
    color: var(--color-text-muted);
    cursor: pointer;
  }

  .btn-cancel:hover {
    background-color: var(--color-border-light);
    color: var(--color-text-secondary);
  }
</style>
