<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // What one place in the fractal is, in words: its bandwidth and how much
  // of what it needs is committed, what a venture needs and yields, where a
  // person stands, and what hangs under it — each row a way on. Explore's
  // card and the navigator's popup, opened out, both show this.
  import {
    alsoIn,
    type Fractal,
    type FractalNode,
    type FractalStanding,
  } from "@holons/core/flows";
  import Icon from "./Icon.svelte";
  import ProposeQuestSheet from "./ProposeQuestSheet.svelte";
  import QuestSheet from "./QuestSheet.svelte";
  import { currentUser, displayName } from "$lib/auth";
  import { t, type MessageKey, pctOf } from "$lib/i18n";
  import { sessionKeyPub } from "$lib/sessionKey";

  export let fractal: Fractal;
  export let focus: FractalNode;
  /** Go to another place: a row is a way on. */
  export let onPick: (id: string) => void;
  /** Say what and who it is: off where a header already does. */
  export let head = true;

  const LIST = 24;

  $: viewer = $currentUser ? String($currentUser.id) : null;
  $: party = viewer && $sessionKeyPub ? viewer : null;
  $: name = $currentUser ? displayName($currentUser) : "";
  // ── What the card says ──
  const KIND: Record<string, MessageKey> = {
    pot: "explore.kind.pot",
    fund: "explore.kind.fund",
    project: "explore.kind.project",
    quest: "explore.kind.quest",
    person: "explore.kind.person",
  };
  const kindKey = (n: FractalNode): MessageKey =>
    KIND[n.kind === "venture" ? (n.origin ?? "project") : n.kind];
  const dotOf = (n: FractalNode) =>
    n.unclaimed
      ? "placeholder"
      : n.kind === "venture"
        ? n.origin === "quest"
          ? "quest"
          : "project"
        : n.kind;
  const bw = (v: number) => (v >= 99.95 ? `${Math.round(v)}%` : $pctOf(v));
  const share100 = (v: number) => `${Math.round(v * 100)}%`;

  $: kids = focus
    ? focus.children
        .map((id) => fractal.byId.get(id))
        .filter((c): c is FractalNode => !!c)
    : [];
  $: groups = focus
    ? [
        {
          key: "explore.under.funds" as MessageKey,
          rows: kids.filter((k) => k.kind === "fund"),
        },
        {
          key: "explore.under.ventures" as MessageKey,
          rows: kids.filter((k) => k.kind === "venture"),
        },
        {
          key: (focus.kind === "person"
            ? "explore.under.forwards"
            : "explore.under.people") as MessageKey,
          rows: kids.filter((k) => k.kind === "person"),
        },
      ].filter((g) => g.rows.length)
    : [];
  let more: Record<string, boolean> = {};
  $: if (focus) more = {};

  function roleText(r: FractalStanding): string {
    return r.role === "covers"
      ? $t("explore.role.covers", { need: r.need ?? "" })
      : $t(`explore.role.${r.role}` as MessageKey);
  }
  /** What this person is right here. */
  const rolesHere = (p: FractalNode, here: string) =>
    p.roles.filter((r) => r.at === here).map(roleText);
  $: standsIn =
    focus.kind === "person"
      ? alsoIn(fractal, focus.id).map((n) => ({
          node: n,
          roles: rolesHere(focus!, n.id),
        }))
      : [];
  $: questName = (id: string) => fractal.byId.get(id)?.label ?? "";
  $: extra = focus ? focus.bandwidth - focus.share : 0;

  // ── Acting on it ──
  let openQuest: string | null = null;
  let proposing = false;
  $: proposeBoards = !focus
    ? []
    : focus.kind === "fund"
      ? [focus.id]
      : focus.kind === "venture" && focus.origin === "project"
        ? focus.parents.filter((id) => fractal.byId.get(id)?.kind === "fund")
        : [];
  const labelOfId = (id: string) => fractal.byId.get(id)?.label ?? id;
</script>

