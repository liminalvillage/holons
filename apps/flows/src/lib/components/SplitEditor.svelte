<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Money out, as an editor: how a holon divides what reaches it. How much it
  // keeps, and who the rest goes to — projects and people placed on rings, an
  // inner ring weighing more than the one outside it. The split page and the
  // popup on the flow both show this.
  //
  // Every figure on screen is core's (`previewDraft`, the same `allocate`
  // the cut pays by), recomputed on each touch; nothing is stored until the
  // changes have been read back and confirmed. Only a steward's save counts
  // — anyone else sees the same screen without the controls.
  //
  // A change is a PROPOSAL to the holon's admins (core's `split-proposals`):
  // it applies once more than half of them said yes — at once, with one
  // admin. Open proposals are listed here; "see it" lays one over the draft,
  // so its numbers (and the scene behind) show what it would do.
  //
  // What it would pay is also handed out as it changes (`onPreview`), so the
  // navigator behind the popup can draw the draft while the sliders move.
  import {
    addRecipient,
    draftChanges,
    draftWithSave,
    previewDraft,
    removeRecipient,
    seatableParty,
    setKeep,
    setRing,
    setRingCount,
    setResourced,
    setSteepness,
    MAX_SPLIT_RINGS,
    splitQuorum,
    type SplitChange,
    type SplitDraft,
    type SplitPreview,
    type SplitProposal,
    type SplitProposalsContext,
    type SplitRecipient,
  } from "@holons/core/flows";
  import { isHolonId } from "@holons/core/protocol";
  import { createEventDispatcher, onDestroy } from "svelte";
  import BottomSheet from "./BottomSheet.svelte";
  import Icon from "./Icon.svelte";
  import KindChip from "./KindChip.svelte";
  import { canSteer } from "$lib/account";
  import { currentUser } from "$lib/auth";
  import { index } from "$lib/graph";
  import { t, pctOf } from "$lib/i18n";
  import { showNotice } from "$lib/notice";
  import { potFinder } from "$lib/discover";
  import type { HolonSearchHit } from "@holons/core/holosphere";
  import { sessionKeyPub } from "$lib/sessionKey";
  import {
    decide,
    loadSplit,
    propose,
    readProposals,
    withdraw,
  } from "$lib/split";

  /** The holon whose split this is. */
  export let holon: string;
  /** The draft as it would pay, against the split as stored; null when gone. */
  export let onPreview: (
    p: { before: SplitPreview; now: SplitPreview } | null,
  ) => void = () => {};

  const dispatch = createEventDispatcher<{ saved: void }>();

  let before: SplitDraft | null = null;
  let draft: SplitDraft | null = null;
  let steer = false;
  let ctx: SplitProposalsContext | null = null;
  /** The proposal laid over the draft, to see it. */
  let seeing: string | null = null;
  let note = "";
  let state: "loading" | "ready" | "unreadable" = "loading";
  const READ_MS = 15_000;
  let readFor = "";

  async function read(id: string) {
    state = "loading";
    // Relays that never answer must not leave the page on "Reading…".
    const late = new Promise<null>((r) => setTimeout(() => r(null), READ_MS));
    const all = await Promise.race([
      Promise.all([loadSplit(id), canSteer(id), readProposals(id)]),
      late,
    ]);
    if (id !== holon) return;
    if (!all) {
      state = "unreadable";
      return;
    }
    const [loaded, mayEdit, props] = all;
    before = loaded;
    draft = loaded;
    steer = mayEdit;
    ctx = props;
    seeing = null;
    state = loaded ? "ready" : "unreadable";
  }
  // Read again when the account changes: signing in may make this editable.
  $: {
    const key = `${holon}:${$currentUser?.id ?? ""}`;
    if (holon && key !== readFor) {
      readFor = key;
      void read(holon);
    }
  }

  $: preview = draft ? previewDraft(draft) : null;
  $: stored = before ? previewDraft(before) : null;
  $: onPreview(stored && preview ? { before: stored, now: preview } : null);
  onDestroy(() => onPreview(null));
  $: changes = before && draft ? draftChanges(before, draft) : [];
  $: byRing = (ring: number) =>
    (preview?.rows ?? []).filter((r) => r.ring === ring);
  $: ringShare = (ring: number) =>
    preview?.rings.find((r) => r.ring === ring)?.percentage ?? 0;

  /** Open the "add" sheet once the split has been read (`?add=1`). */
  export let adding = false;
  let query = "";
  $: q = query.trim().toLowerCase();
  $: candidates = (draft?.candidates ?? []).filter((c) =>
    c.name.toLowerCase().includes(q),
  );
  // Anyone on the map can be seated, not only partners already linked: the
  // link is made when the split applies.
  $: known = new Set([
    holon,
    ...(draft?.recipients ?? []).map((r) => r.id),
    ...(draft?.candidates ?? []).map((r) => r.id),
  ]);
  $: onMap =
    q.length < 2 || !$index
      ? []
      : $index.graph.nodes
          .filter(
            (n) =>
              (n.kind === "fund" ||
                n.kind === "project" ||
                n.kind === "person") &&
              !known.has(n.id) &&
              n.label.toLowerCase().includes(q),
          )
          .slice(0, 20)
          .map(
            (n): SplitRecipient => ({
              id: n.id,
              name: n.label,
              kind: n.kind === "person" ? "person" : "holon",
              ring: 0,
              federated: true,
            }),
          );
  // A link, a key, a Telegram id or a minted holon id, typed or pasted.
  $: typed = (() => {
    const p = seatableParty(query);
    if (!p || known.has(p.id) || onMap.some((n) => n.id === p.id)) return null;
    const certain =
      p.kind === "person" ||
      isHolonId(p.id) ||
      /\/(h|p)\//.test(query) ||
      !!$index?.byId.has(p.id);
    if (!certain) return null;
    const label = $index?.byId.get(p.id)?.label;
    return {
      id: p.id,
      name: label && label !== p.id ? label : p.id,
      kind: p.kind,
      ring: 0,
      federated: true,
    } satisfies SplitRecipient;
  })();
  // Pots on the network the map does not reach: found by name in the registry.
  let network: HolonSearchHit[] = [];
  const find = potFinder((hits) => (network = hits));
  $: find(adding ? query : "");
  $: onNetwork = network
    .filter(
      (h) =>
        !known.has(h.id) &&
        !onMap.some((n) => n.id === h.id) &&
        typed?.id !== h.id,
    )
    .map(
      (h): SplitRecipient => ({
        id: h.id,
        name: h.name,
        kind: "holon",
        ring: 0,
        federated: true,
      }),
    );
  $: offered = [
    ...candidates,
    ...onMap,
    ...onNetwork,
    ...(typed ? [typed] : []),
  ];
  let reviewing = false;
  let saving = false;
  let error = "";

  const edit = (next: SplitDraft) => {
    if (steer) draft = next;
  };
  const kindOf = (r: SplitRecipient) =>
    $index?.byId.get(r.id)?.kind ??
    (r.kind === "person" ? "person" : "project");

  const describe = (c: SplitChange): string => {
    switch (c.kind) {
      case "keep":
        return $t("split.change.keep", { from: c.from, to: c.to });
      case "rings":
        return $t("split.change.rings", { from: c.from, to: c.to });
      case "steepness":
        return $t("split.change.slope", { from: c.from, to: c.to });
      case "resourced":
        return $t("split.change.resourced", { from: c.from, to: c.to });
      case "added":
        return $t("split.change.added", { name: c.name, ring: c.ring });
      case "moved":
        return $t("split.change.moved", {
          name: c.name,
          from: c.from,
          to: c.to,
        });
      case "removed":
        return $t("split.change.removed", { name: c.name });
    }
  };

  // ── Proposals ──
  $: admins = Math.max(1, ctx?.admins ?? 1);
  $: me = ($sessionKeyPub ?? "").toLowerCase();
  const said = (p: SplitProposal) =>
    p.yes.includes(me) ? "yes" : p.no.includes(me) ? "no" : null;
  const isStale = (p: SplitProposal) => !!ctx?.stale.includes(p.id);
  function see(p: SplitProposal) {
    if (!before) return;
    if (seeing === p.id) {
      seeing = null;
      draft = before;
      return;
    }
    seeing = p.id;
    draft = draftWithSave(before, p.split);
  }
  let busy = "";
  async function word(p: SplitProposal, verdict: "attest" | "dispute") {
    let reason: string | undefined;
    if (verdict === "dispute") {
      reason = prompt($t("split.proposal.why")) ?? undefined;
      if (reason === undefined) return;
    }
    busy = p.id;
    try {
      const after = await decide(holon, p.id, verdict, reason);
      if (after?.status === "applied") {
        showNotice($t("split.saved"));
        dispatch("saved");
      }
      await read(holon);
    } catch {
      showNotice($t("claim.failed"));
    } finally {
      busy = "";
    }
  }
  async function takeBack(p: SplitProposal) {
    busy = p.id;
    try {
      await withdraw(holon, p.id);
      await read(holon);
    } finally {
      busy = "";
    }
  }

  async function save() {
    if (!draft) return;
    saving = true;
    error = "";
    try {
      const p = await propose(holon, draft, note.trim() || undefined);
      reviewing = false;
      note = "";
      if (p?.status === "applied") {
        before = draft;
        showNotice($t("split.saved"));
        dispatch("saved");
      } else {
        showNotice(
          $t("split.proposal.sent", {
            n: Math.max(1, (p?.needed ?? 1) - (p?.yes.length ?? 0)),
          }),
        );
        await read(holon);
      }
    } catch (err) {
      error = /locked/i.test((err as Error)?.message ?? "")
        ? $t("split.lockedError")
        : $t("claim.failed");
    } finally {
      saving = false;
    }
  }
