<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  // A roster of people on a card — the hosts of an event, or its participants:
  // chips to drop someone, a member select to add one. What the list *means*
  // is core's (`hostsOf`, `setParticipants`); this only edits the array the
  // card form will save.
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import type { QuestParticipant } from "@holons/core/tasks";
  import { loadMembers, members, type Member } from "$lib/members";
  import { personName } from "$lib/data";
  import { avatarUrl, avatarInitial, hideImg, showImg } from "./Avatars.svelte";

  export let people: QuestParticipant[] = [];
  /** The select's placeholder, e.g. "Add a host…". */
  export let addLabel = "";
  /** The remove button's accessible name for one person. */
  export let removeLabel: (name: string) => string = (name) => name;

  onMount(() => void loadMembers());

  const nameOf = (p: Member | QuestParticipant): string => personName(p);

  $: taken = new Set(people.map((h) => String(h.id)));
  $: available = $members.filter((m) => !taken.has(String(m.id)));

  function add(e: Event) {
    const select = e.currentTarget as HTMLSelectElement;
    const m = $members.find((x) => String(x.id) === select.value);
    select.value = "";
    if (!m) return;
    // The stored shape of a person on a card — see membership.ts `person`.
    const p: QuestParticipant = { id: m.id };
    if (m.username) p.username = m.username;
    if (m.first_name) p.first_name = m.first_name;
    if (m.last_name) p.last_name = m.last_name;
    people = [...people, p];
  }

  function remove(id: string | number | undefined) {
    people = people.filter((h) => String(h.id) !== String(id));
  }
</script>

<!-- One flowing row: the people already on the list, then the add control
     as the last chip, so the roster reads inline with no block of its own. -->
<ul class="roster">
  {#each people as h (h.id)}
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
        aria-label={removeLabel(nameOf(h))}
        on:click={() => remove(h.id)}><Icon name="close" /></button
      >
    </li>
  {/each}
  {#if available.length}
    <li class="add">
      <label>
        <span class="add-ico"><Icon name="plus" /></span>
        <select on:change={add} aria-label={addLabel}>
          <option value="">{addLabel}</option>
          {#each available as m (m.id)}
            <option value={String(m.id)}>{nameOf(m)}</option>
          {/each}
        </select>
      </label>
    </li>
  {/if}
</ul>

<style>
  .roster {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
    margin: 0;
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
  /* The add control is a chip like the others, dashed, sitting inline. */
  .add label {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 44px;
    padding: 0 0.5rem 0 0.7rem;
    border: 1.5px dashed var(--line);
    border-radius: 999px;
  }
  .add-ico {
    flex: 0 0 auto;
    color: var(--teal-deep);
  }
  .add select {
    max-width: 12rem;
    min-height: 44px;
    border: none;
    background: transparent;
    font-size: 1rem;
    font-family: inherit;
    color: var(--ink);
  }
</style>
