<script lang="ts">
  import { toast } from "$lib/stores";
</script>

{#if $toast}
  <div
    style="position:absolute;left:16px;right:16px;bottom:104px;background:var(--color-accent-2-800);color:var(--color-neutral-100);border-radius:var(--radius-md);padding:14px 16px;font-size:13.5px;font-weight:600;z-index:30;box-shadow:var(--shadow-lg);animation:riseIn .2s ease"
  >
    {$toast}
  </div>
{/if}
