<script lang="ts">
  import { formatDate } from '../../utils/date';
  import { goto } from '$app/navigation';
  import { nameMap, resolveName, resolvedName, buildHologramLink, extractHolonIdFromSoul } from '$lib/stores/nameResolver';

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
    _hologram?: {
      isHologram: boolean;
      soul: string;
      sourceHolon: string;
    };
    _federation?: {
      origin?: string;
      sourceLens?: string;
    };
  }

  interface Props {
    quest: Quest;
    questKey: string;
    holonID?: string;
    onclick?: () => void;
  }

  let { quest, questKey, holonID = '', onclick }: Props = $props();

  function getColorFromCategory(category: string | undefined, type: string = 'task') {
    if (!category) {
      switch (type) {
        case 'event':
          return "hsl(280, 70%, 85%)";
        case 'quest':
          return "hsl(200, 70%, 85%)";
        default:
          return "#E5E7EB";
      }
    }
    let hash = 0;
    for (let i = 0; i < category.length; i++) {
      hash = (hash << 5) - hash + category.charCodeAt(i);
      hash = hash & hash;
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 85%)`;
  }

  function isOverdue(when: string | undefined): boolean {
    if (!when) return false;
    const dueDate = new Date(when);
    return dueDate < new Date();
  }

  function getInitials(participant: { firstName?: string; lastName?: string; username: string }): string {
    if (participant.firstName) {
      return (participant.firstName[0] + (participant.lastName?.[0] || '')).toUpperCase();
    }
    return participant.username.slice(0, 2).toUpperCase();
  }

  const maxAvatars = 3;
  const displayParticipants = $derived(quest.participants?.slice(0, maxAvatars) || []);
  const remainingCount = $derived(Math.max(0, (quest.participants?.length || 0) - maxAvatars));
  const overdue = $derived(quest.status !== 'completed' && isOverdue(quest.when));
</script>

<div
  class="kanban-card"
  class:completed={quest.status === 'completed'}
  class:overdue
  class:hologram={quest._hologram?.isHologram}
  style="--card-bg: {getColorFromCategory(quest.category, quest.type)}"
  onclick={onclick}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onclick?.(); }}
  role="button"
  tabindex="0"
>
  <div class="card-header">
    <h4 class="card-title">{quest.title}</h4>
    {#if quest._hologram?.isHologram}
      {@const holoOrigin = extractHolonIdFromSoul(quest._hologram.soul)}
      {@const holoName = holoOrigin ? (resolveName(holoOrigin), resolvedName(holoOrigin, $nameMap)) : 'External'}
      <button
        type="button"
        class="source-pill source-pill--hologram"
        title="Navigate to source: {holoName}"
        onclick={(e) => { e.stopPropagation(); if (quest._hologram) goto(buildHologramLink(quest._hologram)); }}
        aria-label="Navigate to source: {holoName}"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="9" height="9"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        {holoName}
      </button>
    {:else if quest._federation?.origin && quest._federation.origin !== holonID}
      {@const fedOrigin = quest._federation.origin}
      {@const fedName = (resolveName(fedOrigin), resolvedName(fedOrigin, $nameMap))}
      <button
        type="button"
        class="source-pill source-pill--federation"
        title="Navigate to source holon: {fedName}"
        onclick={(e) => { e.stopPropagation(); goto(`/${fedOrigin}/tasks`); }}
        aria-label="Navigate to source holon: {fedName}"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="9" height="9"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        {fedName}
      </button>
    {/if}
  </div>

  {#if quest.description}
    <p class="card-description">{quest.description}</p>
  {/if}

  <div class="card-footer">
    <div class="card-meta">
      {#if quest.category}
        <span class="category-badge">{quest.category}</span>
      {/if}
      {#if quest.when}
        <span class="due-date" class:overdue>
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" stroke-width="2"/>
            <line x1="16" y1="2" x2="16" y2="6" stroke-width="2"/>
            <line x1="8" y1="2" x2="8" y2="6" stroke-width="2"/>
            <line x1="3" y1="10" x2="21" y2="10" stroke-width="2"/>
          </svg>
          {formatDate(quest.when)}
        </span>
      {/if}
    </div>

    {#if displayParticipants.length > 0}
      <div class="avatars">
        {#each displayParticipants as participant}
          <div class="avatar" title={participant.firstName || participant.username}>
            {getInitials(participant)}
          </div>
        {/each}
        {#if remainingCount > 0}
          <div class="avatar avatar-more">+{remainingCount}</div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .kanban-card {
    background-color: var(--card-bg);
    border-radius: 0.5rem;
    padding: 0.75rem;
    cursor: pointer;
    transition: all 0.2s ease;
    border: 1px solid transparent;
  }

  .kanban-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    border-color: rgba(0, 0, 0, 0.1);
  }

  .kanban-card.completed {
    opacity: 0.6;
  }

  .kanban-card.completed .card-title {
    text-decoration: line-through;
  }

  .kanban-card.overdue {
    border-color: #ef4444;
    box-shadow: 0 0 0 1px #ef4444;
  }

  .kanban-card.hologram {
    border: 2px solid #00BFFF;
    box-shadow: 0 0 10px rgba(0, 191, 255, 0.3);
  }

  .card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .card-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: #1f2937;
    line-height: 1.25;
    margin: 0;
    flex: 1;
  }

  .source-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.1rem 0.35rem;
    font-size: 0.6rem;
    font-weight: 500;
    border: none;
    border-radius: 9999px;
    cursor: pointer;
    flex-shrink: 0;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: background-color 150ms ease;
  }
  .source-pill--hologram {
    background: rgba(0, 191, 255, 0.15);
    color: #00BFFF;
  }
  .source-pill--hologram:hover {
    background: rgba(0, 191, 255, 0.3);
  }
  .source-pill--federation {
    background: rgba(168, 85, 247, 0.18);
    color: #a855f7;
  }
  .source-pill--federation:hover {
    background: rgba(168, 85, 247, 0.32);
  }

  .card-description {
    font-size: 0.75rem;
    color: #4b5563;
    margin: 0.25rem 0 0.5rem;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .card-meta {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-wrap: wrap;
  }

  .category-badge {
    display: inline-block;
    padding: 0.125rem 0.375rem;
    font-size: 0.625rem;
    font-weight: 500;
    background-color: rgba(0, 0, 0, 0.1);
    color: #374151;
    border-radius: 0.25rem;
  }

  .due-date {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.625rem;
    color: #6b7280;
  }

  .due-date.overdue {
    color: #ef4444;
    font-weight: 500;
  }

  .avatars {
    display: flex;
    flex-direction: row-reverse;
  }

  .avatar {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background-color: #6366f1;
    color: white;
    font-size: 0.5rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid white;
    margin-left: -0.375rem;
  }

  .avatar:last-child {
    margin-left: 0;
  }

  .avatar-more {
    background-color: #9ca3af;
  }
</style>
