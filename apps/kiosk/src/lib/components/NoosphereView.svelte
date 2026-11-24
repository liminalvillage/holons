<script lang="ts" context="module">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import type { LensDirections } from "$lib/dock";
  import { parseTrail, type Step } from "$lib/noosphere";

  // What the federation said, kept across visits to the view (and across
  // views): a toggle back to the noosphere repaints at once instead of
  // reading every partner again. Read fresh once per session behind it.
  const partnerMap = new Map<string, string[]>();
  const configs = new Map<string, Record<string, LensDirections>>();
  /** Names the federation records carry: the LAST read wins, and only as a fallback. */
  const snapNames = new Map<string, string>();
  const fresh = new Set<string>();
  /** Names resolved FOR each holon (the dock's own authority, resolveNames). */
  const authNames = new Map<string, string>();
  const asked = new Set<string>();
  /** Ids the resolver has answered for (named or not), or gave up waiting on. */
  const answered = new Set<string>();
  /**
   * Each frame's circle order, frozen the first time its own record is read:
   * a flower never reshuffles under the person as flows arrive, and a
   * preview lands exactly as it was seen.
   */
  const ranks = new Map<string, string[]>();
  /** The top level's order, first seen first: hubs arriving late join at the end. */
  const rootOrder: string[] = [];

  /** The trail the person last stood on: a toggle back (or a reload) lands there. */
  const TRAIL_KEY = "kiosk_noo_trail";
  function readTrail(): Step[] {
    try {
      return parseTrail(JSON.parse(sessionStorage.getItem(TRAIL_KEY) ?? "[]"));
    } catch {
      return [];
    }
  }
  const kept = { trail: null as Step[] | null };
  /**
   * The resolver's lookup as last heard — outside the component's reactivity
   * on purpose: the scene re-reads it with its own coalesced tick.
   */
  const heard = { nameOf: (id: string) => id };
</script>

