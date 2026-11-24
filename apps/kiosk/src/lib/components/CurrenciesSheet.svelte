<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The holon's currencies, opened from the ✎ at the end of the Flows unit
  // row. Two kinds of entry, shown together in their unit colours:
  //   - listed: in the settings (`settings.currencies`) — offered before
  //     anyone has used them, and removable here;
  //   - in use: on recorded expenses — they stay while a record carries
  //     them, so they show their count and no remove.
  // Every change saves at once (kiosk rule: no Apply), through core
  // `saveHolonCurrencies`.
  import { createEventDispatcher } from "svelte";
  import Modal from "./Modal.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "$lib/i18n";
  import { unitHue } from "$lib/unithues";
  import { normalizeCurrency } from "@holons/core/expenses";

  /** The listed currencies, normalized. */
  export let listed: string[] = [];
  /** Expense records per currency. */
  export let usage: Record<string, number> = {};
  /** Writes the whole list; throws on failure. */
  export let onSave: (list: string[]) => Promise<void>;

  const dispatch = createEventDispatcher<{ close: void }>();

  let draft = "";
  let busy = false;
  let error = "";

  $: rows = [
    ...new Set([...listed, ...Object.keys(usage)].filter(Boolean)),
  ].map((code) => ({
    code,
    listed: listed.includes(code),
    used: usage[code] ?? 0,
  }));

  async function save(list: string[]) {
    busy = true;
    error = "";
    try {
      await onSave(list);
    } catch (err: any) {
      error = err?.message ? String(err.message) : String(err);
    } finally {
      busy = false;
    }
  }

  function add() {
    const codes = draft
      .split(/[,\s]+/)
      .map((c) => normalizeCurrency(c))
      .filter((c) => c && !listed.includes(c));
    draft = "";
    if (codes.length) void save([...listed, ...codes]);
  }
  function remove(code: string) {
    void save(listed.filter((c) => c !== code));
  }
  /** A currency only on records gets listed, so it is offered on purpose. */
  function keep(code: string) {
    void save([...listed, code]);
  }
</script>

<Modal on:close={() => dispatch("close")}>
  <div class="sheet">
    <h3>{$t("currencies.title")}</h3>
    <p class="sub">{$t("currencies.about")}</p>

    <ul class="rows">
      {#each rows as r (r.code)}
        <li style:--u={unitHue(r.code)}>
          <span class="name"><i class="dot"></i>{r.code.toUpperCase()}</span>
          <span class="meta">
            {r.used
              ? r.used === 1
                ? $t("currencies.usedInOne")
                : $t("currencies.usedIn", { n: String(r.used) })
              : $t("currencies.unused")}
            {#if !r.listed}· {$t("currencies.notListed")}{/if}
          </span>
          {#if r.listed}
            <button
              type="button"
              class="icon"
              disabled={busy}
              aria-label={$t("currencies.remove", {
                code: r.code.toUpperCase(),
              })}
              title={r.used
                ? $t("currencies.removeUsed")
                : $t("currencies.remove", { code: r.code.toUpperCase() })}
              on:click={() => remove(r.code)}><Icon name="close" /></button
            >
          {:else}
            <button
              type="button"
              class="keep"
              disabled={busy}
              on:click={() => keep(r.code)}>{$t("currencies.list")}</button
            >
          {/if}
        </li>
      {/each}
    </ul>

    <form class="add" on:submit|preventDefault={add}>
      <input
        type="text"
        autocapitalize="none"
        placeholder={$t("currencies.addHint")}
        aria-label={$t("currencies.add")}
        bind:value={draft}
      />
      <button
        type="submit"
        class="primary"
        disabled={busy || !draft.trim()}
        aria-label={$t("currencies.add")}
        ><Icon name="plus" /> {$t("currencies.add")}</button
      >
    </form>
    {#if error}<p class="sub warn" role="alert">{error}</p>{/if}
  </div>
</Modal>

<style>
  .sheet {
    color: var(--ink);
  }
  h3 {
    margin: 0 0 0.3rem;
    padding-right: calc(var(--corner-w, 44px) + 0.4rem);
    font-size: 1.1rem;
  }
  .sub {
    margin: 0 0 0.8rem;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .sub.warn {
    color: var(--danger);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 44px;
    padding: 0 0.4rem 0 0.8rem;
    border-radius: 12px;
    background: color-mix(in srgb, var(--u) 12%, var(--paper));
  }
  .name {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-weight: 800;
    font-size: 0.9rem;
  }
  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--u);
  }
  .meta {
    flex: 1;
    font-size: 0.8rem;
    color: var(--ink-soft);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    color: var(--ink-soft);
  }
  .icon :global(svg) {
    width: 1rem;
    height: 1rem;
  }
  .keep {
    min-height: 36px;
    padding: 0 0.8rem;
    border-radius: 999px;
    background: var(--paper);
    font-weight: 700;
    font-size: 0.8rem;
    color: var(--ink-soft);
  }
  .add {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
  }
  .add input {
    flex: 1;
    min-height: 44px;
    padding: 0 0.8rem;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
  }
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 44px;
    padding: 0 1rem;
    border-radius: 12px;
    background: var(--teal);
    color: var(--on-teal);
    font-weight: 700;
  }
  .primary:disabled {
    opacity: 0.5;
  }
  .primary :global(svg) {
    width: 1rem;
    height: 1rem;
  }
</style>