<div class="detail">
  {#if head}
    <p class="kind"><i class="dot {dotOf(focus)}"></i>{$t(kindKey(focus))}</p>
    <h1>{focus.label}</h1>
  {/if}
  {#if focus.description}<p class="about">{focus.description}</p>{/if}
  {#if focus.unclaimed}<p class="muted">{$t("explore.unclaimed")}</p>{/if}

  {#if focus.kind !== "person"}
    <section class="band" aria-label={$t("explore.bandwidth")}>
      <div class="row">
        <b>{$t("explore.bandwidth")}</b>
        {#if focus.share > 0}<b class="num">{bw(focus.bandwidth)}</b>{/if}
      </div>
      {#if focus.share > 0}
        <div class="meter" aria-hidden="true">
          <span class="money" style="width:50%"></span>
          <span class="gold" style="width:{50 * focus.coverage}%"></span>
        </div>
        <p class="small">
          {$t("explore.bandwidth.line", {
            share: bw(focus.share),
            extra: bw(extra),
          })}
        </p>
      {:else}
        <div class="meter" aria-hidden="true">
          <span class="gold" style="width:{100 * focus.coverage}%"></span>
        </div>
      {/if}
      <p class="small">
        {$t("explore.bandwidth.committed", {
          n: share100(focus.coverage),
        })}{#if focus.openNeeds}
          · {$t("explore.openNeeds", { n: focus.openNeeds })}{/if}
      </p>
      {#if focus.share > 0}<p class="small muted">
          {$t("explore.bandwidth.note")}
        </p>{/if}
    </section>
  {/if}

  {#if focus.kind === "venture"}
    <div class="sides">
      <section>
        <h2>{$t("explore.needs")}</h2>
        {#if focus.needs.length}
          <ul class="needs">
            {#each focus.needs as need (need.quest + need.id)}
              <li>
                <div class="row">
                  <span>{need.label}</span>
                  <span class="num"
                    >{need.covered}/{need.quantity}{need.unit
                      ? ` ${need.unit}`
                      : ""}</span
                  >
                </div>
                <div class="meter thin" aria-hidden="true">
                  <span
                    class="gold"
                    style="width:{Math.min(
                      100,
                      (100 * need.covered) / need.quantity,
                    )}%"
                  ></span>
                </div>
                {#if focus.origin === "project"}<p class="small muted">
                    {$t("explore.on", { quest: questName(need.quest) })}
                  </p>{/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="small muted">{$t("explore.needs.none")}</p>
        {/if}
      </section>
      <section>
        <h2>{$t("explore.yields")}</h2>
        {#if focus.yields.length}
          <ul class="yields">
            {#each focus.yields as y, i (y.quest + i)}
              <li>
                <Icon name="sprout" />
                <span
                  >{y.label}{#if y.quantity != null}
                    · {y.quantity}{y.unit ? ` ${y.unit}` : ""}{/if}</span
                >
              </li>
            {/each}
          </ul>
        {:else}
          <p class="small muted">{$t("explore.yields.none")}</p>
        {/if}
      </section>
    </div>
  {/if}

  {#if standsIn.length}
    <section>
      <h2>{$t("explore.standsIn")}</h2>
      <ul class="rows">
        {#each standsIn as s (s.node.id)}
          <li>
            <button on:click={() => onPick(s.node.id)}>
              <i class="dot {dotOf(s.node)}"></i>
              <span class="name">{s.node.label}</span>
              <span class="roles"
                >{#each s.roles as r}<em>{r}</em>{/each}</span
              >
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#each groups as g (g.key)}
    <section>
      <h2>{$t(g.key)} <span class="muted">{g.rows.length}</span></h2>
      <ul class="rows">
        {#each more[g.key] ? g.rows : g.rows.slice(0, LIST) as row (row.id)}
          <li>
            <button on:click={() => onPick(row.id)}>
              <i class="dot {dotOf(row)}"></i>
              <span class="name">{row.label}</span>
              {#if row.kind === "person"}
                <span class="roles"
                  >{#each rolesHere(row, focus.id) as r}<em>{r}</em
                    >{/each}</span
                >
              {:else}
                {#if row.coverage > 0}<span class="cov"
                    >{share100(row.coverage)}</span
                  >{/if}
                {#if row.share > 0}<span class="num">{bw(row.bandwidth)}</span
                  >{/if}
              {/if}
              <Icon name="chevron-right" />
            </button>
          </li>
        {/each}
      </ul>
      {#if !more[g.key] && g.rows.length > LIST}
        <button class="more" on:click={() => (more[g.key] = true)}
          >{$t("common.showMore", { n: g.rows.length - LIST })}</button
        >
      {/if}
    </section>
  {:else}
    {#if focus.kind !== "person" || !standsIn.length}
      <p class="small muted">{$t("explore.empty")}</p>
    {/if}
  {/each}

  <div class="acts">
    {#if focus.origin === "quest"}
      <button class="primary" on:click={() => (openQuest = focus?.id ?? null)}
        >{$t("explore.act.quest")}</button
      >
    {/if}
    {#if proposeBoards.length && party}
      <button class="primary" on:click={() => (proposing = true)}
        ><Icon name="plus" /> {$t("explore.act.propose")}</button
      >
    {/if}
    <slot name="links" />
  </div>
</div>

{#if openQuest && focus}
  <QuestSheet
    questId={openQuest}
    board={focus.board ?? ""}
    boardLabel={labelOfId}
    {party}
    {name}
    on:close={() => (openQuest = null)}
  />
{/if}
{#if proposing && party && focus}
  <ProposeQuestSheet
    boards={proposeBoards.map((id) => ({ id, label: labelOfId(id) }))}
    holon={focus.kind === "venture" ? focus.id : undefined}
    {party}
    {name}
    on:close={() => (proposing = false)}
  />
{/if}

<style>
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 0.85rem;
    margin: 4px 0 0;
  }
  .meter .money {
    background: var(--cap-financial);
  }
  .meter .gold {
    background: #e0a92e;
  }
  .kind {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  h1 {
    margin: 4px 0 6px;
    font-size: 1.35rem;
    line-height: 1.25;
  }
  h2 {
    font-size: 0.95rem;
    margin: 18px 0 8px;
  }
  .about {
    margin: 0 0 6px;
    color: var(--ink-soft);
    white-space: pre-line;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: 0 0 auto;
    background: var(--kind-other);
  }
  .dot.pot {
    background: var(--kind-pot);
  }
  .dot.fund {
    background: var(--kind-fund);
  }
  .dot.project {
    background: var(--kind-project);
  }
  .dot.quest {
    background: #b04fcb;
  }
  .dot.person {
    background: var(--kind-person);
  }
  .dot.placeholder {
    background: var(--kind-placeholder);
  }
  .band {
    margin-top: 12px;
    padding: 12px;
    border-radius: 12px;
    background: var(--teal-wash);
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: baseline;
  }
  .num {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .meter {
    display: flex;
    height: 10px;
    margin-top: 8px;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in srgb, var(--ink) 10%, transparent);
  }
  .meter.thin {
    height: 6px;
    margin-top: 4px;
  }
  .sides {
    display: grid;
    gap: 0 20px;
  }
  @media (min-width: 560px) {
    .sides {
      grid-template-columns: 1fr 1fr;
    }
  }
  .needs,
  .yields,
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .needs li {
    padding: 6px 0;
  }
  .yields li {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 5px 0;
    color: var(--ink-soft);
  }
  .rows li + li {
    border-top: 1px solid var(--line);
  }
  .rows button {
    width: 100%;
    min-height: var(--tap);
    display: flex;
    align-items: center;
    gap: 10px;
    text-align: left;
    color: var(--ink);
    padding: 4px 0;
  }
  .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .roles {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
    max-width: 55%;
  }
  .roles em {
    font-style: normal;
    font-size: 0.74rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--teal-wash);
    color: var(--teal-ink);
  }
  .cov {
    font-size: 0.78rem;
    font-weight: 700;
    color: #9a6c08;
  }
  :global([data-theme="dark"]) .cov {
    color: #f2c14e;
  }
  .more {
    margin-top: 6px;
    color: var(--teal-ink);
    font-weight: 700;
    min-height: var(--tap);
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 18px;
  }
  .acts .primary,
  .acts :global(.ghost) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: var(--tap);
    padding: 0 16px;
    border-radius: 999px;
    font-weight: 700;
    text-decoration: none;
  }
  .acts .primary {
    background: var(--teal);
    color: var(--on-teal);
  }
  .acts :global(.ghost) {
    border: 1px solid var(--line);
    color: var(--ink);
  }
</style>
