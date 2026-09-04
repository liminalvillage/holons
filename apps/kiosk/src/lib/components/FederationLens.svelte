<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The flow editor for ONE pair of holons — what pops up when two circles are
  // dropped together, when their overlap is tapped, or when a federated
  // hexagon is tapped on the earth.
  //
  // Two rules shape it:
  //   1. Opening it federates NOTHING. A drop is a question, not a link; the
  //      record is written the moment the caretaker opens the first flow, and
  //      removed again when the last one closes.
  //   2. Direction is drawn, not spelled. Each lens gets two arrows between
  //      the two holons — one each way — and tapping an arrow opens or closes
  //      that flow. The arrow carries its source holon's colour, so which way
  //      items travel is legible before a single word is read.
  //
  // Edits apply immediately; `kiosk:federation-changed` tells the dock and the
  // layout to refresh.
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
  /** The other side of the pair. */
  export let partner: string;
  export let holonName = "";
  export let partnerName = "";

  const dispatch = createEventDispatcher();

  /** Which way a flow runs, from `holon`'s point of view. */
  type Dir = "out" | "in";
  /**
   * The two halves of one arrow, left to right: the left lane brings items
   * INTO this holon (its head points back at it), the right lane sends them
   * on to the partner. Both lit, the row reads as one bidirectional arrow.
   */
  const LANES: readonly Dir[] = ["in", "out"];

  // Lenses the kiosk renders; already-configured other lenses (set up from
  // Telegram, say) are shown too so a save never drops them.
  const KIOSK_LENSES = ["quests", "library", "roles", "checklists"];
  const LENS_LABEL_KEYS: Record<string, MessageKey> = {
    quests: "tabs.tasks",
    library: "tabs.library",
    roles: "tabs.roles",
    checklists: "tabs.checklists",
  };

  let hs: HoloSphere | null = null;
  let loading = true;
  let error = "";
  let busy = false;
  /** True once this pair has a federation record — flows exist. */
  let linked = false;
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
  $: flowCount = cfg.inbound.length + cfg.outbound.length;
  // The rendered rows: every lens, led by the "All" master that opens or
  // closes a whole direction at once. `key` is the lens id (unused on the
  // master, which never touches a single lens).
  $: rows = [
    { key: "__all__", label: $t("fed.all"), master: true },
    ...lenses.map((lens) => ({
      key: lens,
      label: lensLabel($t, lens),
      master: false,
    })),
  ];
  $: allOn = {
    out: lenses.length > 0 && lenses.every((l) => cfg.outbound.includes(l)),
    in: lenses.length > 0 && lenses.every((l) => cfg.inbound.includes(l)),
  };
  $: someOn = {
    out: cfg.outbound.length > 0,
    in: cfg.inbound.length > 0,
  };

  const nameA = () => holonName || holon;
  const nameB = () => partnerName || partner;
  const initialOf = (name: string) =>
    /[\p{L}\p{N}]/u.exec(name)?.[0]?.toUpperCase() ?? "·";

  $: colorA = holonColor(holon, $holonColors);
  $: colorB = holonColor(partner, $holonColors);

  const isOn = (
    dirs: { inbound: string[]; outbound: string[] },
    lens: string,
    dir: Dir,
  ) => (dir === "out" ? dirs.outbound : dirs.inbound).includes(lens);

  /** Fold a pair of booleans back into the core's lens mode. */
  const modeOf = (inbound: boolean, outbound: boolean): FederationLensMode =>
    inbound && outbound
      ? "both"
      : inbound
        ? "receive"
        : outbound
          ? "send"
          : "off";

  function announceChanged() {
    window.dispatchEvent(new CustomEvent("kiosk:federation-changed"));
  }

  async function load() {
    try {
      hs = await getHolosphere();
      const snap = await getFederationSnapshot(hs, holon);
      if (!alive) return;
      // Read-only on open: a fresh pair stays unfederated until an arrow is
      // tapped. Nothing here writes.
      linked = snap.federated.includes(partner);
      if (linked)
        cfg = {
          inbound: snap.lensConfig[partner]?.inbound ?? [],
          outbound: snap.lensConfig[partner]?.outbound ?? [],
        };
    } catch (err) {
      console.error("[kiosk] federation lens load failed", err);
      if (alive) error = $t("fed.loadError");
    } finally {
      if (alive) loading = false;
    }
  }

  /**
   * Persist a whole directional config. An empty one means "no flows", which
   * is the same thing as unfederated: the record is removed, and the popup
   * stays open so the next tap can start over.
   */
  async function apply(next: { inbound: string[]; outbound: string[] }) {
    if (!hs || busy) return;
    const prevCfg = cfg;
    const prevLinked = linked;
    const empty = next.inbound.length === 0 && next.outbound.length === 0;
    cfg = next; // optimistic while the write lands
    linked = !empty;
    busy = true;
    error = "";
    try {
      if (empty) {
        if (prevLinked) {
          await removeFederationPartner(hs, holon, partner);
          announceChanged();
        }
      } else {
        await setFederationPartner(hs, holon, partner, {
          ...next,
          partnerName: partnerName || undefined,
        });
        announceChanged();
      }
    } catch (err) {
      console.error("[kiosk] federation flow update failed", err);
      cfg = prevCfg;
      linked = prevLinked;
      error = $t(
        empty
          ? "fed.unlinkError"
          : prevLinked
            ? "fed.changeError"
            : "fed.linkError",
      );
    } finally {
      busy = false;
    }
  }

  function toggle(lens: string, dir: Dir) {
    const inbound =
      dir === "in" ? !isOn(cfg, lens, "in") : isOn(cfg, lens, "in");
    const outbound =
      dir === "out" ? !isOn(cfg, lens, "out") : isOn(cfg, lens, "out");
    void apply(applyLensMode(cfg, lens, modeOf(inbound, outbound)));
  }

  /** The header arrows: open (or close) that direction on every lens at once. */
  function toggleAll(dir: Dir) {
    const turnOn = !allOn[dir];
    let next = cfg;
    for (const lens of lenses) {
      const inbound = dir === "in" ? turnOn : isOn(next, lens, "in");
      const outbound = dir === "out" ? turnOn : isOn(next, lens, "out");
      next = applyLensMode(next, lens, modeOf(inbound, outbound));
    }
    void apply(next);
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
      dispatch("unlinked"); // the pair is gone — close the popup
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

  const ariaFor = (tr: Translator, lens: string, dir: Dir) =>
    tr(dir === "out" ? "fed.sendAria" : "fed.receiveAria", {
      lens,
      a: nameA(),
      b: nameB(),
    });

  onMount(load);
  onDestroy(() => {
    alive = false;
    if (confirmTimer) clearTimeout(confirmTimer);
  });
</script>

<div class="lens-editor" style="--a: {colorA}; --b: {colorB}">
  <!-- The pair, drawn the way the dock draws it: two orbs overlapping 25%,
       their vesica between them — this popup edits what crosses it. -->
  <div class="pair" aria-hidden="true">
    <span class="orb" style="--c: {colorA}">{initialOf(nameA())}</span>
    <span class="orb second" style="--c: {colorB}">{initialOf(nameB())}</span>
  </div>
  <div class="names">
    <span class="name">{nameA()}</span>
    <span class="join" class:live={linked}>{linked ? "⇄" : "·"}</span>
    <span class="name">{nameB()}</span>
  </div>
  <p class="status" class:idle={!linked}>
    {linked ? $t("fed.flowsOpen", { n: flowCount }) : $t("fed.notLinked")}
  </p>

  {#if loading}
    <p class="hint">{$t("fed.loading")}</p>
  {:else}
    <!-- One row per lens, and the pair again in miniature: this holon's
         circle, the two arrows that cross between them, the partner's
         circle. The lens sits in the middle, between its own two arrows. -->
    {#each rows as r (r.key)}
      <div class="row" class:master={r.master}>
        <span class="mini" style="--c: {colorA}" aria-hidden="true"
          >{initialOf(nameA())}</span
        >
        <div class="mid">
          <span class="lens-name">{r.label}</span>
          <div class="flow">
            {#each LANES as dir (dir)}
              {@const on = r.master ? allOn[dir] : isOn(cfg, r.key, dir)}
              <button
                type="button"
                class="lane {dir}"
                class:on
                class:part={r.master && !on && someOn[dir]}
                aria-pressed={on}
                aria-label={ariaFor($t, r.label, dir)}
                disabled={busy}
                on:click={() =>
                  r.master ? toggleAll(dir) : toggle(r.key, dir)}
              >
                <span class="head-l"></span>
                <span class="line"></span>
                <span class="head-r"></span>
              </button>
            {/each}
          </div>
        </div>
        <span class="mini" style="--c: {colorB}" aria-hidden="true"
          >{initialOf(nameB())}</span
        >
      </div>
    {/each}

    <p class="hint">{$t("fed.arrowHint")}</p>
    {#if error}<p class="err">{error}</p>{/if}
    {#if linked}
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
        <button
          type="button"
          class="unlink"
          disabled={busy}
          on:click={armUnlink}
        >
          {$t("fed.unlink", { name: nameB() })}
        </button>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .lens-editor {
    min-width: min(24rem, 84vw);
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
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .names .join {
    color: var(--muted);
  }
  .names .join.live {
    color: var(--teal-deep);
  }

  .status {
    margin: 0.2rem 0 0.65rem;
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--teal-deep);
    text-align: center;
  }
  .status.idle {
    color: var(--muted);
  }
  .hint {
    margin: 0.7rem 0 0;
    font-size: 0.78rem;
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

  /* One row IS the pair in miniature: the two circles, and between them a
     single short arrow — the vesica of the dock, made tappable. Its left half
     brings items in, its right half sends them out; both lit, it is one
     bidirectional arrow. */
  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
    max-width: 15.5rem;
    margin: 0.45rem auto 0;
  }
  .row.master {
    padding-bottom: 0.5rem;
    border-bottom: 1.5px dashed var(--line);
  }
  .mini {
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 0.8rem;
    font-weight: 700;
    background: color-mix(in srgb, var(--c, var(--teal)) 55%, transparent);
    border: 2px solid color-mix(in srgb, var(--c, var(--teal)) 70%, var(--ink));
    color: var(--ink);
  }
  .row.master .mini {
    opacity: 0.7;
  }
  .mid {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .lens-name {
    text-align: center;
    font-size: 0.78rem;
    font-weight: 700;
    line-height: 1.15;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The arrow: one shaft, two tap halves. A head is faint until its way is
     open, then it lights up in the colour of the holon items leave from. */
  .flow {
    display: flex;
    align-items: center;
  }
  .lane {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.1rem;
    min-height: 32px;
    padding: 0;
    background: none;
    border: none;
    color: var(--muted);
    transition:
      transform 0.1s ease,
      color 0.15s ease;
  }
  .lane:active {
    transform: scale(0.96);
  }
  .lane:disabled {
    opacity: 0.6;
  }
  .lane .line {
    flex: 1;
    height: 0;
    border-top: 2px dashed currentColor;
    opacity: 0.45;
  }
  /* Each half draws only its own head, at the far end it points to. */
  .lane .head-l,
  .lane .head-r {
    width: 0;
    height: 0;
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
    opacity: 0.3;
  }
  .lane.in .head-r,
  .lane.out .head-l {
    display: none;
  }
  .lane.in .head-l {
    border-right: 8px solid currentColor;
  }
  .lane.out .head-r {
    border-left: 8px solid currentColor;
  }

  .lane.in.on {
    color: var(--b, var(--teal));
  }
  .lane.out.on {
    color: var(--a, var(--teal));
  }
  .lane.on .line {
    opacity: 1;
    border-top-style: solid;
    border-top-width: 3px;
  }
  .lane.on .head-l,
  .lane.on .head-r {
    opacity: 1;
  }
  /* The "All" arrow when only some lenses flow that way. */
  .lane.in.part {
    color: color-mix(in srgb, var(--b, var(--teal)) 55%, var(--muted));
  }
  .lane.out.part {
    color: color-mix(in srgb, var(--a, var(--teal)) 55%, var(--muted));
  }
  .lane.part .line {
    opacity: 0.75;
  }
  .lane.part .head-l,
  .lane.part .head-r {
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
</style>
