<script lang="ts">
  import { dndzone } from 'svelte-dnd-action';
  import KanbanCard from './KanbanCard.svelte';
  import type { KanbanColumn } from './types';

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
    _hologram?: {
      isHologram: boolean;
      soul: string;
      sourceHolon: string;
    };
  }

  interface CardItem {
    id: string;
    key: string;
    quest: Quest;
  }

  interface Props {
    column: KanbanColumn;
    cards: CardItem[];
    onCardClick: (key: string, quest: Quest) => void;
    onCardsReorder: (columnId: string, cards: CardItem[]) => void;
    onColumnEdit: (column: KanbanColumn) => void;
    onColumnDelete: (columnId: string) => void;
  }

  let {
    column,
    cards,
    onCardClick,
    onCardsReorder,
    onColumnEdit,
    onColumnDelete
  }: Props = $props();

  let items = $state(cards);
  let showMenu = $state(false);
  let isEditing = $state(false);
  let editName = $state(column.name);

  const flipDurationMs = 200;

  $effect(() => {
    items = cards.map(c => ({ ...c }));
  });

  function handleDndConsider(e: CustomEvent) {
    items = e.detail.items;
  }

  function handleDndFinalize(e: CustomEvent) {
    items = e.detail.items;
    onCardsReorder(column.id, items);
  }

  function handleRename() {
    isEditing = true;
    showMenu = false;
  }

  function saveRename() {
    if (editName.trim() && editName !== column.name) {
      onColumnEdit({ ...column, name: editName.trim() });
    }
    isEditing = false;
  }

  function cancelRename() {
    editName = column.name;
    isEditing = false;
  }
</script>

<div class="kanban-column">
  <div class="column-header">
    {#if isEditing}
      <input
        type="text"
        class="column-name-input"
        bind:value={editName}
        onkeydown={(e) => {
          if (e.key === 'Enter') saveRename();
          if (e.key === 'Escape') cancelRename();
        }}
        onblur={saveRename}
      />
    {:else}
      <div class="column-title">
        <h3 class="column-name">{column.name}</h3>
        <span class="card-count">{cards.length}</span>
      </div>
    {/if}

    <div class="column-actions">
      <button
        class="menu-btn"
        onclick={() => showMenu = !showMenu}
        aria-label="Column menu"
      >
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="6" r="2"/>
          <circle cx="12" cy="12" r="2"/>
          <circle cx="12" cy="18" r="2"/>
        </svg>
      </button>

      {#if showMenu}
        <div class="dropdown-menu">
          <button onclick={handleRename}>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
            Rename
          </button>
          <button onclick={() => { showMenu = false; onColumnDelete(column.id); }} class="delete">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
            Delete
          </button>
        </div>
      {/if}
    </div>
  </div>

  <div
    class="cards-container"
    use:dndzone={{ items, flipDurationMs, dropTargetStyle: { outline: '2px dashed #6366f1', outlineOffset: '-2px' } }}
    onconsider={handleDndConsider}
    onfinalize={handleDndFinalize}
  >
    {#each items as item (item.id)}
      <KanbanCard
        quest={item.quest}
        questKey={item.key}
        onclick={() => onCardClick(item.key, item.quest)}
      />
    {/each}
  </div>
</div>

<svelte:window onclick={() => showMenu = false} />

<style>
  .kanban-column {
    flex: 0 0 280px;
    min-width: 280px;
    max-width: 280px;
    background-color: #1f2937;
    border-radius: 0.75rem;
    display: flex;
    flex-direction: column;
    max-height: 100%;
  }

  .column-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem;
    border-bottom: 1px solid #374151;
    position: relative;
  }

  .column-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .column-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: #f3f4f6;
    margin: 0;
  }

  .column-name-input {
    font-size: 0.875rem;
    font-weight: 600;
    background-color: #374151;
    border: 1px solid #6366f1;
    border-radius: 0.25rem;
    color: #f3f4f6;
    padding: 0.25rem 0.5rem;
    outline: none;
    width: 150px;
  }

  .card-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.25rem;
    height: 1.25rem;
    padding: 0 0.375rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: #9ca3af;
    background-color: #374151;
    border-radius: 9999px;
  }

  .column-actions {
    position: relative;
  }

  .menu-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.375rem;
    background: transparent;
    border: none;
    color: #9ca3af;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .menu-btn:hover {
    background-color: #374151;
    color: #f3f4f6;
  }

  .dropdown-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 0.25rem;
    background-color: #374151;
    border: 1px solid #4b5563;
    border-radius: 0.5rem;
    padding: 0.25rem;
    min-width: 120px;
    z-index: 50;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
  }

  .dropdown-menu button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    color: #e5e7eb;
    background: none;
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
    text-align: left;
  }

  .dropdown-menu button:hover {
    background-color: #4b5563;
  }

  .dropdown-menu button.delete {
    color: #f87171;
  }

  .dropdown-menu button.delete:hover {
    background-color: rgba(239, 68, 68, 0.2);
  }

  .cards-container {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 100px;
  }
</style>
