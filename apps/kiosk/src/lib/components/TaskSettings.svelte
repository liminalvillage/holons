<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The task board's own settings, reached from the gear in the pills band:
  // whether the whole board is private, and which holons may read it. One
  // card is locked from its own detail view instead.
  import { createEventDispatcher } from "svelte";
  import Modal from "$lib/components/Modal.svelte";
  import AudienceEditor from "$lib/components/AudienceEditor.svelte";
  import { t } from "$lib/i18n";

  export let holonId: string;
  const dispatch = createEventDispatcher();
</script>

<Modal on:close={() => dispatch("close")}>
  <h2>{$t("tasks.privacyTitle")}</h2>
  <p class="sub">{$t("tasks.privacySub")}</p>
  <AudienceEditor scope={{ holon: holonId, lens: "quests" }} />
</Modal>

<style>
  h2 {
    margin: 0 0 0.2rem;
    font-size: 1.1rem;
  }
  .sub {
    margin: 0 0 0.8rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: none;
    letter-spacing: 0;
  }
</style>
