<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A holon's onboarding steps as a newcomer sees them: the steps behind them
  // ticked, the one they are on open with its cards, the rest waiting. What
  // a card lets them do (Done, the profile form, a hint) is the slot's, so
  // the newcomer's screen and an admin's preview draw the same list.
  import type { OnboardingCardView, OnboardingStepView } from "$lib/onboarding";
  import Icon from "./Icon.svelte";

  export let steps: OnboardingStepView[];

  // Only here so the slot's `let:card` is typed.
  const asCard = (c: OnboardingCardView) => c;
</script>

<ol class="steps">
  {#each steps as step (step.id)}
    <li class="step {step.state}">
      <span class="stitle">
        {#if step.state === "done"}<Icon name="check" />{/if}
        {step.title}
      </span>
      {#if step.state === "current"}
        <ul class="cards">
          {#each step.cards as card (card.id)}
            <li class="card" class:done={card.done}>
              <div class="ctitle">
                <span class="mark" aria-hidden="true"
                  ><Icon name={card.done ? "check-square" : "disc"} /></span
                >
                {card.title}
              </div>
              {#if card.description}<p class="desc">{card.description}</p>{/if}
              {#if card.link}
                <a
                  class="link"
                  href={card.link}
                  target="_blank"
                  rel="noopener noreferrer">{card.link}</a
                >
              {/if}
              {#if !card.done}<slot card={asCard(card)} />{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </li>
  {/each}
</ol>

<style>
  .steps {
    list-style: none;
    margin: 0.8rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .step {
    padding: 0.6rem 0.9rem;
    border-radius: 14px;
    background: var(--paper);
  }
  .step.later .stitle {
    color: var(--ink-soft);
  }
  .step.done .stitle {
    color: var(--teal-ink);
  }
  .stitle {
    font-weight: 700;
    color: var(--ink);
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .cards {
    list-style: none;
    margin: 0.6rem 0 0.2rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .card {
    padding: 0.7rem 0.9rem;
    border-radius: 12px;
    background: var(--glass);
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .ctitle {
    font-weight: 600;
    color: var(--ink);
    display: flex;
    gap: 0.5rem;
  }
  .card.done .ctitle {
    color: var(--teal-ink);
  }
  .desc {
    margin: 0;
    font-size: 0.9rem;
    color: var(--ink-soft);
  }
  .link {
    font-size: 0.9rem;
    color: var(--teal-ink);
    word-break: break-all;
  }
</style>
