<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import Icon from "$lib/components/Icon.svelte";
  //
  // The Calendar board's own settings sheet — the two ways a board and the
  // world outside it meet:
  //
  //   Subscribe — this holon's live calendar as a feed URL anyone can add to
  //     Google/Apple/Nextcloud. It keeps updating on its own; the federation
  //     switch decides whether partners' events ride along.
  //   Follow — calendars the holon doesn't own, read onto this board.
  //
  // Kiosk rule: no Apply step. Every change writes as it is made (the feed
  // list is shared with the dashboard, so an edit here shows up there).
  import { createEventDispatcher } from "svelte";
  import { holonId, holonName } from "$lib/stores";
  import { t } from "$lib/i18n";
  import {
    addImportedCalendar,
    calendarsSyncing,
    holonFeedUrl,
    importedCalendars,
    isValidICalUrl,
    recolorImportedCalendar,
    removeImportedCalendar,
    toggleImportedCalendar,
  } from "$lib/calendars";
  import { externalEventColor } from "$lib/data";
  import { NOTE_COLORS, resolveCssColor } from "$lib/palette";
  import { toWebcalUrl } from "@holons/core/calendar";
  import Modal from "./Modal.svelte";

  const dispatch = createEventDispatcher();

  /** Whether the subscribe link carries the holon's federation partners. */
  let withFederation = false;
  $: feedUrl = $holonId ? holonFeedUrl($holonId, withFederation) : "";

  let copied = false;
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  async function copyFeed() {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1800);
    } catch {
      error = $t("clipboard.writeFailed");
    }
  }

  // ── Following someone else's calendar ────────────────────────────────────
  let draftUrl = "";
  let draftName = "";
  let busy = false;
  let error = "";

  $: canAdd = !busy && isValidICalUrl(draftUrl.trim());

  async function add() {
    const holon = $holonId;
    if (!holon || !canAdd) return;
    busy = true;
    error = "";
    const ok = await addImportedCalendar(holon, draftUrl, draftName);
    busy = false;
    if (!ok) {
      error = $t("cal.set.saveFailed");
      return;
    }
    draftUrl = "";
    draftName = "";
  }

  async function remove(id: string) {
    const holon = $holonId;
    if (!holon || busy) return;
    busy = true;
    if (!(await removeImportedCalendar(holon, id)))
      error = $t("cal.set.saveFailed");
    busy = false;
  }

  async function toggle(id: string) {
    const holon = $holonId;
    if (!holon || busy) return;
    busy = true;
    if (!(await toggleImportedCalendar(holon, id)))
      error = $t("cal.set.saveFailed");
    busy = false;
  }

  // ── Colouring a followed calendar ───────────────────────────────────────
  // Tapping a feed's swatch unfolds a palette row under it: the board's six
  // post-it notes, a custom colour, and "Automatic" (back to the hashed note)
  // once a colour is chosen. Every pick writes at once, like everything else
  // on this sheet, and the board recolours the feed's events on the spot.
  let pickingId: string | null = null;

  async function recolor(id: string, color: string) {
    const holon = $holonId;
    if (!holon || busy) return;
    busy = true;
    if (!(await recolorImportedCalendar(holon, id, color)))
      error = $t("cal.set.saveFailed");
    busy = false;
    pickingId = null;
  }

  /** A palette note as the literal hex it stands for in the current theme. */
  const noteHex = (note: string): string => resolveCssColor(note).toLowerCase();

  /** A feed URL reads as its host and last path segment, never a wall of query. */
  function shortUrl(url: string): string {
    try {
      const u = new URL(url.replace(/^webcal:\/\//i, "https://"));
      const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
      return last ? `${u.host}/…/${last}` : u.host;
    } catch {
      return url;
    }
  }
</script>

<Modal on:close={() => dispatch("close")}>
  <div class="calset">
    <h3>{$t("cal.set.title")}</h3>

    <!-- ── This holon's own calendar, as something to subscribe to ───────── -->
    <section>
      <h4>{$t("cal.set.subscribeHead")}</h4>
      <p class="note">
        {$t("cal.set.subscribeBody", {
          name: $holonName || $t("cal.set.thisHolon"),
        })}
      </p>

      <div class="row">
        <span class="rowlabel"
          >{$t("cal.set.federated")}
          <span class="sub">{$t("cal.set.federatedSub")}</span></span
        >
        <button
          type="button"
          class="switch"
          class:on={withFederation}
          role="switch"
          aria-checked={withFederation}
          aria-label={$t("cal.set.federated")}
          on:click={() => (withFederation = !withFederation)}
        >
          <span class="knob"></span>
        </button>
      </div>

      <p class="url" aria-label={$t("cal.set.feedUrl")}>{feedUrl}</p>
      <div class="acts">
        <button type="button" class="act" on:click={copyFeed}>
          {copied ? $t("cal.set.copied") : $t("cal.set.copy")}
        </button>
        {#if feedUrl}
          <a class="act ghost" href={toWebcalUrl(feedUrl)}>
            {$t("cal.set.openInApp")}
          </a>
        {/if}
      </div>
    </section>

    <!-- ── Calendars this holon follows ─────────────────────────────────── -->
    <section>
      <h4>{$t("cal.set.importHead")}</h4>
      <p class="note">{$t("cal.set.importBody")}</p>

      {#if $importedCalendars.length}
        <ul class="feeds">
          {#each $importedCalendars as cal (cal.id)}
            <li class="feed" class:off={!cal.enabled}>
              <button
                type="button"
                class="switch small"
                class:on={cal.enabled}
                role="switch"
                aria-checked={cal.enabled}
                aria-label={$t("cal.set.showFeed", { name: cal.name })}
                on:click={() => toggle(cal.id)}
              >
                <span class="knob"></span>
              </button>
              <button
                type="button"
                class="swatch feedswatch"
                class:auto={!cal.color}
                class:open={pickingId === cal.id}
                style="background: {externalEventColor(cal)};"
                aria-label={$t("cal.set.colorFeed", { name: cal.name })}
                aria-expanded={pickingId === cal.id}
                on:click={() =>
                  (pickingId = pickingId === cal.id ? null : cal.id)}
              ></button>
              <span class="feedwho">
                <span class="feedname">{cal.name}</span>
                <span class="feedurl">{shortUrl(cal.url)}</span>
              </span>
              <button
                type="button"
                class="drop"
                aria-label={$t("cal.set.removeFeed", { name: cal.name })}
                on:click={() => remove(cal.id)}><Icon name="close" /></button
              >
              {#if pickingId === cal.id}
                <div class="palette">
                  {#each NOTE_COLORS as note (note)}
                    <button
                      type="button"
                      class="swatch"
                      class:sel={!!cal.color && cal.color === noteHex(note)}
                      style="background: {note};"
                      disabled={busy}
                      aria-label={$t("cal.set.colorAria", {
                        color: noteHex(note),
                      })}
                      on:click={() => recolor(cal.id, noteHex(note))}
                    ></button>
                  {/each}
                  <label
                    class="swatch custom"
                    style="background: {resolveCssColor(
                      externalEventColor(cal),
                    )};"
                  >
                    <input
                      type="color"
                      value={resolveCssColor(externalEventColor(cal))}
                      disabled={busy}
                      on:change={(e) => recolor(cal.id, e.currentTarget.value)}
                      aria-label={$t("cal.set.colorCustom")}
                    />
                  </label>
                  {#if cal.color}
                    <button
                      type="button"
                      class="autopick"
                      disabled={busy}
                      on:click={() => recolor(cal.id, "")}
                    >
                      {$t("cal.set.colorAuto")}
                    </button>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {:else if $calendarsSyncing}
        <!-- Still reading the list: "none yet" would be a lie for a second. -->
        <p class="empty">{$t("cal.set.syncing")}</p>
      {:else}
        <p class="empty">{$t("cal.set.noFeeds")}</p>
      {/if}

      <div class="add">
        <input
          class="in"
          type="url"
          inputmode="url"
          bind:value={draftUrl}
          placeholder={$t("cal.set.urlPlaceholder")}
          aria-label={$t("cal.set.urlLabel")}
        />
        <input
          class="in"
          type="text"
          bind:value={draftName}
          placeholder={$t("cal.set.namePlaceholder")}
          aria-label={$t("cal.set.nameLabel")}
        />
        <button type="button" class="act" disabled={!canAdd} on:click={add}>
          {$t("cal.set.add")}
        </button>
      </div>

      {#if $calendarsSyncing}
        <p class="note">{$t("cal.set.syncing")}</p>
      {/if}
      {#if error}
        <p class="err">{error}</p>
      {/if}
    </section>
  </div>
</Modal>

<style>
  .calset {
    text-align: left;
  }
  h3 {
    margin: 0 0 1rem;
    font-size: 1.15rem;
    color: var(--ink);
  }
  section + section {
    margin-top: 1.6rem;
    padding-top: 1.2rem;
    border-top: 1.5px solid var(--line);
  }
  h4 {
    margin: 0 0 0.35rem;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .note {
    margin: 0 0 0.8rem;
    font-size: 0.9rem;
    line-height: 1.45;
    color: var(--muted);
  }
  .err {
    margin: 0.6rem 0 0;
    font-size: 0.9rem;
    color: #9a3b2f;
  }
  .empty {
    margin: 0 0 0.8rem;
    font-size: 0.9rem;
    color: var(--muted);
  }

  /* Federation switch — same shape as the Settings panel's toggles. */
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 0;
  }
  .rowlabel {
    color: var(--ink);
    font-weight: 700;
    font-size: 0.95rem;
  }
  .sub {
    display: block;
    font-weight: 500;
    font-size: 0.82rem;
    color: var(--muted);
  }
  .switch {
    flex: 0 0 auto;
    width: 3.1rem;
    height: 1.8rem;
    border-radius: 999px;
    background: var(--line);
    position: relative;
    transition: background 0.18s ease;
  }
  .switch.on {
    background: var(--teal);
  }
  .knob {
    position: absolute;
    top: 0.2rem;
    left: 0.2rem;
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 50%;
    background: #fff;
    box-shadow: var(--shadow-soft);
    transition: transform 0.18s ease;
  }
  .switch.on .knob {
    transform: translateX(1.3rem);
  }
  .switch.small {
    width: 2.6rem;
    height: 1.5rem;
  }
  .switch.small .knob {
    width: 1.1rem;
    height: 1.1rem;
    top: 0.2rem;
  }
  .switch.small.on .knob {
    transform: translateX(1.1rem);
  }

  /* The feed URL: long, and meant to be read before it is copied. */
  .url {
    margin: 0.2rem 0 0.7rem;
    padding: 0.6rem 0.7rem;
    border-radius: 12px;
    background: var(--paper);
    color: var(--ink-soft);
    font-size: 0.8rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow-wrap: anywhere;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .act {
    padding: 0.5rem 0.9rem;
    border-radius: 999px;
    background: var(--teal);
    color: #fff;
    font-size: 0.9rem;
    font-weight: 700;
    text-decoration: none;
  }
  .act:disabled {
    opacity: 0.45;
  }
  .act.ghost {
    background: var(--paper);
    color: var(--teal-deep);
  }
  .act:active {
    transform: scale(0.97);
  }

  .feeds {
    list-style: none;
    margin: 0 0 0.9rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .feed {
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    align-items: center;
    gap: 0.7rem;
    padding: 0.5rem 0.6rem;
    border-radius: 12px;
    background: var(--paper);
  }

  /* The feed's colour and the palette that unfolds under the row.
     Same swatch shape as the Settings panel's accent row. */
  .swatch {
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 50%;
    box-shadow: var(--shadow-soft);
    position: relative;
    transition: transform 0.1s ease;
  }
  .swatch:active {
    transform: scale(0.9);
  }
  .swatch.sel {
    outline: 3px solid var(--ink);
    outline-offset: 2px;
  }
  .swatch:disabled {
    opacity: 0.5;
  }
  /* The feed's own swatch: a solid rim, dashed while its colour is automatic. */
  .feedswatch {
    width: 1.8rem;
    height: 1.8rem;
    border: 2px solid color-mix(in srgb, var(--ink) 35%, transparent);
  }
  .feedswatch.auto {
    border-style: dashed;
  }
  .feedswatch.open {
    outline: 3px solid var(--teal);
    outline-offset: 2px;
  }
  .palette {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0 0.2rem;
  }
  .swatch.custom {
    display: grid;
    place-items: center;
    cursor: pointer;
    border: 2px dashed rgba(255, 255, 255, 0.7);
  }
  .swatch.custom input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .autopick {
    padding: 0.4rem 0.8rem;
    border-radius: 999px;
    background: var(--card);
    color: var(--ink-soft);
    font-size: 0.85rem;
    font-weight: 600;
  }
  .autopick:disabled {
    opacity: 0.5;
  }
  .feed.off .feedwho {
    opacity: 0.5;
  }
  .feedwho {
    min-width: 0;
  }
  .feedname {
    display: block;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .feedurl {
    display: block;
    font-size: 0.78rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .drop {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .drop:active {
    transform: scale(0.92);
  }

  .add {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .in {
    flex: 1 1 12rem;
    min-width: 0;
    padding: 0.55rem 0.7rem;
    border: 1.5px solid var(--line);
    border-radius: 12px;
    background: var(--card);
    color: var(--ink);
    font-size: 0.95rem;
  }
  .in:focus {
    outline: none;
    border-color: var(--teal);
  }
</style>
