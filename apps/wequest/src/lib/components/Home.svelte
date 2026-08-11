<script lang="ts">
  import { onDestroy } from "svelte";
  import { get } from "svelte/store";
  import Icon from "./Icon.svelte";
  import { buildGrid, HEX_R, HEAT } from "$lib/hex";
  import { iconForText } from "$lib/icons";
  import { distLabel } from "$lib/geomap";
  import { MAPBOX_TOKEN, createHexHeatMap, type HexHeatMap } from "$lib/mapboxHeat";
  import { RINGS } from "$lib/data";
  import {
    mode,
    ring,
    go,
    flash,
    hexPickerOpen,
    composeOpen,
    composeIntent,
    draft,
  } from "$lib/stores";
  import {
    holonId,
    holonName,
    settingsHex,
    mapCells,
    cellHeat,
    myNeeds,
    provideFeed,
    myOffers,
    offersAround,
    withdrawOffer,
    selectedNeed,
    partners,
    addPartner,
    publisherHolonOf,
    publisherNameOf,
  } from "$lib/live";
  import { resolveUsername, initials } from "$lib/config";

  const username = resolveUsername() || "neighbour";
  const monogram = initials(username);
  const hour = new Date().getHours();
  const greeting =
    hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Decorative fallback grid when no hex address is configured.
  const fallbackGrid = buildGrid(358, 330, HEX_R, 1).map((h) => ({
    pts: h.pts,
    fill: HEAT[Math.min(4, Math.floor(h.n * 5))],
  }));

  interface CellCard {
    cell: string;
    name: string;
    dist: string;
    summary: string;
    tags: string[];
  }
  let openCell: CellCard | null = null;

  // ── real basemap (mapbox) behind the demand heat; SVG disk is the
  //    token-less fallback ──────────────────────────────────────────────
  let mapEl: HTMLDivElement | null = null;
  let heatMap: HexHeatMap | null = null;
  let heatMapFor = "";

  $: if (MAPBOX_TOKEN && $settingsHex && mapEl && heatMapFor !== $settingsHex) {
    heatMapFor = $settingsHex;
    void mountHeatMap($settingsHex);
  }
  $: heatMap?.setHeat($cellHeat);
  $: heatMap?.setSelected(openCell?.cell ?? null);

  async function mountHeatMap(hex: string) {
    heatMap?.destroy();
    heatMap = null;
    if (!mapEl) return;
    try {
      heatMap = await createHexHeatMap(mapEl, hex, (cell) => {
        const projected = get(mapCells).find((m) => m.cell === cell);
        tapCell(cell, projected?.distKm ?? 0);
      });
      heatMap.setHeat(get(cellHeat));
    } catch (err) {
      console.warn("[wequest] basemap unavailable, keeping the hex disk", err);
      heatMapFor = "";
    }
  }

  onDestroy(() => heatMap?.destroy());

  function tapCell(cell: string, distKm: number) {
    const info = $cellHeat[cell];
    const count = info?.count ?? 0;
    openCell = {
      cell,
      name: "Cell " + cell.slice(0, 7),
      dist: distLabel(distKm),
      summary:
        count > 0
          ? `${count} open need${count === 1 ? "" : "s"} published to this cell.`
          : "Quiet — nothing published here right now.",
      tags: info?.tags?.length ? info.tags : count === 0 ? ["Quiet"] : [],
    };
  }

  function openNeed(n: any) {
    selectedNeed.set(n);
    go("quest");
  }

  function composeOffer() {
    draft.set("");
    composeIntent.set("offer");
    composeOpen.set(true);
  }

  /** Answer an offer by publishing the matching need — demand is the signal. */
  function askFor(offer: any) {
    draft.set(String(offer.title ?? ""));
    composeIntent.set("need");
    composeOpen.set(true);
  }

  function offerFrom(o: any): string {
    return (
      o._federation?.originName ||
      o._federation?.origin ||
      o.initiator?.username ||
      "a neighbour"
    );
  }

  // Holons publishing into the open cell that we are NOT yet federated with —
  // discovery lives on the map: see a need, link its holon in one tap.
  $: openPublishers = (() => {
    if (!openCell) return [] as Array<{ id: string; name: string }>;
    const seen = new Map<string, string>();
    for (const n of $cellHeat[openCell.cell]?.needs ?? []) {
      const id = publisherHolonOf(n);
      if (!id || seen.has(id)) continue;
      if ($partners.some((p) => String(p.id) === id)) continue;
      seen.set(id, publisherNameOf(n));
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  })();

  let federatingId: string | null = null;
  async function federateWith(h: { id: string; name: string }) {
    if (federatingId) return;
    federatingId = h.id;
    await addPartner(h.id);
    federatingId = null;
  }

  $: feed = $mode === "need" ? $myNeeds : $provideFeed;
  $: feedTitle = $mode === "need" ? "Your list, answered" : "Needs you could answer";

  function needMeta(n: any): string {
    const responses = n.responses?.length ?? 0;
    if ($mode === "need") {
      if (n.status === "requested") return "Open · waiting for the ring";
      if (n.status === "offered")
        return `${responses} answer${responses === 1 ? "" : "s"} — tap to choose`;
      if (n.status === "claimed") return "Claimed · ready for handoff";
      return n.status;
    }
    const from =
      n._federation?.originName ||
      n._federation?.origin ||
      n._hologram?.sourceHolonName ||
      (n._hologram?.sourceHolon ? "the map" : null);
    return (from ? `From ${from} · ` : "") + n.status;
  }
</script>

<div class="scr">
  <div style="padding:52px 20px 12px;background:var(--color-bg);display:flex;align-items:center;gap:12px">
    <div style="flex:1">
      <div
        style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--color-neutral-600);font-weight:700"
      >
        {$holonName || $holonId}{$settingsHex ? ` · cell ${$settingsHex.slice(0, 7)}` : ""}
      </div>
      <div style="font-family:var(--font-heading);font-size:26px;line-height:1.1;margin-top:3px">
        {greeting}, {username}
      </div>
    </div>
    <button
      class="tapp"
      on:click={() => go("profile")}
      style="width:46px;height:46px;border-radius:999px;background:var(--color-accent-2-300);display:flex;align-items:center;justify-content:center;font-family:var(--font-heading);font-size:17px;color:var(--color-accent-2-800)"
    >
      {monogram}
    </button>
  </div>

  <div class="body" style="padding-bottom:96px">
    <div style="display:flex;gap:8px;padding:8px 20px 14px">
      <button
        class="tapp chip"
        on:click={() => mode.set("need")}
        style="background:{$mode === 'need' ? 'var(--color-accent)' : 'var(--color-neutral-200)'};color:{$mode ===
        'need'
          ? 'var(--color-neutral-100)'
          : 'var(--color-neutral-700)'}"
      >
        I need
      </button>
      <button
        class="tapp chip"
        on:click={() => mode.set("give")}
        style="background:{$mode === 'give' ? 'var(--color-accent)' : 'var(--color-neutral-200)'};color:{$mode ===
        'give'
          ? 'var(--color-neutral-100)'
          : 'var(--color-neutral-700)'}"
      >
        I can provide
      </button>
      <div style="flex:1"></div>
      <div class="chip" style="background:transparent;color:var(--color-neutral-600)">{RINGS[$ring]}</div>
    </div>

    <div
      style="margin:0 16px;border-radius:var(--radius-lg);overflow:hidden;background:var(--color-accent-2-900);position:relative;height:330px"
    >
      {#if MAPBOX_TOKEN && $settingsHex}
        <div bind:this={mapEl} style="position:absolute;inset:0"></div>
      {/if}
      <svg
        viewBox="0 0 358 330"
        style="width:358px;height:330px;{MAPBOX_TOKEN && $settingsHex ? 'display:none' : ''}"
      >
        {#if $settingsHex && $mapCells.length}
          {#each $mapCells as c (c.cell)}
            <polygon
              class="tapp"
              role="button"
              tabindex="-1"
              aria-label={"Cell " + c.cell}
              on:click={() => tapCell(c.cell, c.distKm)}
              on:keydown={(e) => e.key === "Enter" && tapCell(c.cell, c.distKm)}
              points={c.pts}
              fill={HEAT[Math.min(4, $cellHeat[c.cell]?.count ?? 0)]}
              stroke={openCell?.cell === c.cell ? "#f5ead8" : "rgba(205,219,178,0.35)"}
              stroke-width="1"
            />
          {/each}
          {#each $mapCells.filter((c) => ($cellHeat[c.cell]?.count ?? 0) > 0) as c (c.cell + "-label")}
            <text
              x={c.cx}
              y={c.cy + 4}
              text-anchor="middle"
              font-family="Figtree"
              font-size="12.5"
              font-weight="700"
              fill="#f5ead8"
              pointer-events="none"
            >
              {$cellHeat[c.cell].count}
            </text>
          {/each}
          {#each $mapCells.filter((c) => c.cell === $settingsHex) as c (c.cell + "-you")}
            <circle cx={c.cx} cy={c.cy} r="7" fill="#c67139" stroke="#f5ead8" stroke-width="2.5" pointer-events="none" />
          {/each}
        {:else}
          {#each fallbackGrid as h (h.pts)}
            <polygon points={h.pts} fill={h.fill} stroke="rgba(205,219,178,0.2)" stroke-width="1" />
          {/each}
        {/if}
      </svg>
      <button
        class="tapp"
        on:click={() => hexPickerOpen.set(true)}
        title="Change your home hex"
        style="position:absolute;left:14px;top:14px;padding:7px 12px;border-radius:999px;background:rgba(32,30,29,.55);color:var(--color-neutral-100);font-size:11px;font-weight:600;backdrop-filter:blur(6px)"
      >
        {$settingsHex ? "Demand heat · live" : "No hex address set"}
      </button>
      {#if !$settingsHex}
        <div
          style="position:absolute;left:14px;right:14px;bottom:14px;background:var(--color-bg);border-radius:var(--radius-md);padding:14px 16px;box-shadow:var(--shadow-md)"
        >
          <div style="font-family:var(--font-heading);font-size:16px">The map needs a home</div>
          <div style="font-size:12.5px;color:var(--color-neutral-700);margin-top:4px">
            Claim the hex cell this holon stands in and the demand heat lights up from the live
            needs lens.
          </div>
          <button
            class="tapp"
            on:click={() => hexPickerOpen.set(true)}
            style="margin-top:10px;height:40px;border-radius:999px;background:var(--color-accent);color:var(--color-neutral-100);display:inline-flex;align-items:center;padding:0 18px;font-family:var(--font-heading);font-size:14px"
          >
            Claim your cell
          </button>
        </div>
      {:else if openCell}
        <div
          style="position:absolute;left:14px;right:14px;bottom:14px;background:var(--color-bg);border-radius:var(--radius-md);padding:14px 16px;box-shadow:var(--shadow-md);animation:riseIn .22s ease"
        >
          <div style="display:flex;align-items:baseline;gap:8px">
            <div style="font-family:var(--font-heading);font-size:17px">{openCell.name}</div>
            <div style="font-size:11px;color:var(--color-neutral-600);font-weight:600">{openCell.dist}</div>
            <div style="flex:1"></div>
            <button
              class="tapp"
              on:click={() => (openCell = null)}
              style="font-size:12px;color:var(--color-neutral-600);padding:4px 6px"
            >
              Close
            </button>
          </div>
          <div style="font-size:12.5px;color:var(--color-neutral-700);margin-top:4px">{openCell.summary}</div>
          {#if ($cellHeat[openCell.cell]?.needs ?? []).length}
            <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;max-height:120px;overflow-y:auto">
              {#each $cellHeat[openCell.cell].needs as n (n.id)}
                <button
                  class="tapp"
                  on:click={() => openNeed(n)}
                  style="display:flex;align-items:center;gap:8px;width:100%;background:var(--color-accent-200);border-radius:var(--radius-sm);padding:8px 10px;text-align:left"
                >
                  <span style="flex:1;font-size:12.5px;font-weight:700;color:var(--color-accent-800);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                    >{n.title}</span
                  >
                  <span style="font-size:11px;font-weight:700;color:var(--color-accent-700)">answer →</span>
                </button>
              {/each}
            </div>
            {#if openPublishers.length}
              <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
                {#each openPublishers as h (h.id)}
                  <button
                    class="tapp chip"
                    on:click={() => federateWith(h)}
                    disabled={federatingId === h.id}
                    style="background:var(--color-accent-2-200);color:var(--color-accent-2-800);font-weight:700;font-size:12px;opacity:{federatingId ===
                    h.id
                      ? 0.5
                      : 1}"
                  >
                    {federatingId === h.id ? "Linking…" : `⇄ Federate ${h.name}`}
                  </button>
                {/each}
              </div>
            {/if}
          {:else}
            <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
              {#each openCell.tags as t (t)}
                <div class="chip" style="background:var(--color-accent-200);color:var(--color-accent-800)">{t}</div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <div style="display:flex;align-items:baseline;gap:10px;padding:22px 22px 10px">
      <div style="font-family:var(--font-heading);font-size:21px">{feedTitle}</div>
      <div style="flex:1"></div>
      <button
        class="tapp"
        on:click={() => go("list")}
        style="font-size:12.5px;font-weight:700;color:var(--color-accent-700)"
      >
        Your list →
      </button>
    </div>

    <div style="display:flex;flex-direction:column;gap:10px;padding:0 16px 20px">
      {#each feed as q (q.id)}
        <button
          class="tapp"
          on:click={() => openNeed(q)}
          style="background:var(--color-surface);border-radius:var(--radius-md);padding:14px 16px;display:flex;gap:14px;align-items:center;width:100%"
        >
          <div
            style="width:44px;height:50px;flex:none;position:relative;display:flex;align-items:center;justify-content:center"
          >
            <svg viewBox="0 0 44 50" style="position:absolute;inset:0;width:44px;height:50px">
              <polygon
                points="22,1 43,13 43,37 22,49 1,37 1,13"
                fill={q.status === "requested" ? "var(--color-neutral-300)" : "var(--color-accent-300)"}
              />
            </svg>
            <div style="position:relative;font-size:19px">
              <Icon name={iconForText(String(q.title) + " " + String(q.category ?? ""))} size={22} />
            </div>
          </div>
          <div style="flex:1;min-width:0;text-align:left">
            <div style="font-weight:700;font-size:14.5px;line-height:1.25">{q.title}</div>
            <div style="font-size:12px;color:var(--color-neutral-600);margin-top:3px">{needMeta(q)}</div>
          </div>
          <div style="text-align:right;flex:none">
            <div style="font-family:var(--font-heading);font-size:17px;color:var(--color-accent-700)">
              {q.responses?.length ?? 0}
            </div>
            <div
              style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--color-neutral-600);font-weight:700"
            >
              answers
            </div>
          </div>
        </button>
      {:else}
        <div
          style="background:var(--color-surface);border-radius:var(--radius-md);padding:18px;font-size:13px;color:var(--color-neutral-700)"
        >
          {$mode === "need"
            ? "Nothing on your signal yet — add to your list and send it to the ring."
            : "No open needs from your federation right now."}
        </div>
      {/each}
    </div>

    {#if $mode === "need" && $offersAround.length}
      <div style="display:flex;align-items:baseline;gap:10px;padding:6px 22px 10px">
        <div style="font-family:var(--font-heading);font-size:21px">Offered around you</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;padding:0 16px 20px">
        {#each $offersAround as o (o.id)}
          <button
            class="tapp"
            on:click={() => askFor(o)}
            style="background:var(--color-accent-2-200);border-radius:var(--radius-md);padding:13px 16px;display:flex;gap:12px;align-items:center;width:100%"
          >
            <Icon name={iconForText(String(o.title))} size={20} />
            <div style="flex:1;min-width:0;text-align:left">
              <div style="font-weight:700;font-size:14px;color:var(--color-accent-2-900)">{o.title}</div>
              <div style="font-size:11.5px;color:var(--color-accent-2-800);margin-top:2px">
                from {offerFrom(o)}
              </div>
            </div>
            <span style="font-size:11.5px;font-weight:700;color:var(--color-accent-2-800);flex:none">
              ask for it →
            </span>
          </button>
        {/each}
      </div>
    {/if}

    {#if $mode === "give"}
      <div style="display:flex;align-items:baseline;gap:10px;padding:6px 22px 10px">
        <div style="font-family:var(--font-heading);font-size:21px">Your standing offers</div>
        <div style="flex:1"></div>
        <button
          class="tapp"
          on:click={composeOffer}
          style="font-size:12.5px;font-weight:700;color:var(--color-accent-2-700)"
        >
          + Offer something
        </button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;padding:0 16px 20px">
        {#each $myOffers as o (o.id)}
          <div
            style="background:var(--color-accent-2-200);border-radius:var(--radius-md);padding:13px 16px;display:flex;gap:12px;align-items:center"
          >
            <Icon name={iconForText(String(o.title))} size={20} />
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:14px;color:var(--color-accent-2-900)">{o.title}</div>
              <div style="font-size:11.5px;color:var(--color-accent-2-800);margin-top:2px">
                on the board{o.created ? ` since ${new Date(o.created).toLocaleDateString()}` : ""}
              </div>
            </div>
            <button
              class="tapp"
              on:click={() => withdrawOffer(o)}
              aria-label="Withdraw this offer"
              style="width:30px;height:30px;border-radius:999px;display:flex;align-items:center;justify-content:center;color:var(--color-accent-2-800);font-size:15px;flex:none"
            >
              ×
            </button>
          </div>
        {:else}
          <div
            style="background:var(--color-surface);border-radius:var(--radius-md);padding:16px;font-size:13px;color:var(--color-neutral-700)"
          >
            Nothing on the board yet — what could you provide to the ring?
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
