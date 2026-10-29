<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  // A roster of people on a card — the hosts of an event, or its participants.
  // Each person is a chip with a clear "×" badge to drop them; one round "+"
  // opens the people selector (PersonSelect: search, avatars, members first,
  // partner holons' people on a search). What the list *means* is core's
  // (`hostsOf`, `setParticipants`); this only edits the array the card form
  // will save.
  import Icon from "$lib/components/Icon.svelte";
  import type { QuestParticipant } from "@holons/core/tasks";
  import { personName } from "$lib/data";
  import { avatarUrl, avatarInitial, hideImg, showImg } from "./Avatars.svelte";
  import PersonSelect, { type PersonOption } from "./PersonSelect.svelte";

  export let people: QuestParticipant[] = [];
  /** The dropdown's accessible name and empty entry, e.g. "Add a host…". */
  export let addLabel = "";
  /** The remove badge's accessible name for one person. */
  export let removeLabel: (name: string) => string = (name) => name;
  /** One person at most (a role's fixed holder): a pick replaces them. */
  export let single = false;

  const nameOf = (p: QuestParticipant): string => personName(p);

  $: taken = new Set(people.map((h) => String(h.id)));

  function put(m: PersonOption) {
    if (taken.has(String(m.id))) return;
    // The stored shape of a person on a card — see membership.ts `person`.
    const p: QuestParticipant = { id: m.id };
    if (m.username) p.username = m.username;
    if (m.first_name) p.first_name = m.first_name;
    if (m.last_name) p.last_name = m.last_name;
    people = single ? [p] : [...people, p];
  }

  function remove(id: string | number | undefined) {
    people = people.filter((h) => String(h.id) !== String(id));
  }
</script>

<!-- One flowing row: the people already on the list, then the "+" as the last
     chip, so the roster reads inline with no block of its own. -->
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
        title={removeLabel(nameOf(h))}
        on:click={() => remove(h.id)}
        ><span class="x-badge"><Icon name="close" /></span></button
      >
    </li>
  {/each}
  <li class="add">
    <PersonSelect
      label={addLabel}
      exclude={[...taken]}
      federation
      on:pick={(e) => put(e.detail)}
    >
      <button
        slot="trigger"
        let:toggle
        let:open
        type="button"
        class="add-face"
        aria-label={addLabel}
        title={addLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        on:click={toggle}><Icon name="plus" /></button
      >
    </PersonSelect>
  </li>
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
    font-family: inherit;
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
  /* A full 44px touch target inside the pill, drawn as a visible round
     badge so it reads as "remove" at a glance. */
  .x {
    min-width: 44px;
    min-height: 44px;
    display: grid;
    place-items: center;
    border: none;
    background: transparent;
    padding: 0;
    cursor: pointer;
  }
  .x-badge {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--ink);
    color: var(--card);
    font-size: 0.85rem;
  }
  .x:active .x-badge {
    background: var(--danger, #c0392b);
  }
  /* The one control to add someone: a round "+" the size of a chip, with
     the native select laid invisibly on top so tapping it opens the list. */
  .add {
    position: relative;
    width: 44px;
    height: 44px;
  }
  .add-face {
    width: 44px;
    height: 44px;
    cursor: pointer;
    background: transparent;
    border-radius: 50%;
    display: grid;
    place-items: center;
    border: 1.5px dashed var(--teal-deep);
    color: var(--teal-ink);
    font-size: 1.25rem;
  }
  .add-face:active {
    background: var(--teal-deep);
    color: var(--on-teal);
  }
</style>
