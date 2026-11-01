<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Onboarding into this holon, as the newcomer sees it: the holon's steps,
  // the one they are on, and its cards. Self cards are ticked right here
  // when the session key counts in the person's own holon; otherwise (a
  // Telegram holon the bot keeps) the card says to tick it in the bot chat.
  // A card someone from the holon vouches for only says so. A profile card
  // asks the fields the holon put on it. The bot moves them on (see
  // $lib/onboarding) — this view re-reads every few seconds while they
  // walk, so its moves show without a reload.
  //
  // It is not a tab: while the key is not seated it IS the board (the
  // layout's `onboardingGate`), and once linked the board opens.
  import { onDestroy } from "svelte";
  import { holonId, holonName, showNotice, standingRecheck } from "$lib/stores";
  import { currentUser, displayName, isLoggedIn, loginOpen } from "$lib/auth";
  import { askToJoin } from "$lib/hubmembers";
  import { sessionKeyPub } from "$lib/sessionKey";
  import {
    fieldLabel,
    loadMyOnboarding,
    previewSteps,
    saveMyProfile,
    tickCard,
    type MyOnboarding,
    type OnboardingCardView,
  } from "$lib/onboarding";
  import {
    DEFAULT_PROFILE_FIELDS,
    fieldAccepts,
    fieldText,
    fieldValue,
    type ProfileField,
  } from "@holons/core/onboarding";
  import { t } from "$lib/i18n";
  import OnboardingSteps from "$lib/components/OnboardingSteps.svelte";

  let mine: MyOnboarding | null = null;
  let busy = false;
  let asking = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  /** What the person is typing, per profile field key. */
  let answers: Record<string, string> = {};
  /** Keys the person has typed into since the last read: kept as typed. */
  let touched = new Set<string>();

  async function load(holon: string | null) {
    if (!holon) return;
    try {
      const next = await loadMyOnboarding(holon);
      if (holon !== $holonId) return;
      mine = next;
      if (next.state === "walking") {
        const fill: Record<string, string> = {};
        for (const f of fieldsOf(next)) {
          if (touched.has(f.key)) continue;
          const stored = fieldText(f, next.profile?.[f.key]);
          fill[f.key] =
            stored || (f.key === "first_name" ? String(next.view.name) : "");
        }
        answers = { ...answers, ...fill };
      }
      // Linked: the board opens now, not at the next scheduled re-check.
      if (next.state === "linked") standingRecheck.update((n) => n + 1);
    } catch (err) {
      console.warn("[kiosk] onboarding read failed", err);
    }
  }

  /** Every field the holon's profile cards ask. */
  function fieldsOf(m: MyOnboarding): ProfileField[] {
    if (m.state !== "walking") return [];
    return m.view.steps.flatMap((s) =>
      s.cards.flatMap((c) =>
        c.confirm === "profile" ? (c.fields ?? DEFAULT_PROFILE_FIELDS) : [],
      ),
    );
  }

  // The session key lands a beat after the login: follow the key itself.
  $: (void load($holonId), $sessionKeyPub);

  // Re-read while something is moving: walking, or just asked.
  $: live = mine?.state === "walking" || asking;
  $: if (live && !timer) timer = setInterval(() => void load($holonId), 5000);
  $: if (!live && timer) {
    clearInterval(timer);
    timer = null;
  }
  onDestroy(() => timer && clearInterval(timer));

  $: holonLabel = $holonName || $holonId || "";

  async function start() {
    if (!$holonId || !$currentUser || busy) return;
    busy = true;
    try {
      if (await askToJoin($holonId, displayName($currentUser))) {
        asking = true;
        showNotice($t(mine?.state === "off" ? "onb.offAsked" : "onb.asked"));
      }
    } finally {
      busy = false;
    }
  }

  async function tick(card: OnboardingCardView) {
    if (mine?.state !== "walking" || busy) return;
    busy = true;
    try {
      await tickCard(mine.view, card);
      await load($holonId);
    } catch (err) {
      showNotice(
        $t("onb.tickFailed", {
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      busy = false;
    }
  }

  const cardFields = (card: OnboardingCardView): ProfileField[] =>
    card.fields ?? [...DEFAULT_PROFILE_FIELDS];

  /** Every required field answered, and every answer one its field takes. */
  const ready = (fields: ProfileField[], a: Record<string, string>) =>
    fields.every((f) =>
      (a[f.key] ?? "").trim() ? fieldAccepts(f, a[f.key]) : !f.required,
    );

  async function saveProfileForm(card: OnboardingCardView) {
    if (mine?.state !== "walking" || busy) return;
    busy = true;
    try {
      const fields = cardFields(card);
      await saveMyProfile(
        mine.view,
        Object.fromEntries(
          fields
            .filter((f) => (answers[f.key] ?? "").trim())
            .map((f) => [f.key, fieldValue(f, answers[f.key])]),
        ),
      );
      for (const f of fields) touched.delete(f.key);
      showNotice($t("onb.profileSaved"));
      await load($holonId);
    } catch (err) {
      showNotice(
        $t("onb.tickFailed", {
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      busy = false;
    }
  }

  const INPUT: Record<string, string> = {
    text: "text",
    date: "date",
    url: "url",
    list: "text",
  };
  function typed(key: string, e: Event) {
    answers = {
      ...answers,
      [key]: (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value,
    };
    touched.add(key);
  }

  $: if (mine && mine.state !== "none" && mine.state !== "off") asking = false;
</script>

<div class="onboarding">
  <div class="head">
    <h2>{$t("onb.title", { holon: holonLabel })}</h2>
  </div>
  <div class="scrollarea">
    {#if !$isLoggedIn || mine?.state === "nokey"}
      <p class="state">
        {$t("onb.loginFirst")}
        <br /><button
          class="cta"
          type="button"
          on:click={() => loginOpen.set(true)}>{$t("onb.login")}</button
        >
      </p>
    {:else if !mine}
      <p class="state">{$t("onb.loading")}</p>
    {:else if mine.state === "linked"}
      <p class="state">{$t("onb.linked", { holon: holonLabel })}</p>
    {:else if mine.state === "off"}
      <p class="state">
        {$t("onb.off", { holon: holonLabel })}
        <br />
        <button
          class="cta"
          type="button"
          disabled={busy || asking}
          on:click={start}
          >{asking ? $t("onb.offAsked") : $t("onb.offAsk")}</button
        >
      </p>
    {:else if mine.state === "none"}
      <p class="state">
        {$t("onb.intro", { holon: holonLabel })}
        <br />
        <button
          class="cta"
          type="button"
          disabled={busy || asking}
          on:click={start}>{asking ? $t("onb.asked") : $t("onb.ask")}</button
        >
      </p>
      <OnboardingSteps steps={previewSteps($holonId ?? "", mine.config, -1)} />
    {:else}
      <p class="intro">{$t("onb.intro", { holon: holonLabel })}</p>
      <OnboardingSteps steps={mine.view.steps} let:card>
        {#if card.confirm === "admin"}
          <p class="hint">{$t("onb.adminTicks")}</p>
        {:else if card.confirm === "profile"}
          {#if mine.canTick}
            <form
              class="profile"
              on:submit|preventDefault={() => saveProfileForm(card)}
            >
              {#each cardFields(card) as f (f.key)}
                <label class:missing={card.missing?.includes(f.key)}>
                  <span
                    >{fieldLabel(f, $t)}{#if !f.required}
                      <em>{$t("onb.optional")}</em>{/if}</span
                  >
                  {#if f.type === "longtext"}
                    <textarea
                      rows="3"
                      value={answers[f.key] ?? ""}
                      on:input={(e) => typed(f.key, e)}
                    ></textarea>
                  {:else}
                    <input
                      type={INPUT[f.type]}
                      value={answers[f.key] ?? ""}
                      placeholder={f.type === "list"
                        ? $t("onb.listHint")
                        : f.type === "url"
                          ? "https://"
                          : ""}
                      autocomplete={f.key === "first_name"
                        ? "given-name"
                        : f.key === "last_name"
                          ? "family-name"
                          : "off"}
                      on:input={(e) => typed(f.key, e)}
                    />
                  {/if}
                </label>
              {/each}
              <button
                class="cta"
                type="submit"
                disabled={busy || !ready(cardFields(card), answers)}
                >{$t("onb.profileSave")}</button
              >
            </form>
          {:else}
            <p class="hint">{$t("onb.profileInTelegram")}</p>
          {/if}
        {:else if mine.canTick}
          <button
            class="cta"
            type="button"
            disabled={busy}
            on:click={() => tick(card)}>{$t("onb.tick")}</button
          >
        {:else}
          <p class="hint">{$t("onb.tickInTelegram")}</p>
        {/if}
      </OnboardingSteps>
    {/if}
  </div>
</div>

<style>
  .onboarding {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .head {
    flex: 0 0 auto;
    padding: 0.8rem 1.4rem 0.6rem;
    text-align: center;
  }
  .head h2 {
    margin: 0;
    font-size: 1.45rem;
    font-weight: 700;
    color: var(--ink);
  }
  .scrollarea {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.2rem 1.4rem 1.2rem;
    max-width: 44rem;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }
  .state,
  .intro {
    text-align: center;
    color: var(--ink-soft);
    line-height: 1.5;
  }
  .hint {
    margin: 0;
    font-size: 0.9rem;
    color: var(--ink-soft);
  }
  .profile {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .profile label em {
    font-style: normal;
    opacity: 0.75;
  }
  .profile label.missing span {
    color: var(--ink);
    font-weight: 600;
  }
  .profile label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
    color: var(--ink-soft);
  }
  .profile input,
  .profile textarea {
    font: inherit;
    padding: 0.55rem 0.7rem;
    border-radius: 10px;
    border: 1px solid var(--ghost);
    background: var(--paper);
    color: var(--ink);
  }
  .cta {
    align-self: flex-start;
    min-height: 44px;
    margin-top: 0.4rem;
    padding: 0.5rem 1.1rem;
    border-radius: 999px;
    background: var(--teal);
    color: var(--on-teal);
    font-weight: 700;
  }
  .cta:disabled {
    opacity: 0.55;
  }
</style>
