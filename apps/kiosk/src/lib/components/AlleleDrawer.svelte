<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  //
  // The whole of one allele, in a drawer beside the page (a bottom sheet on
  // a phone): its text, its longer detail with steps, links and picture, the
  // gene it comes from when it is shown here by reference, and the other
  // genes it is expressed in — each a way to that gene on the page.
  import { createEventDispatcher } from "svelte";
  import type { AlleleView, GeneView } from "@holons/core/dna";
  import { alleleIconName } from "$lib/dna";
  import { t } from "$lib/i18n";
  import Icon from "./Icon.svelte";
  import SidePanel from "./SidePanel.svelte";

  export let allele: AlleleView;
  export let gene: GeneView;
  /** Offer the genes it is expressed in as places to go (the front page). */
  export let travel = true;

  const dispatch = createEventDispatcher<{ close: void; gene: string }>();

  $: links = [
    ...(allele.link ? [allele.link] : []),
    ...(allele.detail?.links ?? []),
  ];
  $: image = allele.detail?.image;
  $: safeImage = image && /^https:\/\//i.test(image.src) ? image : null;
</script>

<SidePanel title={allele.title} on:close={() => dispatch("close")}>
  <div class="drawer" style:--g={gene.color || null}>
    <p class="origin">
      <span class="ico" aria-hidden="true"
        ><Icon
          name={allele.icon ? alleleIconName(allele.icon) : "leaf"}
        /></span
      >
      <span>{allele.from ? allele.from.title : gene.title}</span>
    </p>
    {#if allele.kicker}<p class="kicker">{allele.kicker}</p>{/if}
    {#if allele.body}<p class="lede">{allele.body}</p>{/if}
    {#if allele.detail?.body}<p class="detail">{allele.detail.body}</p>{/if}
    {#if safeImage}
      <img src={safeImage.src} alt={safeImage.alt} loading="lazy" />
    {/if}
    {#if allele.detail?.steps?.length}
      <h3>{$t("front.steps")}</h3>
      <ol class="steps">
        {#each allele.detail.steps as step, i (i)}
          <li><span class="sn">{i + 1}</span><span>{step}</span></li>
        {/each}
      </ol>
    {/if}
    {#if links.length}
      <h3>{$t("front.links")}</h3>
      <ul class="links">
        {#each links as l (l.href)}
          <li>
            <a href={l.href} target="_blank" rel="noopener noreferrer"
              ><Icon name={l.icon ? alleleIconName(l.icon) : "link"} />
              <span>{l.label}</span><Icon name="arrow-up-right" /></a
            >
          </li>
        {/each}
      </ul>
    {/if}
    {#if travel && (allele.from || allele.expressedIn.length)}
      <h3>{$t(allele.from ? "front.livesIn" : "front.expressedIn")}</h3>
      <ul class="genes">
        {#each allele.from ? [allele.from] : allele.expressedIn as r (r.gene)}
          <li>
            <button type="button" on:click={() => dispatch("gene", r.gene)}
              ><span>{r.title}</span><Icon name="arrow-right" /></button
            >
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</SidePanel>

<style>
  .drawer {
    position: relative;
    padding-top: 0.2rem;
  }
  .drawer::before {
    content: "";
    display: block;
    height: 4px;
    width: 3.2rem;
    border-radius: 4px;
    background: var(--g, var(--teal));
    margin-bottom: 0.9rem;
  }
  .origin {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .ico {
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 1rem;
    letter-spacing: 0;
    background: color-mix(in srgb, var(--g, var(--teal)) 16%, var(--card));
    color: color-mix(in srgb, var(--g, var(--teal)) 62%, var(--ink));
  }
  .kicker {
    margin: 0.9rem 0 0;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
  }
  .lede {
    margin: 0.5rem 0 0;
    font-family: var(--font-serif);
    font-size: 1.22rem;
    line-height: 1.45;
    color: var(--ink);
    white-space: pre-line;
  }
  .detail {
    margin: 0.9rem 0 0;
    font-size: 0.95rem;
    line-height: 1.65;
    color: var(--ink-soft);
    white-space: pre-line;
  }
  img {
    display: block;
    width: 100%;
    max-height: 16rem;
    object-fit: contain;
    margin-top: 1rem;
    border-radius: 12px;
    background: var(--paper);
  }
  h3 {
    margin: 1.4rem 0 0.55rem;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .steps li {
    display: flex;
    gap: 0.7rem;
    align-items: baseline;
    font-size: 0.95rem;
    line-height: 1.5;
    color: var(--ink);
  }
  .sn {
    flex: 0 0 auto;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    display: inline-grid;
    place-items: center;
    font-size: 0.78rem;
    font-weight: 700;
    background: color-mix(in srgb, var(--g, var(--teal)) 14%, var(--card));
    color: var(--ink);
  }
  .links,
  .genes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .links a,
  .genes button {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    min-height: 44px;
    box-sizing: border-box;
    padding: 0.4rem 0.9rem;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font: inherit;
    font-size: 0.92rem;
    text-align: left;
    text-decoration: none;
  }
  .links a span,
  .genes button span {
    flex: 1;
    min-width: 0;
  }
  .links a:hover,
  .genes button:hover {
    border-color: color-mix(in srgb, var(--g, var(--teal)) 55%, var(--line));
  }
</style>
