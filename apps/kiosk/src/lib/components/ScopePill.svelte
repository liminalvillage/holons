<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The "Show" pill — whose items every view displays: Personal (only the
  // logged-in user's), Local (this holon), or Global (this holon plus its
  // federation partners). One device-wide scope shared by all views; the
  // orthogonal Layout pill only changes how items render.
  import PillSwitch from "./PillSwitch.svelte";
  import { scope } from "$lib/stores";
  import { setScope, type Scope } from "$lib/config";
  import { telegramUser } from "$lib/auth";

  /** Force the small cycling toggle (see PillSwitch). */
  export let compact = false;

  // "Mine" needs someone to be personal about — hidden logged out, EXCEPT
  // when a persisted personal scope is active, so the pill still shows what's
  // selected (the views render their own log-in prompts).
  $: options = [
    ...($telegramUser || $scope === "personal"
      ? [{ id: "personal", label: "Personal", svgIcon: "person" as const }]
      : []),
    { id: "all", label: "Local", glyph: "⌂" },
    { id: "networked", label: "Global", svgIcon: "globe" as const },
  ];

  function onChange(id: string) {
    scope.set(id as Scope);
    setScope(id as Scope);
  }
</script>

<PillSwitch
  {options}
  value={$scope}
  {onChange}
  showText
  {compact}
  icon="filter"
  title="Show"
  label="Whose items to show"
/>
