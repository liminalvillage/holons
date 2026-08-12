<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Federation management for the kiosk: link/unlink partner holons and set,
  // per lens, whether this holon receives their items, sends its own, or both.
  // Edits write the holosphere-native federation record (the one the kiosk's
  // federated reads and publishing honor) and apply immediately — network
  // writes to an eventually-consistent graph don't batch into the modal's
  // draft+Apply flow. After each change a `kiosk:federation-changed` event
  // tells the layout to re-fold partners into the live subscriptions.
  import { onDestroy, onMount } from "svelte";
  import {
    getFederationSnapshot,
    migrateLegacyFederationLinks,
    setFederationPartner,
    removeFederationPartner,
    applyLensMode,
    lensMode,
    type FederationLensMode,
  } from "@holons/core/federation";
  import type { HoloSphere } from "holosphere";
  import { getHolosphere, getHolonName } from "$lib/holosphere";
  import { holonId, partnerNames } from "$lib/stores";
  import { t, type MessageKey, type Translator } from "$lib/i18n";

  type PartnerRow = {
    id: string;
    name: string;
    inbound: string[];
    outbound: string[];
  };

  // Lenses the kiosk renders; a partner's already-configured other lenses
  // (e.g. set up from Telegram) are shown too so a save never drops them.
  const KIOSK_LENSES = ["quests", "library", "roles", "checklists"];
  const LENS_LABEL_KEYS: Record<string, MessageKey> = {
    quests: "tabs.tasks",
    library: "tabs.library",
    roles: "tabs.roles",
    checklists: "tabs.checklists",
  };
  const MODES: {
    id: FederationLensMode;
    labelKey: MessageKey;
    glyph: string;
  }[] = [
    { id: "off", labelKey: "fed.off", glyph: "·" },
    { id: "receive", labelKey: "fed.receive", glyph: "↓" },
    { id: "send", labelKey: "fed.send", glyph: "↑" },
    { id: "both", labelKey: "fed.both", glyph: "⇅" },
  ];

  let hs: HoloSphere | null = null;
  let loading = true;
  let loadError = "";
  let rows: PartnerRow[] = [];
  let expanded: string | null = null;
  let busy: Record<string, boolean> = {};
  let rowError: Record<string, string> = {};
  let addId = "";
  let addBusy = false;
  let addError = "";
  let confirmRemove: string | null = null;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  let alive = true;

  function lensesFor(row: PartnerRow): string[] {
    const extra = [...row.inbound, ...row.outbound].filter(
      (l) => !KIOSK_LENSES.includes(l),
    );
    return [...KIOSK_LENSES, ...new Set(extra)];
  }

  function lensLabel(tr: Translator, lens: string): string {
    const key = LENS_LABEL_KEYS[lens];
    return key ? tr(key) : lens.charAt(0).toUpperCase() + lens.slice(1);
  }

  function mergePartnerNames(named: PartnerRow[]) {
    const entries = named.filter((r) => r.name);
    if (!entries.length) return;
    partnerNames.update((cur) => {
      const next = { ...cur };
      for (const r of entries) next[r.id] = r.name;
      return next;
    });
  }

  async function load() {
    const holon = $holonId;
    if (!holon) {
      loading = false;
      return;
    }
    try {
      hs = hs ?? (await getHolosphere());
      // Fold any pre-unification settings-lens links into the native record
      // before reading it (one-shot; cheap no-op afterwards).
      await migrateLegacyFederationLinks(hs, holon).catch(() => {});
      const snap = await getFederationSnapshot(hs, holon);
      if (!alive) return;
      rows = snap.federated.map((id) => ({
        id,
        name: snap.partnerNames[id] ?? "",
        inbound: snap.lensConfig[id]?.inbound ?? [],
        outbound: snap.lensConfig[id]?.outbound ?? [],
      }));
      loadError = "";
      mergePartnerNames(rows);
      // Best-effort name fill for partners the record doesn't name yet.
      for (const row of rows.filter((r) => !r.name)) {
        getHolonName(hs, row.id).then((name) => {
          if (!alive || !name) return;
          rows = rows.map((r) => (r.id === row.id ? { ...r, name } : r));
          mergePartnerNames([{ ...row, name }]);
        });
      }
    } catch (err) {
      console.error("[kiosk] federation load failed", err);
      if (alive) loadError = $t("fed.loadError");
    } finally {
      if (alive) loading = false;
    }
  }

  function announceChanged() {
    window.dispatchEvent(new CustomEvent("kiosk:federation-changed"));
  }

  async function setLens(
    row: PartnerRow,
    lens: string,
    mode: FederationLensMode,
  ) {
    const holon = $holonId;
    if (!hs || !holon || busy[row.id]) return;
    if (lensMode(row, lens) === mode) return;
    const prev = { inbound: row.inbound, outbound: row.outbound };
    const next = applyLensMode(prev, lens, mode);
    // Optimistic: show the new mode while the write settles.
    rows = rows.map((r) => (r.id === row.id ? { ...r, ...next } : r));
    busy = { ...busy, [row.id]: true };
    rowError = { ...rowError, [row.id]: "" };
    try {
      await setFederationPartner(hs, holon, row.id, {
        ...next,
        partnerName: row.name || undefined,
      });
      announceChanged();
    } catch (err) {
      console.error("[kiosk] federation lens update failed", err);
      rows = rows.map((r) => (r.id === row.id ? { ...r, ...prev } : r));
      rowError = { ...rowError, [row.id]: $t("fed.changeError") };
    } finally {
      busy = { ...busy, [row.id]: false };
    }
  }

  function toggleExpand(id: string) {
    expanded = expanded === id ? null : id;
    confirmRemove = null;
  }

  function armRemove(id: string) {
    confirmRemove = id;
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => (confirmRemove = null), 4000);
  }

  async function unlink(row: PartnerRow) {
    const holon = $holonId;
    if (!hs || !holon || busy[row.id]) return;
    confirmRemove = null;
    busy = { ...busy, [row.id]: true };
    try {
      await removeFederationPartner(hs, holon, row.id);
      rows = rows.filter((r) => r.id !== row.id);
      if (expanded === row.id) expanded = null;
      partnerNames.update((cur) => {
        const next = { ...cur };
        delete next[row.id];
        return next;
      });
      announceChanged();
    } catch (err) {
      console.error("[kiosk] unfederate failed", err);
      rowError = { ...rowError, [row.id]: $t("fed.unlinkError") };
    } finally {
      busy = { ...busy, [row.id]: false };
    }
  }

  async function addPartner() {
    const holon = $holonId;
    const target = addId.trim();
    addError = "";
    if (!hs || !holon || addBusy) return;
    if (!target) return;
    if (target === holon) {
      addError = $t("fed.selfLink");
      return;
    }
    const existing = rows.find((r) => r.id === target);
    if (existing) {
      expanded = existing.id;
      addId = "";
      return;
    }
    addBusy = true;
    try {
      // New partners start receive-only on the kiosk lenses: a display screen's
      // purpose is showing the partner's boards; sending is an explicit opt-in.
      await setFederationPartner(hs, holon, target, {
        inbound: [...KIOSK_LENSES],
        outbound: [],
      });
      addId = "";
      await load();
      expanded = target;
      announceChanged();
      // Resolve the partner's display name and record it (best-effort).
      getHolonName(hs, target).then((name) => {
        if (!alive || !name || !hs) return;
        const row = rows.find((r) => r.id === target);
        if (!row) return;
        setFederationPartner(hs, holon, target, {
          inbound: row.inbound,
          outbound: row.outbound,
          partnerName: name,
        }).catch(() => {});
        rows = rows.map((r) => (r.id === target ? { ...r, name } : r));
        mergePartnerNames([{ ...row, name }]);
      });
    } catch (err) {
      console.error("[kiosk] federate failed", err);
      addError = $t("fed.linkError");
    } finally {
      addBusy = false;
    }
  }

  onMount(load);
  onDestroy(() => {
    alive = false;
    if (confirmTimer) clearTimeout(confirmTimer);
  });
