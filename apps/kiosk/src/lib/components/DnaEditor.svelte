<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  //
  // An admin writes the holon's DNA: its genes (purpose, values, agreements,
  // …), each holding items, the text people read — and for some, agree to —
  // before they join. Nothing to save: every change is written a moment later
  // (`createAutosave`), by core's `saveDrafts`, which is the lens's own write.
  //
  // This component only renders and calls core. What a draft may hold, which
  // ids it is given and when, what a save writes, the 48 KB cap a gene may
  // not cross, and what is wrong with it right now are all
  // @holons/core/dna edit.ts. Who may edit is `may(standing, 'dna')`.
  //
  // A starter gene is a draft until the admin touches it: placeholder text
  // must never become the holon's published purpose (it is the group's
  // about) or the terms a newcomer agrees to.
  import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";
  import { get } from "svelte/store";
  import { may } from "@holons/core/holosphere";
  import {
    GENE_LIMITS,
    addAllele,
    addGene,
    adoptIds,
    availableKinds,
    checkDrafts,
    draftGenes,
    mergeRemote,
    moveAllele,
    moveGene,
    planWrites,
    removeAllele,
    removeDraftGene,
    saveDrafts,
    subscribeGenes,
    updateAllele,
    updateGene,
    withStarter,
    type AckMode,
    type DraftAllele,
    type DraftGene,
    type DraftIssue,
    type Gene,
    type GeneKind,
  } from "@holons/core/dna";
  import { createAutosave } from "$lib/autosave";
  import {
    ALLELE_ICONS,
    ISSUE_LABEL,
    KIND_LABEL,
    alleleIconName,
    iconWords,
    kb,
    meterLevel,
    starterLang,
  } from "$lib/dna";
  import { getHolosphere } from "$lib/holosphere";
  import { locale, t, type MessageKey } from "$lib/i18n";
  import { standing } from "$lib/stores";
  import Icon from "./Icon.svelte";
  import SaveState from "./SaveState.svelte";
  import SidePanel from "./SidePanel.svelte";

  export let holon: string;

  const dispatch = createEventDispatcher<{ close: void }>();

  $: admin = may($standing, "dna");

  let drafts: DraftGene[] = [];
  /** The genes as this editor last saw them stored. */
  let baseline: Gene[] = [];
  /** Genes the admin removed, waiting for the write. */
  let removed: string[] = [];
  /** Starter rows nobody has touched yet: not written. */
  let fresh = new Set<string>();
  let loaded = false;
  let tab: "genes" | "preview" = "genes";
  let openGene: string | null = null;
  let openAllele: string | null = null;
  let openIcons: string | null = null;
  let adding = false;
  let notice = "";
  /** Allele rows switched to "shows another item" before one is picked. */
  let showing = new Set<string>();
  /** Allele rows with their long detail open. */
  let detailOpen = new Set<string>();
  /** The remove button waiting for its second tap. */
  let armed: string | null = null;
  let armTimer: ReturnType<typeof setTimeout> | null = null;

  // ── The lens, and the write ──────────────────────────────────────────────

  let stop: (() => void) | null = null;
  onMount(async () => {
    const hs = await getHolosphere();
    stop = subscribeGenes(hs, holon, (genes) => {
      drafts = mergeRemote(drafts, baseline, genes, removed);
      baseline = genes;
      loaded = true;
    });
  });

  type Job = { drafts: DraftGene[]; baseline: Gene[]; removed: string[] };

  const autosave = createAutosave<Job>(
    () => {
      if (!admin) return null;
      // Starter text nobody has touched is not yet the holon's.
      const saveable = drafts.filter((d) => !fresh.has(d.key));
      const plan = planWrites(baseline, checkDrafts(saveable));
      if (!plan.put.length && !plan.reorder && !removed.length) return null;
      return {
        drafts: structuredClone(saveable),
        baseline,
        removed: [...removed],
      };
    },
    async (job) => {
      try {
        const hs = await getHolosphere();
        const r = await saveDrafts(hs, holon, job);
        baseline = r.baseline;
        drafts = adoptIds(drafts, r.saved);
        const refused = job.removed.filter((id) =>
          r.baseline.some((g) => g.id === id),
        );
        removed = removed.filter((id) => !job.removed.includes(id));
        if (refused.length) {
          // Another gene still shows one of its items: it stays, and says why.
          drafts = mergeRemote(drafts, baseline, baseline, removed);
          const why = r.held.find((i) => i.code === "referenced");
          notice = get(t)("dnaEdit.removeFailed", {
            reason: why ? say(why) : refused.join(", "),
          });
        }
        return true;
      } catch (err) {
        console.warn("[kiosk] DNA not saved", err);
        return false;
      }
    },
  );

  function edit(next: DraftGene[], touched?: string) {
    drafts = next;
    if (touched && fresh.has(touched)) {
      fresh = new Set([...fresh].filter((k) => k !== touched));
    }
    notice = "";
    autosave.touch();
  }

  function close() {
    void autosave.flush();
    dispatch("close");
  }
  onDestroy(() => {
    void autosave.flush();
    stop?.();
    if (armTimer) clearTimeout(armTimer);
  });

  // Escape closes this panel only, not the settings sheet under it.
  function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.stopImmediatePropagation();
    close();
  }

  // ── What is wrong right now, and how big each gene is ────────────────────

  $: check = checkDrafts(drafts);
  const issuesOf = (c: typeof check, geneKey: string, alleleKey?: string) =>
    c.issues.filter(
      (i) =>
        i.geneKey === geneKey &&
        (alleleKey === undefined
          ? !i.alleleKey && i.code !== "too-large"
          : i.alleleKey === alleleKey),
    );
  $: held = new Set(
    check.issues.filter((i) => !fresh.has(i.geneKey)).map((i) => i.geneKey),
  ).size;

  function say(
    i:
      | DraftIssue
      | { code: DraftIssue["code"]; limit?: number; actual?: number },
  ) {
    return get(t)(ISSUE_LABEL[i.code], {
      limit: i.limit ?? 0,
      actual: i.actual ?? 0,
    });
  }

  /**
   * Items another gene's item may show: those already stored (a ref to
   * something not written yet would be refused), and not themselves a ref.
   */
  $: targets = baseline
    .filter((o) => !removed.includes(o.id))
    .flatMap((o) =>
      o.alleles
        .filter((x) => !x.ref)
        .map((x) => ({
          geneId: o.id,
          value: `${o.id}/${x.id}`,
          label: `${o.title || o.id} · ${x.title || x.id}`,
          title: x.title || x.id,
          gene: o.title || o.id,
        })),
    );
  const targetOf = (ref: string | undefined) =>
    ref ? targets.find((x) => x.value === ref) : undefined;

  // ── Actions ──────────────────────────────────────────────────────────────

  const lang = () => starterLang(get(locale));

  async function focus(sel: string) {
    await tick();
    document.querySelector<HTMLElement>(`[data-dna="${sel}"]`)?.focus();
  }

  function useStarter() {
    const before = new Set(drafts.map((d) => d.key));
    const next = withStarter(drafts, lang());
    fresh = new Set([
      ...fresh,
      ...next.filter((d) => !before.has(d.key)).map((d) => d.key),
    ]);
    drafts = next;
    openGene = next.find((d) => !before.has(d.key))?.key ?? openGene;
  }

  async function newGene(kind: GeneKind) {
    const made = addGene(drafts, kind, { lang: lang() });
    adding = false;
    edit(made.drafts);
    openGene = made.gene.key;
    openAllele = null;
    await focus(`gene-title-${made.gene.key}`);
  }

  async function newAllele(g: DraftGene) {
    const made = addAllele(drafts, g.key);
    if (!made.allele) return;
    edit(made.drafts, g.key);
    openAllele = made.allele.key;
    await focus(`allele-title-${made.allele.key}`);
  }

  /** Move, and keep the keyboard on the button that moved it. */
  async function move(
    what: "gene" | "allele",
    by: -1 | 1,
    g: DraftGene,
    a?: DraftAllele,
  ) {
    edit(
      what === "gene"
        ? moveGene(drafts, g.key, by)
        : moveAllele(drafts, g.key, a!.key, by),
      g.key,
    );
    const id = what === "gene" ? g.key : a!.key;
    const here = `${what}-${by < 0 ? "up" : "down"}-${id}`;
    const other = `${what}-${by < 0 ? "down" : "up"}-${id}`;
    await tick();
    const btn = document.querySelector<HTMLButtonElement>(
      `[data-dna="${here}"]`,
    );
    if (btn && !btn.disabled) btn.focus();
    else document.querySelector<HTMLElement>(`[data-dna="${other}"]`)?.focus();
  }

  /** First tap arms, second removes; the arm drops after a few seconds. */
  function remove(key: string, apply: () => void) {
    if (armTimer) clearTimeout(armTimer);
    if (armed !== key) {
      armed = key;
      armTimer = setTimeout(() => (armed = null), 3000);
      return;
    }
    armed = null;
    apply();
  }

  function dropGene(g: DraftGene) {
    if (g.id && baseline.some((b) => b.id === g.id))
      removed = [...removed, g.id];
    fresh = new Set([...fresh].filter((k) => k !== g.key));
    edit(removeDraftGene(drafts, g.key));
    if (openGene === g.key) openGene = null;
  }

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (!next.delete(key)) next.add(key);
    return next;
  };

  const value = (e: Event) =>
    (
      e.currentTarget as
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    ).value;

  const ACKS: { id: AckMode; label: MessageKey }[] = [
    { id: "none", label: "dnaEdit.ackNone" },
    { id: "read", label: "dnaEdit.ackRead" },
    { id: "agree", label: "dnaEdit.ackAgree" },
  ];
  const ackLabel = (a: AckMode) => ACKS.find((x) => x.id === a)!.label;
  const LANGS = ["en", "it", "es"];

  const TABS = [
    { id: "genes", label: "dnaEdit.tabGenes", icon: "dna" },
    { id: "preview", label: "dnaEdit.tabPreview", icon: "eye" },
  ] as const;
  const tabEls: Record<string, HTMLButtonElement> = {};
  function onTabKey(e: KeyboardEvent) {
    const at = TABS.findIndex((x) => x.id === tab);
    const to =
      e.key === "ArrowRight"
        ? (at + 1) % TABS.length
        : e.key === "ArrowLeft"
          ? (at + TABS.length - 1) % TABS.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? TABS.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    tab = TABS[to].id;
    tabEls[tab]?.focus();
  }

  /** A text area grows to its text. */
  function grow(node: HTMLTextAreaElement, _value: string) {
    const fit = () => {
      node.style.height = "auto";
      node.style.height = `${node.scrollHeight}px`;
    };
    fit();
    const seen = new ResizeObserver(fit);
    seen.observe(node);
    return { update: fit, destroy: () => seen.disconnect() };
  }
  /** A title is one line: Enter leaves the field. */
  function oneLine(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    }
  }

  $: missingStarter = withStarter(drafts, lang()).length > drafts.length;
  $: kinds = availableKinds(drafts);
  $: atLimit = drafts.length >= GENE_LIMITS.genes;
