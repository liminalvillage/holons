<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import Icon from "$lib/components/Icon.svelte";
  //
  // The allocation split, editable where it is read — the kiosk's take on the
  // dashboard's AllocationEditor. Move a slider, place a partner — or a
  // person — on a ring, point the holon at its OpenCollective collective; Save writes the settings
  // lens through core (`saveAllocationConfig` / `saveCollectiveSlug`), which
  // is exactly what the Flows board and Flow Management read back.
  //
  // Every change is also dispatched as a `draft`, so the board behind the
  // sheet redraws as the sliders move — nothing is written until Save.
  //
  // Save goes as far as the device can: with a browser wallet it deploys the
  // holon's Bundle contract if there is none, sends the split to it and THEN
  // writes the off-chain mirror (what every wallet-less surface reads), so
  // chain and mirror cannot disagree; without a wallet — most kiosks — it
  // writes the mirror alone, and "Save off-chain only" does the same on a
  // device that has a wallet but should not use it.
  //
  // Writes go through `getReaStore`, so the acting identity is the logged-in
  // user, signed by the device key — the caller gates on login first.

  import { createEventDispatcher } from "svelte";
  import { t, locale } from "$lib/i18n";
  import {
    describeWindow,
    describeWindowSpan,
    WINDOW_PRESETS,
    WINDOW_PRESET_LABELS,
  } from "$lib/flowswindow";
  import {
    DEFAULT_WINDOW_PRESET,
    formatLocalDate,
    windowFromChoice,
    type FlowsWindowChoice,
    type FlowsWindowPreset,
  } from "@holons/core/flows";
  import { getReaStore } from "$lib/holosphere";
  import {
    allocate,
    bindingAuthority,
    bindingPreflight,
    bundleExplorerUrl,
    chainStanding,
    describeChain,
    loadBundleRecord,
    resolveInteriorMembers,
    saveAllocationConfig,
    saveCollectiveSlug,
    sharesFromMembers,
    interiorSharePercentages,
    type AllocationConfig,
    type AllocationMember,
    type CascadeResult,
    type HolonBundleRecord,
    type InteriorMode,
    type InteriorShares,
  } from "@holons/core/flows";
  import {
    ChainError,
    bindOnChain,
    connectedWallet,
    deployBundleOnChain,
    isWalletAvailable,
    readBindings,
    syncAllocationOnChainAndMirror,
    walletChainId,
    type BundleBindings,
  } from "$lib/chain";
  import type { AllocationDraft } from "$lib/allocation";
  import SidePanel from "./SidePanel.svelte";
  import ValueEquation from "./ValueEquation.svelte";

  export let holonId = "";
  export let config: AllocationConfig;
  export let zones: Record<string, number> = {};
  export let partners: { id: string; name: string }[] = [];
  /** People placed on rings, by user id (settings `allocation.people`). */
  export let zonePeople: Record<string, number> = {};
  /** Everyone who could be placed: the holon's roster, the holon itself excluded. */
  export let candidates: { id: string; name: string }[] = [];
  /** The equation's split today — the starting point a custom split copies. */
  export let scored: AllocationMember[] = [];
  /** The hand-set split as saved (settings `allocation.shares`). */
  export let shares: InteriorShares = {};
  export let collectiveSlug = "";
  /** The holon's deployed Bundle contract, when there is one. */
  export let bundle: HolonBundleRecord | null = null;
  /** The cascade the board resolved, for the pre-flight before a bind. */
  export let cascade: CascadeResult | null = null;
  /** The units the board can be drawn in (`all` first) and the current one. */
  export let units: { id: string; label: string }[] = [];
  export let unit = "all";
  /** The period the board covers. */
  export let period: FlowsWindowChoice = { preset: DEFAULT_WINDOW_PRESET };

  const dispatch = createEventDispatcher<{
    close: void;
    saved: { onChain: boolean };
    draft: AllocationDraft;
    /** The View tab's choices apply on the tap — they are how the board is
     *  read, not a setting to save. */
    unit: string;
    period: FlowsWindowChoice;
  }>();

  $: unitLabel =
    units.find((u) => u.id === unit)?.label ?? $t("flows.trackAll");

  function pickPreset(preset: FlowsWindowPreset) {
    // Custom starts from the period it replaces, so the dates are a tweak
    // rather than two blanks.
    if (preset === "custom" && period.preset !== "custom") {
      const w = windowFromChoice(period);
      dispatch("period", {
        preset,
        from: w.from == null ? null : formatLocalDate(w.from),
        to: formatLocalDate(w.to ?? Date.now()),
      });
      return;
    }
    dispatch("period", { ...period, preset });
  }
  function setBound(end: "from" | "to", value: string) {
    dispatch("period", { ...period, preset: "custom", [end]: value || null });
  }

  // A draft, so Cancel costs nothing and Save writes once.
  let interiorPercent = config.interiorPercent;
  let steepness = config.steepness;
  let nzones = config.nzones;
  let zoneOf: Record<string, number> = { ...zones };
  let personZone: Record<string, number> = { ...zonePeople };
  let interiorMode: InteriorMode = config.interiorMode ?? "equation";
  let shareOf: InteriorShares = { ...shares };
  // What each share BOX shows, kept apart from the number it holds.
  //
  // The stored share is the value equation's own figure, in full precision, so
  // a copied split pays exactly what the equation paid. Rounding that for the
  // box would change the split; rounding it on every keystroke would fight the
  // typist. So the box owns a string, the split owns the number, and they part
  // company only in the digits nobody was going to type.
  let shareText: Record<string, string> = {};
  // The custom-split picker's choice.
  let sharePick = "";
  // The picker's choice; placing it moves the person into the list below.
  let pick = "";
  // The value-equation editor is folded away: it is a long list of weights,
  // and most visits here are about the split, not the scoring behind it.
  let eqOpen = false;

  // ── Tabs ────────────────────────────────────────────────────────────────
  // Four questions, one screen each, instead of nine sections in one scroll.
  // Each tab carries its current value in the strip, so the state of the whole
  // sheet is readable without opening anything.
  type TabId = "view" | "split" | "contributors" | "zones" | "fund";
  let tab: TabId = "view";
  let tabEls: Record<string, HTMLButtonElement | undefined> = {};

  $: tabs = [
    {
      id: "view" as const,
      label: $t("flows.tabView"),
      summary: `${unitLabel} · ${describeWindow(period, $t, $locale)}`,
    },
    {
      id: "split" as const,
      label: $t("alloc.tabSplit"),
      summary: `${interiorPercent}/${exteriorPercent}`,
    },
    {
      id: "contributors" as const,
      label: $t("alloc.tabContributors"),
      summary:
        interiorMode === "custom"
          ? $t("alloc.splitCustom")
          : $t("alloc.splitEquation"),
    },
    {
      id: "zones" as const,
      label: $t("alloc.tabZones"),
      summary: $t("alloc.tabZonesSummary", { n: String(nzones) }),
    },
    {
      id: "fund" as const,
      label: $t("alloc.tabFund"),
      summary: slug.trim() || $t("alloc.tabFundEmpty"),
    },
  ];

  /** A tab list is one stop on the Tab key; the arrows move between tabs. */
  function onTabKey(e: KeyboardEvent) {
    const order = tabs.map((x) => x.id);
    const i = order.indexOf(tab);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % order.length;
    else if (e.key === "ArrowLeft")
      next = (i - 1 + order.length) % order.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = order.length - 1;
    else return;
    e.preventDefault();
    tab = order[next];
    tabEls[tab]?.focus();
  }

  /**
   * Arrow keys inside a ring picker, so a zone can be chosen without a mouse.
   * `set` receives the ring number, 1-based, exactly as a tap would give it.
   */
  function onRingKey(
    e: KeyboardEvent,
    current: number,
    set: (z: number) => void,
  ) {
    let next = current;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = current + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = current - 1;
    else if (e.key === "Home") next = 1;
    else if (e.key === "End") next = nzones;
    else return;
    e.preventDefault();
    set(Math.min(nzones, Math.max(1, next)));
  }
  let slug = collectiveSlug;
  let busy = false;
  let syncing = false;
  let error = "";
  let notice = "";
  const hasWallet = isWalletAvailable();

  // The board behind the sheet follows every change.
  $: dispatch("draft", {
    config: { interiorPercent, steepness, nzones, interiorMode },
    zones: zoneOf,
    people: personZone,
    shares: shareOf,
  });

  $: exteriorPercent = 100 - interiorPercent;
  // A partner on a ring the count no longer reaches falls to the outermost.
  $: for (const id of Object.keys(zoneOf)) {
    if (zoneOf[id] > nzones) zoneOf[id] = nzones;
  }
  $: for (const id of Object.keys(personZone)) {
    if (personZone[id] > nzones) personZone[id] = nzones;
  }
  // The people on rings, named from the roster; a placed id the roster no
  // longer knows keeps its id so it can still be removed.
  $: nameOfPerson = new Map(candidates.map((c) => [c.id, c.name]));
  $: placedPeople = Object.entries(personZone)
    .filter(([, zone]) => zone >= 1)
    .map(([id]) => ({ id, name: nameOfPerson.get(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  $: unplaced = candidates
    .filter(
      (c) => !(personZone[c.id] >= 1) && !partners.some((p) => p.id === c.id),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  // What each zone — and each partner in it — actually receives, as a share
  // of the WHOLE fund: the draft run through the same `allocate()` the Sankey
  // draws and the Bundle contract pays by. An empty zone next to an occupied
  // one shows 0%, because that is what the chain would send it; with nobody
  // placed at all the zones keep their decay shape as a preview.
  $: draft = allocate({
    total: null,
    config: { interiorPercent, steepness, nzones },
    members: [],
    zoned: [
      ...partners.map((p) => ({ ...p, zone: zoneOf[p.id] ?? 0 })),
      ...placedPeople.map((p) => ({
        ...p,
        zone: personZone[p.id],
        kind: "person" as const,
      })),
    ],
  });
  $: zoneShares = draft.exterior.map((z) => z.percentage);
  $: maxZoneShare = Math.max(0, ...zoneShares);
  $: anyPlaced =
    partners.some((p) => (zoneOf[p.id] ?? 0) >= 1) || placedPeople.length > 0;
  $: partnerShare = (id: string): number =>
    draft.exterior.flatMap((z) => z.members ?? []).find((m) => m.id === id)
      ?.percentage ?? 0;
  $: rings = Array.from({ length: nzones }, (_, i) => i + 1);
  const pct = (v: number) => `${Math.round(v * 10) / 10}`;

  // The custom split as rows, named from the roster (then the scored roster),
  // with the equation's share beside each for comparison.
  $: scoredOf = new Map(scored.map((m) => [m.id, m]));
  // The boxes hold plain numbers — 1/2/1 or 25/50/25, either is a split —
  // and the percentage each amounts to is worked out beside it.
  $: shareOfTotal = interiorSharePercentages(shareOf);
  $: shareRows = Object.keys(shareOf).map((id) => ({
    id,
    name: nameOfPerson.get(id) ?? scoredOf.get(id)?.name ?? id,
    scored: scoredOf.get(id)?.percentage,
    text: shareText[id] ?? pct(shareOf[id]),
    ofTotal: shareOfTotal[id] ?? 0,
  }));
  $: sharesTotal = Object.values(shareOf).reduce(
    (s, v) => s + (Number.isFinite(v) && v > 0 ? v : 0),
    0,
  );
  $: shareable = [
    ...new Map(
      [...candidates, ...scored.map((m) => ({ id: m.id, name: m.name }))].map(
        (p) => [p.id, p],
      ),
    ).values(),
  ]
    .filter((p) => !(p.id in shareOf))
    .sort((a, b) => a.name.localeCompare(b.name));
  $: equationShares = sharesFromMembers(scored);

  function setMode(mode: InteriorMode) {
    interiorMode = mode;
    // Custom starts from the equation, unless a split was already entered.
    if (mode === "custom" && Object.keys(shareOf).length === 0) copyEquation();
  }

  function copyEquation() {
    shareOf = { ...equationShares };
    // The boxes show the same rounded figure as the equation hint beside them,
    // while the split keeps the exact number underneath.
    shareText = Object.fromEntries(
      Object.entries(shareOf).map(([id, value]) => [id, pct(value)]),
    );
  }

  function setShare(id: string, raw: string) {
    const value = Number(raw);
    // The box keeps what was typed; only the split rounds. Without this the
    // field rewrites itself mid-keystroke.
    shareText = { ...shareText, [id]: raw };
    shareOf = {
      ...shareOf,
      [id]: Number.isFinite(value) && value >= 0 ? value : 0,
    };
  }

  function removeShare(id: string) {
    const next = { ...shareOf };
    delete next[id];
    shareOf = next;
    const text = { ...shareText };
    delete text[id];
    shareText = text;
  }

  function addShare() {
    if (!sharePick) return;
    shareOf = { ...shareOf, [sharePick]: 0 };
    shareText = { ...shareText, [sharePick]: "0" };
    sharePick = "";
  }

  function place(id: string, zone: number) {
    zoneOf = { ...zoneOf, [id]: zoneOf[id] === zone ? 0 : zone };
  }

  function placePerson(id: string, zone: number) {
    personZone = { ...personZone, [id]: zone };
  }

  function removePerson(id: string) {
    const next = { ...personZone };
    delete next[id];
    personZone = next;
  }

  /** The picker: choosing someone seats them on the first ring at once. */
  function addPerson() {
    if (!pick) return;
    placePerson(pick, 1);
    pick = "";
  }

  // ── Bindings: who each share is paid to on chain ───────────────────────
  // The contract pushes a member's share to the address bound to their id;
  // bound to their own Bundle, it is divided again there. Read once when the
  // Fund tab opens with a wallet present (reads prompt nothing), re-read after
  // a bind. The contract decides who may bind — the owner wallet or the wallet
  // already bound — and `bindingAuthority` is that same rule, so the sheet
  // can say so before the chain refuses.
  let bindings: BundleBindings | null = null;
  let bindingsLoading = false;
  let bindingsKey = "";
  // The wallet's chain, read without prompting when the Fund tab opens: the
  // Bundle's address means nothing on another network, so the tab says which
  // one it is on and whether the wallet is there too.
  let walletChain: number | null = null;
  let copied = false;
  $: if (tab === "fund" && hasWallet)
    void walletChainId().then((id) => (walletChain = id));
  $: standing = chainStanding(bundle, walletChain);
  $: bundleChain = describeChain(bundle?.chainId);
  $: explorer = bundleExplorerUrl(bundle);

  async function copyAddress() {
    if (!bundle) return;
    try {
      await navigator.clipboard.writeText(bundle.address);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // No clipboard on this device: the address is selectable text anyway.
    }
  }
  let wallet = "";
  /** The party whose bind form is open. */
  let bindFor = "";
  let bindAddress = "";
  /** That party's own Bundle, when their holon has one: the cascade target. */
  let bindOwnBundle: string | null = null;
  let bindBusy = false;
  let bindError = "";
  let bindNotice = "";

  // Everyone the root pays, as the draft stands: the contributors the split
  // resolves to, plus whoever is placed on a ring.
  $: parties = [
    ...new Map(
      [
        ...resolveInteriorMembers({
          config: { interiorMode },
          scored,
          shares: shareOf,
          nameOf: (id) => nameOfPerson.get(id),
        }).map((m) => ({ id: m.id, name: m.name })),
        ...partners.filter((p) => (zoneOf[p.id] ?? 0) >= 1),
        ...placedPeople,
      ].map((p) => [p.id, p]),
    ).values(),
  ];
  $: partyIds = parties
    .map((p) => p.id)
    .sort()
    .join("|");
  $: if (tab === "fund" && bundle && hasWallet)
    void loadBindings(bundle.address, partyIds);

  async function loadBindings(address: string, ids: string) {
    const want = `${address}#${ids}`;
    if (want === bindingsKey) return;
    bindingsKey = want;
    bindingsLoading = true;
    try {
      const read = await readBindings(address, ids ? ids.split("|") : []);
      if (bindingsKey === want) bindings = read;
    } catch (err) {
      console.warn("[kiosk] bindings read failed", err);
      if (bindingsKey === want) bindings = null;
    } finally {
      if (bindingsKey === want) bindingsLoading = false;
    }
  }

  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  // `read` is passed in, not closed over: the template only re-runs this
  // when something it names changes, and after a bind that is the bindings.
  function boundLabel(read: BundleBindings, id: string): string {
    const addr = read.bound[id];
    if (!addr && !read.member[id]) return $t("alloc.bindNotOnChain");
    if (!addr) return $t("alloc.bindNone");
    return read.isContract[id]
      ? $t("alloc.bindBundle", { address: short(addr) })
      : $t("alloc.bindWallet", { address: short(addr) });
  }

  /** Open the form for one party; their own Bundle is offered first. */
  async function openBind(id: string) {
    bindFor = id;
    bindError = "";
    bindNotice = "";
    bindOwnBundle = null;
    bindAddress = "";
    try {
      const store = await getReaStore();
      const own = await loadBundleRecord(store, id);
      if (bindFor !== id) return;
      bindOwnBundle = own?.address ?? null;
      bindAddress = bindOwnBundle ?? bindings?.bound[id] ?? "";
    } catch {
      // No settings for that holon: a plain address can still be typed.
    }
    // Who is signing decides whether this form can be sent at all.
    try {
      wallet = await connectedWallet();
    } catch (err: any) {
      if (err instanceof ChainError && err.kind === "rejected") bindFor = "";
    }
  }

  $: bindToOwnBundle =
    !!bindOwnBundle &&
    bindAddress.trim().toLowerCase() === bindOwnBundle.toLowerCase();
  $: bindPreflight = bindingPreflight(cascade, bindFor, {
    toContract: bindToOwnBundle,
  });
  $: bindAuthority = bindings
    ? bindingAuthority({
        wallet,
        owner: bindings.owner,
        bound: bindings.bound[bindFor],
      })
    : "none";
  $: bindValid = /^0x[0-9a-fA-F]{40}$/.test(bindAddress.trim());

  async function sendBind() {
    if (!bundle || !bindFor || bindBusy || !bindValid) return;
    bindBusy = true;
    bindError = "";
    bindNotice = $t("alloc.chainConfirm");
    try {
      const hash = await bindOnChain({
        bundleAddress: bundle.address,
        userId: bindFor,
        beneficiary: bindAddress.trim(),
      });
      bindNotice = $t("alloc.bindDone", { hash: hash.slice(0, 10) });
      bindFor = "";
      bindingsKey = "";
      void loadBindings(bundle.address, partyIds);
    } catch (err: any) {
      bindNotice = "";
      if (err instanceof ChainError) {
        bindError =
          err.kind === "rejected"
            ? $t("alloc.chainRejected")
            : err.kind === "no-contract"
              ? $t("alloc.chainNoContract")
              : err.kind === "no-wallet"
                ? $t("alloc.chainNoWallet")
                : /not authorized/i.test(err.message)
                  ? $t("alloc.bindNotAllowed")
                  : $t("alloc.bindFailed", { reason: err.message });
      } else {
        bindError = $t("alloc.bindFailed", {
          reason: String(err?.message ?? err),
        });
      }
    } finally {
      bindBusy = false;
    }
  }

  function failed(err: any) {
    const denied =
      err?.name === "AuthorizationError" ||
      /denied|unauthori[sz]ed|permission/i.test(String(err?.message ?? ""));
    error = denied ? $t("alloc.errDenied") : $t("alloc.errSave");
    if (!denied) console.error("[kiosk] allocation save failed", err);
  }

  /**
   * Save, on chain when there is a wallet: a holon with no Bundle yet gets
   * one deployed (the wallet owns it), then the split is sent to it and the
   * same mirror every wallet-less surface reads is written. Without a wallet
   * only the mirror is written — see `saveOffChain`.
   */
  async function save() {
    if (busy || syncing) return;
    if (!hasWallet) return saveOffChain();
    syncing = true;
    error = "";
    try {
      const store = await getReaStore();
      let target = bundle;
      if (!target) {
        notice = $t("alloc.deployConfirm");
        target = await deployBundleOnChain(store, holonId, {
          steepness,
          nzones,
        });
        bundle = target;
        notice = $t("alloc.deployDone", {
          address: `${target.address.slice(0, 6)}…${target.address.slice(-4)}`,
        });
      } else {
        notice = $t("alloc.chainConfirm");
      }
      const hash = await syncAllocationOnChainAndMirror(
        store,
        holonId,
        {
          bundleAddress: target.address,
          config: { interiorPercent, steepness, nzones, interiorMode },
          scored,
          shares: shareOf,
          placed: [
            ...partners.map((p) => ({ id: p.id, zone: zoneOf[p.id] ?? 0 })),
            ...placedPeople.map((p) => ({ id: p.id, zone: personZone[p.id] })),
          ],
        },
        zoneOf,
        personZone,
      );
      if (slug.trim() !== collectiveSlug) {
        await saveCollectiveSlug(store, holonId, slug.trim());
      }
      notice = $t("alloc.chainDone", { hash: hash.slice(0, 10) });
      dispatch("saved", { onChain: true });
      dispatch("close");
    } catch (err: any) {
      notice = "";
      if (err instanceof ChainError) {
        error =
          err.kind === "rejected"
            ? $t("alloc.chainRejected")
            : err.kind === "no-contract"
              ? $t("alloc.chainNoContract")
              : err.kind === "no-wallet"
                ? $t("alloc.chainNoWallet")
                : $t("alloc.chainFailed", { reason: err.message });
      } else {
        failed(err);
      }
    } finally {
      syncing = false;
    }
  }

  /** The mirror only — what a caretaker with no wallet can still save. */
  async function saveOffChain() {
    if (busy || syncing) return;
    busy = true;
    error = "";
    try {
      const store = await getReaStore();
      await saveAllocationConfig(
        store,
        holonId,
        { interiorPercent, steepness, nzones, interiorMode },
        zoneOf,
        personZone,
        shareOf,
      );
      if (slug.trim() !== collectiveSlug) {
        await saveCollectiveSlug(store, holonId, slug.trim());
      }
      dispatch("saved", { onChain: false });
      dispatch("close");
    } catch (err: any) {
      failed(err);
    } finally {
      busy = false;
    }
  }
</script>

<SidePanel title={$t("flows.settings")} on:close={() => dispatch("close")}>
  <!-- The four questions this panel answers, each carrying its current value
       so the whole state reads at a glance without opening anything. -->
  <div
    slot="tabs"
    class="tabs"
    role="tablist"
    aria-label={$t("flows.settings")}
  >
    {#each tabs as item (item.id)}
      <button
        bind:this={tabEls[item.id]}
        role="tab"
        id="alloc-tab-{item.id}"
        aria-selected={tab === item.id}
        aria-controls="alloc-panel-{item.id}"
        tabindex={tab === item.id ? 0 : -1}
        class="tab"
        class:on={tab === item.id}
        on:click={() => (tab = item.id)}
        on:keydown={onTabKey}
      >
        <span class="tname">{item.label}</span>
        <span class="tsum">{item.summary}</span>
      </button>
    {/each}
  </div>

  <div
    role="tabpanel"
    id="alloc-panel-{tab}"
    aria-labelledby="alloc-tab-{tab}"
    tabindex="0"
    class="tabpanel"
  >
    {#if tab === "view"}
      <!-- ── What the board shows: one unit, one period ─────────────────── -->
      <div class="control">
        <span class="k" id="alloc-unit-label">{$t("flows.trackLabel")}</span>
        <div
          class="chips"
          role="radiogroup"
          tabindex="-1"
          aria-labelledby="alloc-unit-label"
        >
          {#each units as u (u.id)}
            <button
              type="button"
              role="radio"
              class="chip"
              class:on={unit === u.id}
              aria-checked={unit === u.id}
              on:click={() => dispatch("unit", u.id)}>{u.label}</button
            >
          {/each}
        </div>
        <p class="sub">{$t("flows.unitAbout")}</p>
      </div>

      <div class="control">
        <span class="k" id="alloc-period-label">
          {$t("flows.windowLabel")}
          <span class="value">{describeWindowSpan(period, $t)}</span>
        </span>
        <div
          class="chips"
          role="radiogroup"
          tabindex="-1"
          aria-labelledby="alloc-period-label"
        >
          {#each WINDOW_PRESETS as p (p)}
            <button
              type="button"
              role="radio"
              class="chip"
              class:on={period.preset === p}
              aria-checked={period.preset === p}
              on:click={() => pickPreset(p)}
              >{$t(WINDOW_PRESET_LABELS[p])}</button
            >
          {/each}
        </div>
        {#if period.preset === "custom"}
          <div class="dates">
            <label class="date">
              <span>{$t("flows.windowFrom")}</span>
              <input
                type="date"
                value={period.from ?? ""}
                max={period.to ?? undefined}
                on:change={(e) => setBound("from", e.currentTarget.value)}
              />
            </label>
            <label class="date">
              <span>{$t("flows.windowTo")}</span>
              <input
                type="date"
                value={period.to ?? ""}
                min={period.from ?? undefined}
                on:change={(e) => setBound("to", e.currentTarget.value)}
              />
            </label>
          </div>
        {/if}
        <p class="sub">
          {describeWindow(period, $t, $locale)} — {$t("flows.windowAbout")}
        </p>
      </div>
    {:else if tab === "split"}
      <!-- ── How much goes to each side ─────────────────────────────────── -->
      <div class="control">
        <label for="alloc-interior" class="k">
          {$t("alloc.interior")}
          <span class="value">{interiorPercent}% / {exteriorPercent}%</span>
        </label>
        <input
          id="alloc-interior"
          type="range"
          min="0"
          max="100"
          step="1"
          bind:value={interiorPercent}
        />
        <div class="ends">
          <span>{$t("alloc.allExterior")}</span>
          <span>{$t("alloc.allInterior")}</span>
        </div>
        <p class="sub">{$t("alloc.splitAbout")}</p>
      </div>

      <!-- What each half does next, and the way to go and change it. -->
      <button class="jump" on:click={() => (tab = "contributors")}>
        <span class="jl">{$t("alloc.tabContributors")}</span>
        <span class="jv"
          >{interiorMode === "custom"
            ? $t("alloc.splitCustom")
            : $t("alloc.splitEquation")}</span
        >
        <span class="chev" aria-hidden="true">›</span>
      </button>
      <button class="jump" on:click={() => (tab = "zones")}>
        <span class="jl">{$t("alloc.tabZones")}</span>
        <span class="jv"
          >{$t("alloc.tabZonesSummary", { n: String(nzones) })}</span
        >
        <span class="chev" aria-hidden="true">›</span>
      </button>
    {:else if tab === "contributors"}
      <!-- ── How the contributors' share is divided ─────────────────────── -->
      <div class="control">
        <div class="k" id="alloc-mode-label">{$t("alloc.split")}</div>
        <div class="mode" role="radiogroup" aria-labelledby="alloc-mode-label">
          <button
            role="radio"
            aria-checked={interiorMode === "equation"}
            class="seg"
            class:on={interiorMode === "equation"}
            on:click={() => setMode("equation")}
            >{$t("alloc.splitEquation")}</button
          >
          <button
            role="radio"
            aria-checked={interiorMode === "custom"}
            class="seg"
            class:on={interiorMode === "custom"}
            on:click={() => setMode("custom")}>{$t("alloc.splitCustom")}</button
          >
        </div>
        <p class="sub">
          {interiorMode === "custom"
            ? $t("alloc.splitCustomAbout")
            : $t("alloc.splitEquationAbout")}
        </p>
      </div>

      {#if interiorMode === "custom"}
        {#if shareRows.length}
          <ul class="parties shares">
            {#each shareRows as row (row.id)}
              <li>
                <div class="pline">
                  <span class="pname">{row.name}</span>
                  {#if row.scored != null}
                    <span class="pshare"
                      >{$t("alloc.splitScored", { pct: pct(row.scored) })}</span
                    >
                  {/if}
                </div>
                <div class="sharebox">
                  <input
                    type="number"
                    inputmode="decimal"
                    min="0"
                    step="any"
                    value={row.text}
                    on:input={(e) => setShare(row.id, e.currentTarget.value)}
                    aria-label={row.name}
                  />
                  <span class="unit ofTotal"
                    >{$t("alloc.zoneShare", { pct: pct(row.ofTotal) })}</span
                  >
                  <button
                    class="drop"
                    on:click={() => removeShare(row.id)}
                    aria-label={$t("alloc.removePerson", { name: row.name })}
                    ><Icon name="close" /></button
                  >
                </div>
              </li>
            {/each}
          </ul>
          <div class="totalrow">
            <span>{$t("alloc.splitTotal")}</span>
            <span class="sum"
              >{pct(sharesTotal)}
              <span class="unit ofTotal"
                >{$t("alloc.zoneShare", {
                  pct: sharesTotal > 0 ? 100 : 0,
                })}</span
              ></span
            >
          </div>
        {:else}
          <p class="sub">{$t("alloc.splitEmpty")}</p>
        {/if}
        <div class="rowactions">
          {#if shareable.length}
            <div class="picker">
              <select bind:value={sharePick} aria-label={$t("alloc.addPerson")}>
                <option value="">{$t("alloc.addPerson")}</option>
                {#each shareable as c (c.id)}
                  <option value={c.id}>{c.name}</option>
                {/each}
              </select>
              <button class="add" disabled={!sharePick} on:click={addShare}
                >＋</button
              >
            </div>
          {/if}
          <button
            class="wide-ghost"
            disabled={!Object.keys(equationShares).length}
            on:click={copyEquation}>{$t("alloc.splitCopy")}</button
          >
        </div>
      {/if}

      <!-- The weights behind the equation split. Under "by value equation"
           they ARE the split; under a custom split they still drive the hint
           beside each share and what Copy hands over. -->
      <button
        class="disclose"
        on:click={() => (eqOpen = !eqOpen)}
        aria-expanded={eqOpen}
      >
        <span>{$t("settings.valueEquation")}</span>
        <span class="chev" aria-hidden="true"
          >{#if eqOpen}<Icon name="chevron-down" />{:else}<Icon
              name="chevron-right"
            />{/if}</span
        >
      </button>
      {#if eqOpen}
        <div class="eqbox"><ValueEquation holon={holonId} /></div>
      {/if}
    {:else if tab === "zones"}
      <!-- ── Who is on which ring ───────────────────────────────────────── -->
      <div class="control">
        <label for="alloc-steep" class="k">
          {$t("alloc.sharing")}
          <span class="value">{steepness}%</span>
        </label>
        <input
          id="alloc-steep"
          type="range"
          min="0"
          max="100"
          step="1"
          bind:value={steepness}
        />
        <div class="ends">
          <span>{$t("alloc.steep")}</span>
          <span>{$t("alloc.even")}</span>
        </div>
      </div>

      <div class="control">
        <div class="k">
          {$t("alloc.zones")}
          <span class="value">{nzones}</span>
        </div>
        <p class="sub">
          {anyPlaced ? $t("alloc.zonesAbout") : $t("alloc.zonesPreview")}
        </p>
        <div class="stepper">
          <button
            on:click={() => (nzones = Math.max(1, nzones - 1))}
            disabled={nzones <= 1}
            aria-label={$t("alloc.fewer")}>−</button
          >
          <div class="rings">
            {#each zoneShares as share, i (i)}
              <div
                class="ring"
                class:empty={share <= 0}
                title={$t("alloc.zoneShareFund", { pct: pct(share) })}
              >
                <span class="rs">{pct(share)}%</span>
                <div
                  class="fill"
                  style="height: {maxZoneShare > 0
                    ? Math.max(4, (share / maxZoneShare) * 100)
                    : 4}%"
                ></div>
                <span class="rn">{i + 1}</span>
              </div>
            {/each}
          </div>
          <button
            on:click={() => (nzones = Math.min(10, nzones + 1))}
            disabled={nzones >= 10}
            aria-label={$t("alloc.more")}>+</button
          >
        </div>
      </div>

      <div class="control">
        <div class="k">{$t("alloc.partners")}</div>
        {#if partners.length}
          <p class="sub">{$t("alloc.partnersAbout")}</p>
          <ul class="parties">
            {#each partners as p (p.id)}
              <li>
                <div class="pline">
                  <span class="pname">{p.name}</span>
                  {#if (zoneOf[p.id] ?? 0) >= 1}
                    <span class="pshare"
                      >{$t("alloc.zoneShare", {
                        pct: pct(partnerShare(p.id)),
                      })}</span
                    >
                  {:else}
                    <span class="unplaced">{$t("alloc.unplaced")}</span>
                  {/if}
                </div>
                <div
                  class="ringpick"
                  role="radiogroup"
                  tabindex="-1"
                  aria-label={p.name}
                  on:keydown={(e) =>
                    onRingKey(e, zoneOf[p.id] ?? 0, (z) =>
                      place(p.id, zoneOf[p.id] === z ? 0 : z),
                    )}
                >
                  {#each rings as z (z)}
                    <button
                      role="radio"
                      aria-checked={(zoneOf[p.id] ?? 0) === z}
                      tabindex={(zoneOf[p.id] ?? 0) === z ||
                      (!(zoneOf[p.id] >= 1) && z === 1)
                        ? 0
                        : -1}
                      class="rp"
                      class:on={(zoneOf[p.id] ?? 0) === z}
                      on:click={() => place(p.id, z)}
                      title="{$t('flows.tipZoneN', { n: String(z) })} · {$t(
                        'alloc.zoneShareFund',
                        { pct: pct(zoneShares[z - 1] ?? 0) },
                      )}">{z}</button
                    >
                  {/each}
                </div>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="sub">{$t("alloc.noPartners")}</p>
        {/if}
      </div>

      <div class="control">
        <div class="k">{$t("alloc.people")}</div>
        <p class="sub">{$t("alloc.peopleAbout")}</p>
        {#if placedPeople.length}
          <ul class="parties">
            {#each placedPeople as p (p.id)}
              <li>
                <div class="pline">
                  <span class="pname">{p.name}</span>
                  <span class="pshare"
                    >{$t("alloc.zoneShare", {
                      pct: pct(partnerShare(p.id)),
                    })}</span
                  >
                </div>
                <div
                  class="ringpick"
                  role="radiogroup"
                  tabindex="-1"
                  aria-label={p.name}
                  on:keydown={(e) =>
                    onRingKey(e, personZone[p.id] ?? 1, (z) =>
                      placePerson(p.id, z),
                    )}
                >
                  {#each rings as z (z)}
                    <button
                      role="radio"
                      aria-checked={personZone[p.id] === z}
                      tabindex={personZone[p.id] === z ? 0 : -1}
                      class="rp"
                      class:on={personZone[p.id] === z}
                      on:click={() => placePerson(p.id, z)}
                      title="{$t('flows.tipZoneN', { n: String(z) })} · {$t(
                        'alloc.zoneShareFund',
                        { pct: pct(zoneShares[z - 1] ?? 0) },
                      )}">{z}</button
                    >
                  {/each}
                  <button
                    class="rp drop"
                    on:click={() => removePerson(p.id)}
                    aria-label={$t("alloc.removePerson", { name: p.name })}
                    ><Icon name="close" /></button
                  >
                </div>
              </li>
            {/each}
          </ul>
        {/if}
        {#if unplaced.length}
          <div class="picker">
            <select bind:value={pick} aria-label={$t("alloc.addPerson")}>
              <option value="">{$t("alloc.addPerson")}</option>
              {#each unplaced as c (c.id)}
                <option value={c.id}>{c.name}</option>
              {/each}
            </select>
            <button class="add" disabled={!pick} on:click={addPerson}>＋</button
            >
          </div>
        {:else if !placedPeople.length}
          <p class="sub">{$t("alloc.noPeople")}</p>
        {/if}
      </div>
    {:else}
      <!-- ── Where the money is ─────────────────────────────────────────── -->
      <label class="field">
        <span class="k">{$t("alloc.collective")}</span>
        <input
          type="text"
          autocapitalize="none"
          placeholder={$t("alloc.collectiveHint")}
          bind:value={slug}
        />
      </label>

      <!-- The contract, as it stands: where it is, and whether the wallet
           is there too. Save takes the split there. -->
      <div class="control">
        <div class="k">{$t("alloc.chainTitle")}</div>
        {#if bundle}
          <div class="chain-card">
            <div class="chain-row">
              <span class="chain-k">{$t("alloc.chainNetwork")}</span>
              <span class="chain-v" class:warn={!bundleChain}>
                {#if bundleChain}
                  {bundleChain.name}
                  {#if bundleChain.testnet}<span class="chain-tag"
                      >{$t("alloc.chainTestnet")}</span
                    >{/if}
                {:else}
                  {$t("alloc.chainNetworkUnknown")}
                {/if}
              </span>
            </div>
            <div class="chain-row">
              <span class="chain-k">{$t("alloc.chainAddress")}</span>
              <code class="chain-addr">{bundle.address}</code>
            </div>
            <div class="chain-actions">
              <button class="chain-btn" on:click={copyAddress}
                >{copied
                  ? $t("alloc.chainCopied")
                  : $t("alloc.chainCopy")}</button
              >
              {#if explorer}
                <a
                  class="chain-btn"
                  href={explorer}
                  target="_blank"
                  rel="noopener noreferrer">{$t("alloc.chainExplorer")}</a
                >
              {/if}
            </div>
          </div>
          {#if standing.kind === "elsewhere"}
            <p class="bind-warn">
              {$t("alloc.chainElsewhere", {
                wallet: standing.wallet.name,
                bundle: standing.bundle.name,
              })}
            </p>
          {:else if standing.kind === "unrecorded" && bindings}
            <p class="sub">
              {$t("alloc.chainFoundOn", { network: standing.wallet.name })}
            </p>
          {:else if standing.kind === "unrecorded" && !bindingsLoading}
            <p class="bind-warn">
              {$t("alloc.chainNotFoundOn", { network: standing.wallet.name })}
            </p>
          {/if}
          <p class="sub">{$t("alloc.chainSaveHint")}</p>
        {:else}
          <p class="sub">{$t("alloc.chainNone")}</p>
          {#if hasWallet && walletChain}
            <p class="sub">
              {$t("alloc.chainWillDeployTo", {
                network: describeChain(walletChain)?.name ?? "",
              })}
            </p>
          {/if}
        {/if}
        {#if !hasWallet}
          <p class="sub">{$t("alloc.chainNoWallet")}</p>
        {/if}
      </div>

      {#if bundle}
        <!-- ── Who each share is paid to on chain ──────────────────────── -->
        <div class="control">
          <div class="k">{$t("alloc.bindTitle")}</div>
          <p class="sub">{$t("alloc.bindAbout")}</p>
          {#if !hasWallet}
            <p class="sub">{$t("alloc.chainNoWallet")}</p>
          {:else if bindingsLoading && !bindings}
            <p class="sub">{$t("alloc.bindReading")}</p>
          {:else if !bindings}
            <p class="sub">{$t("alloc.chainNoContract")}</p>
          {:else if !parties.length}
            <p class="sub">{$t("alloc.bindNobody")}</p>
          {:else}
            <ul class="bind-list">
              {#each parties as p (p.id)}
                <li class="bind-row" class:open={bindFor === p.id}>
                  <div class="bind-head">
                    <span class="bind-name">{p.name}</span>
                    <span
                      class="bind-status"
                      class:bound={!!bindings.bound[p.id]}
                      >{boundLabel(bindings, p.id)}</span
                    >
                    <button
                      class="bind-btn"
                      disabled={bindBusy || !bindings.member[p.id]}
                      aria-expanded={bindFor === p.id}
                      on:click={() =>
                        bindFor === p.id ? (bindFor = "") : openBind(p.id)}
                      >{bindings.bound[p.id]
                        ? $t("alloc.rebind")
                        : $t("alloc.bind")}</button
                    >
                  </div>
                  {#if bindFor === p.id}
                    <div class="bind-form">
                      <label class="field">
                        <span class="k">{$t("alloc.bindTo")}</span>
                        <input
                          type="text"
                          autocapitalize="none"
                          spellcheck="false"
                          placeholder="0x…"
                          bind:value={bindAddress}
                        />
                      </label>
                      {#if bindOwnBundle}
                        <button
                          class="bind-own"
                          class:on={bindToOwnBundle}
                          on:click={() => (bindAddress = bindOwnBundle ?? "")}
                        >
                          {$t("alloc.bindOwn", {
                            name: p.name,
                            address: short(bindOwnBundle),
                          })}
                        </button>
                      {/if}
                      {#if bindToOwnBundle}
                        <p class="sub">
                          {$t("alloc.bindCascade", {
                            n: String(bindPreflight.nodes),
                          })}
                        </p>
                        {#each bindPreflight.warnings as w (w)}
                          <p class="bind-warn">
                            {#if w === "loop"}
                              {$t("alloc.bindWarnLoop", {
                                names: bindPreflight.loops[0]
                                  .map((id) => nameOfPerson.get(id) ?? id)
                                  .join(" → "),
                              })}
                            {:else if w === "large"}
                              {$t("alloc.bindWarnLarge", {
                                n: String(bindPreflight.nodes),
                              })}
                            {:else}
                              {$t("alloc.bindWarnDeep", {
                                n: String(bindPreflight.depth),
                              })}
                            {/if}
                          </p>
                        {/each}
                      {/if}
                      {#if wallet && bindAuthority === "none"}
                        <p class="bind-warn">
                          {$t("alloc.bindNotAllowed")}
                          {#if bindings.owner}
                            {$t("alloc.bindOwnerIs", {
                              address: short(bindings.owner),
                            })}
                          {/if}
                        </p>
                      {/if}
                      <div class="bind-actions">
                        <button
                          class="ghost"
                          disabled={bindBusy}
                          on:click={() => (bindFor = "")}
                          >{$t("common.cancel")}</button
                        >
                        <button
                          class="primary"
                          disabled={bindBusy ||
                            !bindValid ||
                            bindAuthority === "none"}
                          on:click={sendBind}
                        >
                          {bindBusy
                            ? $t("alloc.chainSyncing")
                            : $t("alloc.bindSend")}
                        </button>
                      </div>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          {#if bindError}<p class="error" role="alert">{bindError}</p>{/if}
          {#if bindNotice}<p class="notice" role="status">{bindNotice}</p>{/if}
        </div>
      {/if}
    {/if}
  </div>

  <svelte:fragment slot="footer">
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if notice}<p class="notice" role="status">{notice}</p>{/if}
    <div class="actions">
      {#if tab === "view"}
        <!-- The View tab applied on the tap; there is nothing to save. -->
        <button class="primary" on:click={() => dispatch("close")}
          >{$t("common.close")}</button
        >
      {:else}
        <button class="ghost" on:click={() => dispatch("close")}
          >{$t("common.cancel")}</button
        >
        <button class="primary" disabled={busy || syncing} on:click={save}>
          {syncing
            ? $t("alloc.chainSyncing")
            : busy
              ? $t("common.saving")
              : hasWallet
                ? $t("alloc.saveOnChain")
                : $t("alloc.save")}
        </button>
      {/if}
    </div>
    {#if tab !== "view" && hasWallet}
      <button
        class="offchain"
        disabled={busy || syncing}
        on:click={saveOffChain}>{$t("alloc.saveOffChain")}</button
      >
    {/if}
  </svelte:fragment>
</SidePanel>

<style>
  /* ── Tab strip ──────────────────────────────────────────────────────────
     Four equal tabs, each showing its own current value so the state of the
     whole panel reads without opening a thing. */
  .tabs {
    display: flex;
    gap: 2px;
    padding: 0 0.7rem 0.6rem;
    border-bottom: 1px solid var(--line);
  }
  .tab {
    flex: 1 1 0;
    min-width: 0;
    min-height: 52px;
    padding: 0.35rem 0.3rem;
    border-radius: 12px;
    background: transparent;
    color: var(--muted);
    text-align: center;
    touch-action: manipulation;
  }
  .tab.on {
    background: var(--paper);
    color: var(--ink);
  }
  .tname {
    display: block;
    font-size: 0.82rem;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tsum {
    display: block;
    font-size: 0.68rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab.on .tsum {
    color: var(--teal-deep);
  }
  .tabpanel:focus-visible {
    outline: 2px solid var(--teal);
    outline-offset: 4px;
    border-radius: 10px;
  }

  /* ── Shared blocks ──────────────────────────────────────────────────── */
  .k {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.6rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .value {
    font-size: 0.95rem;
    letter-spacing: 0;
    text-transform: none;
    color: var(--ink);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .sub {
    margin: 0.3rem 0 0.4rem;
    font-size: 0.85rem;
    line-height: 1.4;
    color: var(--muted);
  }
  .control {
    margin-top: 1.2rem;
  }
  .control:first-child {
    margin-top: 0.6rem;
  }
  .field {
    display: block;
    margin: 0.6rem 0 0;
  }
  .field input {
    display: block;
    width: 100%;
    margin-top: 0.35rem;
    padding: 0.75rem 0.8rem;
    font-size: 1rem;
    font-family: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
    min-height: 48px;
  }
  .field input:focus {
    outline: none;
    border-color: var(--teal);
  }
  input[type="range"] {
    width: 100%;
    margin: 0.6rem 0 0.1rem;
    accent-color: var(--teal);
    /* Absolute, not rem: the kiosk shrinks its root size on a phone, and a
       rem-sized track quietly drops under the 44px a thumb needs. */
    height: 44px;
  }
  .ends {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.72rem;
    color: var(--muted);
  }

  /* ── Jump rows on the Split tab ─────────────────────────────────────── */
  .jump {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    min-height: 56px;
    margin-top: 0.5rem;
    padding: 0.6rem 0.7rem;
    border-radius: 14px;
    background: var(--paper);
    text-align: left;
    touch-action: manipulation;
  }
  .jl {
    flex: 1;
    font-weight: 700;
    color: var(--ink);
  }
  .jv {
    color: var(--teal-deep);
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 45%;
  }
  .chev {
    color: var(--muted);
    flex: 0 0 auto;
  }

  /* ── Mode switch ────────────────────────────────────────────────────── */
  .mode {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  .seg {
    flex: 1;
    min-height: 52px;
    border-radius: 14px;
    background: var(--paper);
    color: var(--ink-soft);
    font-weight: 700;
    touch-action: manipulation;
  }
  .seg.on {
    background: var(--teal);
    color: #fff;
  }

  /* ── Party rows ──────────────────────────────────────────────────────
     The name gets a line of its own and the ring picker the full width
     below it, so a long name simply clips instead of squeezing the rings
     into something no finger can hit. */
  .parties {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.9rem;
  }
  .parties li {
    min-width: 0;
  }
  .pline {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
    min-width: 0;
    margin-bottom: 0.35rem;
  }
  .pname {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: 700;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pshare {
    flex: 0 0 auto;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--teal-deep);
    font-variant-numeric: tabular-nums;
  }
  .unplaced {
    flex: 0 0 auto;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .ringpick {
    display: flex;
    gap: 6px;
    min-width: 0;
    overflow-x: auto; /* only ever needed at the extreme zone counts */
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }
  .ringpick::-webkit-scrollbar {
    display: none;
  }
  .rp {
    flex: 1 1 0;
    min-width: 44px;
    height: 44px;
    border-radius: 12px;
    background: var(--paper);
    color: var(--ink-soft);
    font-size: 0.9rem;
    font-weight: 700;
    touch-action: manipulation;
  }
  .rp.on {
    background: var(--teal);
    color: #fff;
  }
  .rp.drop {
    flex: 0 0 44px;
    color: var(--muted);
  }

  /* ── Custom split rows ──────────────────────────────────────────────── */
  .sharebox {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .sharebox input {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 48px;
    padding: 0.4rem 0.6rem;
    font: inherit;
    font-weight: 700;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
  }
  .sharebox input:focus {
    outline: none;
    border-color: var(--teal);
  }
  .unit {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .ofTotal {
    flex: 0 0 auto;
    min-width: 3.6rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .drop {
    flex: 0 0 44px;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: var(--paper);
    color: var(--muted);
    touch-action: manipulation;
  }
  .totalrow {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-top: 0.7rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--line);
    font-weight: 700;
    color: var(--ink);
  }
  .sum {
    color: var(--teal-deep);
    font-variant-numeric: tabular-nums;
  }
  .rowactions {
    display: grid;
    gap: 0.5rem;
    margin-top: 0.8rem;
  }

  /* ── Pickers, disclosure, zone bars ─────────────────────────────────── */
  .picker {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .picker select {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    padding: 0.4rem 0.7rem;
    font: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
  }
  .picker .add {
    flex: 0 0 48px;
    min-height: 48px;
    border-radius: 12px;
    background: var(--teal);
    color: #fff;
    font-size: 1.2rem;
    touch-action: manipulation;
  }
  .picker .add:disabled {
    opacity: 0.4;
  }
  .wide-ghost {
    width: 100%;
    min-height: 48px;
    padding: 0 0.9rem;
    border-radius: 14px;
    background: var(--paper);
    color: var(--ink);
    font-weight: 700;
    touch-action: manipulation;
  }
  .wide-ghost:disabled {
    opacity: 0.45;
  }
  /* ── The contract's whereabouts ─────────────────────────────────────── */
  .chain-card {
    margin-top: 0.5rem;
    padding: 0.7rem 0.8rem;
    border: 1.5px solid var(--line);
    border-radius: 12px;
    background: var(--card);
  }
  .chain-row {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.25rem 0;
  }
  .chain-k {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .chain-v {
    font-size: 1rem;
    font-weight: 700;
    color: var(--ink);
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .chain-v.warn {
    color: #a3540d;
    font-weight: 500;
  }
  .chain-tag {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.1rem 0.4rem;
    border-radius: 6px;
    background: var(--paper);
    color: var(--muted);
  }
  .chain-addr {
    display: block;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.86rem;
    color: var(--ink);
    word-break: break-all;
    user-select: all;
    -webkit-user-select: all;
  }
  .chain-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .chain-btn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 0 0.8rem;
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 0.88rem;
    font-weight: 700;
    text-decoration: none;
    touch-action: manipulation;
  }

  /* ── Bindings ─────────────────────────────────────────────────────────
     One row per party the root pays: name, where it goes on chain, and the
     bind button; the form unfolds under the row it belongs to. */
  .bind-list {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
  }
  .bind-row {
    border-top: 1px solid var(--line);
    padding: 0.4rem 0;
  }
  .bind-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "name btn"
      "status btn";
    align-items: center;
    column-gap: 0.6rem;
    min-height: 48px;
  }
  .bind-name {
    grid-area: name;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bind-status {
    grid-area: status;
    font-size: 0.82rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .bind-status.bound {
    color: var(--teal-deep);
  }
  .bind-btn {
    grid-area: btn;
    min-height: 44px;
    min-width: 44px;
    padding: 0 0.9rem;
    border-radius: 12px;
    background: var(--paper);
    color: var(--ink);
    font-weight: 700;
    touch-action: manipulation;
  }
  .bind-btn:disabled {
    opacity: 0.45;
  }
  .bind-form {
    padding: 0 0 0.6rem;
  }
  .bind-own {
    display: block;
    width: 100%;
    margin-top: 0.5rem;
    min-height: 44px;
    padding: 0.5rem 0.8rem;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--card);
    color: var(--ink);
    text-align: left;
    font: inherit;
    font-size: 0.9rem;
    touch-action: manipulation;
  }
  .bind-own.on {
    border-color: var(--teal);
    color: var(--teal-deep);
  }
  .bind-warn {
    margin: 0.5rem 0 0;
    font-size: 0.85rem;
    line-height: 1.4;
    color: #a3540d;
  }
  .bind-actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.7rem;
  }
  .bind-actions .primary,
  .bind-actions .ghost {
    min-height: 48px;
  }

  .disclose {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    width: 100%;
    min-height: 52px;
    margin-top: 1.2rem;
    padding: 0.6rem 0.2rem;
    font: inherit;
    font-weight: 700;
    color: var(--ink);
    border-top: 1px solid var(--line);
    touch-action: manipulation;
  }
  .eqbox {
    margin-bottom: 0.4rem;
  }
  .stepper {
    display: flex;
    align-items: stretch;
    gap: 0.5rem;
    margin-top: 0.4rem;
  }
  .stepper > button {
    flex: 0 0 52px;
    min-height: 52px;
    border-radius: 14px;
    background: var(--paper);
    color: var(--ink);
    font-size: 1.3rem;
    font-weight: 700;
    touch-action: manipulation;
  }
  .stepper > button:disabled {
    opacity: 0.4;
  }
  .rings {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 74px;
    padding: 0.3rem 0.4rem 0;
    border-radius: 14px;
    background: var(--paper);
  }
  .ring {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    height: 100%;
  }
  .rs {
    font-size: 0.6rem;
    color: var(--teal-deep);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .ring.empty .rs {
    color: var(--muted);
  }
  .fill {
    width: 100%;
    border-radius: 4px 4px 0 0;
    background: var(--teal);
    min-height: 3px;
  }
  .ring.empty .fill {
    background: var(--line);
  }
  .rn {
    font-size: 0.62rem;
    color: var(--muted);
  }

  /* ── Footer ─────────────────────────────────────────────────────────── */
  /* ── View tab: unit and period chips ──────────────────────────────── */
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  .chip {
    min-height: 44px;
    padding: 0 0.95rem;
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink-soft);
    font-size: 0.86rem;
    font-weight: 700;
    touch-action: manipulation;
  }
  .chip.on {
    background: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-soft);
  }
  .dates {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 0.7rem;
  }
  .date {
    flex: 1 1 10rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .date input {
    min-height: 44px;
    padding: 0 0.7rem;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font: inherit;
    font-size: 0.95rem;
  }

  .actions {
    display: flex;
    gap: 0.6rem;
  }
  .primary,
  .ghost {
    flex: 1;
    min-height: 52px;
    border-radius: 14px;
    font-size: 1rem;
    font-weight: 700;
    transition: transform 0.1s ease;
  }
  .primary {
    background: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-soft);
  }
  .ghost {
    background: var(--paper);
    color: var(--ink);
  }
  .primary:active,
  .ghost:active {
    transform: scale(0.97);
  }
  .primary:disabled {
    opacity: 0.6;
  }
  .offchain {
    display: block;
    width: 100%;
    min-height: 44px;
    margin-top: 0.3rem;
    background: none;
    color: var(--muted);
    font-size: 0.85rem;
    text-decoration: underline;
    touch-action: manipulation;
  }
  .offchain:disabled {
    opacity: 0.45;
  }
  .error {
    color: #c0392b;
    font-size: 0.88rem;
    margin: 0 0 0.6rem;
  }
  .notice {
    color: var(--teal-deep);
    font-size: 0.88rem;
    margin: 0 0 0.6rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .primary,
    .ghost {
      transition: none;
    }
  }
</style>
