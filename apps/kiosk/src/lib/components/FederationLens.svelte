<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The lens editor for ONE federation intersection — what pops up when two
  // circles are dropped together or their overlap is tapped on the dock. It
  // shows exactly that pair (styled like the dock: the two orbs overlapping,
  // vesica between them) and only the per-lens flow settings, plus unlink.
  // Edits write `holon`'s native federation record and apply immediately;
  // `kiosk:federation-changed` tells the dock and the layout to refresh.
  import { createEventDispatcher, onDestroy, onMount } from "svelte";
  import {
    getFederationSnapshot,
    setFederationPartner,
    removeFederationPartner,
    applyLensMode,
    lensMode,
    type FederationLensMode,
  } from "@holons/core/federation";
  import type { HoloSphere } from "holosphere";
  import { getHolosphere } from "$lib/holosphere";
  import { holonColor, holonColors } from "$lib/palette";
  import { t, type MessageKey, type Translator } from "$lib/i18n";

  /** The board whose federation record is edited (the dragged/tapped one). */
  export let holon: string;
  /** The other side of the intersection. */
  export let partner: string;
  export let holonName = "";
  export let partnerName = "";

  const dispatch = createEventDispatcher();

  // Lenses the kiosk renders; already-configured other lenses (set up from
  // Telegram, say) are shown too so a save never drops them.
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
  let error = "";
  let busy = false;
  let cfg: { inbound: string[]; outbound: string[] } = {
    inbound: [],
    outbound: [],
  };
  let confirmUnlink = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  let alive = true;

  $: lenses = [
    ...KIOSK_LENSES,
    ...new Set(
      [...cfg.inbound, ...cfg.outbound].filter(
        (l) => !KIOSK_LENSES.includes(l),
      ),
    ),
  ];

  const nameA = () => holonName || holon;
  const nameB = () => partnerName || partner;
  const initialOf = (name: string) =>
    /[\p{L}\p{N}]/u.exec(name)?.[0]?.toUpperCase() ?? "·";

  function announceChanged() {
    window.dispatchEvent(new CustomEvent("kiosk:federation-changed"));
  }

  async function load() {
    try {
      hs = await getHolosphere();
      const snap = await getFederationSnapshot(hs, holon);
      if (!alive) return;
      if (snap.federated.includes(partner)) {
        cfg = {
          inbound: snap.lensConfig[partner]?.inbound ?? [],
          outbound: snap.lensConfig[partner]?.outbound ?? [],
        };
      } else {
        // A fresh drop: link with the kiosk default — receive-only, because a
        // display screen's purpose is showing the partner's boards; sending
        // is the explicit opt-in this popup exists for.
        cfg = { inbound: [...KIOSK_LENSES], outbound: [] };
        await setFederationPartner(hs, holon, partner, {
          ...cfg,
          partnerName: partnerName || undefined,
        });
        announceChanged();
      }
    } catch (err) {
      console.error("[kiosk] federation lens load failed", err);
      if (alive) error = $t("fed.loadError");
    } finally {
      if (alive) loading = false;
    }
  }

  async function setLens(lens: string, mode: FederationLensMode) {
    if (!hs || busy || lensMode(cfg, lens) === mode) return;
    const prev = cfg;
    cfg = applyLensMode(prev, lens, mode); // optimistic while the write lands
    busy = true;
    error = "";
    try {
      await setFederationPartner(hs, holon, partner, {
        ...cfg,
        partnerName: partnerName || undefined,
      });
      announceChanged();
    } catch (err) {
      console.error("[kiosk] federation lens update failed", err);
      cfg = prev;
      error = $t("fed.changeError");
    } finally {
      busy = false;
    }
  }

  function armUnlink() {
    confirmUnlink = true;
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => (confirmUnlink = false), 4000);
  }

  async function unlink() {
    if (!hs || busy) return;
    busy = true;
    try {
      await removeFederationPartner(hs, holon, partner);
      announceChanged();
      dispatch("unlinked"); // the intersection is gone — close the popup
    } catch (err) {
      console.error("[kiosk] unfederate failed", err);
      error = $t("fed.unlinkError");
      busy = false;
    }
  }

  function lensLabel(tr: Translator, lens: string): string {
    const key = LENS_LABEL_KEYS[lens];
    return key ? tr(key) : lens.charAt(0).toUpperCase() + lens.slice(1);
  }

  onMount(load);
  onDestroy(() => {
    alive = false;
    if (confirmTimer) clearTimeout(confirmTimer);
  });
</script>

<div class="lens-editor">
  <!-- The pair, drawn the way the dock draws it: two orbs overlapping 25%,
       their vesica between them — this popup edits that intersection. -->
  <div class="pair" aria-hidden="true">
    <span class="orb" style="--c: {holonColor(holon, $holonColors)}"
      >{initialOf(nameA())}</span
    >
    <span class="orb second" style="--c: {holonColor(partner, $holonColors)}"
      >{initialOf(nameB())}</span
    >
  </div>
  <div class="names">
    <span class="name">{nameA()}</span>
    <span class="join">⇆</span>
    <span class="name">{nameB()}</span>
  </div>
  <p class="hint">{$t("fed.pairHint", { a: nameA(), b: nameB() })}</p>

  {#if loading}
    <p class="hint">{$t("fed.loading")}</p>
  {:else}
    {#each lenses as lens (lens)}
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
              class:sel={lensMode(cfg, lens) === m.id}
              role="radio"
              aria-checked={lensMode(cfg, lens) === m.id}
              disabled={busy}
              on:click={() => setLens(lens, m.id)}
            >
              <span aria-hidden="true">{m.glyph}</span>
              {$t(m.labelKey)}
            </button>
          {/each}
        </div>
      </div>
    {/each}
    {#if error}<p class="err">{error}</p>{/if}
    {#if confirmUnlink}
      <button
        type="button"
        class="unlink confirm"
        disabled={busy}
        on:click={unlink}
      >
        {$t("fed.tapAgainUnlink")}
      </button>
    {:else}
      <button type="button" class="unlink" disabled={busy} on:click={armUnlink}>
        {$t("fed.unlink", { name: nameB() })}
      </button>
    {/if}
  {/if}
</div>

<style>
  .lens-editor {
    min-width: min(26rem, 82vw);
    text-transform: none;
    letter-spacing: 0;
    text-align: left;
  }

  .pair {
    display: flex;
    justify-content: center;
    margin-bottom: 0.35rem;
  }
  .orb {
    width: 3.6rem;
    height: 3.6rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 1.35rem;
    font-weight: 700;
    background: color-mix(in srgb, var(--c, var(--teal)) 62%, transparent);
    border: 3px solid color-mix(in srgb, var(--c, var(--teal)) 70%, var(--ink));
    color: var(--ink);
  }
  /* 25% overlap, like the constellation the popup was opened from. */
  .orb.second {
    margin-left: -0.9rem;
  }

  .names {
    display: flex;
    justify-content: center;
    align-items: baseline;
    gap: 0.45rem;
    font-weight: 700;
    color: var(--ink);
    font-size: 1.02rem;
  }
  .names .name {
    max-width: 10rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .names .join {
    color: var(--muted);
  }

  .hint {
    margin: 0.35rem 0 0.4rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--muted);
    text-align: center;
  }
  .err {
    margin: 0.4rem 0 0;
    font-size: 0.82rem;
    font-weight: 600;
    color: #9a3b2f;
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
    margin-top: 0.9rem;
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
</style>
