<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The fractal in three.js: the party in focus glowing in the middle, what
  // is under it hanging below on a disc (`layoutLevel`), and under each of
  // those the level after, smaller, and the one after that — Pot, funds,
  // ventures, people, the people they forward to, all drawn alike and all
  // at once, as far down as there is anything (`hang`).
  //
  // A pipe is as thick as the share it carries, in proportion (a 10% line
  // twice a 5% one; core's percentages, `ExploreSpot.flow`), on every level
  // alike.
  //
  // A sphere is as big as its bandwidth (core's `share × (1 + coverage)`),
  // and a gold arc round it is how much of what it needs is committed. Blue
  // drops run down the lines: money. Gold drops run up: resources committed.
  // The more gold has gathered, the wider the blue pipe is drawn.
  //
  // A drag turns it, a pinch or the wheel goes nearer, a tap on a sphere or
  // its name goes into it — one zoom carries the sphere tapped up into the
  // middle while its level grows round it, and the level left behind swells
  // past and fades — and the faint sphere above, the one in focus, or a tap
  // on empty space goes back up the same way, in reverse. A tap on a sphere
  // deeper down goes straight there — except a project: the scene stays as
  // it is and the camera flies in to it, its people named round it, and
  // back out on a tap on empty space or the level above. With "reduce
  // motion" nothing moves unless it is moved.
  //
  // While the split of the sphere in focus is being edited (`draft`), the
  // level under it is drawn from the draft instead: each sphere and pipe as
  // wide as its share of that split, against the widest as stored, so a
  // slider moved shows at once who would get more and who less.
  //
  // An amount being put in somewhere (`amounts`, core's `trickleAmount`)
  // hangs under each name: what of it would reach that sphere.
  //
  // A canvas says nothing to a screen reader: the names over it are buttons,
  // and the page lists the same level under it.
  import { onMount, tick } from "svelte";
  import { t } from "$lib/i18n";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
  import type { FractalNode } from "@holons/core/flows";
  import { amount as money, clip } from "$lib/format";
  import {
    EXPLORE_MAX,
    layoutLevel,
    LEVEL_DROP,
    type ExploreSpot,
  } from "$lib/exploreLayout";

  export let focus: FractalNode;
  export let byId: Map<string, FractalNode>;
  /** The level above, to go back up to. */
  export let parent: FractalNode | null = null;
  export let onPick: (id: string) => void = () => {};
  /** One sentence saying what the drawing shows, for a screen reader. */
  export let label = "";
  /** Fill the parent edge to edge, as the front page does. */
  export let full = false;
  /**
   * A tap on the sphere in focus (or its name): when given, it opens what
   * that sphere is; without, it goes back up like a tap on empty space.
   */
  export let onFocus: (() => void) | null = null;
  /**
   * The focus's split being edited: who it would pass to, by percent of
   * what reaches it, drawn against `widest` (the widest share as stored).
   */
  export let draft: {
    shares: Map<string, number>;
    names: Map<string, string>;
    widest: number;
  } | null = null;
  /**
   * The percent of the focus's own split each party under it gets: what its
   * pipe is drawn by. Without it (a quest, say), the share of the Pot.
   */
  export let links: Map<string, number> | null = null;
  /** Pixels at the bottom a dialog covers: the scene is drawn above them. */
  export let cover = 0;
  /** What an amount put in somewhere would bring each party, by id. */
  export let amounts: Map<string, number> | null = null;
  export let unit = "EUR";

  /** How many levels hang under the focus: funds, ventures, people, who they pass to. */
  const DEPTH = 4;
  /** The most spheres on one level, by depth under the focus; the widest first. */
  const CAP = [0, EXPLORE_MAX, 14, 10, 8];
  /** The most spheres in all, so a wide tree stays light to draw. */
  const BUDGET = 900;
  /** Names drawn over the scene, besides the focus, by depth. */
  const NAMES = [0, 14, 10];
  const NAMED_DEPTH = 2;
  /** A level under a sphere is laid tighter than the one under the focus. */
  const SUB = { spread: 2.6, drop: 1.6, max: 14 };
  /** How far such a level reaches from its sphere, before it is scaled. */
  const SUB_REACH = 3.2;
  const TAP_PX = 6;

  let box: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let tags: HTMLButtonElement[] = [];
  let named: {
    id: string;
    label: string;
    depth?: number;
    focus?: boolean;
    up?: boolean;
  }[] = [];

  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let level: THREE.Group | null = null;
  /** World points the names follow, by id. */
  let anchors = new Map<string, THREE.Vector3>();
  let pickable: THREE.Object3D[] = [];
  let arcs: THREE.Object3D[] = [];
  type Drops = {
    points: THREE.Points;
    curves: THREE.QuadraticBezierCurve3[];
    lane: Uint16Array;
    t: Float32Array;
    speed: Float32Array;
  };
  /** The drops of the level shown: on its lines, and on every level below. */
  let drops: Drops[] = [];
  /** A sphere's place and size in the level's coordinates. */
  type Spot = Pick<ExploreSpot, "x" | "y" | "z" | "r">;
  /** Every sphere drawn, at any depth, by id. */
  let spots = new Map<string, Spot>();
  /** The radius of the sphere in focus. */
  let focusR = 1;
  /** The focus seats nobody: the camera looks at it, not at a level below. */
  let lone = false;
  /**
   * The way from one level to the next, as one zoom: the outer level grows
   * round the spot the inner one sits on until the inner one is the scene
   * (in), or the other way round (up). `k` is how much bigger the inner
   * focus is than its spot. Without a spot to zoom through, the levels
   * just cross-fade.
   */
  let zoom: {
    old: THREE.Group;
    oldDrops: Drops[];
    via: { s: THREE.Vector3; k: number; inward: boolean } | null;
    from: number;
    to: number;
    /** When it started (ms), from the first frame drawn. */
    at: number | null;
  } | null = null;
  /** How long a zoom takes, in ms. */
  const ZOOM_MS = 1600;
  let arriving = false;
  let still = false;
  /** No WebGL here: the level is listed instead of drawn. */
  let failed = false;
  let shownId = "";
  /** The spheres right under the scene's root: what the whole view is fitted to. */
  let firstSpots: Spot[] = [];
  let colours: Record<string, THREE.Color> = {};
  let glow: THREE.Texture;
  const sphere = new THREE.SphereGeometry(1, 32, 20);

  $: if (renderer && focus) show(focus, byId, draft);

  /**
   * A project tapped inside the scene drawn: the scene stays built round
   * `shownId` and the camera flies to the project (`lookId`). Anything else
   * — a fund, a person, a project out of sight, a split being edited —
   * builds a level of its own, as before.
   */
  let lookId = "";
  /** The level the scene is built round, and the one above it, to redraw it. */
  let sceneParent: FractalNode | null = null;
  let shownBy: typeof byId | null = null;
  /** The camera on its way between the scene and a project in it. */
  let fly: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromDist: number;
    toDist: number;
    at: number | null;
  } | null = null;
  const FLY_MS = 1100;

  function canLook(f: FractalNode, d: typeof draft): boolean {
    return (
      !d &&
      !zoom &&
      !!shownId &&
      f.id !== shownId &&
      f.kind === "venture" &&
      spots.has(f.id)
    );
  }

  function show(f: FractalNode, map: typeof byId, d: typeof draft) {
    const fresh = map !== shownBy;
    shownBy = map;
    const stay = canLook(f, d) || (!!lookId && f.id === shownId && !d);
    if (stay) {
      // New data redraws the scene round its own root, then the view is put back.
      if (fresh) build(map.get(shownId) ?? f, sceneParent);
      const to = f.id === shownId ? "" : f.id;
      if (to !== lookId || fresh) flyTo(to, fresh);
      return;
    }
    if (f.id !== shownId || fresh || lookId) {
      lookId = "";
      fly = null;
      build(f);
    }
  }

  /** Where the camera looks, and from how far, to see `id` (or the whole scene). */
  function viewOf(id: string): { target: THREE.Vector3; dist: number } {
    const s = id ? spots.get(id) : null;
    if (!s)
      return {
        target: new THREE.Vector3(0, -LEVEL_DROP * 1.25, 0),
        dist: fitDist(firstSpots),
      };
    // Its people sit round it and just under it: aim a little below its
    // middle, far enough back that they all show.
    return {
      target: new THREE.Vector3(s.x, s.y - s.r * 0.8, s.z),
      dist: Math.max(2, s.r * 20),
    };
  }

  function flyTo(id: string, snap = false) {
    lookId = id;
    tagLook(id);
    const v = viewOf(id);
    const fromDist = camera.position.distanceTo(controls.target);
    controls.maxDistance = Math.max(
      controls.maxDistance,
      v.dist * 1.8,
      fromDist,
    );
    fly = {
      from: controls.target.clone(),
      to: v.target,
      fromDist,
      toDist: v.dist,
      at: null,
    };
    if (snap || still) stepFly(0, true);
    render();
    void tick().then(render);
  }

  /** One frame of the camera's flight; `done` puts it where it is going. */
  function stepFly(now: number, done = false) {
    if (!fly) return;
    if (!done) fly.at ??= now;
    const t = done ? 1 : Math.min(1, (now - (fly.at ?? now)) / FLY_MS);
    const e = 0.5 - 0.5 * Math.cos(Math.PI * t);
    const dir = camera.position.clone().sub(controls.target).normalize();
    controls.target.lerpVectors(fly.from, fly.to, e);
    const dist = fly.fromDist * Math.pow(fly.toDist / fly.fromDist, e);
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    camera.lookAt(controls.target);
    (scene.fog as THREE.FogExp2).density = 0.55 / dist;
    if (t >= 1) {
      controls.maxDistance = fly.toDist * 1.8;
      fly = null;
    }
  }

  /** The names drawn by the level, and the people of the project looked at. */
  let levelNamed: typeof named = [];
  function tagLook(id: string) {
    const extra: typeof named = [];
    const n = id ? byId.get(id) : null;
    for (const cid of n?.children ?? []) {
      const s = spots.get(cid);
      const c = byId.get(cid);
      if (!s || !c || levelNamed.some((t) => t.id === cid)) continue;
      anchors.set(cid, new THREE.Vector3(s.x, s.y + s.r + 0.05, s.z));
      extra.push({ id: cid, label: c.label, depth: 2 });
      if (extra.length >= 12) break;
    }
    named = [
      ...levelNamed.map((t) => ({ ...t, focus: id ? t.id === id : !!t.focus })),
      ...extra,
    ];
  }
  $: if (renderer) lift(cover);
  /** Draw the middle of the scene in the middle of what is left uncovered. */
  function lift(px: number) {
    const w = box.clientWidth;
    const h = box.clientHeight;
    const y = Math.max(0, Math.min(h * 0.6, px)) / 2;
    if (y > 0) camera.setViewOffset(w, h, 0, y, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    render();
  }
  // A draft redraws the level in place, once a frame however fast it moves
  // — only when it, or the split the pipes are drawn by, is not what the
  // scene was built with: a new focus brings new links along, already drawn.
  let redraw = 0;
  let built: { draft: typeof draft; links: typeof links } | null = null;
  $: if (
    renderer &&
    focus &&
    focus.id === shownId &&
    !lookId &&
    built &&
    (draft !== built.draft || links !== built.links)
  )
    queue(draft, links);
  function queue(..._changed: unknown[]) {
    if (redraw) return;
    redraw = requestAnimationFrame(() => {
      redraw = 0;
      if (renderer && focus) build(focus);
    });
  }

  /** Someone the draft passes to who is not on the map yet. */
  const stub = (id: string, label: string): FractalNode => ({
    id,
    kind: "person",
    label,
    share: 0,
    coverage: 0,
    bandwidth: 0,
    needs: [],
    yields: [],
    openNeeds: 0,
    roles: [],
    children: [],
    parents: [],
  });

  function css(name: string, fallback: string): THREE.Color {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    try {
      return new THREE.Color(v || fallback);
    } catch {
      return new THREE.Color(fallback);
    }
  }

  function readColours() {
    colours = {
      pot: css("--kind-pot", "#0a4f4a").lerp(new THREE.Color("#3fd0c4"), 0.55),
      fund: css("--kind-fund", "#2f6fb3").lerp(
        new THREE.Color("#ffffff"),
        0.15,
      ),
      venture: css("--kind-project", "#7a55b8").lerp(
        new THREE.Color("#ffffff"),
        0.15,
      ),
      quest: new THREE.Color("#c06bd8"),
      person: css("--kind-person", "#b3622a").lerp(
        new THREE.Color("#ffd2a8"),
        0.25,
      ),
      unclaimed: css("--kind-placeholder", "#7b8785"),
      money: css("--cap-financial", "#1f88c9").lerp(
        new THREE.Color("#9fe0ff"),
        0.35,
      ),
      gold: new THREE.Color("#f2c14e"),
    };
  }

  const colourOf = (n: FractalNode) =>
    n.unclaimed
      ? colours.unclaimed
      : n.kind === "venture" && n.origin === "quest"
        ? colours.quest
        : (colours[n.kind] ?? colours.venture);

  function glowTexture(): THREE.Texture {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.45)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function orb(
    n: FractalNode,
    r: number,
    at: THREE.Vector3,
    faint = false,
    depth = 0,
  ) {
    const colour = colourOf(n);
    const g = new THREE.Group();
    g.position.copy(at);
    const mesh = new THREE.Mesh(
      sphere,
      new THREE.MeshStandardMaterial({
        color: colour,
        emissive: colour,
        emissiveIntensity: faint ? 0.15 : 0.45,
        roughness: 0.35,
        metalness: 0.15,
        // Always, so a level can fade as it zooms.
        transparent: true,
        opacity: faint ? 0.35 : 1,
      }),
    );
    mesh.scale.setScalar(r);
    mesh.userData.id = n.id;
    g.add(mesh);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glow,
        color: colour,
        transparent: true,
        opacity: faint ? 0.25 : 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.scale.setScalar(r * 4.2);
    g.add(halo);
    if (!faint && n.kind !== "person" && depth <= 1) {
      // What is committed, as a gold arc; the rest of the ring faint.
      const ring = new THREE.Group();
      const full = new THREE.Mesh(
        new THREE.RingGeometry(r * 1.32, r * 1.4, 64),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.12,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.add(full);
      if (n.coverage > 0) {
        const arc = new THREE.Mesh(
          new THREE.RingGeometry(
            r * 1.28,
            r * 1.46,
            64,
            1,
            Math.PI / 2,
            -Math.PI * 2 * Math.min(1, n.coverage),
          ),
          new THREE.MeshBasicMaterial({
            color: colours.gold,
            transparent: true,
            opacity: 0.95,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        ring.add(arc);
      }
      g.add(ring);
      arcs.push(ring);
    }
    pickable.push(mesh);
    return g;
  }

  function disposeGroup(g: THREE.Group | null) {
    if (!g) return;
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((m as THREE.InstancedMesh).isInstancedMesh)
        (m as THREE.InstancedMesh).dispose();
      if (m.geometry && m.geometry !== sphere) m.geometry.dispose();
      const mat = (m as { material?: THREE.Material | THREE.Material[] })
        .material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    scene.remove(g);
  }

  function endZoom() {
    if (!zoom) return;
    disposeGroup(zoom.old);
    zoom = null;
    if (level) {
      level.position.set(0, 0, 0);
      level.scale.setScalar(1);
      fade(level, 1);
    }
    arriving = false;
  }

  /** Every material in a group at `f` of its own opacity. */
  function fade(g: THREE.Object3D, f: number) {
    g.traverse((o) => {
      const m = (o as { material?: THREE.Material }).material;
      if (!m || Array.isArray(m)) return;
      m.userData.base ??= m.opacity;
      m.opacity = m.userData.base * f;
      const u = (m as THREE.ShaderMaterial).uniforms;
      if (u?.opacity) u.opacity.value = m.opacity;
    });
  }

  /** Which of `at`'s spots `id` is, or sits under (a few levels down). */
  function spotOf(id: string, at: Map<string, Spot>) {
    let ring = [id];
    const seen = new Set<string>();
    for (let depth = 0; depth < 8 && ring.length; depth++) {
      const hit = ring.find((x) => at.has(x));
      if (hit) return at.get(hit)!;
      ring.forEach((x) => seen.add(x));
      ring = ring
        .flatMap((x) => byId.get(x)?.parents ?? [])
        .filter((x) => !seen.has(x));
    }
    return null;
  }

  function build(n: FractalNode, up: FractalNode | null = parent) {
    const going = n.id !== shownId;
    sceneParent = up;
    built = { draft, links };
    const wasSpots = spots;
    const wasR = focusR;
    const wasId = shownId;
    const old = level;
    const oldDrops = drops;
    endZoom();
    const zooming = going && !!old && !!wasId && !still;
    if (!zooming) disposeGroup(old);
    level = new THREE.Group();
    pickable = [];
    arcs = [];
    anchors = new Map();
    drops = [];

    spots = new Map();
    const centre = new THREE.Vector3(0, 0, 0);
    const tagged: typeof named = [];
    deep = freshDeep();
    // The level under the focus, and under each sphere the level after,
    // nested and smaller, as far down as there is anything.
    const laid = hang(level, n, tagged);
    for (const o of deepObjects(deep)) level.add(o);
    focusR = Math.max(
      0.75,
      0.12 * Math.max(0, ...laid.map((s) => Math.hypot(s.x, s.z))),
    );
    level.add(orb(n, focusR, centre, false, 0));
    anchors.set(
      n.id,
      centre.clone().add(new THREE.Vector3(0, focusR + 0.35, 0)),
    );

    if (up) {
      const above = new THREE.Vector3(0, LEVEL_DROP + 0.4, -1.2);
      level.add(orb(up, 0.5, above, true, 0));
      anchors.set(up.id, above.clone().add(new THREE.Vector3(0, 0.75, 0)));
      level.add(line([above, centre], 0.18));
    }

    // Redrawn in place: the drops run on from where they were.
    if (!going)
      drops.forEach((d, i) => {
        const was = oldDrops[i];
        if (was) d.t.set(was.t.subarray(0, Math.min(d.t.length, was.t.length)));
        stepDrops(d, 0);
      });
    scene.add(level);

    firstSpots = laid;
    levelNamed = [
      { id: n.id, label: n.label, focus: true },
      ...(up ? [{ id: up.id, label: up.label, up: true }] : []),
      ...tagged,
    ];
    named = levelNamed;

    if (zooming) {
      // In: the new focus is (under) one of the old spots. Up: the old focus
      // is (under) one of the new ones.
      const down = spotOf(n.id, wasSpots);
      const up = down ? null : spotOf(wasId, spots);
      const s = down ?? up;
      const from = camera.position.distanceTo(controls.target);
      const to = fitDist(laid);
      controls.maxDistance = Math.max(from, to) * 1.8;
      zoom = {
        old: old!,
        oldDrops,
        via: s
          ? {
              s: new THREE.Vector3(s.x, s.y, s.z),
              k: (down ? focusR : wasR) / Math.max(0.05, s.r),
              inward: !!down,
            }
          : null,
        from,
        to,
        at: null,
      };
      arriving = true;
      // Posed at its start; the clock runs from the first frame drawn.
      stepZoom(performance.now(), true);
    }
    const first = !wasId;
    shownId = n.id;
    if (going && !zooming) aim(fitDist(laid), first ? VIEW : undefined);
    render();
    // The names are bound on the next tick; a still scene (reduced motion)
    // has no frame loop to place them, so draw once more when they exist.
    void tick().then(render);
  }

  /** Where a group sits in the level's coordinates: `p + k × local`. */
  type Frame = { p: THREE.Vector3; k: number };
  /** One level still to lay: whose children, in which group, how deep. */
  type Due = { g: THREE.Group; n: FractalNode; depth: number; frame: Frame };

  /**
   * Hang `n`'s children under the origin of `g` — the sphere for `n` sits
   * there — and under each of them the level after, in a smaller group of
   * its own, down to DEPTH levels. Level by level, breadth first, until the
   * budget of spheres is spent: every fund gets its ventures before any
   * venture gets its people. Returns the spots of the first level.
   */
  function hang(
    g: THREE.Group,
    n: FractalNode,
    tagged: typeof named,
  ): ExploreSpot[] {
    const budget = { left: BUDGET };
    const due: Due[] = [{ g, n, depth: 1, frame: { p: centre0, k: 1 } }];
    let first: ExploreSpot[] = [];
    while (due.length && budget.left > 0) {
      const item = due.shift()!;
      const laid = lay(item, budget, tagged, due);
      if (item.depth === 1) first = laid;
    }
    return first;
  }

  /**
   * Lay one level: the spheres, pipes and drops under `n` in `g`'s own
   * coordinates, in the level's for the zooms and names (`frame`); the
   * levels under those spheres are queued on `due`.
   */
  function lay(
    { g, n, depth, frame }: Due,
    budget: { left: number },
    tagged: typeof named,
    due: Due[],
  ): ExploreSpot[] {
    const top = depth === 1;
    const ids =
      top && draft
        ? [
            ...n.children,
            ...[...draft.shares.keys()].filter(
              (id) => !n.children.includes(id),
            ),
          ]
        : n.children;
    const kids = ids
      .slice(0, Math.max(0, Math.min(CAP[depth] ?? 0, budget.left)))
      .map(
        (id) =>
          byId.get(id) ??
          (top && draft?.names.has(id)
            ? stub(id, draft.names.get(id)!)
            : undefined),
      )
      .filter((c): c is FractalNode => !!c);
    const kin = new Map(kids.map((k) => [k.id, k]));
    const laid =
      top && draft
        ? layoutLevel(
            kids.map((k) => ({
              id: k.id,
              bandwidth: draft!.shares.get(k.id) ?? 0,
              coverage: k.coverage,
            })),
            { widest: draft.widest },
          )
        : layoutLevel(
            kids.map((k) => ({
              id: k.id,
              bandwidth: k.bandwidth,
              coverage: k.coverage,
              share: top && links?.size ? (links.get(k.id) ?? 0) : k.share,
            })),
            top ? {} : SUB,
          );
    budget.left -= laid.length;
    const toLevel = (v: THREE.Vector3) =>
      v.clone().multiplyScalar(frame.k).add(frame.p);

    // The level under the focus is built of parts, each its own object.
    // Every level below goes into `deep`, in the level's coordinates: one
    // instanced mesh for all their spheres, one cloud of halos, one mesh
    // of pipes and one run of drops — a few draw calls however deep it
    // goes, so a zoom stays smooth.
    const curves: THREE.QuadraticBezierCurve3[] = [];
    const widths: number[] = [];
    const golds: number[] = [];
    const pipes: THREE.BufferGeometry[] = [];
    const named_ = tagged.filter((t) => t.depth === depth).length;
    const mat = new THREE.Matrix4();
    const noTurn = new THREE.Quaternion();
    laid.forEach((s, i) => {
      const c = kin.get(s.id)!;
      const at = new THREE.Vector3(s.x, s.y, s.z);
      const p = toLevel(at);
      const r = frame.k * s.r;
      if (top) g.add(orb(c, s.r, at, false, depth));
      else {
        const colour = colourOf(c);
        deep.ids.push(c.id);
        deep.mats.push(
          mat.compose(p, noTurn, new THREE.Vector3(r, r, r)).clone(),
        );
        deep.cols.push(colour);
        deep.halo.pos.push(p.x, p.y, p.z);
        deep.halo.col.push(colour.r, colour.g, colour.b);
        deep.halo.size.push(haloSize(r));
      }
      // A person standing in two places is drawn twice; the first stands
      // for both when it is zoomed into or named.
      if (!spots.has(c.id)) {
        spots.set(c.id, { x: p.x, y: p.y, z: p.z, r });
        if (depth <= NAMED_DEPTH && named_ + i < NAMES[depth]) {
          anchors.set(
            c.id,
            toLevel(at.clone().add(new THREE.Vector3(0, s.r + 0.22, 0))),
          );
          tagged.push({ id: c.id, label: c.label, depth });
        }
      }
      const mid = at.clone().multiplyScalar(0.5);
      mid.y += top ? 0.6 : 0.3;
      // A level below is drawn in the level's coordinates, not its own.
      const curve = top
        ? new THREE.QuadraticBezierCurve3(centre0, mid, at)
        : new THREE.QuadraticBezierCurve3(frame.p, toLevel(mid), p);
      curves.push(curve);
      widths.push(s.flow);
      golds.push(c.coverage);
      pipes.push(
        new THREE.TubeGeometry(
          curve,
          top ? 20 : 6,
          (PIPE.min + PIPE.span * s.flow) * frame.k,
          top ? 8 : 4,
        ),
      );
    });
    if (top) {
      if (pipes.length) {
        const merged = mergeGeometries(pipes);
        pipes.forEach((p) => p.dispose());
        if (merged) g.add(pipeMesh(merged, 0.42));
      }
      if (curves.length) {
        const d = makeDrops(
          curves,
          widths,
          golds,
          LINE,
          curves.map(() => 1),
        );
        drops.push(d);
        g.add(d.points);
      }
    } else {
      deep.pipes.push(...pipes);
      deep.curves.push(...curves);
      deep.widths.push(...widths);
      deep.golds.push(...golds);
      deep.scales.push(...curves.map(() => frame.k));
    }

    if (depth < DEPTH)
      laid.forEach((s, i) => {
        const c = kin.get(s.id)!;
        if (!c.children.length) return;
        const at = new THREE.Vector3(s.x, s.y, s.z);
        // The room it has: half way to the nearest sphere on this level.
        const gap = Math.min(
          3.2,
          ...laid
            .filter((_, j) => j !== i)
            .map((o) => Math.hypot(o.x - s.x, o.y - s.y, o.z - s.z)),
        );
        // Self-similar: this sphere is to its level what the focus is to
        // this one, as far as the room allows.
        const k = Math.min(s.r / 0.75, (0.55 * gap) / SUB_REACH);
        if (frame.k * k < 0.004) return;
        due.push({
          g,
          n: c,
          depth: depth + 1,
          frame: { p: toLevel(at), k: frame.k * k },
        });
      });
    return laid;
  }
  const centre0 = new THREE.Vector3(0, 0, 0);

  /** Everything below the first level, gathered to be drawn as a few objects. */
  type Deep = {
    ids: string[];
    mats: THREE.Matrix4[];
    cols: THREE.Color[];
    halo: { pos: number[]; col: number[]; size: number[] };
    pipes: THREE.BufferGeometry[];
    curves: THREE.QuadraticBezierCurve3[];
    widths: number[];
    golds: number[];
    scales: number[];
  };
  let deep: Deep;
  const freshDeep = (): Deep => ({
    ids: [],
    mats: [],
    cols: [],
    halo: { pos: [], col: [], size: [] },
    pipes: [],
    curves: [],
    widths: [],
    golds: [],
    scales: [],
  });

  /** A halo's point size for a sphere of radius `r`: as wide as a sprite's would be. */
  const haloSize = (r: number) =>
    (r * 4.2) / Math.tan((camera.fov * Math.PI) / 360);

  function deepObjects(d: Deep): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    if (d.ids.length) {
      const inst = new THREE.InstancedMesh(sphere, orbMaterial(), d.ids.length);
      d.mats.forEach((m, i) => inst.setMatrixAt(i, m));
      d.cols.forEach((c, i) => inst.setColorAt(i, c));
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.userData.ids = d.ids;
      pickable.push(inst);
      out.push(inst);
      out.push(
        glowPoints(
          Float32Array.from(d.halo.pos),
          Float32Array.from(d.halo.col),
          Float32Array.from(d.halo.size),
          0.6,
        ),
      );
    }
    if (d.pipes.length) {
      const merged = mergeGeometries(d.pipes);
      d.pipes.forEach((p) => p.dispose());
      if (merged) out.push(pipeMesh(merged, 0.3));
    }
    if (d.curves.length) {
      const run = makeDrops(d.curves, d.widths, d.golds, LEG, d.scales);
      drops.push(run);
      out.push(run.points);
    }
    return out;
  }

  function pipeMesh(geo: THREE.BufferGeometry, opacity: number) {
    return new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: colours.money,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    );
  }

  /** The spheres' material, lit and glowing in each instance's own colour. */
  function orbMaterial() {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.45,
      roughness: 0.35,
      metalness: 0.15,
      transparent: true,
    });
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        // The instance colour reaches the fragment as `vColor` under USE_COLOR.
        "#include <emissivemap_fragment>\n#ifdef USE_COLOR\n  totalEmissiveRadiance *= vColor;\n#endif",
      );
    };
    return m;
  }

  /** The height of the drawing buffer, halved: what a point's size is scaled by. */
  const glowScale = { value: 1 };
  /** Glowing points, each its own size and colour: halos and drops. */
  function glowMaterial(opacity: number) {
    return new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        map: { value: glow },
        opacity: { value: opacity },
        scale: glowScale,
      },
      vertexShader: `
        attribute float size;
        uniform float scale;
        varying vec3 vColor;
        #include <fog_pars_vertex>
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(size * scale / -mvPosition.z, 180.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D map;
        uniform float opacity;
        varying vec3 vColor;
        #include <fog_pars_fragment>
        void main() {
          gl_FragColor = vec4(vColor, opacity) * texture2D(map, gl_PointCoord);
          #include <fog_fragment>
        }`,
      vertexColors: true,
      transparent: true,
      opacity,
      fog: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  function glowPoints(
    pos: Float32Array,
    col: Float32Array,
    size: Float32Array,
    opacity: number,
  ) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
    return new THREE.Points(geo, glowMaterial(opacity));
  }

  /** Far enough to see the whole level, from above: it reads as a bowl. */
  function fitDist(laid: Spot[]) {
    // Nothing under the focus yet (a Pot just started): frame the orb alone.
    lone = !laid.length;
    const reach = Math.max(
      lone ? 2.6 : 1.6,
      ...laid.map((s) => Math.hypot(s.x, s.z) + s.r),
    );
    const half = Math.tan((camera.fov * Math.PI) / 360);
    return (reach / half / Math.min(1, camera.aspect)) * 0.78 + 2;
  }

  const VIEW = new THREE.Vector3(0.4, 0.6, 0.7).normalize();
  /** The camera `dist` from the level, looking the way it looks now. */
  function aim(dist: number, dir?: THREE.Vector3) {
    // The levels below hang lower than the one under the focus: aim under it.
    controls.target.set(0, lone ? 0 : -LEVEL_DROP * 1.25, 0);
    const d = dir ?? camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(d, dist);
    // Face it now: a still scene (reduced motion) runs no frame loop, so
    // the controls' own update — which turns the camera — never comes.
    camera.lookAt(controls.target);
    (scene.fog as THREE.FogExp2).density = 0.55 / dist;
    if (!zoom) controls.maxDistance = dist * 1.8;
  }

  // Out, not in-out: a tap moves the scene at once, and it settles slowly.
  const ease = (x: number) => 1 - Math.pow(1 - x, 3);
  const soft = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);
  const band = (x: number, a: number, b: number) =>
    Math.min(1, Math.max(0, (x - a) / (b - a)));

  /** One frame of the zoom between levels. */
  function stepZoom(now: number, posed = false) {
    if (!zoom || !level) return;
    // The clock starts on the first frame drawn: a slow first frame (a new
    // level's shaders compiling) must not eat the start of the zoom.
    if (!posed) zoom.at ??= now;
    const t = Math.min(1, (now - (zoom.at ?? now)) / ZOOM_MS);
    const e = ease(t);
    const { old } = zoom;
    let was: number;
    let next: number;
    let reach = e;
    if (zoom.via) {
      // u = 0: the outer level as it is; u = 1: the inner level as it is.
      // One move: the scene glides straight over to the sphere (a) as it
      // grows into it (u), the glide a little ahead going in and a little
      // behind going up. Both ease gently in and out.
      const { s, k, inward } = zoom.via;
      const tt = inward ? t : 1 - t;
      const a = soft(band(tt, 0, 0.85));
      const u = soft(band(tt, 0.1, 1));
      reach = inward ? u : 1 - u;
      const outer = inward ? old : level;
      const inner = inward ? level : old;
      const w = s.clone().multiplyScalar(1 - a);
      const grow = Math.pow(k, u);
      outer.scale.setScalar(grow);
      outer.position.copy(w).addScaledVector(s, -grow);
      inner.scale.setScalar(grow / k);
      inner.position.copy(w);
      // Each level is solid while it is near its own size and fades as it
      // swells past or shrinks away — overlapping, so the scene is never
      // empty in the middle. The outer one, drawn huge, goes once the inner
      // one is there: its halos alone would fill the screen many times over.
      const outerF = 1 - band(u, 0.3, 0.75);
      const innerF = band(u, 0.05, 0.45);
      was = inward ? outerF : innerF;
      next = inward ? innerF : outerF;
    } else {
      old.scale.setScalar(1 + 0.4 * e);
      level.scale.setScalar(0.7 + 0.3 * e);
      was = 1 - band(e, 0.3, 0.8);
      next = band(e, 0, 0.5);
    }
    fade(old, was);
    old.visible = was > 0.002;
    fade(level, next);
    // The names come back while the level settles, not after.
    if (t > 0.7) arriving = false;
    // The camera eases to the new level's distance, in proportion.
    aim(zoom.from * Math.pow(zoom.to / zoom.from, reach));
    if (t >= 1) endZoom();
  }

  function line(pts: THREE.Vector3[], opacity: number) {
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    );
  }

  /** A pipe's radius: the thinnest, and what the widest share adds. */
  const PIPE = { min: 0.012, span: 0.14 };
  /** How drops run: on the lines under the focus, and on the levels below. */
  const LINE = { min: 2, blue: 10, gold: 7, size: 0.2, pace: 1 };
  const LEG = { min: 1, blue: 3, gold: 2, size: 0.11, pace: 1.6 };

  function makeDrops(
    curves: THREE.QuadraticBezierCurve3[],
    widths: number[],
    golds: number[],
    how: typeof LINE,
    /** How much smaller each curve's level is drawn than the first. */
    scales: number[],
  ): Drops {
    const lanes: number[] = [];
    const gold: boolean[] = [];
    curves.forEach((_, i) => {
      const blue = how.min + Math.round(how.blue * widths[i]);
      const up = Math.round(how.gold * golds[i]);
      for (let k = 0; k < blue; k++) (lanes.push(i), gold.push(false));
      for (let k = 0; k < up; k++) (lanes.push(i), gold.push(true));
    });
    const n = lanes.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const t = new Float32Array(n);
    const speed = new Float32Array(n);
    lanes.forEach((lane, k) => {
      const c = gold[k] ? colours.gold : colours.money;
      col.set([c.r, c.g, c.b], k * 3);
      size[k] = how.size * scales[lane];
      t[k] = Math.random();
      // Gold runs up the line: negative speed.
      speed[k] =
        (gold[k] ? -0.11 : 0.18) * how.pace * (0.75 + Math.random() * 0.5);
    });
    const points = glowPoints(pos, col, size, 1);
    const d = { points, curves, lane: Uint16Array.from(lanes), t, speed };
    stepDrops(d, 0);
    return d;
  }

  const tmp = new THREE.Vector3();
  function stepDrops(d: Drops, dt: number) {
    const pos = d.points.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    for (let k = 0; k < d.t.length; k++) {
      d.t[k] = (((d.t[k] + d.speed[k] * dt) % 1) + 1) % 1;
      d.curves[d.lane[k]].getPoint(d.t[k], tmp);
      pos.setXYZ(k, tmp.x, tmp.y, tmp.z);
    }
    pos.needsUpdate = true;
  }

  const project = new THREE.Vector3();
  function render() {
    if (!renderer) return;
    for (const a of arcs) a.quaternion.copy(camera.quaternion);
    renderer.render(scene, camera);
    // The names follow their spheres.
    const w = box.clientWidth;
    const h = box.clientHeight;
    // The focus first, then the widest: a name that would cover one already
    // placed waits until the scene turns.
    const placed: [number, number, number, number][] = [];
    named.forEach((tag, i) => {
      const el = tags[i];
      const at = anchors.get(tag.id);
      if (!el || !at || !level) return;
      project.copy(at).applyMatrix4(level.matrixWorld).project(camera);
      const x = ((project.x + 1) / 2) * w;
      const y = ((1 - project.y) / 2) * h;
      const tw = el.offsetWidth;
      const th = el.offsetHeight;
      const box: [number, number, number, number] = [
        x - tw / 2,
        y - th,
        x + tw / 2,
        y,
      ];
      const off =
        project.z > 1 ||
        Math.abs(project.x) > 1.1 ||
        Math.abs(project.y) > 1.1 ||
        placed.some(
          (o) =>
            box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1],
        );
      if (!off) placed.push(box);
      el.style.visibility = off ? "hidden" : "visible";
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    });
  }

  onMount(() => {
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    still = !!motion?.matches;
    readColours();
    glow = glowTexture();
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
      });
    } catch {
      renderer = null;
      failed = true;
      return;
    }
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x061012, 0.035);
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(4, 8, 6);
    scene.add(key);
    const core = new THREE.PointLight(0x9fe0ff, 18, 14);
    scene.add(core);

    // A far, slow field of stars: depth without meaning.
    const stars = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      const r = 40 + Math.random() * 40;
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      stars.set([r * s * Math.cos(a), r * u, r * s * Math.sin(a)], i * 3);
    }
    const sky = new THREE.BufferGeometry();
    sky.setAttribute("position", new THREE.BufferAttribute(stars, 3));
    const skyMat = new THREE.PointsMaterial({
      color: 0xbfe8e4,
      size: 0.18,
      transparent: true,
      opacity: 0.5,
      fog: false,
    });
    scene.add(new THREE.Points(sky, skyMat));

    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 0.5;
    controls.maxDistance = 30;
    controls.autoRotate = !still;
    controls.autoRotateSpeed = 0.35;
    controls.addEventListener("change", () => still && render());

    const size = () => {
      const w = box.clientWidth;
      const h = box.clientHeight;
      renderer!.setSize(w, h, false);
      glowScale.value =
        renderer!.getDrawingBufferSize(new THREE.Vector2()).y / 2;
      camera.aspect = w / Math.max(1, h);
      lift(cover);
      if (level && !zoom && !lookId) aim(fitDist([...spots.values()]));
      else if (lookId && !zoom) flyTo(lookId, true);
      render();
    };
    const ro = new ResizeObserver(size);
    ro.observe(box);
    size();

    // A tap goes into what is under it.
    let down: { x: number; y: number } | null = null;
    const ray = new THREE.Raycaster();
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > TAP_PX) return;
      const rect = canvas.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray.intersectObjects(pickable, false)[0];
      const ids = hit?.object.userData.ids as string[] | undefined;
      const id = (
        ids && hit?.instanceId != null
          ? ids[hit.instanceId]
          : hit?.object.userData.id
      ) as string | undefined;
      if (id && id !== focus.id) onPick(id);
      else if (id && onFocus) onFocus();
      else if (parent) onPick(parent.id);
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);

    let raf = 0;
    let last = performance.now();
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(box);
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible || document.hidden) return;
      if (still) return;
      if (zoom) for (const d of zoom.oldDrops) stepDrops(d, dt);
      stepZoom(now);
      stepFly(now);
      for (const d of drops) stepDrops(d, dt);
      // The view holds its angle while it moves between levels.
      controls.autoRotate = !zoom && !fly;
      controls.update();
      render();
    };
    raf = requestAnimationFrame(frame);
    if (still) controls.update();

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(redraw);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      controls.dispose();
      endZoom();
      disposeGroup(level);
      level = null;
      sky.dispose();
      skyMat.dispose();
      sphere.dispose();
      glow.dispose();
      // Browsers cap live WebGL contexts: give this one back now, not at GC.
      renderer?.forceContextLoss();
      renderer?.dispose();
      renderer = null;
    };
  });
