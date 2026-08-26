<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The front door. When this screen isn't pointed at a holon yet — a fresh
  // visitor on the bare domain, a caretaker unboxing a display — this is what
  // the kiosk shows instead of a board: what Holons is, what it's for, and the
  // one button that starts a holon.
  //
  // Starting a holon happens in Telegram, because the group IS the holon: the
  // "Add {bot} to a group" button hands off to Telegram's own group chooser
  // (`?startgroup=`), the bot joins and posts a link straight back to this
  // board. This page holds the two ends of that loop together — it marks the
  // hand-off on the way out (config.markBotHandoff) and, when the visitor
  // returns to the tab, opens the "your holon is ready" step for them without
  // making them find it again.
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { holonId, settingsOpen } from "$lib/stores";
  import { t } from "$lib/i18n";
  import {
    addToGroupUrl,
    botChatUrl,
    clearBotHandoff,
    COMMUNITY_URL,
    DASHBOARD_BASE,
    DOCS_URL,
    markBotHandoff,
    resolveBotUsername,
    returningFromBot,
    SOURCE_URL,
  } from "$lib/config";
  import { parseHolonRef } from "$lib/holons";

  const bot = resolveBotUsername();

  // ── The return leg ────────────────────────────────────────────────────────
  // Telegram can't hand anything back to this tab, so the hand-off note left
  // in localStorage is what tells us the visitor is mid-flow. Re-checked when
  // the tab becomes visible again, which is exactly the moment they come back.
  let returning = false;
  let openPanel: HTMLElement | null = null;
  let openInput: HTMLInputElement | null = null;
  let scrolledToOpen = false;

  function checkReturn() {
    if (!returningFromBot()) return;
    returning = true;
    if (scrolledToOpen) return;
    scrolledToOpen = true;
    // Wait a frame so the panel has rendered its returning state.
    requestAnimationFrame(() => {
      openPanel?.scrollIntoView({ behavior: "smooth", block: "center" });
      openInput?.focus({ preventScroll: true });
    });
  }

  function onVisibility() {
    if (document.visibilityState === "visible") checkReturn();
  }

  onMount(() => {
    returning = returningFromBot();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", checkReturn);
  });

  onDestroy(() => {
    if (typeof document === "undefined") return;
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", checkReturn);
  });

  /** Leaving for Telegram — leave the note that starts the return leg. */
  function handOff() {
    markBotHandoff();
  }

  // ── "Already have a holon?" ───────────────────────────────────────────────
  let holonRef = "";
  let refError = false;

  async function openBoard() {
    const id = parseHolonRef(holonRef);
    if (!id) {
      refError = true;
      return;
    }
    refError = false;
    clearBotHandoff();
    // Deliberately NOT persisted: the URL is the shareable thing, and a phone
    // opening someone's board must not re-point this device forever (that is
    // what Settings is for). The store set makes the layout rebind now; the
    // path makes it resolve the same way on reload.
    await goto(`/${encodeURIComponent(id)}`);
    holonId.set(id);
  }

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }

  const PILLARS = [
    { titleKey: "home.pillar1Title", bodyKey: "home.pillar1Body", glyph: "◍" },
    { titleKey: "home.pillar2Title", bodyKey: "home.pillar2Body", glyph: "∑" },
    { titleKey: "home.pillar3Title", bodyKey: "home.pillar3Body", glyph: "⋔" },
    { titleKey: "home.pillar4Title", bodyKey: "home.pillar4Body", glyph: "⬡" },
  ] as const;

  const FEARS = [
    "home.fear1",
    "home.fear2",
    "home.fear3",
    "home.fear4",
  ] as const;

  const SAYINGS = ["home.say1", "home.say2", "home.say3", "home.say4"] as const;

  const MAPS = [
    "home.map1",
    "home.map2",
    "home.map3",
    "home.map4",
    "home.map5",
    "home.map6",
    "home.map7",
  ] as const;

  const PRINCIPLES = [
    "home.design1",
    "home.design2",
    "home.design3",
    "home.design4",
    "home.design5",
    "home.design6",
    "home.design7",
    "home.design8",
  ] as const;

  const LEVELS = [
    {
      tagKey: "home.level0Tag",
      titleKey: "home.level0Title",
      bodyKey: "home.level0Body",
    },
    {
      tagKey: "home.level1Tag",
      titleKey: "home.level1Title",
      bodyKey: "home.level1Body",
    },
    {
      tagKey: "home.level2Tag",
      titleKey: "home.level2Title",
      bodyKey: "home.level2Body",
    },
    {
      tagKey: "home.level3Tag",
      titleKey: "home.level3Title",
      bodyKey: "home.level3Body",
    },
    {
      tagKey: "home.level4Tag",
      titleKey: "home.level4Title",
      bodyKey: "home.level4Body",
    },
  ] as const;

  const STEPS = ["home.step1", "home.step2", "home.step3"] as const;
