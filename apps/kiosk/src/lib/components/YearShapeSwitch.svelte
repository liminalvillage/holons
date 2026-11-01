<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The year window's own shape switch — two lines, or one dial. It sits in
  // the year window's toolbar (not the shell's pills band): the shape is a
  // property of this one window, like its zoom. Per device, like every
  // layout choice.
  import PillSwitch from "./PillSwitch.svelte";
  import { yearShape } from "$lib/stores";
  import { setYearShape, type YearShape } from "$lib/config";
  import { t } from "$lib/i18n";

  function pick(id: string) {
    yearShape.set(id as YearShape);
    setYearShape(id as YearShape);
  }
  $: options = [
    { id: "linear", icon: "lines" as const, label: $t("pills.yearLinear") },
    { id: "radial", icon: "dial" as const, label: $t("pills.yearRadial") },
  ];
</script>

<PillSwitch
  {options}
  value={$yearShape}
  onChange={pick}
  label={$t("pills.yearShape")}
  showText
  expanded
/>