</script>

<div
  class="stage"
  class:full
  class:arriving
  class:failed
  bind:this={box}
  role="group"
  aria-label={label}
>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
  {#if failed}
    <div class="flat">
      <p>{$t("explore.no3d", { name: focus.label })}</p>
      <ul>
        {#if parent}
          <li>
            <button on:click={() => onPick(parent.id)}>↑ {parent.label}</button>
          </li>
        {/if}
        {#each focus.children as cid (cid)}
          {@const c = byId.get(cid)}
          {#if c}
            <li><button on:click={() => onPick(c.id)}>{c.label}</button></li>
          {/if}
        {/each}
      </ul>
      <a href="/eco?view=diagram">{$t("explore.no3d.diagram")}</a>
    </div>
  {/if}
  {#each named as tag, i (tag.id)}
    <button
      class="tag"
      class:focus={tag.focus}
      class:up={tag.up}
      class:deep={(tag.depth ?? 0) > 1}
      bind:this={tags[i]}
      on:click={() =>
        tag.focus
          ? onFocus
            ? onFocus()
            : parent && onPick(parent.id)
          : onPick(tag.id)}
      tabindex={tag.focus && !parent && !onFocus ? -1 : 0}
      >{#if tag.up}↑
      {/if}{clip(
        tag.label,
        tag.focus ? 40 : 22,
      )}{#if amounts?.get(tag.id)}<small class="amt"
          >+{money(amounts.get(tag.id) ?? 0, unit)}</small
        >{/if}</button
    >
  {/each}
</div>

<style>
  .failed .tag {
    display: none;
  }
  /* Nothing to orbit: let the list scroll under a finger. */
  .stage.failed {
    touch-action: auto;
  }
  .flat {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    padding: calc(env(safe-area-inset-top) + 72px) var(--gutter) 40vh;
    color: #e6f3f1;
    font-size: 0.92rem;
  }
  .flat ul {
    list-style: none;
    margin: 10px 0 14px;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .flat button {
    width: 100%;
    min-height: 44px;
    text-align: left;
    padding: 0 12px;
    border-radius: 10px;
    background: rgba(230, 243, 241, 0.08);
    color: inherit;
  }
  .flat a {
    color: #9fe0d8;
  }
  .stage {
    position: relative;
    height: min(62vh, 540px);
    min-height: 340px;
    border-radius: var(--radius);
    overflow: hidden;
    background: radial-gradient(
      120% 90% at 50% 20%,
      #12403c 0%,
      #0a1f21 45%,
      #05090b 100%
    );
    touch-action: none;
  }
  .stage.full {
    height: 100%;
    min-height: 0;
    border-radius: 0;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .amt {
    display: block;
    font-size: 0.72rem;
    font-weight: 800;
    color: #f2c14e;
    font-variant-numeric: tabular-nums;
  }
  .tag:has(.amt) {
    border-radius: 12px;
    text-align: center;
  }
  .tag {
    position: absolute;
    left: 0;
    top: 0;
    max-width: 44vw;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 0.74rem;
    font-weight: 700;
    color: #eef6f4;
    background: rgba(6, 16, 18, 0.62);
    border: 1px solid rgba(255, 255, 255, 0.14);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: auto;
    will-change: transform;
  }
  .tag {
    transition: opacity 0.35s ease;
  }
  .stage.arriving .tag {
    opacity: 0;
    pointer-events: none;
    transition: none;
  }
  .tag.focus {
    font-size: 0.86rem;
    background: rgba(14, 107, 102, 0.75);
    border-color: rgba(159, 224, 255, 0.4);
    cursor: default;
  }
  .tag.up {
    opacity: 0.8;
  }
  .tag.deep {
    font-size: 0.64rem;
    padding: 2px 7px;
    opacity: 0.85;
  }
  .tag:focus-visible {
    outline: 2px solid #9fe0ff;
    outline-offset: 2px;
  }
</style>