</script>

{#if state === "loading"}
  <p class="muted">{$t("fund.reading")}</p>
{:else if state === "unreadable" || !draft || !preview}
  <p class="notice warn">
    {$t("split.unreadable")}
    <button class="btn quiet small" on:click={() => void read(holon)}
      >{$t("common.retry")}</button
    >
  </p>
{:else}
  {#if !steer}
    <p class="notice">
      {$currentUser ? $t("split.notSteward") : $t("split.signIn")}
    </p>
  {/if}
  {#if admins > 1}
    <p class="rule muted">
      {$t("split.rule.many", { n: splitQuorum(admins), of: admins })}
    </p>
  {:else if steer}
    <p class="rule muted">{$t("split.rule.one")}</p>
  {/if}

  {#if ctx?.open.length}
    <section class="props" aria-label={$t("split.proposal.title")}>
      <h2 class="section-title">
        {$t("split.proposal.title")} · {ctx.open.length}
      </h2>
      <ul>
        {#each ctx.open as p (p.id)}
          <li class:on={seeing === p.id}>
            <div class="ptop">
              <b
                >{$t("split.proposal.votes", {
                  yes: p.yes.length,
                  n: p.needed,
                })}</b
              >
              {#if p.no.length}<span class="no"
                  >{$t("split.proposal.noes", { n: p.no.length })}</span
                >{/if}
              {#if isStale(p)}<span class="stale"
                  >{$t("split.proposal.stale")}</span
                >{:else if p.status === "passed"}<span class="ok"
                  >{$t("split.proposal.passed")}</span
                >{/if}
            </div>
            {#if p.note}<p class="pnote">{p.note}</p>{/if}
            {#each Object.values(p.reasons) as r}<p class="pnote why">
                “{r}”
              </p>{/each}
            <div class="pacts">
              <button class="btn quiet" on:click={() => see(p)}
                >{seeing === p.id
                  ? $t("split.proposal.unsee")
                  : $t("split.proposal.see")}</button
              >
              {#if steer && !isStale(p) && p.status === "pending" && said(p) !== "yes"}
                <button
                  class="btn"
                  disabled={busy === p.id}
                  on:click={() => word(p, "attest")}
                  ><Icon name="check" />{$t("split.proposal.yes")}</button
                >
              {/if}
              {#if steer && !isStale(p) && p.status === "pending" && said(p) !== "no" && p.pubkey !== me}
                <button
                  class="btn quiet"
                  disabled={busy === p.id}
                  on:click={() => word(p, "dispute")}
                  >{$t("split.proposal.no")}</button
                >
              {/if}
              {#if p.pubkey === me}
                <button
                  class="btn quiet"
                  disabled={busy === p.id}
                  on:click={() => takeBack(p)}
                  >{$t("split.proposal.withdraw")}</button
                >
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <div
    class="bar"
    role="img"
    aria-label={$t("split.barLabel", {
      keep: $pctOf(preview.keep + preview.unplaced),
      out: $pctOf(preview.passed),
    })}
  >
    {#if preview.keep + preview.unplaced > 0}
      <span class="seg keep" style="flex:{preview.keep + preview.unplaced}"
      ></span>
    {/if}
    {#each preview.rings as ring (ring.ring)}
      {#if ring.percentage > 0}
        <span
          class="seg"
          style="flex:{ring.percentage};opacity:{1 - (ring.ring - 1) * 0.16}"
        ></span>
      {/if}
    {/each}
  </div>
  <p class="legend">
    <span
      ><i class="dot keep"></i>{$t("split.kept")}
      {$pctOf(preview.keep + preview.unplaced)}</span
    >
    <span
      ><i class="dot"></i>{$t("split.passedOn")} {$pctOf(preview.passed)}</span
    >
  </p>
  {#if preview.unplaced > 0.005}
    <p class="notice warn">
      {$t("split.unplaced", { pct: $pctOf(preview.unplaced) })}
    </p>
  {/if}

  <section class="card knobs">
    <label class="knob">
      <span class="k">{$t("split.keepLabel")}<b>{draft.keep}%</b></span>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={draft.keep}
        disabled={!steer || draft.locked}
        on:input={(e) => edit(setKeep(draft!, Number(e.currentTarget.value)))}
      />
      {#if draft.locked}
        <small>{$t("split.keepLocked")}</small>
      {/if}
    </label>

    <div class="knob">
      <span class="k">{$t("split.rings")}<b>{draft.nzones}</b></span>
      <div class="stepper">
        <button
          aria-label={$t("split.fewerRings")}
          disabled={!steer || draft.nzones <= 1}
          on:click={() => edit(setRingCount(draft!, draft!.nzones - 1))}
          ><Icon name="minus" /></button
        >
        <button
          aria-label={$t("split.moreRings")}
          disabled={!steer || draft.nzones >= MAX_SPLIT_RINGS}
          on:click={() => edit(setRingCount(draft!, draft!.nzones + 1))}
          ><Icon name="plus" /></button
        >
      </div>
    </div>

    {#if draft.nzones > 1}
      <label class="knob">
        <span class="k">{$t("split.slope")}<b>{draft.steepness}</b></span>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={draft.steepness}
          disabled={!steer}
          on:input={(e) =>
            edit(setSteepness(draft!, Number(e.currentTarget.value)))}
        />
        <small>{$t("split.slopeHint")}</small>
      </label>
    {/if}

    <label class="knob">
      <span class="k">{$t("split.resourced")}<b>{draft.resourced}%</b></span>
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        value={draft.resourced}
        disabled={!steer}
        on:input={(e) =>
          edit(setResourced(draft!, Number(e.currentTarget.value)))}
      />
      <small>{$t("split.resourcedHint")}</small>
    </label>
  </section>

  {#each Array.from({ length: draft.nzones }, (_, i) => i + 1) as ring (ring)}
    {@const rows = byRing(ring)}
    <h2 class="section-title">
      {$t("split.ring", { n: ring })} · {$pctOf(ringShare(ring))}
    </h2>
    {#if rows.length}
      <ul class="rows">
        {#each rows as r (r.id)}
          <li>
            <span class="who">
              <b>{r.name}</b>
              <span class="meta">
                <KindChip kind={kindOf(r)} />
                {#if !r.federated}
                  <i class="flag">{$t("split.notLinked")}</i>
                {/if}
              </span>
            </span>
            <span class="n">{$pctOf(r.percentage)}</span>
            {#if steer}
              <span class="move">
                <button
                  aria-label={$t("split.moveIn", { name: r.name })}
                  disabled={ring <= 1}
                  on:click={() => edit(setRing(draft!, r.id, ring - 1))}
                  ><Icon name="minus" /></button
                >
                <button
                  aria-label={$t("split.moveOut", { name: r.name })}
                  disabled={ring >= draft.nzones}
                  on:click={() => edit(setRing(draft!, r.id, ring + 1))}
                  ><Icon name="plus" /></button
                >
                <button
                  class="x"
                  aria-label={$t("split.remove", { name: r.name })}
                  on:click={() => edit(removeRecipient(draft!, r.id))}
                  ><Icon name="close" /></button
                >
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted empty">{$t("split.ringEmpty")}</p>
    {/if}
  {/each}

  {#if steer}
    <button class="btn quiet wide add" on:click={() => (adding = true)}
      ><Icon name="plus" />{$t("split.add")}</button
    >
    <div class="save">
      <button
        class="btn wide"
        disabled={!changes.length}
        on:click={() => (reviewing = true)}
      >
        {changes.length
          ? $t("split.review", { n: changes.length })
          : $t("split.noChanges")}
      </button>
    </div>
  {/if}
{/if}

{#if adding && draft}
  <BottomSheet title={$t("split.add")} on:close={() => (adding = false)}>
    <p class="muted">{$t("split.addLead")}</p>
    <label class="sr-only" for="find-recipient">{$t("nav.search")}</label>
    <input
      id="find-recipient"
      class="text"
      bind:value={query}
      placeholder={$t("nav.search")}
      autocomplete="off"
    />
    {#if offered.length}
      <ul class="rows sheet-rows">
        {#each offered.slice(0, 60) as c (c.id)}
          <li>
            <button
              class="cand"
              on:click={() => {
                edit(addRecipient(draft!, c));
                adding = false;
                query = "";
              }}
            >
              <span class="who">
                <b>{c.name}</b>
                <span class="meta"
                  ><KindChip
                    kind={kindOf(c)}
                  />{#if onNetwork.some((n) => n.id === c.id)}<i class="netid"
                      >{c.id}</i
                    >{/if}</span
                >
              </span>
              <Icon name="plus" />
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted empty">
        {q ? $t("split.noMatch") : $t("split.noCandidates")}
      </p>
    {/if}
  </BottomSheet>
{/if}

{#if reviewing}
  <BottomSheet
    title={$t("split.reviewTitle")}
    on:close={() => (reviewing = false)}
  >
    <ul class="changes">
      {#each changes as c, i (i)}
        <li>{describe(c)}</li>
      {/each}
    </ul>
    {#if admins > 1}
      <label class="field">
        <span class="muted small-print">{$t("split.proposal.note")}</span>
        <textarea class="text" rows="2" maxlength="500" bind:value={note}
        ></textarea>
      </label>
      <p class="muted small-print">
        {$t("split.proposal.lead", {
          n: splitQuorum(admins),
          of: admins,
        })}
      </p>
    {:else}
      <p class="muted small-print">{$t("split.takesEffect")}</p>
    {/if}
    {#if error}<p class="notice warn" role="alert">{error}</p>{/if}
    <div class="row">
      <button
        class="btn quiet"
        on:click={() => (reviewing = false)}
        disabled={saving}>{$t("nav.back")}</button
      >
      <button class="btn grow" on:click={save} disabled={saving}
        >{saving
          ? $t("split.saving")
          : admins > 1
            ? $t("split.proposal.send")
            : $t("split.save")}</button
      >
    </div>
  </BottomSheet>
{/if}

<style>
  .netid {
    margin-left: 8px;
    font-style: normal;
    font-size: 0.74rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .bar {
    display: flex;
    height: 22px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--line);
    margin-top: 12px;
  }
  .seg {
    background: var(--teal);
    min-width: 2px;
  }
  .seg + .seg {
    border-left: 2px solid var(--card);
  }
  .seg.keep,
  .dot.keep {
    background: var(--kind-person, var(--ink-soft));
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 18px;
    margin: 8px 0 4px;
    font-size: 0.88rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 6px;
    background: var(--teal);
  }
  .knobs {
    display: grid;
    gap: 16px;
    margin-top: 12px;
  }
  .knob {
    display: grid;
    gap: 6px;
  }
  .k {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-weight: 600;
  }
  .k b {
    font-variant-numeric: tabular-nums;
  }
  .knob small {
    font-size: 0.8rem;
    color: var(--muted);
  }
  input[type="range"] {
    width: 100%;
    height: 44px;
    accent-color: var(--teal);
  }
  .stepper,
  .move {
    display: inline-flex;
    gap: 6px;
  }
  .stepper button,
  .move button {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
    color: var(--ink);
    background: var(--card);
  }
  .stepper button:disabled,
  .move button:disabled {
    opacity: 0.35;
  }
  .move .x {
    border-color: transparent;
    color: var(--muted);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 60px;
    padding: 8px 8px 8px 14px;
  }
  .rows li + li {
    border-top: 1px solid var(--line);
  }
  .who {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
  }
  .who b {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .flag {
    font-style: normal;
    font-size: 0.74rem;
    font-weight: 700;
    color: var(--caution);
  }
  .n {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .empty {
    font-size: 0.9rem;
    padding: 4px 2px;
  }
  .wide {
    width: 100%;
  }
  .add {
    margin-top: 18px;
  }
  .save {
    position: sticky;
    bottom: var(
      --split-save-bottom,
      calc(var(--nav-h) + env(safe-area-inset-bottom) + 10px)
    );
    margin-top: 12px;
    z-index: 5;
  }
  .text {
    width: 100%;
    min-height: var(--tap);
    margin: 10px 0;
    padding: 0 14px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }
  .sheet-rows li {
    padding: 0;
  }
  .cand {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 60px;
    padding: 8px 14px;
    font: inherit;
    color: var(--ink);
  }
  .changes {
    margin: 0;
    padding-left: 20px;
    display: grid;
    gap: 6px;
  }
  .rule {
    font-size: 0.82rem;
    margin: 8px 0 0;
  }
  .props ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .props li {
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 10px 12px;
    display: grid;
    gap: 6px;
  }
  .props li.on {
    border-color: var(--teal);
    background: var(--teal-wash);
  }
  .ptop {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: baseline;
    font-size: 0.9rem;
  }
  .no,
  .stale {
    color: var(--caution, #b5651d);
    font-weight: 700;
    font-size: 0.8rem;
  }
  .ok {
    color: var(--teal-ink);
    font-weight: 700;
    font-size: 0.8rem;
  }
  .pnote {
    margin: 0;
    font-size: 0.86rem;
    color: var(--ink-soft);
  }
  .pnote.why {
    font-style: italic;
  }
  .pacts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pacts .btn {
    min-height: 36px;
    padding: 0 12px;
    font-size: 0.86rem;
  }
  .field {
    display: grid;
    gap: 4px;
    margin-top: 10px;
  }
  .small-print {
    font-size: 0.84rem;
    margin-top: 12px;
  }
  .row {
    display: flex;
    gap: 10px;
    margin-top: 14px;
  }
  .grow {
    flex: 1 1 auto;
  }
</style>
