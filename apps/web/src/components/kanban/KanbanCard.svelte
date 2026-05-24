<script lang="ts">
  import TaskCard from '../shared/TaskCard.svelte';

  interface Quest {
    id: string;
    title: string;
    description?: string;
    when?: string;
    status: 'ongoing' | 'completed' | 'recurring' | 'repeating';
    category?: string;
    picture?: string;
    participants: Array<{
      id: string;
      username: string;
      firstName?: string;
      lastName?: string;
    }>;
    type?: 'task' | 'quest' | 'event' | 'recurring';
    _hologram?: { isHologram?: boolean; [key: string]: unknown };
    _federation?: { origin?: string; [key: string]: unknown };
  }

  interface Props {
    quest: Quest;
    questKey: string;
    holonID?: string;
    onclick?: () => void;
  }

  let { quest, holonID = '', onclick }: Props = $props();
</script>

<TaskCard
  {quest}
  variant="kanban"
  {holonID}
  onclick={() => onclick?.()}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onclick?.(); }}
  role="button"
  tabindex={0}
  ariaLabel={`Open: ${quest.title}`}
/>
