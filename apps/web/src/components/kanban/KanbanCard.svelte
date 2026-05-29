<script lang="ts">
  import TaskCard from '../shared/TaskCard.svelte';
  import type { ResolvedHologramMeta, FederationMeta } from 'holosphere';

  interface Quest {
    id: string;
    title: string;
    description?: string;
    when?: string;
    status: 'ongoing' | 'completed' | 'recurring' | 'repeating';
    category?: string;
    picture?: string;
    dependencies?: string[];
    participants: Array<{
      id: string;
      username: string;
      firstName?: string;
      lastName?: string;
    }>;
    type?: 'task' | 'quest' | 'event' | 'recurring';
    _hologram?: ResolvedHologramMeta;
    _federation?: FederationMeta;
  }

  interface Props {
    quest: Quest;
    questKey: string;
    holonID?: string;
    onclick?: () => void;
    resolveDependencyTitle?: (id: string) => string | undefined;
    onDependencyClick?: (id: string) => void;
  }

  let {
    quest,
    holonID = '',
    onclick,
    resolveDependencyTitle,
    onDependencyClick,
  }: Props = $props();
</script>

<TaskCard
  {quest}
  variant="kanban"
  {holonID}
  {resolveDependencyTitle}
  {onDependencyClick}
  onclick={() => onclick?.()}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onclick?.(); }}
  role="button"
  tabindex={0}
  ariaLabel={`Open: ${quest.title}`}
/>