<script lang="ts">
  // The noosphere as the flower of life, drawn through Metatron's cube. The
  // frame is one holon: its seed at the centre, its federation partners the
  // circles of the flower round it, ring by ring on the hexagonal lattice
  // (lib/noosphere flowerOf). Faint straight lines join every centre — the
  // cube — and the lines between the seed and each partner are its
  // channels: two strands, what reaches the frame on one side and what it
  // sends on the other, light travelling the way the data goes. Each circle
  // holds a small flower of that partner's own partners, laid out by the
  // very call that lays it out once entered, so a tap falls into it without
  // a jump. A double tap (or a held press) opens the hub's board instead.
  //
  // The scene is drawn once in the frame's unit circle and the camera is the
  // SVG viewBox, so a flight writes one attribute per frame. Names are NOT
  // in that scene: they are set in real pixels on a layer of their own,
  // fitted to each circle once the stage is measured — a font size in the
  // camera's tiny units was laid out by some engines at the first, unmeasured
  // scale and only corrected by a zoom.
  import { onDestroy, onMount, tick } from "svelte";
  import { get } from "svelte/store";
  import { isValidCell } from "h3-js";
  import { getFederationSnapshot } from "@holons/core/federation";
  import { shortId } from "@holons/core/identity";
  import { getHolosphere } from "$lib/holosphere";
  import { readCache } from "$lib/dockcache";
  import { IDENTICON_SIZE, identiconCells } from "$lib/identicon";
  import { holonColor, holonColors, inkOn } from "$lib/palette";
  import {
    invalidateName,
    isPrimedName,
    nameOf,
    resolveNames,
  } from "$lib/names";
  import { fedLensLabel } from "$lib/fedrequests";
  import {
    dockEntries,
    matchesText,
    pairFlows,
    rememberBoard,
  } from "$lib/dock";
  import {
    DOUBLE_MS,
    FRAME,
    HOLD_MS,
    HOME,
    LENS_TABS,
    MAX_CHILDREN,
    ROOT,
    ROOT_ROT,
    channel,
    childRot,
    childrenOf,
    easeInOut,
    fitLabel,
    flowerCentres,
    flowerOf,
    idTail,
    latticeLines,
    lensesReaching,
    lerpCam,
    linesPath,
    orderKids,
    placeCard,
    reaching,
    segAt,
    shortName,
    streamOf,
    tapMeaning,
    ties,
    travel,
    twins,
    vesicaPath,
    wheelGate,
    type Bloom,
    type Cam,
    type Fit,
    type Flower,
    type Measure,
    type Rect,
    type Seg,
    type Stream,
    type WheelState,
    markPlace,
    MARK_BOX_H,
    MARK_BOX_W,
    MARK_DROP,
  } from "$lib/noosphere";
  import { t, type MessageKey } from "$lib/i18n";
  import Icon from "./Icon.svelte";

  /** The hubs at the top of the noosphere — the dock's. */
  export let hubs: readonly { id: string; name: string }[] = [];
  /** The search box: dims the circles whose name doesn't answer it. */
  export let query = "";
  export let onopen: (hub: string) => void;
  /**
   * Open the flow editor for the pair (DockView owns the Modal and the
   * FederationLens in it — the one place a flow is written).
   */
  export let ontend:
    | ((
        holon: string,
        partner: string,
        holonName: string,
        partnerName: string,
      ) => void)
    | undefined = undefined;
  /** A dialog over the view (the flow editor): everything holds still. */
  export let paused = false;

  const reducedMotion =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── The federation, read as it is needed ────────────────────────────────

  for (const [id, f] of Object.entries(
    readCache<
      Record<
        string,
        { partners?: string[]; lenses?: Record<string, LensDirections> }
      >
    >("federation", {}),
  )) {
    if (!partnerMap.has(id) && Array.isArray(f?.partners))
      partnerMap.set(id, f.partners);
    if (!configs.has(id) && f?.lenses && typeof f.lenses === "object")
      configs.set(id, f.lenses);
  }

  /** Bumped whenever a read lands: the scene re-derives. */
  let fedTick = 0;
  /**
   * Reads and names land in bursts (25 hubs, each with its partners): they
   * are gathered into one scene update every ~100 ms, never one per answer.
   */
  let bumpFed = false;
  let bumpName = false;
  let bumpTimer: ReturnType<typeof setTimeout> | null = null;
  function bump(kind: "fed" | "name") {
    if (kind === "fed") bumpFed = true;
    else bumpName = true;
    if (bumpTimer) return;
    bumpTimer = setTimeout(() => {
      bumpTimer = null;
      if (bumpFed) fedTick += 1;
      if (bumpName) nameTick += 1;
      bumpFed = bumpName = false;
    }, 100);
  }
  let reading = 0;
  const inflight = new Set<string>();

  async function load(ids: readonly string[]) {
    const want = ids.filter((id) => id && !fresh.has(id) && !inflight.has(id));
    if (!want.length) return;
    for (const id of want) inflight.add(id);
    reading += 1;
    try {
      const hs = await getHolosphere();
      await Promise.all(
        want.map(async (id) => {
          try {
            const snap = await getFederationSnapshot(hs, id);
            partnerMap.set(id, snap.federated);
            configs.set(id, snap.lensConfig);
            for (const [pid, n] of Object.entries(snap.partnerNames ?? {}))
              if (n) snapNames.set(pid, n);
            fresh.add(id);
          } catch {
            if (!partnerMap.has(id)) partnerMap.set(id, []);
          } finally {
            inflight.delete(id);
          }
        }),
      );
    } catch {
      for (const id of want) inflight.delete(id);
    } finally {
      reading -= 1;
      bump("fed");
    }
  }

  // ── Where we are ────────────────────────────────────────────────────────

  /** The frames entered, outermost first, each with its turn; empty at the top. */
  let trail: Step[] = kept.trail ?? (kept.trail = readTrail());
  $: {
    kept.trail = trail;
    try {
      sessionStorage.setItem(TRAIL_KEY, JSON.stringify(trail));
    } catch {
      /* private mode: the trail lives for this visit only */
    }
  }
  $: focus = trail.length ? trail[trail.length - 1].id : null;
  /** The frame `focus` was entered from (null: from the top). */
  $: container = trail.length > 1 ? trail[trail.length - 2].id : null;
  $: frameRot = trail.length ? trail[trail.length - 1].rot : ROOT_ROT;

  /** The dock's hubs in the order first seen: late arrivals never reshuffle it. */
  function stableRoot(list: readonly { id: string }[]): string[] {
    const now = [...new Set(list.map((h) => h.id).filter(Boolean))];
    const have = new Set(now);
    const keep = rootOrder.filter((id) => have.has(id));
    const seen = new Set(keep);
    for (const id of now) if (!seen.has(id)) keep.push(id);
    rootOrder.splice(0, rootOrder.length, ...keep);
    return keep.slice(0, MAX_CHILDREN);
  }
  $: rootIds = stableRoot(hubs);

  const flowOf = (frame: string, kid: string) => streamOf(frame, kid, configs);
  const flowWeight = (frame: string, kid: string) => {
    const s = flowOf(frame, kid);
    return 2 * s.inbound.length + s.outbound.length;
  };

  /**
   * The circles inside `id` entered from `from`, in slot order: the way back
   * first, then by what flows — ranked once the frame's own record is read,
   * then frozen. The top level keeps the dock's order, never ranked.
   */
  function orderedKids(id: string | null, from: string | null): string[] {
    if (id === null) return rootIds;
    const kids = childrenOf(id, partnerMap.get(id), from);
    const key = `${id}|${from ?? ""}`;
    let order = ranks.get(key);
    if (!order && fresh.has(id)) {
      order = orderKids(kids, from, (k) => flowWeight(id, k));
      ranks.set(key, order);
    }
    const frozen = order;
    return orderKids(
      kids,
      from,
      frozen
        ? (k) => {
            const i = frozen.indexOf(k);
            return i < 0 ? -1e6 : -i;
          }
        : (k) => flowWeight(id, k),
    );
  }
  /** The flower of `id` entered from `from` at turn `rot` — previews and frames alike. */
  function flowerFor(
    id: string | null,
    from: string | null,
    rot: number,
  ): Flower {
    return flowerOf(orderedKids(id, from), rot, id === null ? ROOT : FRAME);
  }

  $: flower =
    (void fedTick, void rootIds, flowerFor(focus, container, frameRot));
  $: kids = flower.blooms.map((b) => b.id);
  $: void load(focus ? [focus, ...kids] : kids);
  /** Each circle's preview: that partner's own flower, as entered from here. */
  $: minis =
    (void fedTick,
    new Map(
      flower.blooms.map((b) => [b.id, flowerFor(b.id, focus, childRot(b))]),
    ));
  $: seed = { x: 0, y: 0, r: flower.hub };

  onMount(() => {
    const onFedChanged = () => {
      const ids = focus ? [focus, ...kids] : kids;
      for (const id of ids) fresh.delete(id);
      void load(ids);
    };
    window.addEventListener("kiosk:federation-changed", onFedChanged);
    return () =>
      window.removeEventListener("kiosk:federation-changed", onFedChanged);
  });

  // ── Size ────────────────────────────────────────────────────────────────

  let paneW = 0;
  let paneH = 0;
  /** Nothing is drawn until the stage is measured: the first frame is the settled one. */
  $: measured = paneW > 0 && paneH > 0;
  $: wide = paneW >= 860;
  $: phone = paneW < 600;
  $: panelW = wide ? Math.min(360, Math.max(300, paneW * 0.3)) : 0;
  $: stageW = Math.max(1, paneW - panelW);
  /** Narrow: the stage keeps its height; the panel is a sheet over its foot. */
  $: stageH = Math.max(
    1,
    wide ? paneH : Math.max(240, Math.min(paneH - 120, paneW + 80)),
  );
  $: TOP = phone ? 56 : 64;
  $: BOTTOM = wide ? 56 : 24;
  /** Screen px per frame unit at rest. */
  $: S = Math.max(
    60,
    Math.min(
      stageW / 2 - (phone ? 6 : 40),
      (stageH - TOP - BOTTOM) / 2 - (phone ? 4 : 12),
    ),
  );
  $: cx = stageW / 2;
  $: cy = TOP + (stageH - TOP - BOTTOM) / 2;
  let sheetOpen = false;
  $: sheetH = wide ? 0 : sheetOpen ? paneH : paneH - stageH + 22;

  // ── The camera ──────────────────────────────────────────────────────────

  let cam: Cam = HOME;
  $: u = cam.r / S;
  $: viewBox = `${cam.x - cx * u} ${cam.y - cy * u} ${stageW * u} ${stageH * u}`;

  // ── Names, colours, lenses ──────────────────────────────────────────────

  // Names come from the one resolver, asked FOR each holon (resolveNames —
  // what names the dock's circles too). A stored label (a dock entry, a
  // federation record's word for its partner) only stands in, muted, until
  // the resolver answers.
  let nameTick = 0;
  /**
   * The resolver's own lookup, refreshed with the scene (bump), not on every
   * answer it hears for any surface.
   */
  heard.nameOf = get(nameOf);
  const resolvedFn = (id: string) => heard.nameOf(id);
  onMount(() =>
    nameOf.subscribe((f) => {
      heard.nameOf = f;
      bump("name");
    }),
  );
  /**
   * Past this, an unanswered id shows its stored label (muted) rather than
   * waiting: at the top its mark already says which hub it is, and a blank
   * circle for longer reads as broken.
   */
  const NAME_WAIT = 3500;
  /** Re-asks for ids no source answered (a relay read that timed out). */
  const RETRY = [4000, 15000];
  async function learnNames(ids: readonly string[], attempt = 0) {
    const want = ids.filter((id) => id && (attempt > 0 || !asked.has(id)));
    if (!want.length) return;
    for (const id of want) asked.add(id);
    const late = setTimeout(() => {
      for (const id of want) answered.add(id);
      bump("name");
    }, NAME_WAIT);
    const missed: string[] = [];
    try {
      const m = await resolveNames(want);
      for (const id of want) {
        const n = m.get(id) ?? "";
        // A name only primed (another holon's label for it) is not an answer.
        if (n && n !== shortId(id) && !isPrimedName(id)) authNames.set(id, n);
        else if (!authNames.has(id)) missed.push(id);
      }
    } catch {
      missed.push(...want);
    } finally {
      clearTimeout(late);
      // The resolver has had its say: an id it could not name shows its
      // stored label now (a retry may still name it later).
      for (const id of want) answered.add(id);
      bump("name");
    }
    if (missed.length && attempt < RETRY.length && alive)
      retries.push(
        setTimeout(() => {
          for (const id of missed) invalidateName(id);
          void learnNames(missed, attempt + 1);
        }, RETRY[attempt]),
      );
  }
  let alive = true;
  const retries: ReturnType<typeof setTimeout>[] = [];
  $: void learnNames([...trail.map((s) => s.id), ...kids]);
  // The previews' circles too, so a flight in lands on names already asked.
  $: void learnNames(
    [...minis.values()].flatMap((m) => m.blooms.map((b) => b.id)),
  );

  /** The name a source answered for `id` (never a primed or stored label), or "". */
  function sureName(id: string): string {
    const auth = authNames.get(id);
    if (auth) return auth;
    const r = resolvedFn(id);
    return r && r !== shortId(id) && !isPrimedName(id) ? r : "";
  }
  /** The resolver has not answered for `id` yet: its name is a stand-in. */
  const unnamed = (id: string) => !sureName(id) && !answered.has(id);
  function label(id: string, resolved: (id: string) => string): string {
    const sure = sureName(id);
    if (sure) return sure;
    const r = resolved(id);
    return (
      $dockEntries.find((e) => e.id === id)?.name ||
      hubs.find((h) => h.id === id)?.name ||
      snapNames.get(id) ||
      r ||
      shortId(id) ||
      id
    );
  }
  $: nm =
    (void fedTick,
    void nameTick,
    void hubs,
    void $dockEntries,
    (id: string) => label(id, resolvedFn));
  $: naming = (void nameTick, unnamed);
  /**
   * Circles whose names read alike, among names a source has answered for
   * (a stand-in is no one's twin): they carry their id tail, on the circle
   * and in the panel alike.
   */
  $: twinSet =
    (void nameTick,
    twins(
      kids.filter((id) => !!sureName(id)),
      nm,
    ));
  /** A circle's name as the panel and the card print it ("…" while asked for). */
  $: shown = (id: string) =>
    naming(id) ? "…" : twinSet.has(id) ? `${nm(id)} ${idTail(id)}` : nm(id);
  $: lensName = (lens: string) =>
    LENS_TABS[lens]
      ? $t(LENS_TABS[lens] as MessageKey)
      : fedLensLabel($t, lens);
  /** Lens labels, each once (offers and needs share a tab). */
  $: lensList = (lenses: readonly string[]) => [
    ...new Set(lenses.map((l) => lensName(l))),
  ];
  const isCell = (id: string) => {
    try {
      return isValidCell(id);
    } catch {
      return false;
    }
  };
  $: colorOf = (id: string | null) =>
    id ? holonColor(id, $holonColors) : "var(--teal)";
  /**
   * `--on-c` for a caretaker's literal colour, which the palette's ink was
   * never tuned against (the note palette reads with the theme's ink).
   */
  $: inkStyle = (id: string) => {
    const ink = inkOn(colorOf(id));
    return ink ? ` --on-c: ${ink};` : "";
  };

  // ── The scene, in frame units ───────────────────────────────────────────

  $: slotOf = new Map(flower.blooms.map((b) => [b.id, b]));
  /** The flower of life behind the circles, and the cube's lines. */
  $: centres = flowerCentres(flower.k || 1, flower.rot);
  $: cubeD = linesPath(latticeLines(flower.k || 1, flower.rot), flower.d);
  $: miniCube = new Map(
    [...minis].map(([id, m]) => [
      id,
      m.blooms.length ? linesPath(latticeLines(m.k, m.rot), m.d) : "",
    ]),
  );
  /** Strands sit this far either side of the line they share (frame units). */
  $: gap = 3.4 / S;

  $: frameStreams =
    (void fedTick,
    new Map<string, Stream>(
      focus ? flower.blooms.map((b) => [b.id, flowOf(focus, b.id)]) : [],
    ));

  /** Each circle's channel to the seed: two strands, and the line a tap finds. */
  $: chans = focus
    ? flower.blooms.map((b) => {
        const s = frameStreams.get(b.id) ?? {
          partner: b.id,
          inbound: [],
          outbound: [],
        };
        return {
          b,
          s,
          ch: channel(seed, b, gap),
          nIn: lensList(s.inbound).length,
          nOut: lensList(s.outbound).length,
        };
      })
    : [];

  /** Partners of each other: a gold line, a glowing vesica when side by side. */
  $: tieList =
    (void fedTick,
    ties(kids, (id) => partnerMap.get(id)).map(([a, b]) => {
      const A = slotOf.get(a)!;
      const B = slotOf.get(b)!;
      const D = Math.hypot(A.x - B.x, A.y - B.y);
      const f = pairFlows(a, b, configs);
      return {
        key: `${a}|${b}`,
        a,
        b,
        ves: Math.abs(D - flower.d) < flower.d * 0.08 ? vesicaPath(A, B) : "",
        ch: channel(A, B, gap * 0.8),
        ab: f.ab,
        ba: f.ba,
      };
    }));

  /** A small arrowhead at the middle of a strand, pointing the way it flows. */
  function chevron(s: Seg, size: number): string {
    const L = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) || 1;
    const ux = (s.x1 - s.x0) / L;
    const uy = (s.y1 - s.y0) / L;
    const p = segAt(s, 0.5);
    const f = (v: number) => +v.toFixed(5);
    const tip = { x: p.x + ux * size, y: p.y + uy * size };
    const l = {
      x: p.x - ux * size - uy * size,
      y: p.y - uy * size + ux * size,
    };
    const r = {
      x: p.x - ux * size + uy * size,
      y: p.y - uy * size - ux * size,
    };
    return `M${f(l.x)} ${f(l.y)}L${f(tip.x)} ${f(tip.y)}L${f(r.x)} ${f(r.y)}`;
  }
  const segD = (s: Seg) => `M${s.x0} ${s.y0}L${s.x1} ${s.y1}`;
  /** The cube's star (two triangles in a hexagon) in a unit circle. */
  const STAR = (() => {
    const p = (k: number) => {
      const a = ROOT_ROT + (k * Math.PI) / 3;
      return `${+Math.cos(a).toFixed(4)} ${+Math.sin(a).toFixed(4)}`;
    };
    const hex = [0, 1, 2, 3, 4, 5].map(p);
    return (
      `M${hex.join("L")}Z` +
      `M${p(0)}L${p(2)}L${p(4)}Z` +
      `M${p(1)}L${p(3)}L${p(5)}Z` +
      "M0.22 0A0.22 0.22 0 1 1 -0.22 0A0.22 0.22 0 1 1 0.22 0Z"
    );
  })();

  type Mote = {
    key: string;
    seg: Seg;
    phase: number;
    kind: "in" | "out" | "tie";
    owner: string;
    other: string;
  };
  /** One mote of light per lens, travelling the way it flows. */
  $: motes = [
    ...chans.flatMap((c) => [
      ...lensList(c.s.inbound).map(
        (_, j, all): Mote => ({
          key: `${c.b.id}:in:${j}`,
          seg: c.ch.inn,
          phase: (j / all.length + 0.07 * j) % 1,
          kind: "in",
          owner: c.b.id,
          other: "",
        }),
      ),
      ...lensList(c.s.outbound).map(
        (_, j, all): Mote => ({
          key: `${c.b.id}:out:${j}`,
          seg: c.ch.out,
          phase: (j / all.length + 0.5 + 0.05 * j) % 1,
          kind: "out",
          owner: c.b.id,
          other: "",
        }),
      ),
    ]),
    ...tieList.flatMap((tl) => [
      ...lensList(tl.ab).map(
        (_, j, all): Mote => ({
          key: `${tl.key}:ab:${j}`,
          seg: tl.ch.out,
          phase: (j / all.length + 0.21) % 1,
          kind: "tie",
          owner: tl.a,
          other: tl.b,
        }),
      ),
      ...lensList(tl.ba).map(
        (_, j, all): Mote => ({
          key: `${tl.key}:ba:${j}`,
          seg: tl.ch.inn,
          phase: (j / all.length + 0.63) % 1,
          kind: "tie",
          owner: tl.a,
          other: tl.b,
        }),
      ),
    ]),
  ];
  /** Where a mote is at time-fraction `t` of its run, and how bright. */
  function moteAt(m: Mote, t: number): { x: number; y: number; o: number } {
    const p = segAt(m.seg, 0.06 + 0.88 * t);
    return { ...p, o: Math.min(1, t * 6, (1 - t) * 6) };
  }
  /** At rest (and under reduced motion) each mote stays put along its strand. */
  const restT = (m: Mote) => 0.2 + 0.6 * m.phase;

  // ── Search ──────────────────────────────────────────────────────────────

  $: filtering = query.trim() !== "";
  /** Circles whose OWN name doesn't answer the search; their channels dim too. */
  $: dimmed = new Set(
    filtering ? kids.filter((id) => !matchesText(nm(id), query)) : [],
  );

  // ── Names on the stage, in pixels ───────────────────────────────────────

  /** Width at 1px of a text in the label face, measured once the face is known. */
  let measure: Measure | null = null;
  let stageEl: HTMLDivElement;
  let rootEl: HTMLDivElement;
  onMount(() => {
    const face =
      getComputedStyle(rootEl).getPropertyValue("--font-logo").trim() ||
      "sans-serif";
    const ctx = document.createElement("canvas").getContext("2d");
    const make = (): Measure => {
      if (!ctx) return (s) => s.length * 0.62;
      const cache = new Map<string, number>();
      return (s) => {
        let w = cache.get(s);
        if (w === undefined) {
          ctx.font = `700 100px ${face}`;
          w = ctx.measureText(s).width / 100;
          cache.set(s, w);
        }
        return w;
      };
    };
    measure = make();
    // A face that arrives late re-measures every name.
    const again = () => (measure = make());
    void document.fonts?.ready.then(again);
    document.fonts?.addEventListener?.("loadingdone", again);
    return () => document.fonts?.removeEventListener?.("loadingdone", again);
  });

  type Part = { text: string; cls: string };
  type Label = {
    id: string;
    hub: boolean;
    x: number;
    y: number;
    fit: Fit;
    sub: Part[];
    subPx: number;
    h: number;
    w: number;
    pending: boolean;
  };
  const LEAD = 1.15;

  /**
   * Every name fitted to its own circle at this stage size: the largest
   * size at which the whole name fits in two lines, smaller before cut, cut
   * (keeping a closing number) only at the floor, hidden rather than run
   * into a neighbour. Pure in its arguments: the first frame drawn is the
   * settled one.
   */
  function layoutLabels(
    fl: Flower,
    S: number,
    cx: number,
    cy: number,
    measure: Measure | null,
    nm: (id: string) => string,
    naming: (id: string) => boolean,
    focus: string | null,
    hubName: string,
    hubSub: string,
    subOf: (b: Bloom) => Part[],
    phone: boolean,
    same: Set<string>,
  ): Label[] {
    if (!measure) return [];
    const min = 9;
    const top = !focus;
    /** A top-level circle: its mark above, its name under it. */
    const marked = (hub: boolean) => top && !hub;
    const set = (
      id: string,
      name: string,
      x: number,
      y: number,
      R: number,
      hub: boolean,
      sub: Part[],
      tail = "",
    ): Label | null => {
      // Small circles may stack three short lines; big ones keep to two.
      // Under a mark there is room for two at most.
      const lines = marked(hub) ? 2 : hub || R < 40 ? 3 : 2;
      // The name AND its sub-line sit inside the circle: a block about four
      // fifths of the diameter wide and a little over half of it tall keeps
      // its corners off the rim. Only the top level's small circles (no
      // channels, neighbours almost touching) may let a word reach the rim.
      const roomy = top && !hub && R < 34;
      // A circle too small to name under its mark wears the mark alone.
      if (marked(hub) && !markPlace(R).named) return null;
      const box = marked(hub)
        ? { w: R * MARK_BOX_W, h: R * MARK_BOX_H }
        : {
            w: Math.min(
              R * (hub ? 1.56 : roomy ? 1.9 : lines === 3 ? 1.5 : 1.6),
              fl.d * S - 6,
            ),
            h: R * (hub ? 1.2 : roomy ? 1.45 : lines === 3 ? 1.25 : 1.1),
          };
      const max = Math.max(
        10,
        Math.min(
          R * (hub ? 0.28 : top ? 0.34 : 0.3),
          phone ? (hub ? 15 : 14) : hub ? 18 : 16,
        ),
      );
      const subText = sub.map((p) => p.text).join("");
      const subPxFor = (px: number) => Math.max(8.5, px * 0.78);
      /** The name fitted with room kept under it for the sub-line (or not). */
      const tryFit = (withSub: boolean): { fit: Fit; subPx: number } | null => {
        const reserve = withSub ? subPxFor(max) * 1.3 : 0;
        const fit = fitLabel(
          name,
          { w: box.w, h: box.h - reserve },
          {
            max,
            min,
            wordMin: R < 34 ? 7.5 : min,
            lines,
            measure,
            tail: tail || undefined,
          },
        );
        if (!fit) return null;
        const subPx = subPxFor(fit.px);
        if (
          withSub &&
          (fit.lines.length * fit.px * LEAD + subPx * 1.3 > box.h ||
            measure(subText) * subPx > box.w)
        )
          return null;
        return { fit, subPx };
      };
      const wantSub = sub.length > 0 && !tail && R >= 26 && !marked(hub);
      const got = (wantSub ? tryFit(true) : null) ?? tryFit(false);
      if (!got) return null;
      const { fit, subPx } = got;
      const keepSub =
        wantSub &&
        fit.lines.length * fit.px * LEAD + subPx * 1.3 <= box.h &&
        measure(subText) * subPx <= box.w;
      const nameH = fit.lines.length * fit.px * LEAD;
      const w = Math.max(
        ...fit.lines.map((l) => measure(l) * fit.px),
        keepSub ? measure(subText) * subPx : 0,
      );
      return {
        id,
        hub,
        x,
        y,
        fit,
        sub: keepSub ? sub : [],
        subPx,
        h: nameH + (keepSub ? subPx * 1.3 : 0),
        w,
        pending: !hub || focus ? naming(id) : false,
      };
    };
    const out: Label[] = [];
    // The seed's own name first: it wins any crowding. The top level's seed
    // is the noosphere itself, drawn, not named (the trail names it).
    const hubLabel = focus
      ? set(focus, hubName, cx, cy, fl.hub * S, true, [
          { text: hubSub, cls: "" },
        ])
      : null;
    if (hubLabel) out.push(hubLabel);
    // Siblings that read the same carry their id tail (`same`: names a
    // source answered for only). A circle whose name is still being asked
    // for shows none: a stored label may be stale, and a name that changes
    // under the finger reads worse than one that arrives.
    const firstTry = fl.blooms
      .filter((b) => !naming(b.id))
      .map((b) => {
        const tail = same.has(b.id) ? idTail(b.id) : "";
        return {
          b,
          l:
            set(
              b.id,
              nm(b.id),
              cx + b.x * S,
              cy + (b.y + (top ? b.r * MARK_DROP : 0)) * S,
              b.r * S,
              false,
              subOf(b),
              tail,
            ) ??
            (tail
              ? set(
                  b.id,
                  nm(b.id),
                  cx + b.x * S,
                  cy + (b.y + (top ? b.r * MARK_DROP : 0)) * S,
                  b.r * S,
                  false,
                  [],
                )
              : null),
        };
      });
    // A cut can make two names read alike: those keep a line and the tail.
    const shown = (l: Label | null) => (l ? l.fit.lines.join(" ") : "");
    const cutTwins = twins(
      firstTry.filter((f) => f.l?.fit.cut).map((f) => f.b.id),
      (id) => shown(firstTry.find((f) => f.b.id === id)?.l ?? null),
    );
    for (const f of firstTry) {
      let l = f.l;
      if (l && cutTwins.has(f.b.id)) {
        l =
          set(
            f.b.id,
            nm(f.b.id),
            l.x,
            l.y,
            f.b.r * S,
            false,
            [],
            idTail(f.b.id),
          ) ?? l;
      }
      if (l) out.push(l);
    }
    // Names never sit on each other: a later one that would is left to the
    // card and the panel.
    const placed: Rect[] = [];
    const pad = 2;
    return out.filter((l) => {
      const r = {
        x0: l.x - l.w / 2 - pad,
        x1: l.x + l.w / 2 + pad,
        y0: l.y - l.h / 2 - pad,
        y1: l.y + l.h / 2 + pad,
      };
      if (
        placed.some(
          (p) => r.x0 < p.x1 && p.x0 < r.x1 && r.y0 < p.y1 && p.y0 < r.y1,
        )
      )
        return false;
      placed.push(r);
      return true;
    });
  }

  $: subOf = (b: Bloom): Part[] => {
    if (!focus) {
      return partnerMap.has(b.id)
        ? [
            {
              text: $t("noo.partners", {
                n: partnerMap.get(b.id)?.length ?? 0,
              }),
              cls: "",
            },
          ]
        : [];
    }
    if (b.id === container) return [{ text: $t("noo.wayBack"), cls: "" }];
    const c = chans.find((x) => x.b.id === b.id);
    if (!c || (!c.nIn && !c.nOut))
      return [{ text: $t("noo.quietLink"), cls: "" }];
    const parts: Part[] = [];
    if (c.nIn) parts.push({ text: $t("noo.nIn", { n: c.nIn }), cls: "in" });
    if (c.nIn && c.nOut) parts.push({ text: " · ", cls: "" });
    if (c.nOut) parts.push({ text: $t("noo.nOut", { n: c.nOut }), cls: "out" });
    return parts;
  };
  $: hubSub = focus
    ? $t("noo.partners", { n: flower.blooms.length })
    : $t("noo.hubs", { n: flower.blooms.length });
  $: labels = layoutLabels(
    flower,
    S,
    cx,
    cy,
    measure,
    nm,
    naming,
    focus,
    focus ? nm(focus) : $t("noo.root"),
    hubSub,
    subOf,
    phone,
    twinSet,
  );
  /** First line's baseline, from the block's centre: a cap height under its top. */
  const top0 = (l: Label) => l.y - l.h / 2 + l.fit.px * 0.86;

  // ── Hover, focus, the card ──────────────────────────────────────────────

  /** The circle under the pointer or the keyboard: the rest of the flower fades. */
  let hot: string | null = null;
  let tipFor: { kind: "bloom" | "chan"; id: string } | null = null;
  let tipW = 0;
  let tipH = 0;
  let svgEl: SVGSVGElement;
  /** After a flight the card waits for the pointer to move: nothing was hovered. */
  let armed = true;
  let armAt = { x: 0, y: 0 };

  function pointIn(kind: "bloom" | "chan", id: string, e: PointerEvent) {
    if (!armed && Math.hypot(e.clientX - armAt.x, e.clientY - armAt.y) > 3)
      armed = true;
    if (flying || e.pointerType === "touch" || !armed) return;
    hot = id;
    if (tipFor?.id !== id || tipFor.kind !== kind) tipFor = { kind, id };
  }
  function pointOut(id: string) {
    if (hot === id) hot = null;
    if (tipFor?.id === id) tipFor = null;
  }
  function focusIn(kind: "bloom" | "chan", id: string) {
    if (flying) return;
    hot = id;
    tipFor = { kind, id };
  }
  function onStageMove(e: PointerEvent) {
    if (!armed && Math.hypot(e.clientX - armAt.x, e.clientY - armAt.y) > 3)
      armed = true;
    if (hold && Math.hypot(e.clientX - hold.x0, e.clientY - hold.y0) > 10)
      cancelHold();
  }
  let lastPointer = { x: 0, y: 0 };
  function trackPointer(e: PointerEvent) {
    lastPointer = { x: e.clientX, y: e.clientY };
  }
  function disarm() {
    hot = null;
    tipFor = null;
    armed = false;
    armAt = lastPointer;
  }
  /** A circle's box on the stage at rest, in px. */
  const boxOf = (s: { x: number; y: number; r: number }): Rect => ({
    x0: cx + (s.x - s.r) * S,
    y0: cy + (s.y - s.r) * S,
    x1: cx + (s.x + s.r) * S,
    y1: cy + (s.y + s.r) * S,
  });
  $: tipBloom = tipFor ? (slotOf.get(tipFor.id) ?? null) : null;
  $: tipStream = tipBloom ? (frameStreams.get(tipBloom.id) ?? null) : null;
  // The card opens beside what it describes, on the side away from the seed:
  // never over the seed, the circle, nor the channel.
  let legendEl: HTMLDivElement | null = null;
  /** The legend's box on the stage: a card keeps off it too. */
  function legendBox(): Rect[] {
    if (!legendEl || !stageEl) return [];
    const l = legendEl.getBoundingClientRect();
    const st = stageEl.getBoundingClientRect();
    return [
      {
        x0: l.left - st.left,
        y0: l.top - st.top,
        x1: l.right - st.left,
        y1: l.bottom - st.top,
      },
    ];
  }
  $: tipPos = (() => {
    if (!tipBloom || !tipW) return { x: -9999, y: -9999 };
    const b = tipBloom;
    const avoid: Rect[] = [boxOf(seed), ...legendBox()];
    let target = boxOf(b);
    if (tipFor?.kind === "chan") {
      const m = channel(seed, b, 0).mid;
      target = {
        x0: cx + Math.min(m.x0, m.x1) * S - 10,
        x1: cx + Math.max(m.x0, m.x1) * S + 10,
        y0: cy + Math.min(m.y0, m.y1) * S - 10,
        y1: cy + Math.max(m.y0, m.y1) * S + 10,
      };
      avoid.push(boxOf(b));
    }
    return placeCard(
      { w: tipW, h: tipH },
      target,
      avoid,
      { w: stageW, h: stageH },
      { x: b.x, y: b.y },
      12,
      8,
      flower.blooms.filter((q) => q.id !== b.id).map(boxOf),
    );
  })();

  // ── Flights ─────────────────────────────────────────────────────────────

  let flying = false;
  /** The flight lands: the new frame's detail blooms in. */
  let landing = false;
  /** 0 → 1 as everything but the target circle fades away. */
  let fadeK = 0;
  let flyTarget: string | null = null;
  let raf = 0;
  /** The trail a flight is heading for — kept if the view closes mid-air. */
  let headingFor: Step[] | null = null;
  /** A move asked for mid-flight: it runs on landing, never dropped. */
  let queued: (() => void) | null = null;
  let viaKeyboard = false;

  /** Ends the running animation where it is (a flight called off). */
  let stopAnim: (() => void) | null = null;
  function animate(
    ms: number,
    step: (e: number, k: number) => void,
  ): Promise<void> {
    return new Promise((res) => {
      if (reducedMotion || ms <= 0) {
        step(1, 1);
        return res();
      }
      const t0 = performance.now();
      stopAnim = () => {
        cancelAnimationFrame(raf);
        stopAnim = null;
        res();
      };
      const f = (now: number) => {
        const k = Math.min(1, (now - t0) / ms);
        step(easeInOut(k), k);
        if (k < 1) raf = requestAnimationFrame(f);
        else {
          stopAnim = null;
          res();
        }
      };
      raf = requestAnimationFrame(f);
    });
  }
  /** Where a flight INTO a circle started: calling it off returns there. */
  let flightFrom: Cam | null = null;
  /**
   * The flight into a circle called off (its double tap opened the board
   * instead): the camera, the fade and the trail are back where they were,
   * so closing the board finds the noosphere as the person left it.
   */
  function abortFlight() {
    if (!flying || !flightFrom) return;
    const back = flightFrom;
    flightFrom = null;
    headingFor = null;
    queued = null;
    stopAnim?.();
    cam = back;
    fadeK = 0;
    flyTarget = null;
    flying = false;
  }
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  async function land() {
    cam = HOME;
    fadeK = 0;
    flyTarget = null;
    landing = true;
    await tick();
    requestAnimationFrame(() => {
      flying = false;
      landing = false;
      wake(PERIOD * 2.5);
      if (viaKeyboard) svgEl?.querySelector<SVGElement>(".seed")?.focus();
      viaKeyboard = false;
      const next = queued;
      queued = null;
      next?.();
    });
  }

  /** Tap on a circle: fall into its flower — or, the way back, rise out. */
  async function enter(id: string) {
    if (flying) {
      queued = () => enter(id);
      return;
    }
    const at = trail.findIndex((s) => s.id === id);
    if (at >= 0) return goTo(at);
    if (focus && id === container) return up();
    const b = slotOf.get(id);
    if (!b) return;
    disarm();
    cancelHold();
    flying = true;
    flyTarget = id;
    headingFor = travel(trail, id, childRot(b));
    const from = cam;
    flightFrom = from;
    const to = { x: b.x, y: b.y, r: b.r };
    await animate(1000, (e, k) => {
      cam = lerpCam(from, to, e);
      fadeK = clamp01((k - 0.25) / 0.55);
    });
    // Called off mid-air (abortFlight has put everything back).
    if (!headingFor || !flightFrom) return;
    flightFrom = null;
    trail = headingFor;
    headingFor = null;
    await land();
  }

  /**
   * Out to the frame at trail index `depth` (−1: the top), one level at a
   * time — every frame between is flown through, never cut.
   */
  async function goTo(depth: number) {
    if (flying) {
      queued = () => goTo(depth);
      return;
    }
    const want = Math.max(0, depth + 1);
    if (want >= trail.length) return;
    disarm();
    cancelHold();
    flying = true;
    flightFrom = null;
    headingFor = trail.slice(0, want);
    while (trail.length > want) {
      const child = trail[trail.length - 1].id;
      const next = trail.slice(0, -1);
      const f = next.length ? next[next.length - 1] : null;
      const c = next.length > 1 ? next[next.length - 2].id : null;
      const b = flowerFor(f?.id ?? null, c, f?.rot ?? ROOT_ROT).blooms.find(
        (q) => q.id === child,
      );
      trail = next;
      if (!b) {
        cam = HOME;
        continue;
      }
      cam = { x: b.x, y: b.y, r: b.r };
      flyTarget = child;
      fadeK = 1;
      await tick();
      const from = cam;
      await animate(trail.length > want ? 600 : 900, (e, k) => {
        cam = lerpCam(from, HOME, e);
        fadeK = 1 - clamp01((k - 0.05) / 0.6);
      });
    }
    headingFor = null;
    await land();
  }
  const up = () => goTo(trail.length - 2);

  // ── Opening a hub: a double tap, a held press, Shift+Enter ──────────────

  /** Open `id`'s board (docking it first when it isn't), as "Open board" does. */
  function openHub(id: string | null) {
    if (!id) return;
    cancelHold();
    cancelPendingTap();
    lastTap = null;
    queued = null;
    const via = id === focus ? container : focus;
    if (!$dockEntries.some((e) => e.id === id))
      rememberBoard(id, nm(id), via ? { via } : {});
    onopen(id);
  }

  let lastTap: { id: string; at: number } | null = null;
  /** The click that ends a held press (it already opened the board). */
  let swallowClick = false;
  /** What pressed last: a mouse's single click waits to see if a second follows. */
  let pointerKind = "";
  /** A mouse click's flight, held back a moment in case it is a double click. */
  let pendingTap: { id: string; timer: ReturnType<typeof setTimeout> } | null =
    null;
  const CLICK_WAIT = 230;
  function cancelPendingTap() {
    if (pendingTap) clearTimeout(pendingTap.timer);
    pendingTap = null;
  }
  /**
   * A circle tapped: the first tap travels, a second quick one opens — and
   * the first one's flight never happens (a mouse waits a moment before it
   * flies; a touch flight already under way is called off and put back).
   */
  function tapCircle(id: string | null) {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    const now = performance.now();
    if (pendingTap) {
      const first = pendingTap.id;
      cancelPendingTap();
      if (id === first || id === null) return openHub(first);
    }
    const m = tapMeaning(lastTap, id, now, flying ? flyTarget : null);
    if (m.act === "open") {
      if (flying && m.id === flyTarget) abortFlight();
      return openHub(m.id);
    }
    if (!id) return;
    lastTap = { id, at: now };
    if (id === focus) return;
    if (pointerKind === "mouse" && !flying) {
      pendingTap = {
        id,
        timer: setTimeout(() => {
          pendingTap = null;
          enter(id);
        }, CLICK_WAIT),
      };
      return;
    }
    enter(id);
  }

  /** A press being held on a circle: its ring fills, then the board opens. */
  let hold: {
    id: string;
    x: number;
    y: number;
    r: number;
    x0: number;
    y0: number;
  } | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  function press(
    e: PointerEvent,
    id: string,
    s: { x: number; y: number; r: number },
  ) {
    swallowClick = false;
    pointerKind = e.pointerType;
    cancelHold();
    if (flying || e.button > 0 || !id) return;
    hold = {
      id,
      x: cx + s.x * S,
      y: cy + s.y * S,
      r: Math.max(s.r * S, 18) + 9,
      x0: e.clientX,
      y0: e.clientY,
    };
    holdTimer = setTimeout(() => {
      const target = hold?.id ?? null;
      hold = null;
      holdTimer = null;
      swallowClick = true;
      openHub(target);
    }, HOLD_MS);
  }
  function cancelHold() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    hold = null;
  }

  onDestroy(() => {
    alive = false;
    retries.forEach(clearTimeout);
    cancelPendingTap();
    if (bumpTimer) clearTimeout(bumpTimer);
    cancelHold();
    cancelAnimationFrame(raf);
    cancelAnimationFrame(moteRaf);
    // Closed mid-flight: the destination is kept, not the hop it was on.
    if (headingFor) {
      kept.trail = headingFor;
      try {
        sessionStorage.setItem(TRAIL_KEY, JSON.stringify(headingFor));
      } catch {
        /* private mode */
      }
    }
  });

  // ── Gestures and keys ───────────────────────────────────────────────────

  let wheel: WheelState = { acc: 0, last: -1e9, lock: false };
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = wheelGate(wheel, e.deltaY, performance.now());
    wheel = r.state;
    if (!r.fire || flying) return;
    if (r.fire === "out") {
      if (trail.length) up();
    } else {
      const el = (e.target as Element | null)?.closest?.("[data-kid]");
      const id = el?.getAttribute("data-kid");
      if (id) enter(id);
    }
  }

  function typing(e: KeyboardEvent): boolean {
    const el = e.target as HTMLElement | null;
    if (!el) return false;
    return (
      el.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ||
      !!document.querySelector('[aria-modal="true"]')
    );
  }
  function onKey(e: KeyboardEvent) {
    if (typing(e)) return;
    const inScene = !!svgEl && svgEl.contains(e.target as Node);
    if (e.key === "Escape" && sheetOpen && !wide) {
      e.preventDefault();
      sheetOpen = false;
    } else if (
      (e.key === "Escape" || (e.key === "Backspace" && inScene)) &&
      trail.length
    ) {
      e.preventDefault();
      e.stopPropagation();
      viaKeyboard = inScene;
      up();
    } else if (e.key === "Home" && inScene && trail.length) {
      e.preventDefault();
      viaKeyboard = true;
      goTo(-1);
    }
  }
  /** Enter travels in, Shift+Enter opens; arrows walk the circles in order. */
  function bloomKey(e: KeyboardEvent, id: string) {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      openHub(id);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      viaKeyboard = true;
      enter(id);
      return;
    }
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const i = kids.indexOf(id);
    const next = kids[(i + step + kids.length) % kids.length];
    svgEl
      ?.querySelector<SVGElement>(`.bloom[data-kid="${CSS.escape(next)}"]`)
      ?.focus();
  }
  function seedKey(e: KeyboardEvent) {
    if (e.key === "Enter" && e.shiftKey && focus) {
      e.preventDefault();
      openHub(focus);
    } else if (
      (e.key === "ArrowRight" || e.key === "ArrowDown") &&
      kids.length
    ) {
      e.preventDefault();
      svgEl
        ?.querySelector<SVGElement>(`.bloom[data-kid="${CSS.escape(kids[0])}"]`)
        ?.focus();
    }
  }

  /** A tap on the stage outside every circle: outside the rim it rises. */
  function onStageClick(e: MouseEvent) {
    const el = e.target as Element;
    if (el.closest(".bloom, .chan, .seed, .crumbs, .tip")) return;
    if (flying) return tapCircle(null);
    const r = stageEl.getBoundingClientRect();
    const x = (e.clientX - r.left - cx) / S;
    const y = (e.clientY - r.top - cy) / S;
    if (Math.hypot(x, y) > 1.02 && trail.length) up();
  }

  // ── Federation: the pair's flow editor ──────────────────────────────────

  /**
   * The editor opens only on names the resolver has answered for — a stale
   * label would have the person tune flows with a holon they mistook.
   */
  let tending = false;
  async function tend(partner: string) {
    const home = focus;
    if (!home || !ontend || tending) return;
    hot = null;
    tipFor = null;
    tending = true;
    try {
      if (unnamed(home) || unnamed(partner)) {
        asked.delete(home);
        asked.delete(partner);
        await learnNames([home, partner]);
      }
    } finally {
      tending = false;
    }
    if (focus !== home) return;
    // Never a stored label the resolver could not confirm: the short id then.
    const sure = (id: string) => sureName(id) || shortId(id);
    ontend(home, partner, sure(home), sure(partner));
  }

  // ── Light along the channels ────────────────────────────────────────────

  // At rest the motes sit still along their strands (each strand carries an
  // arrowhead the way it flows) and nothing is drawn per frame. They travel
  // for a while after a landing, and along the channels of the circle under
  // the pointer or the keyboard — never while a dialog is over the view, the
  // tab is hidden, or motion is reduced.
  let moteLayer: SVGGElement;
  let moteRaf = 0;
  let bloomUntil = 0;
  const lastT = new Map<string, number>();
  const PERIOD = 3200;
  function wake(bloomMs = 0) {
    if (reducedMotion || typeof requestAnimationFrame === "undefined") return;
    if (bloomMs) bloomUntil = Math.max(bloomUntil, performance.now() + bloomMs);
    if (!moteRaf) moteRaf = requestAnimationFrame(glow);
  }
  function glow(now: number) {
    moteRaf = 0;
    if (!moteLayer) return;
    const all = now < bloomUntil;
    const live =
      !paused && !document.hidden && !flying && (all || hot !== null);
    const els = moteLayer.children;
    motes.forEach((m, i) => {
      const el = els[i] as SVGGElement | undefined;
      if (!el) return;
      if (live && (all || m.owner === hot || m.other === hot)) {
        const tt = (now / PERIOD + m.phase) % 1;
        const p = moteAt(m, tt);
        el.setAttribute("transform", `translate(${p.x} ${p.y})`);
        el.setAttribute("opacity", p.o.toFixed(3));
        lastT.set(m.key, tt);
      } else if (lastT.has(m.key)) {
        const r = moteAt(m, restT(m));
        el.setAttribute("transform", `translate(${r.x} ${r.y})`);
        el.removeAttribute("opacity");
        lastT.delete(m.key);
      }
    });
    if (live) moteRaf = requestAnimationFrame(glow);
  }
  $: (void hot, void paused, wake());
  onMount(() => {
    wake(PERIOD * 2.5);
    const onVis = () => wake();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  });

  // ── The panel ───────────────────────────────────────────────────────────

  $: streams = (void fedTick, focus ? reaching(focus, kids, configs) : []);
  $: inflowRows = (() => {
    const by = new Map<string, Set<string>>();
    for (const f of lensesReaching(streams)) {
      const k = lensName(f.lens);
      by.set(k, new Set([...(by.get(k) ?? []), ...f.from]));
    }
    return [...by.entries()].map(([lens, from]) => ({ lens, from: [...from] }));
  })();
  // What the frame sends, read the same way: each lens once, with where it goes.
  $: outflowRows = (() => {
    const by = new Map<string, Set<string>>();
    for (const s of streams)
      for (const l of s.outbound) {
        const k = lensName(l);
        by.set(k, new Set([...(by.get(k) ?? []), s.partner]));
      }
    return [...by.entries()]
      .map(([lens, to]) => ({ lens, to: [...to] }))
      .sort(
        (a, b) => b.to.length - a.to.length || a.lens.localeCompare(b.lens),
      );
  })();
  $: leaf = !!focus && kids.length === 1 && kids[0] === container;
  const names = (ids: readonly string[]) => ids.map((id) => nm(id)).join(", ");

  /** Phone: the root crumb is the icon alone, and only the last two follow. */
  $: crumbs = trail
    .map((s, i) => ({ id: s.id, i }))
    .filter(({ i }) => !phone || i >= trail.length - 2);
