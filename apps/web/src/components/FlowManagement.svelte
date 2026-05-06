<script lang="ts">
  // This component has been redesigned with a new concentric zone visualization.
  // The implementation is in src/components/flow/FlowManagement.svelte
  // This file re-exports the new component for backwards compatibility.

  import FlowManagementNew from './flow/FlowManagement.svelte';

  export let holonId: string;
</script>

<FlowManagementNew {holonId} />
