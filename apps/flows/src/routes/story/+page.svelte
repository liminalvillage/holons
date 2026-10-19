<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The story the app tells, scene by scene, each scene opening onto the
  // screen that does it for real:
  //
  //   1 money is a detour          you → money → project → market → needs
  //   2 more than money            the pipes carry resource tokens too
  //   3 resource any level         the Pot, a fund, a project, a person;
  //                                offers with their terms, visible to all
  //   4 eight forms of capital     financial is one stream among eight
  //   5 the game                   resource base → financial bandwidth
  //   6 the most resourced rise    the leaderboard
  //   7 every flow, traceable      an amount followed down to a person
  //   8 live today                 the financial channel, in this app
  //   9 close
  //
  // The illustrations are drawings, not data; every link leads to data.
  import { CAPITALS } from "@holons/core/flows";
  import Icon from "$lib/components/Icon.svelte";
  import { capitalColour, capitalName } from "$lib/capitals";
  import { index } from "$lib/graph";
  import { t, type MessageKey } from "$lib/i18n";
  import { hrefFor } from "$lib/urls";

  /** What "you" give instead of money: the needs the market would have sold. */
  const NEEDS = ["space", "tools", "seeds", "skills", "time"] as const;

  // Real parties to open each level on, when the map has them.
  $: pick = (kind: string) =>
    $index?.graph.nodes
      .filter((n) => n.kind === kind && n.share > 0)
      .sort((a, b) => b.share - a.share)[0] ?? null;
  $: pot = $index?.byId.get($index.graph.root) ?? null;
  $: fund = pick("fund");
  $: project = pick("project");
  $: person = pick("person");
  $: levels = [
    { key: "story.level.pot", node: pot },
    { key: "story.level.fund", node: fund },
    { key: "story.level.project", node: project },
    { key: "story.level.person", node: person },
  ] as const;
</script>

<svelte:head><title>{$t("story.title")} · Flows</title></svelte:head>

<header class="head">
  <p class="eyebrow">Flows</p>
  <h1>{$t("story.title")}</h1>
  <p class="muted">{$t("story.lead")}</p>
</header>

