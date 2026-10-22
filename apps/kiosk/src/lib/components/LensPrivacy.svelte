<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Who can read the board on screen: one sheet from the lock beside the
  // gear, the lens name on top, the AudienceEditor under it (state, one
  // action, what it does, who it is shared with). A single card is locked
  // from its own view instead.
  import { createEventDispatcher } from "svelte";
  import Modal from "$lib/components/Modal.svelte";
  import AudienceEditor from "$lib/components/AudienceEditor.svelte";
  import { t } from "$lib/i18n";

  export let holonId: string;
  export let lens: string;
  export let label: string;
  const dispatch = createEventDispatcher();
  let editor: AudienceEditor;
  let locked = false;
  let frozen = true;
</script>

<Modal on:close={() => dispatch("close")}>
  <!-- The one action sits in the corner beside the ✕; the title keeps
       clear of both. -->
  <button
    slot="corner"
    type="button"
    class="act"
    class:open={locked}
    disabled={frozen}
    on:click={() => editor?.toggle()}
    >{$t(locked ? "audience.makePublic" : "audience.makePrivate")}</button
  >
  <h2>{$t("privacy.who", { lens: label })}</h2>
  <AudienceEditor
    bind:this={editor}
    bind:locked
    bind:frozen
    actionOutside
    scope={{ holon: holonId, lens }}
  />
</Modal>

<style>
  h2 {
    margin: 0 0 0.8rem;
    padding-right: calc(var(--corner-w, 44px) + 0.4rem);
    font-size: 1.1rem;
    line-height: 1.3;
  }
  .act {
    min-height: 44px;
    padding: 0 0.9rem;
    border-radius: 999px;
    border: 1.5px solid var(--teal-deep);
    background: var(--teal-deep);
    color: var(--on-teal);
    font-weight: 700;
    font-size: 0.85rem;
    white-space: nowrap;
  }
  .act.open {
    background: var(--card);
    color: var(--teal-ink);
  }
  .act:disabled {
    opacity: 0.5;
  }
</style>
