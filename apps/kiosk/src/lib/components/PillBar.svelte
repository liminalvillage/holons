<div class="pillbar"><slot /></div>

<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Centered row holding a view's pills (Show + View + Sort). Renders IN
     FLOW as its own band above the content — the board starts below it, so
     the pills never overlay cards, trays or drawers. Owns the row layout the
     pills themselves deliberately don't. -->

<style>
  .pillbar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    /* Three pills outgrow a phone — wrap instead of clipping off-screen. */
    flex-wrap: wrap;
    gap: 0.6rem;
    padding: 0.9rem 0.7rem 0.2rem;
  }
  @media (max-width: 560px) {
    .pillbar {
      gap: 0.4rem;
      padding: 0.5rem 0.5rem 0.1rem;
    }
  }
</style>