<ol class="scenes">
  <!-- 1 -->
  <li class="card scene">
    <p class="n">1</p>
    <h2>{$t("story.s1.title")}</h2>
    <svg viewBox="0 0 340 156" class="art" aria-hidden="true">
      <g class="detour">
        <text x="6" y="30">{$t("story.you")}</text>
        <path d="M40 26 H62" />
        <text x="68" y="30">€</text>
        <path d="M82 26 H102" />
        <text x="108" y="30">{$t("story.project")}</text>
        <path d="M170 26 H192" />
        <text x="198" y="30">{$t("story.market")}</text>
        <path d="M226 38 V60" />
      </g>
      <g class="needs">
        {#each NEEDS as need, i (need)}
          <text x={168 + (i % 3) * 56} y={82 + Math.floor(i / 3) * 20}
            >{$t(`story.need.${need}` as MessageKey)}</text
          >
        {/each}
      </g>
      <path class="arc" d="M18 38 C 30 128, 128 128, 162 84" />
      <text class="arcLabel" x="24" y="150">{$t("story.s1.arc")}</text>
    </svg>
    <p>{$t("story.s1.body")}</p>
  </li>

  <!-- 2 -->
  <li class="card scene">
    <p class="n">2</p>
    <h2>{$t("story.s2.title")}</h2>
    <svg viewBox="0 0 340 120" class="art" aria-hidden="true">
      <g class="pipes">
        <path d="M20 60 H120" />
        <path d="M120 60 C150 60 150 24 180 24 H320" />
        <path d="M120 60 H320" />
        <path d="M120 60 C150 60 150 96 180 96 H320" />
      </g>
      {#each [24, 60, 96] as y, row (row)}
        {#each [0, 1, 2, 3] as k (k)}
          <circle
            class="drop"
            r="4"
            cx="0"
            cy="0"
            style="--y:{y}px; --d:{k * 0.9 + row * 0.3}s; fill:{k % 2
              ? capitalColour(CAPITALS[(row * 3 + k) % 7])
              : capitalColour('financial')}"
          />
        {/each}
      {/each}
    </svg>
    <p>{$t("story.s2.body")}</p>
    <a class="go" href="/eco"
      >{$t("story.s2.go")}<Icon name="chevron-right" /></a
    >
  </li>

  <!-- 3 -->
  <li class="card scene">
    <p class="n">3</p>
    <h2>{$t("story.s3.title")}</h2>
    <p>{$t("story.s3.body")}</p>
    <ul class="levels">
      {#each levels as l (l.key)}
        <li>
          {#if l.node}
            <a href={hrefFor(l.node)}
              ><Icon name="gift" /><b>{$t(l.key)}</b><i>{l.node.label}</i></a
            >
          {:else}
            <span><Icon name="gift" /><b>{$t(l.key)}</b></span>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="offer">
      <p class="tag">{$t("offers.public")}</p>
      <h3>{$t("story.s3.offerTitle")}</h3>
      <dl>
        <dt>
          <i style="background:{capitalColour('material')}"></i>{$t(
            "story.s3.o1",
          )}
        </dt>
        <dd>{$t("story.s3.o1terms")}</dd>
        <dt>
          <i style="background:{capitalColour('material')}"></i>{$t(
            "story.s3.o2",
          )}
        </dt>
        <dd>{$t("story.s3.o2terms")}</dd>
        <dt>
          <i style="background:{capitalColour('intellectual')}"></i>{$t(
            "story.s3.o3",
          )}
        </dt>
        <dd>{$t("story.s3.o3terms")}</dd>
      </dl>
    </div>
    <p class="muted small">{$t("story.s3.how")}</p>
  </li>

  <!-- 4 -->
  <li class="card scene">
    <p class="n">4</p>
    <h2>{$t("story.s4.title")}</h2>
    <ul class="eight">
      {#each CAPITALS as c (c)}
        <li class:money={c === "financial"}>
          <i style="background:{capitalColour(c)}"></i>
          <b>{$t(capitalName(c))}</b>
          {#if c === "financial"}<em>{$t("eco.oneOfEight")}</em>{/if}
        </li>
      {/each}
    </ul>
    <p>{$t("story.s4.body")}</p>
    <a class="go" href="/eco"
      >{$t("story.s4.go")}<Icon name="chevron-right" /></a
    >
  </li>

  <!-- 5 -->
  <li class="card scene">
    <p class="n">5</p>
    <h2>{$t("story.s5.title")}</h2>
    <p class="formula">
      <span>{$t("rise.ruleBase")}</span>
      <Icon name="chevron-right" />
      <span>{$t("rise.ruleBandwidth")}</span>
    </p>
    <p>{$t("story.s5.body")}</p>
    <a class="go" href="/eco"
      >{$t("story.s5.go")}<Icon name="chevron-right" /></a
    >
  </li>

  <!-- 6 -->
  <li class="card scene">
    <p class="n">6</p>
    <h2>{$t("story.s6.title")}</h2>
    <p>{$t("story.s6.body")}</p>
    <a class="go" href="/rise"
      >{$t("story.s6.go")}<Icon name="chevron-right" /></a
    >
  </li>

  <!-- 7 -->
  <li class="card scene">
    <p class="n">7</p>
    <h2>{$t("story.s7.title")}</h2>
    <p>{$t("story.s7.body")}</p>
    {#if person}
      <a class="go" href={hrefFor(person)}
        >{$t("story.s7.go", { name: person.label })}<Icon
          name="chevron-right"
        /></a
      >
    {/if}
  </li>

  <!-- 8 -->
  <li class="card scene live">
    <p class="n">8</p>
    <h2>{$t("story.s8.title")}</h2>
    <p>{$t("story.s8.body")}</p>
    <ul class="clips">
      <li><a href="/eco"><Icon name="globe" />{$t("story.s8.network")}</a></li>
      <li><a href="/"><Icon name="download" />{$t("story.s8.claim")}</a></li>
      <li>
        <a href="/"><Icon name="wallet" />{$t("story.s8.withdraw")}</a>
      </li>
    </ul>
  </li>

  <!-- 9 -->
  <li class="scene close">
    <h2>{$t("story.s9.title")}</h2>
    <p>{$t("story.s9.body")}</p>
    <a class="btn" href="/eco"><Icon name="sprout" />{$t("story.s9.go")}</a>
  </li>
</ol>

<style>
  .head {
    display: grid;
    gap: 6px;
    margin-bottom: 16px;
  }
  .head h1 {
    font-size: 1.7rem;
    line-height: 1.15;
  }
  .eyebrow {
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--teal-ink);
  }
  .scenes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 14px;
  }
  .scene {
    display: grid;
    gap: 10px;
    padding: 18px 16px;
  }
  .n {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--teal);
    color: var(--on-teal);
    font-weight: 800;
    font-size: 0.85rem;
  }
  .scene h2 {
    font-size: 1.2rem;
  }
  .art {
    width: 100%;
    height: auto;
    overflow: visible;
  }
  .art text {
    font:
      600 12px system-ui,
      sans-serif;
    fill: var(--ink-soft);
  }
  .detour path {
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.5;
    stroke-dasharray: 4 4;
  }
  .needs text {
    fill: var(--ink);
    font-weight: 700;
  }
  .arc {
    fill: none;
    stroke: var(--cap-living);
    stroke-width: 3.5;
    stroke-linecap: round;
    stroke-dasharray: 260;
    stroke-dashoffset: 260;
    animation: draw 2.4s 0.6s ease-out forwards;
  }
  .art .arcLabel {
    fill: var(--cap-living);
    font-weight: 800;
  }
  @keyframes draw {
    to {
      stroke-dashoffset: 0;
    }
  }
  .pipes path {
    fill: none;
    stroke: color-mix(in srgb, var(--cap-financial) 35%, var(--line));
    stroke-width: 8;
    stroke-linecap: round;
  }
  .drop {
    offset-path: none;
    transform: translate(20px, 60px);
    animation: flow 3.6s var(--d) linear infinite;
  }
  @keyframes flow {
    0% {
      transform: translate(20px, 60px);
      opacity: 0;
    }
    10% {
      opacity: 1;
    }
    35% {
      transform: translate(130px, 60px);
    }
    55% {
      transform: translate(180px, var(--y));
    }
    95% {
      opacity: 1;
    }
    100% {
      transform: translate(320px, var(--y));
      opacity: 0;
    }
  }
  .go {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    font-weight: 700;
    color: var(--teal-ink);
    text-decoration: none;
    justify-self: start;
  }
  .levels,
  .clips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .levels a,
  .levels span,
  .clips a {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-height: 64px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    text-decoration: none;
    font-size: 0.9rem;
  }
  .levels i {
    font-style: normal;
    font-size: 0.78rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .clips {
    grid-template-columns: 1fr;
  }
  .clips a {
    flex-direction: row;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    font-weight: 700;
  }
  .offer {
    padding: 12px 14px;
    border-radius: 12px;
    border: 1.5px dashed var(--line);
    display: grid;
    gap: 8px;
  }
  .tag {
    justify-self: start;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--teal-wash);
    color: var(--teal-ink);
    font-size: 0.72rem;
    font-weight: 700;
  }
  .offer h3 {
    font-size: 1rem;
  }
  .offer dl {
    margin: 0;
    display: grid;
    gap: 2px 0;
    font-size: 0.86rem;
  }
  .offer dt {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    margin-top: 6px;
  }
  .offer dt i,
  .eight i {
    width: 12px;
    height: 12px;
    border-radius: 4px;
    flex: 0 0 auto;
  }
  .offer dd {
    margin: 0 0 0 18px;
    color: var(--ink-soft);
  }
  .eight {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px 12px;
  }
  .eight li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.92rem;
  }
  .eight .money {
    grid-column: 1 / -1;
    padding: 6px 10px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--cap-financial) 14%, var(--card));
  }
  .eight em {
    font-style: normal;
    font-size: 0.8rem;
    color: var(--ink-soft);
    margin-left: auto;
  }
  .formula {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-weight: 800;
  }
  .formula span {
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--teal-wash);
    color: var(--teal-ink);
  }
  .small {
    font-size: 0.82rem;
  }
  .close {
    padding: 22px 4px 8px;
    text-align: center;
    justify-items: center;
  }
  .close h2 {
    font-size: 1.5rem;
  }
  @media (prefers-reduced-motion: reduce) {
    .arc {
      animation: none;
      stroke-dashoffset: 0;
    }
    .drop {
      animation: none;
      opacity: 0;
    }
  }
</style>
