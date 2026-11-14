<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  //
  // A holon's front page — `/<holon>/dna`: who it is before what it does.
  // The hero (its name, what it is for, how many people, the one thing to
  // do next), an index of its genes, every gene read in full, how joining
  // works, and the version of the DNA on show. Readable by anyone, logged
  // in or not; a wall display reaches it from the holon's name.
  //
  // Everything it says is core's `HolonFront` (lib/dna.ts holds it): which
  // call to action the viewer gets, the refs, "expressed in", the reading
  // time, the steps after a request. This lays it out — and, for an admin,
  // opens the DNA editor (`?edit`).
  import { onDestroy, onMount, tick } from "svelte";
  import { page } from "$app/stores";
  import { replaceState } from "$app/navigation";
  import { may } from "@holons/core/holosphere";
  import type { AlleleView, GeneView } from "@holons/core/dna";
  import { frontState, reloadFront, watchFront } from "$lib/dna";
  import { hrefForPage } from "$lib/tabroute";
  import { boardBehind, holonId, holonName, standing } from "$lib/stores";
  import { sessionKeyPub } from "$lib/sessionKey";
  import { isLoggedIn } from "$lib/auth";
  import { locale, t } from "$lib/i18n";
  import Icon from "$lib/components/Icon.svelte";
  import Identicon from "$lib/components/Identicon.svelte";
  import GeneSection from "$lib/components/GeneSection.svelte";
  import AlleleDrawer from "$lib/components/AlleleDrawer.svelte";
  import DnaEditor from "$lib/components/DnaEditor.svelte";

  // ── The front, read ──────────────────────────────────────────────────────
  let stop: (() => void) | null = null;
  let watched = "";
  $: key = `${$holonId ?? ""}|${$sessionKeyPub ?? ""}`;
  $: if ($holonId && key !== watched) {
    watched = key;
    stop?.();
    stop = watchFront($holonId, $sessionKeyPub);
  }
  onDestroy(() => stop?.());

  $: shown =
    $frontState.status === "ready" && $frontState.holon === $holonId
      ? $frontState.front
      : null;
  $: failed = $frontState.status === "error" && $frontState.holon === $holonId;
  $: label = shown?.name || $holonName || $holonId || "";
  // Who may edit is the holon's word on the logged-in key; a wall display
  // nobody logged into edits nothing.
  $: admin = $isLoggedIn && (!!shown?.viewer.edit || may($standing, "dna"));

  // ── Reading ──────────────────────────────────────────────────────────────
  let more = false;
  let scroller: HTMLElement;
  let active: string | null = null;
  let open: { allele: AlleleView; gene: GeneView } | null = null;

  const reduced = () =>
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  function goTo(id: string) {
    open = null;
    const el = document.getElementById(`gene-${id}`);
    el?.scrollIntoView({
      behavior: reduced() ? "auto" : "smooth",
      block: "start",
    });
    active = id;
  }

  // Which gene is being read: the index follows it.
  let spy: IntersectionObserver | null = null;
  async function watchSections() {
    spy?.disconnect();
    await tick();
    if (!scroller || typeof IntersectionObserver !== "function") return;
    spy = new IntersectionObserver(
      (entries) => {
        const seen = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (seen[0]) active = seen[0].target.id.replace(/^gene-/, "");
      },
      { root: scroller, rootMargin: "-15% 0px -70% 0px" },
    );
    for (const el of scroller.querySelectorAll("section.gene")) spy.observe(el);
  }
  $: if (shown) void (shown.genes.length, watchSections());
  onDestroy(() => spy?.disconnect());

  // ── The editor (admins; `?edit` opens it) ────────────────────────────────
  let editing = false;
  let askedEdit = false;
  onMount(() => {
    askedEdit = $page.url.searchParams.has("edit");
  });
  $: if (askedEdit && admin && $holonId) {
    askedEdit = false;
    editing = true;
  }
  function closeEditor() {
    editing = false;
    if ($page.url.searchParams.has("edit"))
      replaceState(hrefForPage($page.url, "dna"), {});
  }

  // ── Words ────────────────────────────────────────────────────────────────
  $: updated = shown?.dna.updated
    ? new Date(shown.dna.updated).toLocaleDateString($locale, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";
  $: applyHref = hrefForPage($page.url, "apply");
  $: onboardingHref = hrefForPage($page.url, "onboarding");
  $: boardHref = hrefForPage($page.url, null);
  $: genome = shown?.genes.map((g) => ({
    id: g.id,
    color: g.color || null,
    weight: Math.max(1, g.alleles.length),
  }));
</script>

<div class="front" bind:this={scroller}>
  {#if $boardBehind}
    <a class="back" href={boardHref}
      ><Icon name="chevron-left" />{$t("front.board")}</a
    >
  {/if}

  {#if shown}
    <header class="hero" style:--hero={shown.color || null}>
      {#if genome?.length}
        <div class="genome" aria-hidden="true">
          {#each genome as g (g.id)}
            <span style:--g={g.color} style:flex-grow={g.weight}></span>
          {/each}
        </div>
      {/if}
      <p class="eyebrow">
        {#if shown.picture}
          <img class="pic" src={shown.picture} alt="" />
        {:else}
          <Identicon class="mark" seed={shown.holon} />
        {/if}
        <span>{$t("front.eyebrow")}</span>
      </p>
      <h1 class="name">{shown.name}</h1>
      {#if shown.about}
        <p class="about">{more ? shown.about : shown.teaser}</p>
        {#if shown.teaser !== shown.about}
          <button
            type="button"
            class="quiet"
            aria-expanded={more}
            on:click={() => (more = !more)}
            >{$t(more ? "front.readLess" : "front.readMore")}</button
          >
        {/if}
      {/if}
      <p class="people">
        <Icon name="users" />{$t("front.people", { n: shown.members })}
        {#if shown.counts.parts}
          <span class="sep" aria-hidden="true">·</span>
          <Icon name="clock" />{$t("front.minutes", {
            n: shown.counts.minutes,
          })}
        {/if}
      </p>
      <div class="actions">
        {#if shown.viewer.cta === "apply"}
          <a class="cta" href={applyHref}>{$t("front.apply")}</a>
        {:else if shown.viewer.cta === "continue"}
          <a class="cta" href={onboardingHref}>{$t("front.pending")}</a>
        {:else if shown.viewer.cta === "review"}
          <a class="cta warn" href={applyHref}
            ><Icon name="warning" />{$t("front.blocked")}</a
          >
        {:else if shown.viewer.cta === "linked"}
          <span class="linked"><Icon name="check" />{$t("front.linked")}</span>
        {:else}
          <p class="note">{$t("front.nobody", { holon: label })}</p>
        {/if}
        {#if admin}
          <button
            type="button"
            class="cta ghost"
            on:click={() => (editing = true)}
            ><Icon name="pencil" />{$t(
              shown.empty ? "front.write" : "front.edit",
            )}</button
          >
        {/if}
      </div>
    </header>

    {#if shown.empty}
      <section class="empty">
        <span class="empty__ico" aria-hidden="true"><Icon name="dna" /></span>
        <p>{$t("front.empty", { holon: label })}</p>
      </section>
    {:else}
      <!-- On a phone the index is a row of chips that stays in reach. -->
      <nav class="chips" aria-label={$t("front.contents")}>
        {#each shown.genes as g (g.id)}
          <button
            type="button"
            class="chip"
            class:on={active === g.id}
            style:--g={g.color || null}
            on:click={() => goTo(g.id)}
            ><span class="dot"></span>{g.title}</button
          >
        {/each}
      </nav>

      <div class="body">
        <nav class="rail" aria-label={$t("front.contents")}>
          <p class="rail__head">{$t("front.contents")}</p>
          <ol>
            {#each shown.genes as g, i (g.id)}
              <li>
                <button
                  type="button"
                  class:on={active === g.id}
                  aria-current={active === g.id ? "true" : undefined}
                  style:--g={g.color || null}
                  on:click={() => goTo(g.id)}
                >
                  <span class="dot"></span>
                  <span class="rn">{String(i + 1).padStart(2, "0")}</span>
                  <span class="rt">{g.title}</span>
                  {#if g.ack === "agree"}<span
                      class="agree"
                      title={$t("front.askAgree")}
                      ><Icon name="handshake" /><span class="sr"
                        >{$t("front.askAgree")}</span
                      ></span
                    >{/if}
                </button>
              </li>
            {/each}
          </ol>
        </nav>

        <main class="genes">
          {#each shown.genes as g, i (g.id)}
            <GeneSection
              gene={g}
              index={i + 1}
              on:open={(e) => (open = e.detail)}
              on:gene={(e) => goTo(e.detail)}
            />
          {/each}

          <section class="how" aria-labelledby="how-title">
            <h2 id="how-title">{$t("front.howTitle")}</h2>
            <ol>
              {#each shown.how as step, i (i)}
                <li>
                  <span class="hn">{i + 1}</span>
                  <span class="ht">
                    {#if step.kind === "read"}
                      {$t("front.howRead", {
                        n: step.parts,
                        m: step.minutes,
                      })}
                    {:else if step.kind === "send"}
                      {$t("front.howSend")}
                    {:else if step.kind === "step"}
                      {step.title}
                    {:else}
                      {$t("front.howLinked")}
                    {/if}
                  </span>
                </li>
              {/each}
            </ol>
          </section>
        </main>
      </div>
    {/if}

    <footer class="foot">
      {#if shown.dna.short}
        <p class="ver">
          {$t("front.footer", { short: shown.dna.short, date: updated })}
        </p>
      {/if}
      <p class="living">{$t("front.living", { holon: shown.name })}</p>
      {#if shown.viewer.cta === "apply"}
        <a class="cta" href={applyHref}>{$t("front.apply")}</a>
      {:else if shown.viewer.cta === "review"}
        <a class="cta warn" href={applyHref}>{$t("front.blocked")}</a>
      {/if}
    </footer>
  {:else if failed}
    <div class="state" role="alert">
      <span class="empty__ico" aria-hidden="true"><Icon name="warning" /></span>
      <p>{$t("front.unreachable", { holon: label })}</p>
      <button type="button" class="cta" on:click={() => void reloadFront()}
        >{$t("front.retry")}</button
      >
    </div>
  {:else}
    <div class="skeleton" aria-busy="true" aria-label={$t("front.loading")}>
      <span class="sk sk--eyebrow"></span>
      <span class="sk sk--name"></span>
      <span class="sk sk--line"></span>
      <span class="sk sk--line short"></span>
      <span class="sk sk--cta"></span>
      <div class="sk-grid">
        {#each [0, 1, 2, 3, 4, 5] as i (i)}<span class="sk sk--card"
          ></span>{/each}
      </div>
    </div>
  {/if}
</div>

{#if open}
  <AlleleDrawer
    allele={open.allele}
    gene={open.gene}
    on:close={() => (open = null)}
    on:gene={(e) => goTo(e.detail)}
  />
{/if}

{#if editing && $holonId}
  <DnaEditor holon={$holonId} on:close={closeEditor} />
{/if}

<style>
  .front {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--card);
  }

  .back {
    position: absolute;
    top: 0.6rem;
    left: 0.6rem;
    z-index: 3;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 44px;
    padding: 0 0.9rem 0 0.6rem;
    border-radius: 999px;
    color: var(--ink-soft);
    font-size: 0.86rem;
    text-decoration: none;
  }
  .back:hover {
    color: var(--ink);
    background: var(--paper);
  }

  /* ── Hero ── */
  .hero {
    position: relative;
    text-align: center;
    padding: clamp(3.2rem, 7vw, 6rem) clamp(1rem, 4vw, 3rem)
      clamp(2rem, 4vw, 3.2rem);
    background:
      radial-gradient(
        120% 90% at 50% 0%,
        color-mix(in srgb, var(--hero, var(--teal)) 14%, transparent),
        transparent 70%
      ),
      var(--card);
  }
  /* The genome as a band: one segment per gene, in its colour, as wide as
     it is rich. */
  .genome {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 6px;
    display: flex;
    gap: 2px;
  }
  .genome span {
    flex-basis: 0;
    background: var(--g, var(--teal));
  }
  .eyebrow {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--hero, var(--teal)) 30%, var(--ink-soft));
  }
  .eyebrow :global(.mark) {
    font-size: 1.6rem;
    color: var(--teal-ink);
  }
  .pic {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    object-fit: cover;
  }
  .name {
    margin: 0.9rem auto 0;
    max-width: 18ch;
    font-family: var(--font-serif);
    font-weight: 400;
    font-size: clamp(2.6rem, 1.6rem + 4.2vw, 5.2rem);
    line-height: 1.02;
    letter-spacing: 0.01em;
    color: var(--ink);
    overflow-wrap: anywhere;
    text-wrap: balance;
  }
  .about {
    margin: 1.3rem auto 0;
    max-width: 38rem;
    font-family: var(--font-serif);
    font-size: clamp(1.1rem, 1rem + 0.4vw, 1.3rem);
    line-height: 1.55;
    color: var(--ink-soft);
    white-space: pre-line;
    text-wrap: pretty;
  }
  .quiet {
    min-height: 44px;
    margin-top: 0.2rem;
    padding: 0 0.8rem;
    border-radius: 999px;
    color: var(--teal-ink);
    font-size: 0.88rem;
    font-weight: 600;
  }
  .people {
    margin: 1.1rem 0 0;
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
    color: var(--ink-soft);
  }
  .sep {
    margin: 0 0.3rem;
  }
  .actions {
    margin-top: 1.6rem;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 0.6rem;
  }
  .cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 48px;
    padding: 0 1.5rem;
    border-radius: 999px;
    background: var(--teal);
    color: var(--on-teal);
    font: inherit;
    font-weight: 700;
    font-size: 0.98rem;
    text-decoration: none;
    box-shadow: var(--shadow-soft);
    transition:
      transform 0.2s ease,
      background 0.2s ease;
  }
  .cta:hover {
    background: var(--teal-deep);
  }
  .cta:active {
    transform: scale(0.98);
  }
  .cta.warn {
    background: var(--caution);
    color: var(--card);
  }
  .cta.ghost {
    background: transparent;
    color: var(--ink);
    border: 1px solid var(--line);
    box-shadow: none;
  }
  .cta.ghost:hover {
    background: var(--paper);
  }
  .linked {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 44px;
    padding: 0 1.1rem;
    border-radius: 999px;
    background: var(--teal-wash);
    color: var(--ink);
    font-weight: 600;
  }
  .note {
    margin: 0;
    max-width: 30rem;
    color: var(--ink-soft);
    font-size: 0.92rem;
  }

  /* ── Index ── */
  .chips {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 0.55rem clamp(1rem, 4vw, 3rem);
    background: color-mix(in srgb, var(--card) 88%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--line);
  }
  .chips::-webkit-scrollbar {
    display: none;
  }
  .chip {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 44px;
    padding: 0 0.95rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink-soft);
    font-size: 0.86rem;
    white-space: nowrap;
  }
  .chip.on {
    color: var(--ink);
    border-color: color-mix(in srgb, var(--g, var(--teal)) 60%, var(--line));
    background: color-mix(in srgb, var(--g, var(--teal)) 10%, var(--card));
  }
  .dot {
    width: 0.62rem;
    height: 0.62rem;
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--g, var(--teal));
  }

  .body {
    padding: clamp(1.6rem, 4vw, 3rem) clamp(1rem, 4vw, 3rem) 1rem;
    max-width: 78rem;
    margin: 0 auto;
    box-sizing: border-box;
  }
  .rail {
    display: none;
  }
  .genes {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: clamp(3rem, 6vw, 5rem);
  }

  @media (min-width: 1024px) {
    .chips {
      display: none;
    }
    .body {
      display: grid;
      grid-template-columns: 14rem minmax(0, 1fr);
      gap: 3.2rem;
    }
    .rail {
      display: block;
      position: sticky;
      top: 1.6rem;
      align-self: start;
    }
  }
  .rail__head {
    margin: 0 0 0.6rem 0.7rem;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .rail ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .rail button {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    min-height: 44px;
    padding: 0 0.7rem;
    border-radius: 12px;
    color: var(--ink-soft);
    font-size: 0.9rem;
    text-align: left;
    transition: background 0.2s ease;
  }
  .rail button:hover {
    background: var(--paper);
  }
  .rail button.on {
    background: color-mix(in srgb, var(--g, var(--teal)) 11%, var(--card));
    color: var(--ink);
  }
  .rn {
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.06em;
  }
  .rt {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .agree {
    flex: 0 0 auto;
    display: inline-grid;
    place-items: center;
    color: var(--ink-soft);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  /* ── How joining works ── */
  .how {
    padding: clamp(1.4rem, 3vw, 2.2rem);
    border-radius: 22px;
    background: var(--paper);
    max-width: 44rem;
  }
  .how h2 {
    margin: 0 0 1rem;
    font-family: var(--font-serif);
    font-weight: 500;
    font-size: clamp(1.5rem, 1.2rem + 1vw, 2rem);
    color: var(--ink);
  }
  .how ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .how li {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    color: var(--ink);
  }
  .hn {
    flex: 0 0 auto;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: 700;
    font-size: 0.86rem;
    background: var(--card);
    border: 1px solid var(--line);
    color: var(--ink);
  }

  /* ── Footer ── */
  .foot {
    margin-top: clamp(2rem, 5vw, 4rem);
    padding: 2.4rem clamp(1rem, 4vw, 3rem) 3rem;
    border-top: 1px solid var(--line);
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }
  .ver {
    margin: 0;
    font-size: 0.78rem;
    letter-spacing: 0.08em;
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }
  .living {
    margin: 0 0 0.8rem;
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 1.08rem;
    color: var(--ink-soft);
  }

  /* ── Empty, failed, loading ── */
  .empty,
  .state {
    margin: 0 auto;
    max-width: 30rem;
    padding: 2rem 1.4rem 3rem;
    text-align: center;
    color: var(--ink-soft);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.8rem;
  }
  .state {
    padding-top: 5rem;
  }
  .empty p,
  .state p {
    margin: 0;
    font-family: var(--font-serif);
    font-size: 1.25rem;
    color: var(--ink);
  }
  .empty__ico {
    width: 3.2rem;
    height: 3.2rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 1.4rem;
    background: var(--paper);
    color: var(--ink-soft);
  }

  .skeleton {
    max-width: 52rem;
    margin: 0 auto;
    padding: 5rem 1.4rem 2rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.9rem;
  }
  .sk {
    display: block;
    border-radius: 10px;
    background: var(--paper);
    animation: sk-pulse 1.6s ease-in-out infinite;
  }
  .sk--eyebrow {
    width: 6rem;
    height: 0.8rem;
  }
  .sk--name {
    width: min(26rem, 80%);
    height: 3.4rem;
    border-radius: 14px;
  }
  .sk--line {
    width: min(34rem, 90%);
    height: 1rem;
  }
  .sk--line.short {
    width: min(22rem, 60%);
  }
  .sk--cta {
    width: 10rem;
    height: 3rem;
    border-radius: 999px;
    margin-top: 0.6rem;
  }
  .sk-grid {
    width: 100%;
    margin-top: 2.4rem;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
    gap: 0.8rem;
  }
  .sk--card {
    height: 7.5rem;
    border-radius: 16px;
  }
  @keyframes sk-pulse {
    50% {
      opacity: 0.55;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sk {
      animation: none;
    }
    .cta {
      transition: none;
    }
  }
</style>
