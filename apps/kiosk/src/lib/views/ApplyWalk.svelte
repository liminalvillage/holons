<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  //
  // The walk — `/<holon>/apply`: before asking to join, a person goes
  // through every gene that asks for it, one per screen — "I've read this",
  // or "I agree to …" — then reviews, ticks their agreement to the DNA as a
  // whole, and sends the request, which carries the version they agreed to.
  // Back is always there; nothing is timed or quizzed.
  //
  // Where they stand is core's (`walkProgress`): a gene edited since they
  // acknowledged it is stale and asked again. This device keeps the walk per
  // holon and person (lib/dna.ts). A handoff link (`?dna=<hash>`) carrying the
  // DNA as it is now opens the review with every part ticked — it skips the
  // reading, never the agreement. The request itself is core's
  // `applyToHolon`, which refuses a DNA that changed meanwhile.
  import { onDestroy, tick } from "svelte";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import {
    acknowledgeStep,
    unacknowledgeStep,
    walkProgress,
    type AlleleView,
    type GeneView,
    type WalkState,
    type WalkStep,
  } from "@holons/core/dna";
  import { DnaChanged, DnaNotAcknowledged } from "@holons/core/holons";
  import {
    frontState,
    handoffHash,
    loadWalk,
    reloadFront,
    saveWalk,
    watchFront,
  } from "$lib/dna";
  import { applyFor } from "$lib/hubmembers";
  import { hrefForPage } from "$lib/tabroute";
  import { holonId, holonName } from "$lib/stores";
  import { sessionKeyPub } from "$lib/sessionKey";
  import { currentUser, displayName, loginOpen } from "$lib/auth";
  import { t } from "$lib/i18n";
  import Icon from "$lib/components/Icon.svelte";
  import GeneSection from "$lib/components/GeneSection.svelte";
  import AlleleDrawer from "$lib/components/AlleleDrawer.svelte";

  // ── The front, read ──────────────────────────────────────────────────────
  let stop: (() => void) | null = null;
  let watched = "";
  $: watchKey = `${$holonId ?? ""}|${$sessionKeyPub ?? ""}`;
  $: if ($holonId && watchKey !== watched) {
    watched = watchKey;
    stop?.();
    stop = watchFront($holonId, $sessionKeyPub);
  }
  onDestroy(() => stop?.());

  $: front =
    $frontState.status === "ready" && $frontState.holon === $holonId
      ? $frontState.front
      : null;
  $: failed = $frontState.status === "error" && $frontState.holon === $holonId;
  $: label = front?.name || $holonName || $holonId || "";

  // ── The walk on this device ──────────────────────────────────────────────
  let walk: WalkState = { acks: {} };
  let walkFor = "";
  $: if ($holonId && watchKey !== walkFor) {
    walkFor = watchKey;
    walk = loadWalk($holonId, $sessionKeyPub);
  }
  function keep(next: WalkState) {
    walk = next;
    if ($holonId) saveWalk($holonId, $sessionKeyPub, next);
  }

  $: steps = front?.walk ?? [];
  $: progress = walkProgress(steps, walk, front?.dna.hash ?? null);
  $: genesById = new Map((front?.genes ?? []).map((g) => [g.id, g]));

  // ── Where the person is ──────────────────────────────────────────────────
  type Screen = "intro" | "review" | number;
  let screen: Screen = "intro";
  /** The DNA version the start was decided for (re-decided while still on the intro). */
  let decidedFor: string | null | undefined;
  let handoff: "current" | "stale" | null = null;
  let scroller: HTMLElement;
  let heading: HTMLElement;

  // The first look decides where to start: a handoff carrying the DNA as it
  // is now lands on the review, ticked; anything else on the intro. A DNA
  // that arrives later (a read that was still catching up) decides again,
  // as long as the person has not moved off the intro.
  $: if (front && screen === "intro" && decidedFor !== front.dna.hash) {
    decidedFor = front.dna.hash;
    const carried = handoffHash($page.url.search);
    handoff = null;
    if (carried && front.dna.hash && carried === front.dna.hash) {
      let next = walk;
      for (const s of steps) next = acknowledgeStep(next, s);
      keep(next);
      handoff = "current";
      screen = "review";
    } else if (carried) handoff = "stale";
  }

  async function show(next: Screen) {
    screen = next;
    open = null;
    await tick();
    scroller?.scrollTo({ top: 0 });
    heading?.focus({ preventScroll: true });
  }

  const indexOf = (gene: string | null) =>
    gene ? steps.findIndex((s) => s.gene === gene) : -1;

  function begin() {
    const at = indexOf(progress.current);
    void show(progress.complete ? "review" : at >= 0 ? at : 0);
  }
  function next(i: number) {
    void show(i + 1 < steps.length ? i + 1 : "review");
  }
  function back(i: number) {
    void show(i > 0 ? i - 1 : "intro");
  }

  $: step = typeof screen === "number" ? (steps[screen] ?? null) : null;
  $: gene = step ? (genesById.get(step.gene) ?? null) : null;
  $: done = (s: WalkStep) => walk.acks[s.gene] === s.hash;
  $: stale = (s: WalkStep) => progress.stale.includes(s.gene);

  function readIt(i: number, s: WalkStep) {
    keep(acknowledgeStep(walk, s));
    next(i);
  }
  function setAgreed(s: WalkStep, on: boolean) {
    keep(on ? acknowledgeStep(walk, s) : unacknowledgeStep(walk, s));
  }

  // ── Review and send ──────────────────────────────────────────────────────
  let name = "";
  let named = false;
  $: if (!named && $currentUser) name = displayName($currentUser);
  let consent = false;
  let consentFor: string | null = null;
  // Agreeing is to one version: a new DNA unticks the box.
  $: if ((front?.dna.hash ?? null) !== consentFor) {
    consentFor = front?.dna.hash ?? null;
    consent = false;
  }
  let sending = false;
  let problem: string | null = null;

  $: needsConsent = !!front?.dna.hash;
  $: canSend =
    !!front &&
    progress.complete &&
    (!needsConsent || consent) &&
    !!$sessionKeyPub &&
    !sending;

  async function send() {
    if (!front || !$holonId || !canSend) return;
    sending = true;
    problem = null;
    try {
      await applyFor($holonId, progress.hash, name.trim());
      await goto(hrefForPage($page.url, "onboarding"));
    } catch (err) {
      if (err instanceof DnaChanged || err instanceof DnaNotAcknowledged) {
        problem = $t("walk.changed");
        await reloadFront();
      } else {
        problem = $t("walk.failed", {
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      sending = false;
    }
  }

  // ── The drawer ───────────────────────────────────────────────────────────
  let open: { allele: AlleleView; gene: GeneView } | null = null;

  $: frontHref = hrefForPage($page.url, "dna");
  $: onboardingHref = hrefForPage($page.url, "onboarding");
  $: pct = steps.length
    ? Math.round((progress.done.length / steps.length) * 100)
    : 100;
</script>

<div class="walk" bind:this={scroller}>
  <div class="top">
    <a class="back" href={frontHref}
      ><Icon name="chevron-left" />{$t("walk.toFront")}</a
    >
    {#if front && steps.length}
      <div
        class="progress"
        role="progressbar"
        aria-label={$t("walk.progressLabel")}
        aria-valuemin="0"
        aria-valuemax={steps.length}
        aria-valuenow={progress.done.length}
        aria-valuetext={$t("walk.progress", {
          i: progress.done.length,
          n: steps.length,
        })}
      >
        {#each steps as s, i (s.gene)}
          <span
            class="seg"
            class:done={done(s)}
            class:here={screen === i}
            class:stale={stale(s)}
            style:--g={genesById.get(s.gene)?.color || null}
          ></span>
        {/each}
      </div>
    {/if}
  </div>

  {#if front}
    {#if screen === "intro"}
      <section class="pane intro">
        <p class="eyebrow">{$t("walk.eyebrow")}</p>
        <h1 bind:this={heading} tabindex="-1">
          {$t("walk.title", { holon: label })}
        </h1>
        {#if front.viewer.cta === "linked"}
          <p class="lede">{$t("walk.linkedAlready", { holon: label })}</p>
        {:else if steps.length}
          <p class="lede">{$t("walk.intro", { holon: label })}</p>
          <p class="meta">
            <Icon name="clock" />{$t("walk.introParts", {
              n: steps.length,
              m: front.counts.minutes,
            })}
          </p>
        {:else}
          <p class="lede">{$t("walk.introNone", { holon: label })}</p>
        {/if}
        {#if front.viewer.cta === "continue"}
          <p class="notice">
            <Icon name="info" />{$t("walk.alreadyIn")}
            <a href={onboardingHref}>{$t("front.pending")}</a>
          </p>
        {/if}
        {#if handoff === "stale"}
          <p class="notice warn">
            <Icon name="warning" />{$t("walk.handoffStale")}
          </p>
        {/if}

        {#if steps.length}
          <ol class="parts">
            {#each steps as s, i (s.gene)}
              <li style:--g={genesById.get(s.gene)?.color || null}>
                <span class="pdot"></span>
                <span class="pt">{s.title}</span>
                <span class="pk"
                  >{$t(
                    s.ack === "agree" ? "walk.kindAgree" : "walk.kindRead",
                  )}</span
                >
                {#if done(s)}<span class="ptick" title={$t("walk.done")}
                    ><Icon name="check" /></span
                  >{:else if stale(s)}<span
                    class="pstale"
                    title={$t("walk.stale", { gene: s.title })}
                    ><Icon name="warning" /></span
                  >{/if}
              </li>
            {/each}
          </ol>
        {/if}

        {#if front.viewer.cta !== "linked"}
          <div class="row">
            <button type="button" class="cta" on:click={begin}>
              {#if !steps.length || progress.complete}
                {$t("walk.toReview")}
              {:else if progress.done.length || progress.stale.length}
                {$t("walk.resume")}
              {:else}
                {$t("walk.begin")}
              {/if}
              <Icon name="arrow-right" />
            </button>
          </div>
        {/if}
      </section>
    {:else if step && gene && typeof screen === "number"}
      {@const i = screen}
      {@const s = step}
      <section class="pane gene-pane" aria-labelledby="walk-step">
        <p class="eyebrow" id="walk-step" bind:this={heading} tabindex="-1">
          {$t("walk.progress", { i: i + 1, n: steps.length })}
        </p>
        {#if stale(s)}
          <p class="notice warn">
            <Icon name="warning" />{$t("walk.stale", { gene: s.title })}
          </p>
        {/if}
        <GeneSection
          {gene}
          index={i + 1}
          level={1}
          on:open={(e) => (open = e.detail)}
        />
      </section>
      <div class="bar" style:--g={gene.color || null}>
        <div class="bar__in">
          <button type="button" class="ghost" on:click={() => back(i)}
            ><Icon name="arrow-left" />{$t("walk.back")}</button
          >
          {#if s.ack === "agree"}
            <label class="agree">
              <input
                type="checkbox"
                checked={done(s)}
                on:change={(e) => setAgreed(s, e.currentTarget.checked)}
              />
              <span>{$t("walk.agree", { gene: s.title })}</span>
            </label>
            <button
              type="button"
              class="cta"
              disabled={!done(s)}
              on:click={() => next(i)}
              >{$t("walk.continue")}<Icon name="arrow-right" /></button
            >
          {:else}
            <span class="grow"></span>
            <button type="button" class="cta" on:click={() => readIt(i, s)}
              ><Icon name="check" />{$t("walk.read")}</button
            >
          {/if}
        </div>
      </div>
    {:else}
      <section class="pane review">
        <p class="eyebrow">{$t("walk.eyebrow")}</p>
        <h1 bind:this={heading} tabindex="-1">{$t("walk.review")}</h1>
        {#if handoff === "current"}
          <p class="notice"><Icon name="info" />{$t("walk.handoff")}</p>
        {/if}
        {#if steps.length}
          <ul class="ticks">
            {#each steps as s, i (s.gene)}
              <li style:--g={genesById.get(s.gene)?.color || null}>
                <span class="tick" class:ok={done(s)} aria-hidden="true"
                  ><Icon
                    name={done(s) ? "check" : stale(s) ? "warning" : "disc"}
                  /></span
                >
                <span class="tt">
                  <span class="tn">{s.title}</span>
                  <span class="ts"
                    >{done(s)
                      ? $t(s.ack === "agree" ? "walk.didAgree" : "walk.didRead")
                      : stale(s)
                        ? $t("walk.stale", { gene: s.title })
                        : $t("walk.todo")}</span
                  >
                </span>
                <button
                  type="button"
                  class="ghost small"
                  on:click={() => void show(i)}
                  >{$t(done(s) ? "walk.again" : "walk.open")}</button
                >
              </li>
            {/each}
          </ul>
        {:else}
          <p class="lede">{$t("walk.introNone", { holon: label })}</p>
        {/if}

        <form class="send" on:submit|preventDefault={send}>
          <label class="field">
            <span>{$t("walk.name", { holon: label })}</span>
            <input
              type="text"
              bind:value={name}
              on:input={() => (named = true)}
              autocomplete="name"
              maxlength="80"
            />
          </label>
          {#if needsConsent}
            <label class="consent" class:off={!progress.complete}>
              <input
                type="checkbox"
                bind:checked={consent}
                disabled={!progress.complete}
              />
              <span
                >{$t("walk.consent", {
                  holon: label,
                  short: front.dna.short ?? "",
                })}</span
              >
            </label>
          {/if}
          {#if problem}<p class="notice warn" role="alert">
              <Icon name="warning" />{problem}
            </p>{/if}
          <div class="row">
            {#if !$sessionKeyPub}
              <p class="hint">{$t("walk.loginHint")}</p>
              <button
                type="button"
                class="cta"
                on:click={() => loginOpen.set(true)}
                >{$t("walk.loginToSend")}</button
              >
            {:else}
              <button type="submit" class="cta" disabled={!canSend}
                >{$t(sending ? "walk.sending" : "walk.send")}<Icon
                  name="send"
                /></button
              >
            {/if}
          </div>
          {#if front.after.length}
            <div class="after">
              <p>{$t("walk.next")}</p>
              <ol>
                {#each front.after as a (a.id)}<li>{a.title}</li>{/each}
              </ol>
            </div>
          {/if}
        </form>
      </section>
    {/if}
  {:else if failed}
    <section class="pane state" role="alert">
      <p>{$t("front.unreachable", { holon: label })}</p>
      <button type="button" class="cta" on:click={() => void reloadFront()}
        >{$t("front.retry")}</button
      >
    </section>
  {:else}
    <section class="pane state" aria-busy="true">
      <span class="sk sk--a"></span>
      <span class="sk sk--b"></span>
      <span class="sk sk--c"></span>
    </section>
  {/if}
</div>

{#if open && gene}
  <AlleleDrawer
    allele={open.allele}
    gene={open.gene}
    travel={false}
    on:close={() => (open = null)}
  />
{/if}

<style>
  .walk {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    background: var(--card);
  }

  .top {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.45rem clamp(0.6rem, 3vw, 2rem);
    background: color-mix(in srgb, var(--card) 90%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  .back {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 44px;
    padding: 0 0.8rem 0 0.5rem;
    border-radius: 999px;
    color: var(--ink-soft);
    font-size: 0.86rem;
    text-decoration: none;
  }
  .back:hover {
    color: var(--ink);
    background: var(--paper);
  }
  .progress {
    flex: 1;
    display: flex;
    gap: 4px;
    max-width: 36rem;
    margin-left: auto;
  }
  .seg {
    flex: 1;
    height: 6px;
    border-radius: 6px;
    background: var(--line);
    transition: background 0.3s ease;
  }
  .seg.done {
    background: var(--g, var(--teal));
  }
  .seg.here {
    box-shadow:
      0 0 0 2px var(--card),
      0 0 0 3.5px var(--ink-soft);
  }
  .seg.stale:not(.done) {
    background: repeating-linear-gradient(
      90deg,
      var(--caution) 0 4px,
      transparent 4px 7px
    );
  }

  .pane {
    width: 100%;
    max-width: 52rem;
    margin: 0 auto;
    padding: clamp(1.6rem, 5vw, 3.6rem) clamp(1rem, 4vw, 2.4rem) 2rem;
    box-sizing: border-box;
    animation: kiosk-fade 0.35s ease both;
  }
  .gene-pane {
    max-width: 64rem;
    flex: 1;
  }
  .eyebrow {
    margin: 0 0 0.8rem;
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--ink-soft);
    outline: none;
  }
  h1 {
    margin: 0;
    font-family: var(--font-serif);
    font-weight: 400;
    font-size: clamp(2.2rem, 1.5rem + 3vw, 3.8rem);
    line-height: 1.05;
    color: var(--ink);
    outline: none;
    text-wrap: balance;
  }
  .lede {
    margin: 1.1rem 0 0;
    max-width: 38rem;
    font-family: var(--font-serif);
    font-size: clamp(1.1rem, 1rem + 0.4vw, 1.3rem);
    line-height: 1.55;
    color: var(--ink-soft);
  }
  .meta {
    margin: 0.9rem 0 0;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.92rem;
    color: var(--ink-soft);
  }
  .notice {
    margin: 1rem 0 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-radius: 14px;
    background: var(--teal-wash);
    color: var(--ink);
    font-size: 0.92rem;
    line-height: 1.45;
  }
  .notice a {
    color: var(--teal-ink);
    font-weight: 700;
  }
  .notice.warn {
    background: color-mix(in srgb, var(--caution) 13%, var(--card));
  }
  .notice.warn :global(.icon) {
    color: var(--caution);
  }
  .gene-pane .notice {
    margin: 0 0 1.4rem;
  }

  .parts {
    list-style: none;
    margin: 1.8rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--line);
  }
  .parts li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 3.2rem;
    border-bottom: 1px solid var(--line);
  }
  .pdot {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 50%;
    flex: 0 0 auto;
    background: var(--g, var(--teal));
  }
  .pt {
    flex: 1;
    min-width: 0;
    font-family: var(--font-serif);
    font-size: 1.15rem;
    color: var(--ink);
  }
  .pk {
    font-size: 0.8rem;
    color: var(--ink-soft);
  }
  .ptick {
    color: var(--teal-ink);
  }
  .pstale {
    color: var(--caution);
  }

  .row {
    margin-top: 1.8rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem;
  }
  .cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 48px;
    padding: 0 1.4rem;
    border-radius: 999px;
    background: var(--teal);
    color: var(--on-teal);
    font: inherit;
    font-weight: 700;
    box-shadow: var(--shadow-soft);
    transition:
      background 0.2s ease,
      opacity 0.2s ease;
  }
  .cta:hover:not(:disabled) {
    background: var(--teal-deep);
  }
  .cta:disabled {
    opacity: 0.45;
    box-shadow: none;
    cursor: not-allowed;
  }
  .ghost {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 44px;
    padding: 0 1rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font: inherit;
  }
  .ghost:hover {
    background: var(--paper);
  }
  .ghost.small {
    font-size: 0.86rem;
    padding: 0 0.85rem;
  }

  /* ── One gene per screen: the decision stays at hand ── */
  .bar {
    position: sticky;
    bottom: 0;
    z-index: 3;
    margin-top: auto;
    border-top: 1px solid var(--line);
    background: color-mix(in srgb, var(--card) 94%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  .bar__in {
    max-width: 64rem;
    margin: 0 auto;
    padding: 0.7rem clamp(0.8rem, 4vw, 2.4rem)
      calc(0.7rem + env(safe-area-inset-bottom, 0px));
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem 0.9rem;
  }
  .grow {
    flex: 1;
  }
  .agree {
    flex: 1 1 14rem;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-height: 48px;
    padding: 0 0.9rem;
    border-radius: 14px;
    background: color-mix(in srgb, var(--g, var(--teal)) 10%, var(--card));
    color: var(--ink);
    font-weight: 600;
    cursor: pointer;
  }
  /* A phone: the agreement across the top, Back and Continue beneath it. */
  @media (max-width: 640px) {
    .agree {
      order: -1;
      flex-basis: 100%;
    }
    .bar__in .cta {
      margin-left: auto;
    }
  }
  .agree input,
  .consent input {
    flex: 0 0 auto;
    width: 1.35rem;
    height: 1.35rem;
    accent-color: var(--teal);
    cursor: pointer;
  }

  /* ── Review ── */
  .ticks {
    list-style: none;
    margin: 1.6rem 0 0;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  .ticks li {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--line);
  }
  .tick {
    flex: 0 0 auto;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--paper);
    color: var(--ink-soft);
  }
  .tick.ok {
    background: color-mix(in srgb, var(--g, var(--teal)) 18%, var(--card));
    color: var(--ink);
  }
  .tt {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .tn {
    font-family: var(--font-serif);
    font-size: 1.12rem;
    color: var(--ink);
  }
  .ts {
    font-size: 0.82rem;
    color: var(--ink-soft);
  }
  .send {
    margin-top: 1.8rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.9rem;
    color: var(--ink-soft);
    max-width: 26rem;
  }
  .field input {
    font: inherit;
    font-size: 1rem;
    min-height: 48px;
    padding: 0 0.9rem;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
  }
  .consent {
    display: flex;
    align-items: flex-start;
    gap: 0.8rem;
    padding: 1rem 1.1rem;
    border-radius: 16px;
    border: 1.5px solid color-mix(in srgb, var(--teal) 40%, var(--line));
    background: var(--teal-wash);
    color: var(--ink);
    font-family: var(--font-serif);
    font-size: 1.12rem;
    line-height: 1.45;
    cursor: pointer;
  }
  .consent input {
    margin-top: 0.15rem;
  }
  .consent.off {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .send .row {
    margin-top: 0.2rem;
  }
  .hint {
    margin: 0;
    flex-basis: 100%;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }
  .after {
    margin-top: 0.6rem;
    padding: 1rem 1.2rem;
    border-radius: 16px;
    background: var(--paper);
    color: var(--ink-soft);
    font-size: 0.92rem;
  }
  .after p {
    margin: 0 0 0.4rem;
    font-weight: 700;
    color: var(--ink);
  }
  .after ol {
    margin: 0;
    padding-left: 1.3rem;
  }

  .state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    text-align: center;
    color: var(--ink);
  }
  .sk {
    display: block;
    border-radius: 12px;
    background: var(--paper);
    animation: sk-pulse 1.6s ease-in-out infinite;
  }
  .sk--a {
    width: 7rem;
    height: 0.8rem;
  }
  .sk--b {
    width: min(28rem, 90%);
    height: 3rem;
  }
  .sk--c {
    width: min(34rem, 90%);
    height: 6rem;
  }
  @keyframes sk-pulse {
    50% {
      opacity: 0.55;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pane,
    .sk {
      animation: none;
    }
  }
</style>
