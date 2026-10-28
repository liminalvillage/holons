<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The "Show federated" switch — whether every view folds the federation
  // partners' items in beside this holon's own. Off shows the holon (its own
  // records plus the holograms placed in it); on adds every partner's. One
  // device-wide choice shared by all views; the orthogonal Layout pill only
  // changes how items render. Mirrored cards keep their glow edge either way,
  // coloured by the hash of the holon they belong to.
  import SwitchPill from "./SwitchPill.svelte";
  import { scope } from "$lib/stores";
  import { setScope, type Scope } from "$lib/config";
  import { t } from "$lib/i18n";

  /** Hide the text label (the band is packing pills onto one row). */
  export let compact = false;
  /** Force the text label on regardless of screen width. */
  export let expanded = false;

  $: on = $scope === "networked";

  function toggle() {
    const next: Scope = on ? "all" : "networked";
    scope.set(next);
    setScope(next);
  }
</script>

<SwitchPill
  {on}
  icon="globe"
  label={$t("scope.federated")}
  aria={$t("scope.aria")}
  onToggle={toggle}
  {compact}
  {expanded}
/>
