<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  // Who leads an event: chips to drop a host, a roster select to name one.
  // The list itself is core's (`hostsOf` / `toggleHost`); this only edits the
  // array the card form will save.
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import type { QuestParticipant } from "@holons/core/tasks";
  import { loadMembers, members, type Member } from "$lib/members";
  import { avatarUrl, avatarInitial, hideImg, showImg } from "./Avatars.svelte";
  import { t } from "$lib/i18n";

  export let hosts: QuestParticipant[] = [];

  onMount(() => void loadMembers());

  function nameOf(p: Member | QuestParticipant): string {
    const full = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
    return full || (p?.username ? `@${p.username}` : `#${p?.id ?? "?"}`);
  }

  $: taken = new Set(hosts.map((h) => String(h.id)));
  $: available = $members.filter((m) => !taken.has(String(m.id)));

  function add(e: Event) {
    const select = e.currentTarget as HTMLSelectElement;
    const m = $members.find((x) => String(x.id) === select.value);
    select.value = "";
    if (!m) return;
    // The stored shape of a person on a card — see membership.ts `person`.
    const host: QuestParticipant = { id: m.id };
    if (m.username) host.username = m.username;
    if (m.first_name) host.first_name = m.first_name;
    hosts = [...hosts, host];
  }

  function remove(id: string | number | undefined) {
    hosts = hosts.filter((h) => String(h.id) !== String(id));
  }
</script>

<div class="hosts">
  {#if hosts.length}
    <ul class="chips">
      {#each hosts as h (h.id)}
        <li class="chip">
          <span class="av">
            <span class="ini">{avatarInitial(nameOf(h))}</span>
            {#if h.id != null}
              <img
                src={avatarUrl(h.id)}
                alt=""
                loading="lazy"
                on:error={hideImg}
                on:load={showImg}
              />
            {/if}
          </span>
          <span class="nm">{nameOf(h)}</span>
          <button
            type="button"
            class="x"
            aria-label={$t("detail.removeHost", { name: nameOf(h) })}
            on:click={() => remove(h.id)}><Icon name="close" /></button
          >
        </li>
      {/each}
    </ul>
  {/if}
  {#if available.length}
    <label class="add">
      <span class="add-ico"><Icon name="plus" /></span>
      <select on:change={add} aria-label={$t("detail.addHost")}>
        <option value="">{$t("detail.addHost")}</option>
        {#each available as m (m.id)}
          <option value={String(m.id)}>{nameOf(m)}</option>
        {/each}
      </select>
    </label>
  {/if}
</div>

<style>
  .chips {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin: 0 0 0.5rem;
    padding: 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0 0 0 0.3rem;
    border-radius: 999px;
    /* The edit form's own chip colours, so it reads in both themes. */
    background: var(--card);
    border: 1.5px solid var(--line);
    font-weight: 700;
    color: var(--ink);
    font-size: 0.92rem;
  }
  .av {
    position: relative;
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--teal);
    display: grid;
    place-items: center;
    flex: 0 0 auto;
  }
  .ini {
    font-size: 0.72rem;
    font-weight: 800;
    color: #fff;
  }
  .av img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .nm {
    max-width: 11rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* A full 44px touch target inside the pill. */
  .x {
    min-width: 44px;
    min-height: 44px;
    display: grid;
    place-items: center;
    border: none;
    background: transparent;
    color: var(--ink-soft);
    border-radius: 999px;
    cursor: pointer;
  }
  .add {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.2rem 0.4rem 0.2rem 0.7rem;
    border: 1.5px dashed var(--line);
    border-radius: 14px;
  }
  .add-ico {
    flex: 0 0 auto;
    color: var(--teal-deep);
  }
  .add select {
    flex: 1;
    min-height: 44px;
    border: none;
    background: transparent;
    font-size: 1rem;
    font-family: inherit;
    color: var(--ink);
  }
</style>