</script>

<svelte:window on:keydown={onKey} on:pointermove={trackPointer} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
  class="noo"
  class:wide
  class:phone
  class:paused
  bind:this={rootEl}
  bind:clientWidth={paneW}
  bind:clientHeight={paneH}
  on:click|stopPropagation
>
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="stage"
    bind:this={stageEl}
    style="width: {stageW}px; height: {stageH}px"
    on:wheel={onWheel}
    on:click={onStageClick}
    on:pointermove={onStageMove}
    on:pointerup={cancelHold}
    on:pointercancel={cancelHold}
    on:contextmenu={(e) => {
      if (hold || swallowClick) e.preventDefault();
    }}
  >
    {#if measured}
      <svg
        class="sky"
        class:flying
        class:landing
        class:lit={!!hot}
        bind:this={svgEl}
        width={stageW}
        height={stageH}
        {viewBox}
        role="group"
        aria-label={focus ? nm(focus) : $t("noo.root")}
      >
        <defs>
          <radialGradient
            id="noo-rim-fill"
            class="v"
            class:top={!focus}
            style="--c: {colorOf(focus)}"
          >
            <stop offset="0" class="f0" />
            <stop offset="0.72" class="f1" />
            <stop offset="1" class="f2" />
          </radialGradient>
          <radialGradient id="noo-ves">
            <stop offset="0" class="vg" stop-opacity="0.75" />
            <stop offset="0.65" class="vg" stop-opacity="0.28" />
            <stop offset="1" class="vg" stop-opacity="0.06" />
          </radialGradient>
          <clipPath id="noo-rim"><circle r="1" /></clipPath>
        </defs>

        <g class="frame" style="opacity: {1 - fadeK}">
          <circle class="rim-fill" r="1" fill="url(#noo-rim-fill)" />
          <!-- The flower of life, one ring past the circles, kept in the rim. -->
          <g class="flower detail" clip-path="url(#noo-rim)" aria-hidden="true">
            {#each centres as p, i (i)}
              <circle cx={p.x * flower.d} cy={p.y * flower.d} r={flower.d} />
            {/each}
          </g>
          <!-- Metatron's cube: straight lines through every centre. -->
          <path class="cube" d={cubeD} aria-hidden="true" />
          <circle class="rim" r="1" aria-hidden="true" />

          <!-- Partners of each other: gold lines, a vesica when side by side. -->
          <g class="ties" aria-hidden="true">
            {#each tieList as tl (tl.key)}
              <g
                class="tie"
                class:lit={hot === tl.a || hot === tl.b}
                class:dim={dimmed.has(tl.a) || dimmed.has(tl.b)}
              >
                {#if tl.ves}<path class="ves" d={tl.ves} />{/if}
                <path class="tline" d={segD(tl.ch.mid)} />
              </g>
            {/each}
          </g>

          <!-- The channels: two strands each, and the line a tap finds. -->
          <g class="chans detail">
            {#each chans as c (c.b.id)}
              <g
                class="chan"
                class:hot={hot === c.b.id}
                class:dim={dimmed.has(c.b.id)}
                role="button"
                tabindex="0"
                aria-label={$t("noo.manage", { name: nm(c.b.id) })}
                on:click|stopPropagation={() => tend(c.b.id)}
                on:keydown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    tend(c.b.id);
                  }
                }}
                on:pointerenter={(e) => pointIn("chan", c.b.id, e)}
                on:pointermove={(e) => pointIn("chan", c.b.id, e)}
                on:pointerleave={() => pointOut(c.b.id)}
                on:focus={() => focusIn("chan", c.b.id)}
                on:blur={() => pointOut(c.b.id)}
              >
                {#if c.nIn}<path class="halo in" d={segD(c.ch.inn)} />{/if}
                {#if c.nOut}<path class="halo out" d={segD(c.ch.out)} />{/if}
                <path class="strand in" class:off={!c.nIn} d={segD(c.ch.inn)} />
                <path
                  class="strand out"
                  class:off={!c.nOut}
                  d={segD(c.ch.out)}
                />
                {#if c.nIn}<path
                    class="arrow in"
                    d={chevron(c.ch.inn, 3.6 / S)}
                  />{/if}
                {#if c.nOut}<path
                    class="arrow out"
                    d={chevron(c.ch.out, 3.6 / S)}
                  />{/if}
                <path class="hit" d={segD(c.ch.mid)} />
              </g>
            {/each}
          </g>

          <g class="motes detail" bind:this={moteLayer} aria-hidden="true">
            {#each motes as m (m.key)}
              {@const r = moteAt(m, restT(m))}
              <g
                class="mote {m.kind}"
                class:dim={dimmed.has(m.owner) || dimmed.has(m.other)}
                transform="translate({r.x} {r.y})"
              >
                <circle class="glow" r={(m.kind === "tie" ? 5 : 7) / S} />
                <circle class="core" r={(m.kind === "tie" ? 1.8 : 2.6) / S} />
              </g>
            {/each}
          </g>
        </g>

        <!-- The circles: each a partner holding its own flower. -->
        <g class="blooms">
          {#each flower.blooms as b (b.id)}
            {@const m = minis.get(b.id)}
            <g
              class="bloom v"
              class:hot={hot === b.id}
              class:dim={dimmed.has(b.id)}
              class:back={b.id === container}
              class:cell={isCell(b.id)}
              class:target={flyTarget === b.id}
              data-kid={b.id}
              role="button"
              tabindex="0"
              aria-keyshortcuts="Enter Shift+Enter"
              aria-label={b.id === container
                ? `${nm(b.id)} — ${$t("noo.wayBack")}`
                : $t("noo.enter", { name: nm(b.id) })}
              style="--c: {colorOf(b.id)};{inkStyle(
                b.id,
              )} opacity: {flyTarget === b.id ? 1 : 1 - fadeK}"
              on:click|stopPropagation={() => tapCircle(b.id)}
              on:pointerdown={(e) => press(e, b.id, b)}
              on:keydown={(e) => bloomKey(e, b.id)}
              on:pointerenter={(e) => pointIn("bloom", b.id, e)}
              on:pointermove={(e) => pointIn("bloom", b.id, e)}
              on:pointerleave={() => pointOut(b.id)}
              on:focus={() => focusIn("bloom", b.id)}
              on:blur={() => pointOut(b.id)}
            >
              <circle class="disc" cx={b.x} cy={b.y} r={b.r} />
              {#if !focus}
                <!-- At the top, each hub carries its mark — the identicon
                     its orb wears in the Holosphere — over its name. -->
                {@const mk = markPlace(b.r * S)}
                <g
                  class="mark"
                  aria-hidden="true"
                  transform="translate({b.x - b.r * mk.half} {b.y -
                    b.r * (mk.half + mk.rise)}) scale({(2 * b.r * mk.half) /
                    IDENTICON_SIZE})"
                >
                  {#each identiconCells(b.id) as [c, r] (c * IDENTICON_SIZE + r)}
                    <rect x={c} y={r} width="1" height="1" />
                  {/each}
                </g>
              {:else if m}
                <g
                  class="mini"
                  transform="translate({b.x} {b.y}) scale({b.r})"
                  aria-hidden="true"
                >
                  {#if b.r * S > 26 && miniCube.get(b.id)}
                    <path class="mcube" d={miniCube.get(b.id)} />
                  {/if}
                  {#each m.blooms as q (q.id)}
                    <circle
                      class="mkid v"
                      class:back={q.id === focus}
                      style="--c: {colorOf(q.id)}"
                      cx={q.x}
                      cy={q.y}
                      r={q.r}
                    />
                  {/each}
                  <circle class="mseed" r={m.hub} />
                </g>
              {/if}
              <circle class="ring" cx={b.x} cy={b.y} r={b.r} />
              <circle class="hit" cx={b.x} cy={b.y} r={Math.max(b.r, 22 / S)} />
            </g>
          {/each}
        </g>

        <!-- The seed: the frame's own holon. -->
        <g
          class="seed v"
          class:top={!focus}
          tabindex={focus ? 0 : -1}
          role="button"
          aria-disabled={!focus}
          aria-keyshortcuts={focus ? "Shift+Enter" : undefined}
          aria-label={focus ? nm(focus) : $t("noo.root")}
          style="--c: {colorOf(focus)}; opacity: {1 - fadeK}"
          on:click|stopPropagation={() => focus && tapCircle(focus)}
          on:pointerdown={(e) => focus && press(e, focus, seed)}
          on:keydown={seedKey}
        >
          <circle class="sdisc" r={flower.hub} />
          <circle class="sring" r={flower.hub * 0.84} />
          {#if !focus}
            <!-- The noosphere's own seed: the cube's star in its heart. -->
            <path class="star" d={STAR} transform="scale({flower.hub * 0.8})" />
          {/if}
        </g>
      </svg>

      <!-- Names, in real pixels over the scene; hidden while flying. -->
      <svg
        class="names"
        class:flying
        class:landing
        class:lit={!!hot}
        width={stageW}
        height={stageH}
        aria-hidden="true"
      >
        {#each labels as l (l.id + (l.hub ? ":hub" : ""))}
          <text
            class="lbl"
            class:hub={l.hub}
            class:hot={hot === l.id}
            class:dim={!l.hub && dimmed.has(l.id)}
            class:pending={l.pending}
            style={l.hub ? undefined : inkStyle(l.id)}
            font-size={l.fit.px}
          >
            {#each l.fit.lines as line, i (i)}<tspan
                x={l.x}
                y={top0(l) + i * l.fit.px * LEAD}>{line}</tspan
              >{/each}{#if l.sub.length}<tspan
                class="sub"
                x={l.x}
                y={l.y -
                  l.h / 2 +
                  l.fit.lines.length * l.fit.px * LEAD +
                  l.subPx * 1.02}
                font-size={l.subPx}
                >{#each l.sub as p, j (j)}<tspan class={p.cls}>{p.text}</tspan
                  >{/each}</tspan
              >{/if}
          </text>
        {/each}
        {#if hold}
          <circle class="hold-track" cx={hold.x} cy={hold.y} r={hold.r} />
          <circle
            class="hold"
            cx={hold.x}
            cy={hold.y}
            r={hold.r}
            style="--len: {2 * Math.PI * hold.r}px; --ms: {HOLD_MS}ms"
            transform="rotate(-90 {hold.x} {hold.y})"
          />
        {/if}
      </svg>
    {/if}

    {#if tipFor && tipBloom}
      {@const b = tipBloom}
      {@const s = tipStream}
      <div
        class="tip v"
        class:sized={!!tipW}
        role="tooltip"
        bind:clientWidth={tipW}
        bind:clientHeight={tipH}
        style="left: {tipPos.x}px; top: {tipPos.y}px; --c: {colorOf(b.id)}"
      >
        {#if tipFor.kind === "chan" && focus}
          <h4>{$t("noo.pair", { a: nm(b.id), b: nm(focus) })}</h4>
        {:else}
          <h4><span class="dot" aria-hidden="true"></span>{shown(b.id)}</h4>
          <p class="meta">
            {#if isCell(b.id)}{$t("noo.place")} ·
            {/if}{#if partnerMap.has(b.id)}{$t("noo.partners", {
                n: partnerMap.get(b.id)?.length ?? 0,
              })}{:else}{$t("noo.loadingShort")}{/if}{#if b.id === container}
              · {$t("noo.cameFrom")}{/if}
          </p>
        {/if}
        {#if focus && s}
          <div class="flow in">
            <span class="sw in" aria-hidden="true"></span><span class="k"
              >{$t("noo.in")}</span
            >
            {#each lensList(s.inbound) as l (l)}<span class="lens in">{l}</span
              >{:else}<span class="lens none">{$t("noo.nothing")}</span>{/each}
          </div>
          <div class="flow out">
            <span class="sw out" aria-hidden="true"></span><span class="k"
              >{$t("noo.out")}</span
            >
            {#each lensList(s.outbound) as l (l)}<span class="lens out"
                >{l}</span
              >{:else}<span class="lens none">{$t("noo.nothing")}</span>{/each}
          </div>
        {/if}
        {#if tipFor.kind === "chan"}
          <p class="tact">{$t("noo.tapTune")}</p>
        {:else}
          <p class="tact">
            {b.id === container ? $t("noo.tapBack") : $t("noo.tapEnter")} · {$t(
              "noo.openHint",
            )}
          </p>
        {/if}
      </div>
    {/if}

    <!-- The trail: every frame entered, each a way back to it. -->
    <nav class="crumbs" aria-label={$t("noo.trail")}>
      <button
        type="button"
        class="crumb root"
        class:here={!trail.length}
        aria-label={$t("noo.root")}
        on:click|stopPropagation={() => goTo(-1)}
      >
        <Icon name="metatron" />{#if !phone}<span>{$t("noo.root")}</span>{/if}
      </button>
      {#if phone && trail.length > 2}
        <span class="sep" aria-hidden="true"><Icon name="chevron-right" /></span
        >
        <button
          type="button"
          class="crumb more"
          aria-label={$t("noo.up", { name: nm(trail[trail.length - 3].id) })}
          on:click|stopPropagation={() => goTo(trail.length - 3)}>…</button
        >
      {/if}
      {#each crumbs as c (c.id + c.i)}
        <span class="sep" aria-hidden="true"><Icon name="chevron-right" /></span
        >
        <button
          type="button"
          class="crumb v"
          class:here={c.i === trail.length - 1}
          style="--c: {colorOf(c.id)}"
          aria-current={c.i === trail.length - 1 ? "location" : undefined}
          on:click|stopPropagation={() => goTo(c.i)}
        >
          <span class="dot" aria-hidden="true"></span><span class="ctext"
            >{nm(c.id)}</span
          >
        </button>
      {/each}
    </nav>

    {#if wide}
      <div class="legend" aria-hidden="true" bind:this={legendEl}>
        {#if focus}
          <span
            ><i class="sw in"></i>{$t("noo.reaching", {
              name: shortName(nm(focus), 32),
            })}</span
          >
          <span
            ><i class="sw out"></i>{$t("noo.sending", {
              name: shortName(nm(focus), 32),
            })}</span
          >
        {:else}
          <span><i class="sw tie"></i>{$t("noo.tiesLegend")}</span>
        {/if}
      </div>
      <p class="hint" aria-hidden="true">
        {focus ? $t("noo.hint") : $t("noo.hintRoot")}
      </p>
    {/if}
  </div>

  <aside
    class="panel"
    class:open={sheetOpen}
    style={wide ? "" : `height: calc(${sheetH}px + var(--dock-tray) + 0.4rem)`}
  >
    {#if !wide}
      <button
        type="button"
        class="grab"
        aria-expanded={sheetOpen}
        aria-label={sheetOpen ? $t("noo.sheetClose") : $t("noo.sheetOpen")}
        on:click={() => (sheetOpen = !sheetOpen)}><span></span></button
      >
    {/if}
    {#if focus}
      <header class="v" style="--c: {colorOf(focus)}">
        <span class="dot big" aria-hidden="true"></span>
        <div class="title">
          <strong class:pending={naming(focus)}>{nm(focus)}</strong>
          <small>
            {$t("noo.partners", { n: kids.length })}{#if inflowRows.length}
              {" · "}<span class="in"
                >{$t("noo.lensesIn", { n: inflowRows.length })}</span
              >{/if}{#if outflowRows.length}
              {" · "}<span class="out"
                >{$t("noo.lensesOut", { n: outflowRows.length })}</span
              >{/if}
          </small>
        </div>
      </header>
      <div class="actions">
        <button
          type="button"
          class="act primary"
          on:click={() => openHub(focus)}
        >
          {$t("noo.open")}
        </button>
        <button type="button" class="act" on:click={up}>
          {$t("noo.up", {
            name: container ? shortName(nm(container), 18) : $t("noo.root"),
          })}
        </button>
      </div>
      <p class="intro soft">{$t("noo.hint")}</p>
      {#if !wide}
        <p class="plegend" aria-hidden="true">
          <span><i class="sw in"></i>{$t("noo.legendInShort")}</span>
          <span><i class="sw out"></i>{$t("noo.legendOutShort")}</span>
        </p>
      {/if}
      {#if leaf && container}
        <p class="none">
          {$t("noo.onlyWith", { name: nm(focus), other: nm(container) })}
        </p>
      {/if}

      <h3>
        <i class="sw in"></i>{$t("noo.reaching", { name: nm(focus) })}
      </h3>
      {#if inflowRows.length}
        <ul class="lenses">
          {#each inflowRows as f (f.lens)}
            <li>
              <b>{f.lens}</b><span
                >{$t("noo.inFrom", { names: names(f.from) })}</span
              >
            </li>
          {/each}
        </ul>
      {:else}
        <p class="none">{$t("noo.nothingReaches")}</p>
      {/if}

      <h3>
        <i class="sw out"></i>{$t("noo.sending", { name: nm(focus) })}
      </h3>
      {#if outflowRows.length}
        <ul class="lenses">
          {#each outflowRows as f (f.lens)}
            <li>
              <b>{f.lens}</b><span
                >{$t("noo.outTo", { names: names(f.to) })}</span
              >
            </li>
          {/each}
        </ul>
      {:else}
        <p class="none">{$t("noo.nothingSent")}</p>
      {/if}

      <h3>{$t("noo.circles")}</h3>
      <ul class="rows">
        {#each flower.blooms as b (b.id)}
          {@const s = frameStreams.get(b.id)}
          <li
            class="v"
            style="--c: {colorOf(b.id)}"
            class:hot={hot === b.id}
            data-row={b.id}
          >
            <button
              type="button"
              class="row"
              on:click={() => enter(b.id)}
              on:pointerenter={() => (hot = b.id)}
              on:pointerleave={() => hot === b.id && (hot = null)}
            >
              <span class="dot" aria-hidden="true"></span>
              <span class="rtext">
                <span class="rname" class:pending={naming(b.id)}
                  >{shown(b.id)}</span
                >
                {#if b.id === container}<small>{$t("noo.wayBack")}</small>{/if}
                {#if s?.inbound.length}
                  <small class="in"
                    >{$t("noo.in")}: {lensList(s.inbound).join(", ")}</small
                  >
                {/if}
                {#if s?.outbound.length}
                  <small class="out"
                    >{$t("noo.out")}: {lensList(s.outbound).join(", ")}</small
                  >
                {/if}
                {#if b.id !== container && !s?.inbound.length && !s?.outbound.length}<small
                    >{$t("noo.quietLink")}</small
                  >{/if}
              </span>
            </button>
            {#if ontend}
              <button
                type="button"
                class="tune"
                aria-label={$t("noo.manage", { name: nm(b.id) })}
                title={$t("noo.manage", { name: nm(b.id) })}
                disabled={tending || naming(b.id) || naming(focus)}
                on:click={() => tend(b.id)}><Icon name="sliders" /></button
              >
            {/if}
          </li>
        {/each}
      </ul>
      {#if !kids.length}
        <p class="none">{reading ? $t("noo.loading") : $t("noo.lonely")}</p>
      {/if}
    {:else}
      <header>
        <span class="dot big root" aria-hidden="true"
          ><Icon name="metatron" /></span
        >
        <div class="title">
          <strong>{$t("noo.root")}</strong>
          <small>{$t("noo.hubs", { n: rootIds.length })}</small>
        </div>
      </header>
      <p class="intro">{$t("noo.hintRoot")}</p>
      <p class="intro soft"><i class="sw tie"></i>{$t("noo.ties")}</p>
      <ul class="rows">
        {#each flower.blooms as b (b.id)}
          <li
            class="v"
            style="--c: {colorOf(b.id)}"
            class:hot={hot === b.id}
            data-row={b.id}
          >
            <button
              type="button"
              class="row"
              on:click={() => enter(b.id)}
              on:pointerenter={() => (hot = b.id)}
              on:pointerleave={() => hot === b.id && (hot = null)}
            >
              <span class="dot" aria-hidden="true"></span>
              <span class="rtext">
                <span class="rname" class:pending={naming(b.id)}
                  >{shown(b.id)}</span
                >
                <small>
                  {partnerMap.has(b.id)
                    ? $t("noo.partners", {
                        n: partnerMap.get(b.id)?.length ?? 0,
                      })
                    : $t("noo.loadingShort")}
                </small>
              </span>
              <span class="chev" aria-hidden="true"
                ><Icon name="chevron-right" /></span
              >
            </button>
          </li>
        {/each}
      </ul>
      <p class="intro soft">{$t("noo.holoHint")}</p>
    {/if}
    {#if reading && kids.length}
      <p class="loading" role="status">{$t("noo.loading")}</p>
    {/if}
  </aside>
</div>

<style>
  /* Fills the sky between the bar and the tray, like the People view.
     Above the gravity field (z 2), under the bar and the tray (z 6). */
  .noo {
    position: absolute;
    inset: calc(env(safe-area-inset-top) + 4.4rem) 0
      calc(var(--dock-tray) + 0.4rem) 0;
    z-index: 4;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    text-transform: none;
    letter-spacing: 0;
    /* Sacred-geometry tokens (light: vellum and old gold). */
    --flow-in: #08756d;
    --flow-out: #b0520a;
    --gold: #9c7419;
    --sky-a: #fbf8f0;
    --sky-b: #f1ebdd;
    --sky-c: #e6dfcd;
    --halo: #fbf8f1;
    --disc-mix: 90%;
    --line-a: 0.32;
  }
  :global(:root[data-theme="dark"]) .noo {
    --flow-in: #5fe3d3;
    --flow-out: #ffb054;
    --gold: #e3bf6c;
    --sky-a: #1a222b;
    --sky-b: #11171d;
    --sky-c: #090c10;
    --halo: #0c1014;
    --disc-mix: 88%;
    --line-a: 0.3;
  }
  .noo.wide {
    flex-direction: row;
  }
  @media (max-width: 40rem) {
    .noo {
      top: calc(env(safe-area-inset-top) + 7.6rem);
    }
  }

  /* A holon's colour made vivid enough to read on the sky: the note palette
     is pastel by day and muted by night. */
  .v {
    --pc: color-mix(in srgb, var(--c) 62%, var(--ink));
  }
  :global(:root[data-theme="dark"]) .v {
    --pc: color-mix(in srgb, var(--c) 45%, #fff);
  }
  @supports (color: oklch(from red l c h)) {
    .v {
      --pc: oklch(from var(--c) calc(l - 0.2) calc(c * 2.4 + 0.04) h);
    }
    :global(:root[data-theme="dark"]) .v {
      --pc: oklch(from var(--c) calc(l + 0.34) calc(c * 2.2 + 0.04) h);
    }
  }

  .stage {
    position: relative;
    flex: none;
    overflow: hidden;
    touch-action: manipulation;
    -webkit-touch-callout: none;
    background: radial-gradient(
      120% 90% at 50% 46%,
      var(--sky-a) 0%,
      var(--sky-b) 55%,
      var(--sky-c) 100%
    );
  }
  .sky,
  .names {
    position: absolute;
    inset: 0;
    display: block;
    user-select: none;
    -webkit-user-select: none;
  }
  .names {
    pointer-events: none;
    overflow: visible;
  }
  /* SVG outlines are drawn in user units — at this zoom a 2px ring would
     swallow the flower. We draw our own. */
  .sky :focus {
    outline: none;
  }

  .rim-fill {
    pointer-events: none;
  }
  /* The frame's own disc: the very tint its circle had in the flower it
     was entered from, so a landing changes nothing. */
  #noo-rim-fill .f0,
  #noo-rim-fill .f1 {
    stop-color: color-mix(in srgb, var(--c) var(--disc-mix), var(--sky-b));
  }
  #noo-rim-fill.top .f0,
  #noo-rim-fill.top .f1,
  #noo-rim-fill.top .f2 {
    stop-color: color-mix(in srgb, var(--gold) 7%, var(--sky-b));
  }
  #noo-rim-fill .f2 {
    stop-color: color-mix(
      in srgb,
      var(--c) calc(var(--disc-mix) + 8%),
      var(--sky-b)
    );
  }
  .vg {
    stop-color: var(--gold);
  }
  .flower circle {
    fill: none;
    stroke: var(--gold);
    stroke-opacity: calc(var(--line-a) * 0.55);
    stroke-width: 0.7px;
    vector-effect: non-scaling-stroke;
  }
  .cube {
    fill: none;
    stroke: var(--gold);
    stroke-opacity: var(--line-a);
    stroke-width: 0.8px;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .rim {
    fill: none;
    stroke: var(--gold);
    stroke-opacity: 0.75;
    stroke-width: 1.4px;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }

  /* Detail (names, channels, light) fades for a flight and returns after. */
  .detail,
  .names {
    transition: opacity 0.35s ease;
  }
  .sky.flying .detail,
  .names.flying,
  .names.landing {
    opacity: 0 !important;
    transition: opacity 0.15s ease;
  }
  /* The preview stays quiet under the name; it comes up when hovered. */
  .mini {
    opacity: 0.72;
    transition: opacity 0.45s ease;
  }
  .bloom.hot .mini {
    opacity: 1;
  }
  .landing .bloom .mini {
    opacity: 0;
    transition: none;
  }

  .ties {
    pointer-events: none;
  }
  .tie .tline {
    fill: none;
    stroke: var(--gold);
    stroke-opacity: 0.5;
    stroke-width: 1.1px;
    stroke-dasharray: 2 4;
    vector-effect: non-scaling-stroke;
  }
  .tie .ves {
    fill: url(#noo-ves);
    stroke: var(--gold);
    stroke-opacity: 0.55;
    stroke-width: 0.9px;
    vector-effect: non-scaling-stroke;
  }
  .lit .tie:not(.lit) {
    opacity: 0.25;
  }
  .tie.lit .tline {
    stroke-opacity: 0.95;
    stroke-width: 1.8px;
  }

  .chan {
    cursor: pointer;
  }
  .chan .hit {
    fill: none;
    stroke: transparent;
    stroke-width: 48px;
    stroke-linecap: butt;
    vector-effect: non-scaling-stroke;
  }
  .chan:focus-visible .hit {
    stroke: color-mix(in srgb, var(--ink) 14%, transparent);
  }
  .strand {
    fill: none;
    stroke-width: 2.2px;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .strand.in {
    stroke: var(--flow-in);
  }
  .strand.out {
    stroke: var(--flow-out);
  }
  .strand.off {
    stroke: var(--gold);
    stroke-opacity: 0.45;
    stroke-width: 1px;
    stroke-dasharray: 1 5;
  }
  .halo {
    fill: none;
    stroke-width: 8px;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
    opacity: 0.16;
  }
  .halo.in {
    stroke: var(--flow-in);
  }
  .halo.out {
    stroke: var(--flow-out);
  }
  .arrow {
    fill: none;
    stroke-width: 1.8px;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .arrow.in {
    stroke: var(--flow-in);
  }
  .arrow.out {
    stroke: var(--flow-out);
  }
  .chan.hot .strand:not(.off) {
    stroke-width: 3.2px;
  }
  .chan.hot .halo {
    opacity: 0.3;
  }
  .lit .chan:not(.hot) {
    opacity: 0.35;
  }
  .dim {
    opacity: 0.2;
  }

  .motes {
    pointer-events: none;
  }
  .mote .glow {
    opacity: 0.35;
  }
  .mote.in .glow,
  .mote.in .core {
    fill: var(--flow-in);
  }
  .mote.out .glow,
  .mote.out .core {
    fill: var(--flow-out);
  }
  .mote.tie .glow,
  .mote.tie .core {
    fill: var(--gold);
  }

  .bloom {
    cursor: pointer;
    transition: opacity 0.25s ease;
  }
  /* A holon wears its own colour — the very note its orb, cards and board
     wear (lib/palette) — so the circle here is recognisably the same hub. */
  .bloom .disc {
    fill: color-mix(in srgb, var(--c) var(--disc-mix), var(--sky-b));
  }
  .bloom .ring {
    fill: none;
    stroke: var(--gold);
    stroke-width: 1.6px;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .bloom.back .ring {
    stroke-dasharray: 5 4;
  }
  .bloom .hit {
    fill: transparent;
  }
  .bloom.hot .ring {
    stroke-width: 2.6px;
  }
  .bloom:focus-visible .ring {
    stroke: var(--ink);
    stroke-width: 3px;
    stroke-dasharray: 6 4;
  }
  .lit .bloom:not(.hot) {
    opacity: 0.55;
  }
  .sky.flying .bloom {
    transition: none;
  }
  .mini {
    pointer-events: none;
  }
  /* The hub's mark, in the ink that reads on its colour (as on its orb). */
  .mark {
    fill: var(--on-c, var(--ink));
    opacity: 0.88;
    shape-rendering: crispEdges;
    pointer-events: none;
  }
  .mcube {
    fill: none;
    stroke: var(--gold);
    stroke-opacity: calc(var(--line-a) * 1.2);
    stroke-width: 0.5px;
    vector-effect: non-scaling-stroke;
  }
  .mkid {
    fill: color-mix(in srgb, var(--c) var(--disc-mix), var(--sky-b));
    stroke: var(--gold);
    stroke-opacity: 0.8;
    stroke-width: 0.7px;
    vector-effect: non-scaling-stroke;
  }
  .mkid.back {
    stroke-dasharray: 2 2;
  }
  .mseed {
    fill: color-mix(in srgb, var(--c) 70%, var(--gold));
    stroke: var(--gold);
    stroke-width: 0.8px;
    vector-effect: non-scaling-stroke;
  }

  .seed .sdisc {
    fill: color-mix(in srgb, var(--c) 78%, var(--gold));
    stroke: var(--gold);
    stroke-width: 1.8px;
    vector-effect: non-scaling-stroke;
  }
  .seed .sring {
    fill: none;
    stroke: var(--gold);
    stroke-opacity: 0.5;
    stroke-width: 0.8px;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .seed .star {
    fill: none;
    stroke: var(--gold);
    stroke-width: 1.4px;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .seed.top .sdisc {
    fill: color-mix(in srgb, var(--gold) 16%, var(--sky-b));
  }
  .seed:not(.top) {
    cursor: pointer;
  }
  .seed:focus-visible .sdisc {
    stroke: var(--ink);
    stroke-width: 3px;
    stroke-dasharray: 6 4;
  }

  /* Names: set in pixels, haloed so they read over the lattice. */
  .lbl {
    font-family: var(--font-logo);
    font-weight: 700;
    text-anchor: middle;
    fill: var(--on-c, var(--ink));
    paint-order: stroke;
    stroke: var(--halo);
    stroke-opacity: 0.9;
    stroke-width: 3px;
    stroke-linejoin: round;
    transition: opacity 0.2s ease;
  }
  .lbl.hub {
    font-weight: 750;
  }
  .lbl .sub {
    font-weight: 650;
    fill: var(--ink-soft);
  }
  .lbl .in {
    fill: var(--flow-in);
  }
  .lbl .out {
    fill: var(--flow-out);
  }
  .lbl.pending {
    fill: var(--muted);
  }
  .names.lit .lbl:not(.hot):not(.hub) {
    opacity: 0.55;
  }
  .hold-track {
    fill: none;
    stroke: var(--gold);
    stroke-opacity: 0.25;
    stroke-width: 5px;
  }
  .hold {
    fill: none;
    stroke: var(--gold);
    stroke-width: 5px;
    stroke-linecap: round;
    stroke-dasharray: var(--len);
    stroke-dashoffset: var(--len);
    filter: drop-shadow(0 0 4px var(--gold));
    animation: hold calc(var(--ms) - 100ms) linear 100ms forwards;
  }
  @keyframes hold {
    to {
      stroke-dashoffset: 0;
    }
  }

  /* The card: beside what it describes, kept inside the stage. */
  .tip {
    position: absolute;
    z-index: 6;
    width: max-content;
    max-width: 14rem;
    padding: 0.5rem 0.75rem 0.5rem;
    border-radius: 16px;
    background: var(--card);
    border: 1.5px solid color-mix(in srgb, var(--pc) 55%, var(--line));
    box-shadow:
      var(--shadow-soft),
      0 0 24px color-mix(in srgb, var(--pc) 20%, transparent);
    pointer-events: none;
    font-size: 0.85rem;
    color: var(--ink);
    font-family: var(--font-logo);
    visibility: hidden;
  }
  .tip.sized {
    visibility: visible;
  }
  .tip h4 {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0;
    font-size: 0.95rem;
    overflow-wrap: anywhere;
  }
  .tip .meta {
    margin: 0.15rem 0 0.3rem;
    color: var(--ink-soft);
  }
  .tip .flow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.2rem 0.3rem;
    margin-top: 0.3rem;
  }
  .tip .flow .k {
    margin-right: 0.15rem;
    font-weight: 700;
    font-size: 0.78rem;
  }
  .tip .flow.in .k {
    color: var(--flow-in);
  }
  .tip .flow.out .k {
    color: var(--flow-out);
  }
  .tip .flow .sw {
    width: 0.8rem;
  }
  .lens {
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-weight: 700;
    font-size: 0.75rem;
  }
  .lens.in {
    background: color-mix(in srgb, var(--flow-in) 16%, var(--card));
    color: var(--flow-in);
  }
  .lens.out {
    background: color-mix(in srgb, var(--flow-out) 16%, var(--card));
    color: var(--flow-out);
  }
  .lens.none {
    padding-left: 0;
    color: var(--muted);
    font-weight: 500;
  }
  .tip .tact {
    margin: 0.4rem 0 0;
    font-size: 0.75rem;
    color: var(--muted);
  }

  /* The trail, over the stage's top edge — one row, never over the flower. */
  .crumbs {
    position: absolute;
    left: 0.75rem;
    top: 0.4rem;
    right: 0.75rem;
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.2rem;
    overflow: hidden;
    pointer-events: none;
    padding: 2px;
  }
  .crumb {
    pointer-events: auto;
    flex: 0 1 auto;
    box-sizing: border-box;
    min-width: 44px;
    min-height: 44px;
    height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    max-width: 13rem;
    padding: 0 0.85rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--card);
    box-shadow: var(--shadow-soft);
    color: var(--ink);
    font: inherit;
    font-family: var(--font-logo);
    font-size: 0.85rem;
    font-weight: 650;
    white-space: nowrap;
  }
  .crumb.root {
    flex: none;
  }
  .phone .crumb {
    max-width: 9.5rem;
  }
  .ctext {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .crumb.here {
    border-color: color-mix(in srgb, var(--pc, var(--teal)) 60%, var(--line));
  }
  .crumb:active {
    transform: scale(0.96);
  }
  .sep {
    flex: none;
    color: var(--muted);
    font-size: 0.85rem;
    display: inline-flex;
  }
  .legend {
    position: absolute;
    left: 0.75rem;
    bottom: 0.6rem;
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding: 0.45rem 0.85rem;
    border-radius: 999px;
    background: var(--card);
    border: 1px solid var(--line);
    font-family: var(--font-logo);
    font-size: 0.78rem;
    font-weight: 650;
    color: var(--ink-soft);
    pointer-events: none;
    flex-wrap: wrap;
    row-gap: 0.2rem;
    max-width: min(calc(100% - 1.5rem), 34rem);
    border-radius: 18px;
  }
  .legend span,
  .plegend span {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    white-space: nowrap;
  }
  .hint {
    position: absolute;
    right: 0.9rem;
    bottom: 0.9rem;
    margin: 0;
    max-width: 42%;
    text-align: right;
    color: var(--muted);
    font-family: var(--font-logo);
    font-size: 0.75rem;
    pointer-events: none;
  }
  .sw {
    display: inline-block;
    flex: none;
    width: 1.1rem;
    height: 0.22rem;
    border-radius: 999px;
  }
  .sw.in {
    background: var(--flow-in);
  }
  .sw.out {
    background: var(--flow-out);
  }
  .sw.tie {
    background: repeating-linear-gradient(
      90deg,
      var(--gold) 0 3px,
      transparent 3px 6px
    );
  }

  /* The panel: beside the stage on a wide screen, a sheet over the stage's
     foot on a narrow one (its height never moves the flower); opened, the
     sheet takes the whole view. */
  .panel {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 7;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 1rem 1.2rem;
    background: var(--card);
    border-top: 1px solid var(--line);
    border-radius: 22px 22px 0 0;
    box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.14);
    font-family: var(--font-logo);
    transition: height 0.28s ease;
  }
  .panel.open {
    border-radius: 0;
  }
  /* Narrow: the sheet runs down to the screen's foot, under the tray's
     "Add a hub" pill (which floats over it); its content stops above it. */
  .noo:not(.wide) {
    overflow: visible;
  }
  .noo:not(.wide) .panel {
    bottom: calc(-1 * (var(--dock-tray) + 0.4rem));
    padding-bottom: calc(var(--dock-tray) + 1.4rem);
  }
  /* Closed, the sheet holds still and fades out at its foot: no line is
     cut in half; the handle opens the rest. */
  .noo:not(.wide) .panel:not(.open) {
    overflow: hidden;
  }
  .noo:not(.wide) .panel:not(.open)::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: calc(var(--dock-tray) + 3.2rem);
    background: linear-gradient(
      to bottom,
      color-mix(in srgb, var(--card) 0%, transparent),
      var(--card) 62%
    );
    pointer-events: none;
  }
  .wide .panel {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    border-radius: 0;
    border-top: 0;
    border-left: 1px solid var(--line);
    box-shadow: none;
    background: color-mix(in srgb, var(--card) 94%, transparent);
    padding: 1.1rem 1rem 1.4rem;
    transition: none;
  }
  .grab {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    width: calc(100% + 2rem);
    min-height: 44px;
    margin: 0 -1rem;
    padding: 0;
    background: var(--card);
    border: 0;
    cursor: pointer;
  }
  .grab span {
    width: 2.6rem;
    height: 0.3rem;
    border-radius: 999px;
    background: var(--muted);
    opacity: 0.6;
  }
  .panel header {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }
  .title {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .title strong {
    font-size: 1.2rem;
    font-weight: 700;
    line-height: 1.2;
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .title small {
    color: var(--ink-soft);
    font-size: 0.82rem;
  }
  .in {
    color: var(--flow-in);
  }
  .out {
    color: var(--flow-out);
  }
  .dot {
    flex: none;
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    /* The circle's own brightened colour: one holon, one colour everywhere. */
    background: var(--pc, var(--teal));
    box-shadow: 0 0 0 1.5px var(--gold);
  }
  .dot.big {
    width: 1.05rem;
    height: 1.05rem;
  }
  .dot.root {
    width: 1.9rem;
    height: 1.9rem;
    display: grid;
    place-items: center;
    background: var(--teal);
    color: var(--on-teal);
    font-size: 1.05rem;
    box-shadow: none;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0.75rem 0 0.2rem;
  }
  .act {
    box-sizing: border-box;
    min-height: 44px;
    padding: 0.4rem 0.95rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font: inherit;
    font-size: 0.88rem;
    font-weight: 650;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .act.primary {
    background: var(--teal);
    border-color: var(--teal);
    color: var(--on-teal);
  }
  .act:active {
    transform: scale(0.97);
  }
  .plegend {
    display: flex;
    gap: 1rem;
    margin: 0.6rem 0 0;
    font-size: 0.78rem;
    font-weight: 650;
    color: var(--ink-soft);
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 1.1rem 0 0.35rem;
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .lenses {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .lenses li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.1rem 0.6rem;
    padding: 0.35rem 0;
    font-size: 0.88rem;
    border-bottom: 1px solid var(--line);
  }
  .lenses b {
    min-width: 5.5rem;
    color: var(--ink);
    font-weight: 650;
  }
  .lenses span {
    color: var(--ink-soft);
  }
  .none,
  .intro,
  .loading {
    margin: 0.3rem 0;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .intro {
    margin: 0.6rem 0;
  }
  .intro.soft {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--muted);
    font-size: 0.8rem;
  }
  .rows {
    list-style: none;
    margin: 0.3rem 0 0;
    padding: 0;
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    border-bottom: 1px solid var(--line);
    border-radius: 10px;
  }
  .rows li.hot {
    background: color-mix(in srgb, var(--pc) 12%, transparent);
  }
  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 3.5rem;
    padding: 0.35rem 0.2rem;
    text-align: left;
    font: inherit;
    color: var(--ink);
    background: none;
    border: 0;
  }
  .row:active {
    opacity: 0.7;
  }
  .rtext {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .rname {
    font-size: 0.95rem;
    font-weight: 650;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rtext small {
    font-size: 0.76rem;
    color: var(--muted);
  }
  .rtext small.in {
    color: var(--flow-in);
  }
  .rtext small.out {
    color: var(--flow-out);
  }
  .tune {
    flex: none;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink-soft);
    font-size: 1.1rem;
  }
  .tune:disabled {
    opacity: 0.45;
  }
  .tune:hover:not(:disabled) {
    color: var(--ink);
    border-color: var(--ink-soft);
  }
  .chev {
    flex: none;
    color: var(--muted);
  }
  /* A name the resolver is still asked for: a stand-in, muted. */
  .pending {
    color: var(--muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .detail,
    .names,
    .mini,
    .panel,
    .bloom,
    .lbl {
      transition: none;
    }
    .hold {
      animation-duration: 1ms;
      animation-delay: calc(var(--ms) - 1ms);
    }
  }
</style>