</script>

<svelte:window on:keydown|capture={onKey} />

<SidePanel title={$t("dnaEdit.title")} on:close={close}>
  <svelte:fragment slot="corner">
    {#if admin}<SaveState saver={autosave} />{/if}
  </svelte:fragment>

  <div slot="tabs" class="tabs" role="tablist" aria-label={$t("dnaEdit.title")}>
    {#each TABS as item (item.id)}
      <button
        bind:this={tabEls[item.id]}
        type="button"
        role="tab"
        id="dna-tab-{item.id}"
        aria-selected={tab === item.id}
        aria-controls="dna-panel"
        tabindex={tab === item.id ? 0 : -1}
        class="tab"
        class:on={tab === item.id}
        on:click={() => (tab = item.id)}
        on:keydown={onTabKey}><Icon name={item.icon} /> {$t(item.label)}</button
      >
    {/each}
  </div>

  <div
    id="dna-panel"
    role="tabpanel"
    aria-labelledby="dna-tab-{tab}"
    tabindex="0"
    class="tabpanel"
  >
    {#if !admin}
      <p class="note">{$t("dnaEdit.notAdmin")}</p>
    {:else if !loaded}
      <p class="note" role="status">{$t("dnaEdit.loading")}</p>
    {:else if tab === "genes"}
      {#if !drafts.length}
        <div class="empty">
          <p>{$t("dnaEdit.empty")}</p>
          <button type="button" class="primary" on:click={useStarter}
            ><Icon name="sparkles" /> {$t("dnaEdit.useStarter")}</button
          >
          <p class="hint">{$t("dnaEdit.starterNote")}</p>
        </div>
      {/if}

      {#if notice}<p class="issue" role="alert">{notice}</p>{/if}

      <ul class="genes">
        {#each drafts as g, gi (g.key)}
          {@const bytes = check.bytes.get(g.key) ?? 0}
          {@const level = meterLevel(bytes)}
          {@const open = openGene === g.key}
          {@const name = g.title || $t("dnaEdit.untitled")}
          <li class="gene" class:open style:--dot={g.color ?? "var(--teal)"}>
            <div class="ghead">
              <button
                type="button"
                class="gtoggle"
                aria-expanded={open}
                aria-controls="dna-gene-{g.key}"
                aria-label={$t(open ? "dnaEdit.collapse" : "dnaEdit.expand", {
                  name,
                })}
                on:click={() => (openGene = open ? null : g.key)}
              >
                <span class="dot" aria-hidden="true"></span>
                <span class="gtext">
                  <span class="gname" class:ghost={!g.title}>{name}</span>
                  <span class="gmeta"
                    >{$t(KIND_LABEL[g.kind])} · {$t(ackLabel(g.ack))}</span
                  >
                </span>
                <Icon name={open ? "chevron-up" : "chevron-down"} />
              </button>
              <div class="tools">
                <button
                  type="button"
                  class="tool"
                  data-dna="gene-up-{g.key}"
                  disabled={gi === 0}
                  aria-label={$t("dnaEdit.moveUp")}
                  title={$t("dnaEdit.moveUp")}
                  on:click={() => move("gene", -1, g)}
                  ><Icon name="arrow-up" /></button
                >
                <button
                  type="button"
                  class="tool"
                  data-dna="gene-down-{g.key}"
                  disabled={gi === drafts.length - 1}
                  aria-label={$t("dnaEdit.moveDown")}
                  title={$t("dnaEdit.moveDown")}
                  on:click={() => move("gene", 1, g)}
                  ><Icon name="arrow-down" /></button
                >
                <button
                  type="button"
                  class="tool danger"
                  class:armed={armed === `gene:${g.key}`}
                  aria-label={armed === `gene:${g.key}`
                    ? $t("dnaEdit.removeSure")
                    : $t("dnaEdit.removeGene")}
                  title={$t("dnaEdit.removeGene")}
                  on:click={() => remove(`gene:${g.key}`, () => dropGene(g))}
                  ><Icon name="trash" />{#if armed === `gene:${g.key}`}<span
                      >{$t("dnaEdit.removeSure")}</span
                    >{/if}</button
                >
              </div>
            </div>
            <div
              class="slim {level}"
              aria-hidden="true"
              style:--fill="{Math.min(100, (bytes / GENE_LIMITS.bytes) * 100)}%"
            ></div>
            {#if fresh.has(g.key)}
              <p class="fresh">{$t("dnaEdit.fresh")}</p>
            {/if}
            {#each issuesOf(check, g.key) as i}
              <p class="issue"><Icon name="warning" /> {say(i)}</p>
            {/each}

            {#if open}
              <div class="gbody" id="dna-gene-{g.key}">
                <label class="field">
                  <span>{$t("dnaEdit.geneTitle")}</span>
                  <input
                    type="text"
                    data-dna="gene-title-{g.key}"
                    value={g.title}
                    on:input={(e) =>
                      edit(
                        updateGene(drafts, g.key, { title: value(e) }),
                        g.key,
                      )}
                    on:keydown={oneLine}
                  />
                </label>

                <label class="field">
                  <span>{$t("dnaEdit.blurb")}</span>
                  <textarea
                    rows="2"
                    value={g.blurb}
                    use:grow={g.blurb}
                    on:input={(e) =>
                      edit(
                        updateGene(drafts, g.key, { blurb: value(e) }),
                        g.key,
                      )}
                  ></textarea>
                </label>

                <label class="field">
                  <span>{$t("dnaEdit.kind")}</span>
                  <select
                    value={g.kind}
                    on:change={(e) =>
                      edit(
                        updateGene(drafts, g.key, {
                          kind: value(e) as GeneKind,
                        }),
                        g.key,
                      )}
                  >
                    {#each kinds.includes(g.kind) ? kinds : [g.kind, ...kinds] as k (k)}
                      <option value={k}>{$t(KIND_LABEL[k])}</option>
                    {/each}
                  </select>
                </label>

                <div class="field">
                  <span id="ack-{g.key}">{$t("dnaEdit.ack")}</span>
                  <div
                    class="chips"
                    role="radiogroup"
                    tabindex="-1"
                    aria-labelledby="ack-{g.key}"
                  >
                    {#each ACKS as a (a.id)}
                      <button
                        type="button"
                        role="radio"
                        class="chip"
                        class:on={g.ack === a.id}
                        aria-checked={g.ack === a.id}
                        on:click={() =>
                          edit(updateGene(drafts, g.key, { ack: a.id }), g.key)}
                        >{$t(a.label)}</button
                      >
                    {/each}
                  </div>
                  <p class="hint">{$t("dnaEdit.hashHint")}</p>
                </div>

                <div class="row2">
                  <div class="field">
                    <span id="color-{g.key}">{$t("dnaEdit.color")}</span>
                    <div class="colorrow">
                      <input
                        type="color"
                        class="color"
                        aria-labelledby="color-{g.key}"
                        value={g.color ?? "#0e6b66"}
                        on:input={(e) =>
                          edit(
                            updateGene(drafts, g.key, { color: value(e) }),
                            g.key,
                          )}
                      />
                      {#if g.color}
                        <button
                          type="button"
                          class="ghostbtn"
                          on:click={() =>
                            edit(
                              updateGene(drafts, g.key, { color: "" }),
                              g.key,
                            )}>{$t("dnaEdit.noColor")}</button
                        >
                      {/if}
                    </div>
                  </div>
                  <label class="field">
                    <span>{$t("dnaEdit.lang")}</span>
                    <select
                      value={g.lang}
                      on:change={(e) =>
                        edit(
                          updateGene(drafts, g.key, { lang: value(e) }),
                          g.key,
                        )}
                    >
                      {#each LANGS.includes(g.lang) ? LANGS : [g.lang, ...LANGS] as l (l)}
                        <option value={l}>{l}</option>
                      {/each}
                    </select>
                  </label>
                </div>

                <!-- The size this gene would be stored at, against the cap a
                     relay can take: red over it, and the save is refused. -->
                <div class="field">
                  <span id="size-{g.key}"
                    >{$t("dnaEdit.sizeLabel", { name })}</span
                  >
                  <div
                    class="meter {level}"
                    role="meter"
                    aria-labelledby="size-{g.key}"
                    aria-valuemin="0"
                    aria-valuemax={GENE_LIMITS.bytes}
                    aria-valuenow={bytes}
                    aria-valuetext={$t("dnaEdit.size", {
                      used: kb(bytes),
                      max: kb(GENE_LIMITS.bytes),
                    })}
                  >
                    <span
                      class="bar"
                      style:width="{Math.min(
                        100,
                        (bytes / GENE_LIMITS.bytes) * 100,
                      )}%"
                    ></span>
                  </div>
                  <p
                    class="msize"
                    class:over={level === "over"}
                    role={level === "over" ? "alert" : undefined}
                  >
                    {#if level === "over"}<Icon name="warning" />
                      {$t("dnaEdit.sizeOver", {
                        used: kb(bytes),
                        max: kb(GENE_LIMITS.bytes),
                      })}{:else}{$t("dnaEdit.size", {
                        used: kb(bytes),
                        max: kb(GENE_LIMITS.bytes),
                      })}{/if}
                  </p>
                </div>

                <fieldset class="group">
                  <legend>{$t("dnaEdit.links")}</legend>
                  {#each g.links ?? [] as l, li}
                    <div class="linkrow">
                      <input
                        type="text"
                        aria-label={$t("dnaEdit.linkLabel")}
                        placeholder={$t("dnaEdit.linkLabel")}
                        value={l.label ?? ""}
                        on:input={(e) =>
                          edit(
                            updateGene(drafts, g.key, {
                              links: (g.links ?? []).map((x, n) =>
                                n === li ? { ...x, label: value(e) } : x,
                              ),
                            }),
                            g.key,
                          )}
                      />
                      <input
                        type="url"
                        inputmode="url"
                        aria-label={$t("dnaEdit.linkHref")}
                        placeholder={$t("dnaEdit.linkHref")}
                        value={l.href ?? ""}
                        on:input={(e) =>
                          edit(
                            updateGene(drafts, g.key, {
                              links: (g.links ?? []).map((x, n) =>
                                n === li ? { ...x, href: value(e) } : x,
                              ),
                            }),
                            g.key,
                          )}
                      />
                      <button
                        type="button"
                        class="tool"
                        aria-label={$t("dnaEdit.removeLink")}
                        title={$t("dnaEdit.removeLink")}
                        on:click={() =>
                          edit(
                            updateGene(drafts, g.key, {
                              links: (g.links ?? []).filter((_, n) => n !== li),
                            }),
                            g.key,
                          )}><Icon name="close" /></button
                      >
                    </div>
                  {/each}
                  <button
                    type="button"
                    class="add"
                    on:click={() =>
                      edit(
                        updateGene(drafts, g.key, {
                          links: [...(g.links ?? []), { label: "", href: "" }],
                        }),
                        g.key,
                      )}><Icon name="plus" /> {$t("dnaEdit.addLink")}</button
                  >
                </fieldset>

                <h4 class="sub">{$t("dnaEdit.alleles")}</h4>
                <ul class="alleles">
                  {#each g.alleles as a, ai (a.key)}
                    {@const aopen = openAllele === a.key}
                    {@const shown = targetOf(a.ref)}
                    {@const aname =
                      a.title || shown?.title || $t("dnaEdit.untitledAllele")}
                    {@const mine = issuesOf(check, g.key, a.key)}
                    <li class="allele" class:aopen>
                      <div class="ahead">
                        <button
                          type="button"
                          class="atoggle"
                          aria-expanded={aopen}
                          aria-controls="dna-allele-{a.key}"
                          aria-label={$t(
                            aopen ? "dnaEdit.collapse" : "dnaEdit.expand",
                            { name: aname },
                          )}
                          on:click={() => (openAllele = aopen ? null : a.key)}
                        >
                          <span class="aicon" aria-hidden="true">
                            {#if a.icon}<Icon
                                name={alleleIconName(a.icon)}
                              />{/if}
                          </span>
                          <span class="aname" class:ghost={!a.title && !shown}
                            >{aname}</span
                          >
                        </button>
                        <div class="tools">
                          <button
                            type="button"
                            class="tool"
                            data-dna="allele-up-{a.key}"
                            disabled={ai === 0}
                            aria-label={$t("dnaEdit.moveUp")}
                            title={$t("dnaEdit.moveUp")}
                            on:click={() => move("allele", -1, g, a)}
                            ><Icon name="arrow-up" /></button
                          >
                          <button
                            type="button"
                            class="tool"
                            data-dna="allele-down-{a.key}"
                            disabled={ai === g.alleles.length - 1}
                            aria-label={$t("dnaEdit.moveDown")}
                            title={$t("dnaEdit.moveDown")}
                            on:click={() => move("allele", 1, g, a)}
                            ><Icon name="arrow-down" /></button
                          >
                          <button
                            type="button"
                            class="tool danger"
                            class:armed={armed === `allele:${a.key}`}
                            aria-label={armed === `allele:${a.key}`
                              ? $t("dnaEdit.removeSure")
                              : $t("dnaEdit.removeAllele")}
                            title={$t("dnaEdit.removeAllele")}
                            on:click={() =>
                              remove(`allele:${a.key}`, () =>
                                edit(removeAllele(drafts, g.key, a.key), g.key),
                              )}
                            ><Icon
                              name="trash"
                            />{#if armed === `allele:${a.key}`}<span
                                >{$t("dnaEdit.removeSure")}</span
                              >{/if}</button
                          >
                        </div>
                      </div>
                      {#each mine as i}
                        <p class="issue"><Icon name="warning" /> {say(i)}</p>
                      {/each}

                      {#if aopen}
                        <div class="abody" id="dna-allele-{a.key}">
                          <div
                            class="chips"
                            role="radiogroup"
                            tabindex="-1"
                            aria-label={$t("dnaEdit.alleleTitle")}
                          >
                            <button
                              type="button"
                              role="radio"
                              class="chip"
                              class:on={!a.ref && !showing.has(a.key)}
                              aria-checked={!a.ref && !showing.has(a.key)}
                              on:click={() => {
                                showing = new Set(
                                  [...showing].filter((k) => k !== a.key),
                                );
                                if (a.ref)
                                  edit(
                                    updateAllele(drafts, g.key, a.key, {
                                      ref: "",
                                    }),
                                    g.key,
                                  );
                              }}>{$t("dnaEdit.own")}</button
                            >
                            <button
                              type="button"
                              role="radio"
                              class="chip"
                              class:on={!!a.ref || showing.has(a.key)}
                              aria-checked={!!a.ref || showing.has(a.key)}
                              on:click={() =>
                                (showing = new Set(showing).add(a.key))}
                              >{$t("dnaEdit.shows")}</button
                            >
                          </div>

                          {#if a.ref || showing.has(a.key)}
                            {@const options = targets.filter(
                              (x) => x.geneId !== g.id,
                            )}
                            <label class="field">
                              <span>{$t("dnaEdit.refPick")}</span>
                              <select
                                value={a.ref ?? ""}
                                on:change={(e) =>
                                  edit(
                                    updateAllele(drafts, g.key, a.key, {
                                      ref: value(e),
                                    }),
                                    g.key,
                                  )}
                              >
                                <option value="">{$t("dnaEdit.refNone")}</option
                                >
                                {#if a.ref && !options.some((x) => x.value === a.ref)}
                                  <option value={a.ref}>{a.ref}</option>
                                {/if}
                                {#each options as x (x.value)}
                                  <option value={x.value}>{x.label}</option>
                                {/each}
                              </select>
                            </label>
                            {#if !options.length}
                              <p class="hint">{$t("dnaEdit.refNoTargets")}</p>
                            {/if}
                          {:else}
                            <label class="field">
                              <span>{$t("dnaEdit.alleleTitle")}</span>
                              <input
                                type="text"
                                data-dna="allele-title-{a.key}"
                                value={a.title}
                                on:input={(e) =>
                                  edit(
                                    updateAllele(drafts, g.key, a.key, {
                                      title: value(e),
                                    }),
                                    g.key,
                                  )}
                                on:keydown={oneLine}
                              />
                            </label>
                            <label class="field">
                              <span>{$t("dnaEdit.kicker")}</span>
                              <input
                                type="text"
                                value={a.kicker ?? ""}
                                on:input={(e) =>
                                  edit(
                                    updateAllele(drafts, g.key, a.key, {
                                      kicker: value(e),
                                    }),
                                    g.key,
                                  )}
                                on:keydown={oneLine}
                              />
                            </label>
                            <label class="field">
                              <span>{$t("dnaEdit.body")}</span>
                              <textarea
                                rows="3"
                                value={a.body ?? ""}
                                use:grow={a.body ?? ""}
                                on:input={(e) =>
                                  edit(
                                    updateAllele(drafts, g.key, a.key, {
                                      body: value(e),
                                    }),
                                    g.key,
                                  )}
                              ></textarea>
                            </label>
                          {/if}

                          <div class="field">
                            <span id="icon-{a.key}">{$t("dnaEdit.icon")}</span>
                            <button
                              type="button"
                              class="iconpick"
                              aria-labelledby="icon-{a.key}"
                              aria-expanded={openIcons === a.key}
                              on:click={() =>
                                (openIcons =
                                  openIcons === a.key ? null : a.key)}
                            >
                              {#if a.icon}<Icon name={alleleIconName(a.icon)} />
                                {iconWords(a.icon)}{:else}{$t(
                                  "dnaEdit.pickIcon",
                                )}{/if}
                              <Icon
                                name={openIcons === a.key
                                  ? "chevron-up"
                                  : "chevron-down"}
                              />
                            </button>
                            {#if openIcons === a.key}
                              <div
                                class="icons"
                                role="radiogroup"
                                tabindex="-1"
                                aria-labelledby="icon-{a.key}"
                              >
                                <button
                                  type="button"
                                  role="radio"
                                  class="ico none"
                                  class:on={!a.icon}
                                  aria-checked={!a.icon}
                                  aria-label={$t("dnaEdit.noIcon")}
                                  title={$t("dnaEdit.noIcon")}
                                  on:click={() => {
                                    edit(
                                      updateAllele(drafts, g.key, a.key, {
                                        icon: null,
                                      }),
                                      g.key,
                                    );
                                    openIcons = null;
                                  }}><Icon name="close" /></button
                                >
                                {#each ALLELE_ICONS as key (key)}
                                  <button
                                    type="button"
                                    role="radio"
                                    class="ico"
                                    class:on={a.icon === key}
                                    aria-checked={a.icon === key}
                                    aria-label={iconWords(key)}
                                    title={iconWords(key)}
                                    on:click={() => {
                                      edit(
                                        updateAllele(drafts, g.key, a.key, {
                                          icon: key,
                                        }),
                                        g.key,
                                      );
                                      openIcons = null;
                                    }}
                                    ><Icon name={alleleIconName(key)} /></button
                                  >
                                {/each}
                              </div>
                            {/if}
                          </div>

                          {#if !a.ref && !showing.has(a.key)}
                            <fieldset class="group">
                              <legend>{$t("dnaEdit.link")}</legend>
                              <div class="linkrow">
                                <input
                                  type="text"
                                  aria-label={$t("dnaEdit.linkLabel")}
                                  placeholder={$t("dnaEdit.linkLabel")}
                                  value={a.link?.label ?? ""}
                                  on:input={(e) =>
                                    edit(
                                      updateAllele(drafts, g.key, a.key, {
                                        link: { ...a.link, label: value(e) },
                                      }),
                                      g.key,
                                    )}
                                />
                                <input
                                  type="url"
                                  inputmode="url"
                                  aria-label={$t("dnaEdit.linkHref")}
                                  placeholder={$t("dnaEdit.linkHref")}
                                  value={a.link?.href ?? ""}
                                  on:input={(e) =>
                                    edit(
                                      updateAllele(drafts, g.key, a.key, {
                                        link: { ...a.link, href: value(e) },
                                      }),
                                      g.key,
                                    )}
                                />
                              </div>
                            </fieldset>

                            {#if a.detail || detailOpen.has(a.key)}
                              <label class="field">
                                <span>{$t("dnaEdit.detailBody")}</span>
                                <textarea
                                  rows="3"
                                  value={a.detail?.body ?? ""}
                                  use:grow={a.detail?.body ?? ""}
                                  on:input={(e) =>
                                    edit(
                                      updateAllele(drafts, g.key, a.key, {
                                        detail: { ...a.detail, body: value(e) },
                                      }),
                                      g.key,
                                    )}
                                ></textarea>
                              </label>
                              <label class="field">
                                <span>{$t("dnaEdit.steps")}</span>
                                <textarea
                                  rows="3"
                                  value={(a.detail?.steps ?? []).join("\n")}
                                  use:grow={(a.detail?.steps ?? []).join("\n")}
                                  on:input={(e) =>
                                    edit(
                                      updateAllele(drafts, g.key, a.key, {
                                        detail: {
                                          ...a.detail,
                                          steps: value(e).split("\n"),
                                        },
                                      }),
                                      g.key,
                                    )}
                                ></textarea>
                              </label>
                            {:else}
                              <button
                                type="button"
                                class="add"
                                on:click={() =>
                                  (detailOpen = toggle(detailOpen, a.key))}
                                ><Icon name="plus" />
                                {$t("dnaEdit.more")}</button
                              >
                            {/if}
                          {/if}
                        </div>
                      {/if}
                    </li>
                  {/each}
                </ul>
                <button
                  type="button"
                  class="add"
                  disabled={g.alleles.length >= GENE_LIMITS.allelesPerGene}
                  on:click={() => newAllele(g)}
                  ><Icon name="plus" /> {$t("dnaEdit.addAllele")}</button
                >
              </div>
            {/if}
          </li>
        {/each}
      </ul>

      {#if drafts.length}
        {#if adding}
          <div
            class="kinds"
            role="group"
            aria-label={$t("dnaEdit.addGeneKind")}
          >
            <p class="hint">{$t("dnaEdit.addGeneKind")}</p>
            <div class="chips wrap">
              {#each kinds as k (k)}
                <button type="button" class="chip" on:click={() => newGene(k)}
                  >{$t(KIND_LABEL[k])}</button
                >
              {/each}
            </div>
          </div>
        {/if}
        <button
          type="button"
          class="add-gene"
          disabled={atLimit}
          aria-expanded={adding}
          on:click={() => (adding = !adding)}
          ><Icon name="plus" /> {$t("dnaEdit.addGene")}</button
        >
        {#if missingStarter}
          <button type="button" class="add" on:click={useStarter}
            ><Icon name="sparkles" /> {$t("dnaEdit.addMissing")}</button
          >
        {/if}
      {/if}
    {:else}
      <!-- ── Preview: the genes as a reader would see them ──────────────── -->
      <p class="note">{$t("dnaEdit.previewNote")}</p>
      {#each check.settled as s (s.key)}
        {@const g = s.gene}
        <section class="pgene" style:--dot={g.color ?? "var(--teal)"}>
          <h3>
            <span class="dot" aria-hidden="true"></span>
            {g.title || $t("dnaEdit.untitled")}
          </h3>
          {#if g.ack !== "none"}
            <p class="badge">
              {$t(
                g.ack === "agree"
                  ? "dnaEdit.previewAgree"
                  : "dnaEdit.previewRead",
              )}
            </p>
          {/if}
          {#if fresh.has(s.key)}<p class="fresh">{$t("dnaEdit.fresh")}</p>{/if}
          {#if g.blurb}<p class="pblurb">{g.blurb}</p>{/if}
          {#if g.links?.length}
            <p class="plinks">
              {#each g.links as l}<span class="plink">{l.label}</span>{/each}
            </p>
          {/if}
          <ul class="pcards" class:long={g.kind === "terms"}>
            {#each g.alleles as a (a.id)}
              {@const shown = a.ref
                ? check.settled
                    .find((x) => x.gene.id === a.ref!.split("/")[0])
                    ?.gene.alleles.find((x) => x.id === a.ref!.split("/")[1])
                : undefined}
              {@const view = shown ?? a}
              <li class="pcard">
                {#if view.icon}<span class="picon" aria-hidden="true"
                    ><Icon name={alleleIconName(view.icon)} /></span
                  >{/if}
                {#if view.kicker}<span class="pkicker">{view.kicker}</span>{/if}
                <strong>{view.title}</strong>
                {#if view.body}<span class="pbody">{view.body}</span>{/if}
                {#if a.ref && shown}
                  <span class="pfrom"
                    >{$t("dnaEdit.sharedFrom", {
                      gene: targetOf(a.ref)?.gene ?? a.ref.split("/")[0],
                    })}</span
                  >
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {:else}
        <p class="note">{$t("dnaEdit.previewEmpty")}</p>
      {/each}
    {/if}
  </div>

  <svelte:fragment slot="footer">
    <p class="status" role="status" aria-live="polite">
      <span
        >{$t("dnaEdit.counts", {
          n: drafts.length,
          max: GENE_LIMITS.genes,
        })}</span
      >
      {#if held}
        <span class="held"
          ><Icon name="warning" /> {$t("dnaEdit.held", { n: held })}</span
        >
      {/if}
    </p>
  </svelte:fragment>
</SidePanel>

<style>
  /* ── Tabs ─────────────────────────────────────────────────────────────── */
  .tabs {
    display: flex;
    gap: 4px;
    padding: 0 1.2rem 0.7rem;
    border-bottom: 1px solid var(--line);
  }
  .tab {
    flex: 1 1 0;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    border-radius: 12px;
    background: transparent;
    color: var(--ink-soft);
    font-weight: 700;
    font-size: 0.9rem;
    touch-action: manipulation;
  }
  .tab.on {
    background: var(--paper);
    color: var(--ink);
  }
  .tabpanel:focus {
    outline: none;
  }
  .tabpanel:focus-visible {
    outline: 2px solid var(--teal);
    outline-offset: 2px;
  }

  .note {
    margin: 0.9rem 0 0;
    font-size: 0.85rem;
    line-height: 1.45;
    color: var(--ink-soft);
  }
  .hint {
    margin: 0.4rem 0 0;
    font-size: 0.8rem;
    line-height: 1.4;
    color: var(--ink-soft);
  }
  .issue {
    margin: 0.35rem 0 0;
    display: flex;
    gap: 0.35rem;
    align-items: baseline;
    font-size: 0.8rem;
    line-height: 1.35;
    color: var(--ink);
  }
  .issue :global(.icon) {
    color: var(--danger);
    transform: translateY(2px);
  }
  .fresh {
    margin: 0.35rem 0 0;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--ink-soft);
  }

  input,
  textarea,
  select {
    font: inherit;
    color: var(--ink);
  }

  /* ── Genes ────────────────────────────────────────────────────────────── */
  .genes,
  .alleles {
    list-style: none;
    margin: 0.9rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .gene {
    padding: 0.3rem 0.5rem 0.7rem 0.65rem;
    border-radius: 14px;
    background: var(--card);
    border: 1.5px solid var(--line);
  }
  .gene.open {
    border-color: color-mix(in srgb, var(--teal) 45%, var(--line));
    box-shadow: var(--shadow-soft);
  }
  .ghead,
  .ahead {
    display: flex;
    align-items: center;
    gap: 0.1rem;
  }
  .gtoggle,
  .atoggle {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0 0.3rem;
    border-radius: 10px;
    background: transparent;
    color: var(--ink);
    text-align: left;
    touch-action: manipulation;
  }
  .gtoggle:hover,
  .atoggle:hover {
    background: var(--paper);
  }
  .dot {
    width: 0.8rem;
    height: 0.8rem;
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--dot, var(--teal));
    box-shadow: 0 0 0 2px var(--card);
    outline: 1px solid var(--line);
  }
  .gtext {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .gname,
  .aname {
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .aname {
    flex: 1;
    font-weight: 700;
    font-size: 0.92rem;
  }
  .ghost {
    color: var(--ink-soft);
    font-style: italic;
    font-weight: 600;
  }
  .gmeta {
    font-size: 0.76rem;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .aicon {
    width: 1.6rem;
    height: 1.6rem;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: var(--paper);
    color: var(--ink);
    font-size: 1.05rem;
  }

  /* Move / remove. */
  .tools {
    display: flex;
    flex: 0 0 auto;
  }
  .tool {
    min-width: 44px;
    height: 44px;
    padding: 0 0.45rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    border-radius: 10px;
    background: transparent;
    color: var(--ink-soft);
    font-size: 0.95rem;
    touch-action: manipulation;
  }
  .tool:hover:not(:disabled) {
    background: var(--paper);
    color: var(--ink);
  }
  .tool:disabled {
    opacity: 0.3;
  }
  .tool.danger:hover {
    color: var(--danger);
  }
  .tool.armed,
  .tool.armed:hover {
    background: var(--danger);
    color: var(--on-danger);
    font-size: 0.8rem;
    font-weight: 700;
  }

  /* How full a gene is: a thin line under its header. */
  .slim {
    height: 3px;
    margin: 0 0.3rem;
    border-radius: 3px;
    background: linear-gradient(
      to right,
      var(--teal) var(--fill),
      var(--line) var(--fill)
    );
  }
  .slim.warn {
    background: linear-gradient(
      to right,
      var(--caution) var(--fill),
      var(--line) var(--fill)
    );
  }
  .slim.over {
    background: var(--danger);
  }

  .gbody,
  .abody {
    padding: 0.2rem 0.3rem 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.7rem;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--ink-soft);
    border: 0;
    padding: 0;
    min-width: 0;
  }
  .field input,
  .field textarea,
  .field select,
  .linkrow input {
    padding: 0.55rem 0.7rem;
    min-height: 44px;
    min-width: 0;
    font-size: 0.95rem;
    font-weight: 400;
    background: var(--paper);
    border: 1.5px solid transparent;
    border-radius: 10px;
    resize: none;
  }
  .field input:focus,
  .field textarea:focus,
  .field select:focus,
  .linkrow input:focus {
    outline: none;
    border-color: var(--teal);
    background: var(--card);
  }
  .row2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }
  .colorrow {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .color {
    width: 44px;
    height: 44px;
    padding: 2px;
    border-radius: 10px;
    background: var(--paper);
    border: 1.5px solid var(--line);
    cursor: pointer;
  }
  .ghostbtn {
    min-height: 44px;
    padding: 0 0.7rem;
    border-radius: 10px;
    background: transparent;
    color: var(--teal-ink);
    font-weight: 700;
    font-size: 0.82rem;
    touch-action: manipulation;
  }

  /* Pills: ack, who an allele shows. */
  .chips {
    display: flex;
    gap: 0.3rem;
  }
  .chips.wrap {
    flex-wrap: wrap;
  }
  .chip {
    flex: 1 1 0;
    min-height: 44px;
    min-width: 0;
    padding: 0 0.6rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink-soft);
    font-size: 0.85rem;
    font-weight: 700;
    border: 1.5px solid transparent;
    touch-action: manipulation;
  }
  .chips.wrap .chip {
    flex: 0 0 auto;
  }
  .chip:hover:not(.on) {
    border-color: var(--line);
    color: var(--ink);
  }
  .chip.on {
    background: var(--teal);
    color: var(--on-teal);
  }

  /* Size meter. */
  .meter {
    height: 10px;
    border-radius: 6px;
    background: var(--paper-deep);
    overflow: hidden;
  }
  .bar {
    display: block;
    height: 100%;
    background: var(--teal);
    transition: width 0.2s ease;
  }
  .meter.warn .bar {
    background: var(--caution);
  }
  .meter.over .bar {
    background: var(--danger);
  }
  .msize {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .msize.over {
    display: flex;
    gap: 0.35rem;
    align-items: baseline;
    color: var(--danger);
    font-weight: 800;
  }

  .group {
    margin: 0.8rem 0 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  .group legend {
    padding: 0;
    margin-bottom: 0.3rem;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  .linkrow {
    display: grid;
    grid-template-columns: 1fr 1.4fr auto;
    gap: 0.3rem;
    align-items: center;
    margin-bottom: 0.3rem;
  }
  .linkrow:not(:has(.tool)) {
    grid-template-columns: 1fr 1.4fr;
  }

  .sub {
    margin: 1rem 0 0;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .allele {
    padding: 0 0.3rem 0.5rem 0.4rem;
    border-radius: 12px;
    background: var(--paper);
  }
  .allele.aopen {
    background: var(--card);
    border: 1.5px solid var(--line);
    padding-bottom: 0.7rem;
  }
  .allele .atoggle:hover {
    background: var(--card);
  }
  .iconpick {
    min-height: 44px;
    padding: 0 0.8rem;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
    font-weight: 600;
    font-size: 0.9rem;
    touch-action: manipulation;
  }
  .icons {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
    gap: 4px;
    margin-top: 0.3rem;
  }
  .ico {
    height: 44px;
    min-width: 44px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
    font-size: 1.3rem;
    border: 1.5px solid transparent;
    touch-action: manipulation;
  }
  .ico:hover:not(.on) {
    border-color: var(--line);
  }
  .ico.on {
    background: var(--teal);
    color: var(--on-teal);
  }

  .add,
  .add-gene {
    min-height: 44px;
    margin-top: 0.5rem;
    padding: 0 0.7rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    border-radius: 10px;
    background: transparent;
    color: var(--teal-ink);
    font-size: 0.88rem;
    font-weight: 700;
    touch-action: manipulation;
  }
  .add:hover:not(:disabled) {
    background: var(--teal-wash);
  }
  .add:disabled,
  .add-gene:disabled {
    opacity: 0.4;
  }
  .add-gene {
    width: 100%;
    min-height: 52px;
    margin-top: 0.7rem;
    justify-content: center;
    border: 2px dashed var(--line);
    border-radius: 14px;
    font-weight: 800;
  }
  .add-gene:hover:not(:disabled) {
    border-color: var(--teal);
    background: var(--teal-wash);
  }
  .kinds {
    margin-top: 0.7rem;
    padding: 0.5rem 0.6rem 0.7rem;
    border-radius: 14px;
    background: var(--paper);
  }
  .kinds .hint {
    margin: 0 0 0.4rem;
  }

  .empty {
    margin: 1.4rem 0 1rem;
    padding: 1.4rem 1rem;
    border-radius: 16px;
    background: var(--paper);
    text-align: center;
    color: var(--ink-soft);
  }
  .empty p {
    margin: 0 0 0.8rem;
  }
  .empty .hint {
    margin: 0.8rem 0 0;
  }
  .primary {
    min-height: 44px;
    padding: 0 1.1rem;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    border-radius: 999px;
    background: var(--teal);
    color: var(--on-teal);
    font-weight: 700;
    touch-action: manipulation;
  }

  /* ── Preview ──────────────────────────────────────────────────────────── */
  .pgene {
    margin-top: 1rem;
    padding: 0.8rem 0.9rem 0.9rem;
    border-radius: 16px;
    background: var(--card);
    border: 1px solid var(--line);
    border-top: 4px solid var(--dot, var(--teal));
  }
  .pgene h3 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.05rem;
    color: var(--ink);
  }
  .badge {
    display: inline-block;
    margin: 0.4rem 0 0;
    padding: 0.15rem 0.6rem;
    border-radius: 999px;
    background: var(--glass);
    color: var(--ink-soft);
    font-size: 0.75rem;
    font-weight: 700;
  }
  .pblurb {
    margin: 0.5rem 0 0;
    line-height: 1.45;
    color: var(--ink);
  }
  .plinks {
    margin: 0.4rem 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .plink {
    color: var(--teal-ink);
    font-weight: 700;
    font-size: 0.85rem;
    text-decoration: underline;
  }
  .pcards {
    list-style: none;
    margin: 0.7rem 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 0.5rem;
  }
  .pcards.long {
    grid-template-columns: 1fr;
  }
  .pcard {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.6rem 0.7rem;
    border-radius: 12px;
    background: var(--paper);
    color: var(--ink);
  }
  .picon {
    font-size: 1.3rem;
    color: var(--teal-ink);
  }
  .pkicker {
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .pbody {
    font-size: 0.85rem;
    line-height: 1.4;
    color: var(--ink-soft);
    white-space: pre-wrap;
  }
  .pfrom {
    font-size: 0.72rem;
    color: var(--ink-soft);
  }

  /* ── Footer ───────────────────────────────────────────────────────────── */
  .status {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1rem;
    justify-content: space-between;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .held {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    color: var(--ink);
    font-weight: 800;
  }
  .held :global(.icon) {
    color: var(--danger);
    transform: translateY(2px);
  }
</style>