</script>

<div class="federation">
  {#if loading}
    <p class="hint">{$t("fed.loading")}</p>
  {:else if loadError}
    <p class="err">{loadError}</p>
  {:else if rows.length === 0}
    <p class="hint">{$t("fed.none")}</p>
  {/if}

  {#each rows as row (row.id)}
    <div class="partner" class:busy={busy[row.id]}>
      <button
        type="button"
        class="partner-head"
        aria-expanded={expanded === row.id}
        on:click={() => toggleExpand(row.id)}
      >
        <span class="partner-id">
          <span class="partner-name">{row.name || row.id}</span>
          {#if row.name}<span class="sub">{row.id}</span>{/if}
        </span>
        <span
          class="chevron"
          class:open={expanded === row.id}
          aria-hidden="true">›</span
        >
      </button>

      {#if expanded === row.id}
        <div class="lenses">
          <p class="hint">{$t("fed.hint")}</p>
          {#each lensesFor(row) as lens (lens)}
            <div class="lens-row">
              <span class="lens-name">{lensLabel($t, lens)}</span>
              <div
                class="mode-row"
                role="radiogroup"
                aria-label={$t("fed.lensAria", { lens: lensLabel($t, lens) })}
              >
                {#each MODES as m (m.id)}
                  <button
                    type="button"
                    class="mode-opt"
                    class:sel={lensMode(row, lens) === m.id}
                    role="radio"
                    aria-checked={lensMode(row, lens) === m.id}
                    disabled={busy[row.id]}
                    on:click={() => setLens(row, lens, m.id)}
                  >
                    <span aria-hidden="true">{m.glyph}</span>
                    {$t(m.labelKey)}
                  </button>
                {/each}
              </div>
            </div>
          {/each}
          {#if rowError[row.id]}<p class="err">{rowError[row.id]}</p>{/if}
          {#if confirmRemove === row.id}
            <button
              type="button"
              class="unlink confirm"
              disabled={busy[row.id]}
              on:click={() => unlink(row)}
            >
              {$t("fed.tapAgainUnlink")}
            </button>
          {:else}
            <button
              type="button"
              class="unlink"
              disabled={busy[row.id]}
              on:click={() => armRemove(row.id)}
            >
              {$t("fed.unlink", { name: row.name || row.id })}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  <div class="add-row">
    <input
      type="text"
      bind:value={addId}
      placeholder={$t("settings.holonPlaceholder")}
      inputmode="numeric"
      disabled={addBusy}
      on:keydown={(e) => e.key === "Enter" && addPartner()}
    />
    <button
      type="button"
      class="link-btn"
      disabled={addBusy || !addId.trim()}
      on:click={addPartner}
    >
      {addBusy ? $t("fed.linking") : $t("fed.link")}
    </button>
  </div>
  {#if addError}<p class="err">{addError}</p>{/if}
</div>

<style>
  .federation {
    margin-top: 0.45rem;
    text-transform: none;
    letter-spacing: 0;
    text-align: left;
  }
  .hint {
    margin: 0.2rem 0 0.4rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--muted);
  }
  .err {
    margin: 0.4rem 0 0;
    font-size: 0.82rem;
    font-weight: 600;
    color: #9a3b2f;
  }

  .partner {
    border: 1.5px solid var(--line);
    border-radius: 12px;
    background: var(--card);
    margin-bottom: 0.5rem;
    overflow: hidden;
  }
  .partner.busy {
    opacity: 0.75;
  }
  .partner-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    width: 100%;
    min-height: 52px;
    padding: 0.6rem 0.8rem;
    text-align: left;
  }
  .partner-id {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .partner-name {
    font-size: 0.98rem;
    font-weight: 700;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--muted);
  }
  .chevron {
    flex: 0 0 auto;
    font-size: 1.4rem;
    line-height: 1;
    color: var(--muted);
    transition: transform 0.15s ease;
  }
  .chevron.open {
    transform: rotate(90deg);
  }

  .lenses {
    padding: 0 0.8rem 0.8rem;
    border-top: 1.5px solid var(--line);
  }
  .lens-row {
    margin-top: 0.6rem;
  }
  .lens-name {
    display: block;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ink-soft);
    margin-bottom: 0.3rem;
  }
  .mode-row {
    display: flex;
    gap: 0.4rem;
  }
  .mode-opt {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    min-height: 44px;
    padding: 0.4rem 0.3rem;
    border-radius: 10px;
    background: var(--paper);
    border: 1.5px solid var(--line);
    color: var(--ink-soft);
    font-size: 0.8rem;
    font-weight: 700;
    transition: transform 0.1s ease;
  }
  .mode-opt:active {
    transform: scale(0.96);
  }
  .mode-opt.sel {
    border-color: var(--teal);
    color: var(--teal-deep);
  }
  .mode-opt:disabled {
    opacity: 0.6;
  }

  .unlink {
    margin-top: 0.8rem;
    width: 100%;
    min-height: 46px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.5);
    color: #9a3b2f;
    font-size: 0.9rem;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 0.8rem;
  }
  .unlink.confirm {
    background: #9a3b2f;
    color: #fff;
  }

  .add-row {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.6rem;
  }
  .add-row input {
    flex: 1;
    min-width: 0;
    padding: 0.7rem 0.8rem;
    font-size: 1rem;
    font-family: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
  }
  .add-row input:focus {
    outline: none;
    border-color: var(--teal);
  }
  .link-btn {
    flex: 0 0 auto;
    min-width: 5.5rem;
    min-height: 52px;
    border-radius: 12px;
    background: var(--teal);
    color: #fff;
    font-size: 0.95rem;
    font-weight: 700;
    box-shadow: var(--shadow-soft);
    transition: transform 0.1s ease;
  }
  .link-btn:active {
    transform: scale(0.97);
  }
  .link-btn:disabled {
    opacity: 0.55;
    box-shadow: none;
  }
</style>