</script>

<svelte:head>
  <title>{$t("home.metaTitle")}</title>
  <meta name="description" content={$t("home.metaDescription")} />
</svelte:head>

<div class="home">
  <!-- ── Hero ───────────────────────────────────────────────────────────── -->
  <header class="hero">
    <div class="wordmark">holons</div>
    <h1>{$t("home.heroTitle")}</h1>
    <p class="lead">{$t("home.heroLead")}</p>
    <div class="hero-cta">
      <a
        class="btn primary"
        href={addToGroupUrl()}
        target="_blank"
        rel="noopener"
        on:click={handOff}
      >
        <svg
          class="tg"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
          />
        </svg>
        <span>{$t("home.ctaStart")}</span>
      </a>
      <button class="btn ghost" on:click={() => scrollTo("what-is-a-holon")}>
        {$t("home.ctaRead")}
      </button>
    </div>
    <p class="note">{$t("home.heroNote")}</p>
  </header>

  <!-- ── Why ────────────────────────────────────────────────────────────── -->
  <section class="section">
    <p class="kicker">{$t("home.problemKicker")}</p>
    <h2>{$t("home.problemTitle")}</h2>
    <p>{$t("home.problemP1")}</p>
    <p>{$t("home.problemP2")}</p>

    <p class="sub">{$t("home.fearsTitle")}</p>
    <div class="fears">
      {#each FEARS as key, i}
        <div class="lift">
          <div class="fear tilt" style="--tilt: {i % 2 ? 0.9 : -1.1}deg">
            {$t(key)}
          </div>
        </div>
      {/each}
    </div>
    <p class="aside">{$t("home.fearsNote")}</p>
    <p>{$t("home.problemP3")}</p>
  </section>

  <!-- ── What a holon is ────────────────────────────────────────────────── -->
  <section class="section band" id="what-is-a-holon">
    <p class="kicker">{$t("home.holonKicker")}</p>
    <h2>{$t("home.holonTitle")}</h2>
    <p>{$t("home.holonP1")}</p>
    <p>{$t("home.holonP2")}</p>

    <div class="pillars">
      {#each PILLARS as p}
        <article class="pillar">
          <div class="glyph" aria-hidden="true">{p.glyph}</div>
          <h3>{$t(p.titleKey)}</h3>
          <p>{$t(p.bodyKey)}</p>
        </article>
      {/each}
    </div>
  </section>

  <!-- ── What the software does ─────────────────────────────────────────── -->
  <section class="section">
    <p class="kicker">{$t("home.layerKicker")}</p>
    <h2>{$t("home.layerTitle")}</h2>
    <p>{$t("home.layerP1")}</p>

    <p class="sub">{$t("home.layerSay")}</p>
    <div class="sayings">
      {#each SAYINGS as key}
        <span class="saying">{$t(key)}</span>
      {/each}
    </div>

    <p>{$t("home.layerP2")}</p>

    <p class="sub">{$t("home.mapsTitle")}</p>
    <ul class="maps">
      {#each MAPS as key}
        <li>{$t(key)}</li>
      {/each}
    </ul>

    <p>{$t("home.memoryP")}</p>
  </section>

  <!-- ── By design ──────────────────────────────────────────────────────── -->
  <section class="section band">
    <p class="kicker">{$t("home.designKicker")}</p>
    <h2>{$t("home.designTitle")}</h2>
    <p>{$t("home.designLead")}</p>
    <ul class="principles">
      {#each PRINCIPLES as key}
        <li>{$t(key)}</li>
      {/each}
    </ul>
  </section>

  <!-- ── How it grows ───────────────────────────────────────────────────── -->
  <section class="section">
    <p class="kicker">{$t("home.levelsKicker")}</p>
    <h2>{$t("home.levelsTitle")}</h2>
    <p>{$t("home.levelsLead")}</p>
    <ol class="levels">
      {#each LEVELS as l}
        <li>
          <span class="tag">{$t(l.tagKey)}</span>
          <h3>{$t(l.titleKey)}</h3>
          <p>{$t(l.bodyKey)}</p>
        </li>
      {/each}
    </ol>
  </section>

  <!-- ── Start ──────────────────────────────────────────────────────────── -->
  <section class="section start" id="start">
    <p class="kicker">{$t("home.startKicker")}</p>
    <h2>{$t("home.startTitle")}</h2>
    <p>{$t("home.startLead")}</p>

    <ol class="steps">
      {#each STEPS as key, i}
        <li><span class="num">{i + 1}</span><span>{$t(key, { bot })}</span></li>
      {/each}
    </ol>

    <a
      class="btn primary big"
      href={addToGroupUrl()}
      target="_blank"
      rel="noopener"
      on:click={handOff}
    >
      <svg
        class="tg"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
        />
      </svg>
      <span>{$t("home.startButton", { bot })}</span>
    </a>

    <p class="alt">
      <a href={botChatUrl()} target="_blank" rel="noopener" on:click={handOff}>
        {$t("home.startAlt")}
      </a>
      <span class="alt-note">{$t("home.startAltNote", { bot })}</span>
    </p>

    <!-- The return leg: paste what the bot gave you and this screen becomes
         that holon's board. Highlighted when we know they've just come back
         from Telegram. -->
    <div class="open" class:returning bind:this={openPanel}>
      <h3>{returning ? $t("home.backTitle") : $t("home.openTitle")}</h3>
      <p>{returning ? $t("home.backLead") : $t("home.openLead")}</p>
      <form
        on:submit|preventDefault={openBoard}
        aria-describedby={refError ? "holon-ref-error" : undefined}
      >
        <input
          bind:this={openInput}
          bind:value={holonRef}
          on:input={() => (refError = false)}
          type="text"
          inputmode="url"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          aria-label={$t("home.openAria")}
          aria-invalid={refError}
          placeholder={$t("home.openPlaceholder")}
        />
        <button type="submit" class="btn primary compact">
          {$t("home.openButton")}
        </button>
      </form>
      {#if refError}
        <p class="error" id="holon-ref-error" role="alert">
          {$t("home.openInvalid")}
        </p>
      {/if}
    </div>
  </section>

  <!-- ── Where this goes ────────────────────────────────────────────────── -->
  <section class="section band closing">
    <p class="kicker">{$t("home.closingKicker")}</p>
    <p>{$t("home.closingP1")}</p>
    <p>{$t("home.closingP2")}</p>
    <p class="crescendo">{$t("home.closingP3")}</p>
  </section>

  <!-- ── Footer ─────────────────────────────────────────────────────────── -->
  <footer class="foot">
    <nav>
      <a href={DOCS_URL} target="_blank" rel="noopener"
        >{$t("home.footerDocs")}</a
      >
      <a href={DASHBOARD_BASE} target="_blank" rel="noopener"
        >{$t("home.footerDashboard")}</a
      >
      <a href={COMMUNITY_URL} target="_blank" rel="noopener"
        >{$t("home.footerCommunity")}</a
      >
      <a href={SOURCE_URL} target="_blank" rel="noopener"
        >{$t("home.footerSource")}</a
      >
      <button on:click={() => settingsOpen.set(true)}
        >{$t("home.footerSetup")}</button
      >
    </nav>
    <p class="caretaker">{$t("home.caretakerNote")}</p>
    <p class="license">{$t("home.footerLicense")}</p>
  </footer>
</div>

<style>
  /* The board locks the viewport and forbids selection; a page you are meant
     to READ needs the opposite of both. */
  .home {
    min-height: 100dvh;
    /* The bands paint out to the viewport edges (see .band::before); clip that
       overhang rather than letting it scroll the page sideways. */
    overflow-x: clip;
    background: radial-gradient(
      120% 55% at 50% -12%,
      var(--paper) 38%,
      var(--paper-deep) 100%
    );
    color: var(--ink);
    padding: 0 1.4rem calc(2rem + env(safe-area-inset-bottom));
    -webkit-user-select: text;
    user-select: text;
    animation: kiosk-fade 0.5s ease both;
  }

  /* ── Hero ──────────────────────────────────────────────────────────────── */
  .hero {
    max-width: 46rem;
    margin: 0 auto;
    padding: clamp(3rem, 12vh, 7rem) 0 clamp(2rem, 6vh, 4rem);
    text-align: center;
  }
  .wordmark {
    font-family: var(--font-logo);
    font-size: 1.5rem;
    font-weight: 500;
    letter-spacing: 0.22em;
    text-transform: lowercase;
    color: var(--teal);
    margin-bottom: 1.6rem;
  }
  .hero h1 {
    font-size: clamp(2.1rem, 5.4vw, 3.4rem);
    line-height: 1.08;
    letter-spacing: -0.015em;
    margin: 0 0 1.1rem;
    text-wrap: balance;
  }
  .lead {
    font-size: 1.16rem;
    line-height: 1.62;
    color: var(--ink-soft);
    margin: 0 auto;
    max-width: 34rem;
    text-wrap: pretty;
  }
  .hero-cta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    justify-content: center;
    margin: 2rem 0 1.1rem;
  }
  .note {
    color: var(--muted);
    font-size: 0.92rem;
    margin: 0;
  }

  /* ── Buttons ───────────────────────────────────────────────────────────── */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    min-height: var(--tap);
    padding: 0 1.7rem;
    border-radius: 16px;
    font-weight: 700;
    font-size: 1.02rem;
    text-decoration: none;
    transition:
      transform 0.12s ease,
      box-shadow 0.12s ease;
  }
  .btn:active {
    transform: scale(0.975);
  }
  .btn.primary {
    background: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-note);
  }
  .btn.compact {
    min-height: 52px;
    padding: 0 1.4rem;
    font-size: 0.98rem;
    box-shadow: var(--shadow-soft);
  }
  .btn.ghost {
    background: transparent;
    color: var(--ink);
    border: 1.5px solid var(--line);
  }
  .btn.big {
    min-height: 4.2rem;
    font-size: 1.14rem;
    padding: 0 2.2rem;
  }
  .tg {
    width: 1.35em;
    height: 1.35em;
    flex: none;
  }

  /* ── Sections ──────────────────────────────────────────────────────────── */
  .section {
    max-width: 42rem;
    margin: 0 auto;
    padding: clamp(2.6rem, 8vh, 4.6rem) 0;
  }
  .section > p {
    font-size: 1.06rem;
    line-height: 1.72;
    color: var(--ink-soft);
    margin: 0 0 1.1rem;
    text-wrap: pretty;
  }
  .section > p.kicker {
    font-size: 0.8rem;
    font-weight: 800;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--teal);
    margin-bottom: 0.6rem;
  }
  h2 {
    font-size: clamp(1.6rem, 3.4vw, 2.2rem);
    line-height: 1.16;
    letter-spacing: -0.01em;
    margin: 0 0 1.2rem;
    color: var(--ink);
    text-wrap: balance;
  }
  .section > p.sub {
    font-weight: 700;
    color: var(--ink);
    margin-top: 1.8rem;
    margin-bottom: 0.9rem;
  }
  .section > p.aside {
    font-style: italic;
    color: var(--muted);
  }

  /* A band gives the long read a change of ground. The section keeps its
     normal reading column; only the painted ground goes full-bleed, stretched
     to the viewport edges from wherever the column happens to sit. */
  .band {
    position: relative;
  }
  .band::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(50% - 50vw);
    right: calc(50% - 50vw);
    background: var(--card);
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    z-index: 0;
  }
  .band > * {
    position: relative;
    z-index: 1;
  }

  /* ── Fears (post-its) ──────────────────────────────────────────────────── */
  .fears {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: 1.1rem;
    margin: 0 0 1.6rem;
  }
  .fear {
    padding: 1.15rem 1.15rem 1.4rem;
    border-radius: 4px;
    font-size: 1rem;
    line-height: 1.45;
    font-style: italic;
    color: var(--ink);
    min-height: 6.4rem;
    display: flex;
    align-items: center;
  }
  .fears > :nth-child(1) .fear {
    background: var(--note-sun);
  }
  .fears > :nth-child(2) .fear {
    background: var(--note-coral);
  }
  .fears > :nth-child(3) .fear {
    background: var(--note-sky);
  }
  .fears > :nth-child(4) .fear {
    background: var(--note-lav);
  }

  /* ── Pillars ───────────────────────────────────────────────────────────── */
  .pillars {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: 1.1rem;
    margin-top: 2rem;
  }
  .pillar {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 1.4rem;
  }
  .pillar .glyph {
    font-size: 1.7rem;
    line-height: 1;
    color: var(--teal);
    margin-bottom: 0.7rem;
  }
  .pillar h3 {
    margin: 0 0 0.5rem;
    font-size: 1.12rem;
    color: var(--ink);
  }
  .pillar p {
    margin: 0;
    font-size: 0.98rem;
    line-height: 1.6;
    color: var(--ink-soft);
  }

  /* ── Sayings / maps ────────────────────────────────────────────────────── */
  .sayings {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-bottom: 1.6rem;
  }
  .saying {
    background: var(--note-mint);
    color: var(--ink);
    border-radius: 999px;
    padding: 0.55rem 1.1rem;
    font-size: 1rem;
    font-weight: 600;
  }
  .maps {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
    padding: 0;
    margin: 0 0 1.6rem;
  }
  .maps li {
    border: 1px dashed var(--line);
    border-radius: 999px;
    padding: 0.45rem 0.95rem;
    font-size: 0.96rem;
    color: var(--ink-soft);
  }
  .maps li:last-child {
    border-style: solid;
    border-color: var(--teal);
    color: var(--teal);
    font-weight: 700;
  }

  /* ── Principles ────────────────────────────────────────────────────────── */
  .principles {
    list-style: none;
    padding: 0;
    margin: 1.6rem auto 0;
    display: grid;
    gap: 0.85rem;
  }
  .principles li {
    position: relative;
    padding-left: 1.9rem;
    font-size: 1.02rem;
    line-height: 1.6;
    color: var(--ink-soft);
  }
  .principles li::before {
    content: "✓";
    position: absolute;
    left: 0;
    top: 0;
    color: var(--teal);
    font-weight: 800;
  }

  /* ── Levels ────────────────────────────────────────────────────────────── */
  .levels {
    list-style: none;
    padding: 0;
    margin: 2rem 0 0;
    display: grid;
    gap: 0.9rem;
  }
  .levels li {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 1.3rem 1.4rem;
  }
  .levels .tag {
    display: inline-block;
    font-size: 0.74rem;
    font-weight: 800;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--teal);
    margin-bottom: 0.45rem;
  }
  .levels h3 {
    margin: 0 0 0.45rem;
    font-size: 1.16rem;
  }
  .levels p {
    margin: 0;
    font-size: 0.99rem;
    line-height: 1.62;
    color: var(--ink-soft);
  }

  /* ── Start ─────────────────────────────────────────────────────────────── */
  .start {
    text-align: center;
  }
  .steps {
    list-style: none;
    counter-reset: step;
    padding: 0;
    margin: 2rem auto;
    max-width: 34rem;
    display: grid;
    gap: 0.9rem;
    text-align: left;
  }
  .steps li {
    display: flex;
    align-items: flex-start;
    gap: 0.85rem;
    font-size: 1.02rem;
    line-height: 1.6;
    color: var(--ink-soft);
  }
  .steps .num {
    flex: none;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 50%;
    background: var(--teal);
    color: #fff;
    font-weight: 800;
    font-size: 0.95rem;
    display: grid;
    place-items: center;
  }
  .start > p.alt {
    margin: 1.4rem auto 0;
    max-width: 30rem;
  }
  .alt a {
    color: var(--teal);
    font-weight: 700;
    text-decoration: none;
    border-bottom: 1.5px solid color-mix(in srgb, var(--teal) 40%, transparent);
  }
  .alt-note {
    display: block;
    margin-top: 0.5rem;
    font-size: 0.92rem;
    color: var(--muted);
    line-height: 1.55;
  }

  /* ── The return panel ──────────────────────────────────────────────────── */
  .open {
    margin: 3rem auto 0;
    max-width: 34rem;
    text-align: left;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 1.5rem;
    transition:
      border-color 0.3s ease,
      box-shadow 0.3s ease;
  }
  .open.returning {
    border-color: var(--teal);
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--teal) 18%, transparent),
      var(--shadow-soft);
  }
  .open h3 {
    margin: 0 0 0.4rem;
    font-size: 1.16rem;
  }
  .open > p {
    margin: 0 0 1rem;
    font-size: 0.99rem;
    line-height: 1.6;
    color: var(--ink-soft);
  }
  .open form {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  .open input {
    flex: 1 1 14rem;
    min-width: 0;
    min-height: 52px;
    padding: 0 0.95rem;
    font: inherit;
    font-size: 1rem;
    color: var(--ink);
    background: var(--paper);
    border: 1.5px solid var(--line);
    border-radius: 12px;
  }
  .open input:focus {
    outline: none;
    border-color: var(--teal);
  }
  .open input[aria-invalid="true"] {
    border-color: #c0567a;
  }
  .error {
    margin: 0.75rem 0 0;
    font-size: 0.94rem;
    line-height: 1.5;
    color: #c0567a;
  }

  /* ── Closing ───────────────────────────────────────────────────────────── */
  .closing > p.crescendo {
    font-size: 1.22rem;
    line-height: 1.6;
    color: var(--ink);
    font-weight: 600;
  }

  /* ── Footer ────────────────────────────────────────────────────────────── */
  .foot {
    max-width: 42rem;
    margin: 0 auto;
    padding: 2.6rem 0 0;
    text-align: center;
    border-top: 1px solid var(--line);
  }
  .foot nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.4rem;
    justify-content: center;
    margin-bottom: 1.3rem;
  }
  .foot nav a,
  .foot nav button {
    color: var(--ink-soft);
    text-decoration: none;
    font-size: 0.98rem;
    font-weight: 600;
    min-height: 2.6rem;
    display: inline-flex;
    align-items: center;
  }
  .foot nav a:hover,
  .foot nav button:hover {
    color: var(--teal);
  }
  .caretaker,
  .license {
    color: var(--muted);
    font-size: 0.88rem;
    line-height: 1.55;
    margin: 0 auto 0.6rem;
    max-width: 32rem;
  }
</style>
