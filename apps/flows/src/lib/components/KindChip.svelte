<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // What a party is, in words, with its colour as a dot — the colour is the
  // one its bar has in the diagram, and is never the only cue.
  import { t, type MessageKey } from "$lib/i18n";

  /** A `FlowPartyKind`, or one of the diagram's own bars (`other`, `direct`, `retained`). */
  export let kind: string;

  const KEYS: Record<string, MessageKey> = {
    pot: "kind.pot",
    fund: "kind.fund",
    project: "kind.project",
    person: "kind.person",
    placeholder: "kind.placeholder",
    other: "kind.other",
    direct: "kind.direct",
    retained: "kind.retained",
  };
  $: key = KEYS[kind] ?? "kind.other";
</script>

<span class="chip"><i class="dot {kind}"></i>{$t(key)}</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .dot {
    width: 0.62em;
    height: 0.62em;
    border-radius: 999px;
    background: var(--kind-other);
    flex: 0 0 auto;
  }
  .dot.pot {
    background: var(--kind-pot);
  }
  .dot.fund {
    background: var(--kind-fund);
  }
  .dot.project {
    background: var(--kind-project);
  }
  .dot.person {
    background: var(--kind-person);
  }
  .dot.placeholder {
    background: var(--kind-placeholder);
  }
</style>
