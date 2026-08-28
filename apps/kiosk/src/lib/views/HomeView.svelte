<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The front door. When this screen isn't pointed at a holon yet — a fresh
  // visitor on the bare domain, a caretaker unboxing a display — this is what
  // the kiosk shows instead of a board: what a hub is, the two ways to start
  // one, and how hubs connect. Short on purpose; the long read lives at
  // docs.holons.io. It wears the kiosk's own skin (paper, ink, a little teal,
  // the same tokens as the board behind it) so the door and the room match.
  //
  // Both paths lead into Telegram, because the chat IS the hub:
  //   personal  a private chat with the bot (`?start=`) — the visitor's own hub
  //   group     the add-to-group chooser (`?startgroup=`) — the group is the hub
  // Either way the bot answers with a link straight back to this board. This
  // page holds the two ends of that loop together — it marks the hand-off on
  // the way out (config.markBotHandoff) and, when the visitor returns to the
  // tab, opens the "your hub is ready" step without making them find it again.
  //
  // The bot is never named in the copy: a fork running its own bot re-points
  // VITE_TELEGRAM_BOT_USERNAME and every deep link follows, with no string to
  // retranslate in three catalogs.
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
    returningFromBot,
    SOURCE_URL,
  } from "$lib/config";
  import { parseHolonPaste } from "$lib/holons";

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

  // ── "Already have a hub?" ─────────────────────────────────────────────────
  let holonRef = "";
  let refError = false;

  async function openBoard() {
    const id = parseHolonPaste(holonRef);
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

  const TOOLS = [
    "home.tool1",
    "home.tool2",
    "home.tool3",
    "home.tool4",
    "home.tool5",
    "home.tool6",
    "home.tool7",
    "home.tool8",
  ] as const;
</script>

{#snippet tgIcon()}
  <svg class="tg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path
      d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
    />
  </svg>
{/snippet}

<!-- ── Illustrations ─────────────────────────────────────────────────────────
     Drawn inline rather than shipped as files: the kiosk is offline-first, and
     an SVG built from the theme tokens (`--teal`, `--line`, the page ground)
     re-tints itself at sunset instead of going luminous on a dark wall. Every
     membrane is painted with the ground it sits on, so the links behind it are
     occluded without any masking. -->

{#snippet netArt()}
  <svg
    class="art art--net"
    viewBox="0 0 640 190"
    role="img"
    aria-label={$t("home.artNetAlt")}
  >
    <g class="link">
      <line x1="90" y1="120" x2="320" y2="105" />
      <line x1="205" y1="55" x2="320" y2="105" />
      <line x1="320" y1="105" x2="452" y2="52" />
      <line x1="320" y1="105" x2="556" y2="122" />
      <line x1="90" y1="120" x2="205" y2="55" class="soft" />
      <line x1="452" y1="52" x2="556" y2="122" class="soft" />
    </g>

    <g class="hub">
      <circle cx="90" cy="120" r="26" />
      <circle cx="205" cy="55" r="21" />
      <circle cx="452" cy="52" r="23" />
      <circle cx="556" cy="122" r="28" />
    </g>
    <g class="hub hub--lead">
      <circle cx="320" cy="105" r="38" />
    </g>

    <g class="member">
      <circle cx="80" cy="114" r="3.4" />
      <circle cx="97" cy="110" r="3.4" />
      <circle cx="95" cy="130" r="3.4" />

      <circle cx="198" cy="50" r="3.2" />
      <circle cx="211" cy="48" r="3.2" />
      <circle cx="207" cy="63" r="3.2" />

      <circle cx="445" cy="46" r="3.2" />
      <circle cx="459" cy="45" r="3.2" />
      <circle cx="455" cy="61" r="3.2" />

      <circle cx="545" cy="114" r="3.4" />
      <circle cx="562" cy="111" r="3.4" />
      <circle cx="565" cy="130" r="3.4" />
      <circle cx="547" cy="132" r="3.4" />
    </g>
    <g class="member member--lead">
      <circle cx="305" cy="93" r="4" />
      <circle cx="325" cy="88" r="4" />
      <circle cx="337" cy="107" r="4" />
      <circle cx="313" cy="120" r="4" />
      <circle cx="332" cy="122" r="4" />
    </g>
  </svg>
{/snippet}

{#snippet personArt()}
  <!-- One person, many hubs: your own membrane at the centre, and the hubs you
       take part in around it. The mirror of the group card, which is many
       people inside one membrane. -->
  <svg class="art art--card" viewBox="0 0 120 96" aria-hidden="true">
    <g class="link">
      <line x1="60" y1="48" x2="22" y2="24" class="soft" />
      <line x1="60" y1="48" x2="98" y2="22" class="soft" />
      <line x1="60" y1="48" x2="20" y2="74" class="soft" />
      <line x1="60" y1="48" x2="100" y2="72" class="soft" />
    </g>
    <g class="hub">
      <circle cx="22" cy="24" r="10" />
      <circle cx="98" cy="22" r="10" />
      <circle cx="20" cy="74" r="10" />
      <circle cx="100" cy="72" r="10" />
    </g>
    <g class="hub hub--lead"><circle cx="60" cy="48" r="21" /></g>
    <g class="member member--lead"><circle cx="60" cy="48" r="6.5" /></g>
  </svg>
{/snippet}

{#snippet groupArt()}
  <svg class="art art--card" viewBox="0 0 120 96" aria-hidden="true">
    <g class="link">
      <line x1="44" y1="36" x2="76" y2="34" />
      <line x1="44" y1="36" x2="40" y2="62" />
      <line x1="76" y1="34" x2="80" y2="62" />
      <line x1="40" y1="62" x2="80" y2="62" />
      <line x1="44" y1="36" x2="80" y2="62" class="soft" />
      <line x1="76" y1="34" x2="40" y2="62" class="soft" />
    </g>
    <g class="hub hub--lead"><circle cx="60" cy="48" r="34" /></g>
    <g class="member member--lead">
      <circle cx="44" cy="36" r="5.5" />
      <circle cx="76" cy="34" r="5.5" />
      <circle cx="40" cy="62" r="5.5" />
      <circle cx="80" cy="62" r="5.5" />
    </g>
  </svg>
{/snippet}

{#snippet connectArt()}
  <svg
    class="art art--connect"
    viewBox="0 0 640 200"
    role="img"
    aria-label={$t("home.artConnectAlt")}
  >
    <g class="hub">
      <circle cx="200" cy="100" r="72" />
      <circle cx="440" cy="100" r="72" />
    </g>

    <!-- What crosses, and only what each side published. -->
    <g class="crossing">
      <path d="M278 74 H362" />
      <path d="M354 68 L363 74 L354 80" />
      <path d="M362 126 H278" />
      <path d="M286 120 L277 126 L286 132" />
    </g>
    <g class="parcel">
      <rect x="308" y="60" width="24" height="24" rx="6" />
      <rect x="308" y="116" width="24" height="24" rx="6" />
    </g>

    <g class="member member--lead">
      <circle cx="176" cy="80" r="6" />
      <circle cx="212" cy="72" r="6" />
      <circle cx="168" cy="118" r="6" />
      <circle cx="210" cy="124" r="6" />
      <circle cx="418" cy="76" r="6" />
      <circle cx="454" cy="86" r="6" />
      <circle cx="424" cy="120" r="6" />
      <circle cx="458" cy="122" r="6" />
    </g>
  </svg>
{/snippet}

<svelte:head>
  <title>{$t("home.metaTitle")}</title>
  <meta name="description" content={$t("home.metaDescription")} />
</svelte:head>

<div class="home">
  <!-- ── Hero + the two paths ───────────────────────────────────────────── -->
  <header class="hero" id="start">
    <div class="wordmark">hubs network</div>
    <h1>{$t("home.heroTitle")}</h1>
    <p class="lead">{$t("home.heroLead")}</p>

    {@render netArt()}

    <div class="paths">
      <article class="path">
        {@render personArt()}
        <p class="path-kicker">{$t("home.personalKicker")}</p>
        <h2>{$t("home.personalTitle")}</h2>
        <p>{$t("home.personalBody")}</p>
        <a
          class="btn primary"
          href={botChatUrl()}
          target="_blank"
          rel="noopener"
          on:click={handOff}
        >
          {@render tgIcon()}
          <span>{$t("home.personalButton")}</span>
        </a>
      </article>

      <article class="path">
        {@render groupArt()}
        <p class="path-kicker">{$t("home.groupKicker")}</p>
        <h2>{$t("home.groupTitle")}</h2>
        <p>{$t("home.groupBody")}</p>
        <a
          class="btn primary"
          href={addToGroupUrl()}
          target="_blank"
          rel="noopener"
          on:click={handOff}
        >
          {@render tgIcon()}
          <span>{$t("home.groupButton")}</span>
        </a>
      </article>
    </div>

    <p class="note">{$t("home.pathsNote")}</p>
  </header>

  <!-- ── What a hub runs ────────────────────────────────────────────────── -->
  <section class="section band">
    <p class="kicker">{$t("home.toolsKicker")}</p>
    <h2>{$t("home.toolsTitle")}</h2>
    <p>{$t("home.toolsLead")}</p>
    <ul class="tools">
      {#each TOOLS as key}
        <li>{$t(key)}</li>
      {/each}
    </ul>
    <p class="aside">{$t("home.toolsNote")}</p>
  </section>

  <!-- ── Connectors ─────────────────────────────────────────────────────── -->
  <section class="section">
    <p class="kicker">{$t("home.fedKicker")}</p>
    <h2>{$t("home.fedTitle")}</h2>
    <p>{$t("home.fedP1")}</p>
    {@render connectArt()}
    <p>{$t("home.fedP2")}</p>
    <p class="crescendo">{$t("home.fedP3")}</p>
  </section>

  <!-- ── The return leg: paste what the bot gave you and this screen
       becomes that hub's board. Highlighted when we know they've just
       come back from Telegram. ─────────────────────────────────────────── -->
  <section class="section band">
    <div class="open" class:returning bind:this={openPanel}>
      <h2>{returning ? $t("home.backTitle") : $t("home.openTitle")}</h2>
      <p>{returning ? $t("home.backLead") : $t("home.openLead")}</p>
      <p class="hint">
        <code>/id</code>
        <span>{$t("home.openHint")}</span>
      </p>
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
     to READ needs the opposite of both. Everything else here is the kiosk's
     own skin — paper, ink, a little teal, the tokens app.css defines — so the
     front door looks like the room behind it in both day and night palettes. */
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
    padding: clamp(2.6rem, 10vh, 6rem) 0 clamp(2rem, 6vh, 4rem);
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
  .note {
    color: var(--muted);
    font-size: 0.92rem;
    line-height: 1.55;
    max-width: 32rem;
    margin: 1.4rem auto 0;
  }

  /* ── The two paths ─────────────────────────────────────────────────────── */
  .paths {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
    gap: 1.1rem;
    margin-top: 2.6rem;
    text-align: left;
  }
  .path {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 1.5rem;
  }
  .path-kicker {
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--teal);
    margin: 0;
  }
  .path h2 {
    margin: 0;
    font-size: 1.24rem;
    line-height: 1.2;
  }
  .path p {
    margin: 0 0 0.5rem;
    font-size: 0.99rem;
    line-height: 1.6;
    color: var(--ink-soft);
  }
  /* Buttons sit on a shared baseline however long the copy above them runs. */
  .path .btn {
    margin-top: auto;
  }

  /* ── Illustrations ─────────────────────────────────────────────────────────
     One vocabulary across all four drawings: a membrane is a circle painted
     with the ground it sits on, members are teal dots inside it, links are
     hairlines that the membranes occlude. `--ground` is set per placement so a
     card's art hides its links against --card and the hero's against --paper. */
  .art {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }
  .art .link line {
    stroke: var(--teal);
    stroke-width: 1.5;
    opacity: 0.5;
  }
  .art .link line.soft {
    stroke: var(--muted);
    stroke-width: 1.2;
    stroke-dasharray: 4 6;
    opacity: 0.65;
  }
  .art .hub circle {
    fill: var(--ground);
    stroke: var(--line);
    stroke-width: 1.5;
  }
  .art .hub--lead circle {
    stroke: var(--teal);
    stroke-width: 2;
    fill: color-mix(in srgb, var(--teal) 7%, var(--ground));
  }
  .art .member circle {
    fill: var(--muted);
  }
  .art .member--lead circle {
    fill: var(--teal);
  }
  .art .crossing path {
    fill: none;
    stroke: var(--teal);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .art .parcel rect {
    fill: var(--ground);
    stroke: var(--teal);
    stroke-width: 1.6;
  }

  /* The wide drawings breathe; the card ones are a header, not a picture. */
  .art--net {
    --ground: var(--paper);
    max-width: 40rem;
    margin: 2.4rem auto 0;
  }
  .art--connect {
    --ground: var(--paper);
    max-width: 34rem;
    margin: 1.6rem auto 2rem;
  }
  .art--card {
    --ground: var(--card);
    width: 7.5rem;
    margin-bottom: 0.4rem;
  }

  /* ── The /id hint ──────────────────────────────────────────────────────── */
  .hint {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0 0 1rem;
    font-size: 0.95rem;
    line-height: 1.45;
    color: var(--ink-soft);
  }
  .hint code {
    flex: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--teal);
    background: color-mix(in srgb, var(--teal) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--teal) 30%, transparent);
    border-radius: 8px;
    padding: 0.24rem 0.55rem;
  }

  /* ── Buttons ───────────────────────────────────────────────────────────── */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    min-height: var(--tap);
    padding: 0 1.4rem;
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
    font-size: 0.98rem;
    box-shadow: var(--shadow-soft);
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
    padding: clamp(2.4rem, 7vh, 4rem) 0;
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
  .section > h2 {
    font-size: clamp(1.6rem, 3.4vw, 2.2rem);
    line-height: 1.16;
    letter-spacing: -0.01em;
    margin: 0 0 1.2rem;
    color: var(--ink);
    text-wrap: balance;
  }
  .section > p.aside {
    font-size: 0.96rem;
    color: var(--muted);
    margin-bottom: 0;
  }
  .section > p.crescendo {
    font-size: 1.18rem;
    line-height: 1.58;
    font-weight: 600;
    color: var(--ink);
    margin-bottom: 0;
  }

  /* A band gives the page a change of ground. The section keeps its normal
     reading column; only the painted ground goes full-bleed, stretched to the
     viewport edges from wherever the column happens to sit. */
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

  /* ── The tool set ──────────────────────────────────────────────────────── */
  .tools {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
    padding: 0;
    margin: 0 0 1.4rem;
  }
  .tools li {
    border: 1px dashed var(--line);
    border-radius: 999px;
    padding: 0.45rem 0.95rem;
    font-size: 0.96rem;
    color: var(--ink-soft);
  }
  .tools li:last-child {
    border-style: solid;
    border-color: var(--teal);
    color: var(--teal);
    font-weight: 700;
  }

  /* ── The return panel ──────────────────────────────────────────────────── */
  .open {
    margin: 0 auto;
    max-width: 34rem;
    background: var(--paper);
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
  .open h2 {
    margin: 0 0 0.4rem;
    font-size: 1.24rem;
    line-height: 1.2;
    color: var(--ink);
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
    background: var(--card);
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
