<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // The zoomed-forward detail card for a tapped post-it / library thing. Shows
  // full details and — when logged in with Telegram — edit fields and actions
  // (save, mark complete, borrow / return). Writes go through identity-aware
  // helpers; the meaning of borrowing lives in @holons/core/library.
  import Modal from "./Modal.svelte";
  import Confetti from "./Confetti.svelte";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import {
    selection,
    closeDetail,
    holonId,
    holonName,
    rawQuests,
    rawLibrary,
    completionRequest,
    editOnOpen,
    partnerNames,
  } from "$lib/stores";
  import { isLoggedIn, telegramUser, loginOpen, borrowActor } from "$lib/auth";
  import { getWriter, getLibraryDb, getHolosphere } from "$lib/holosphere";
  import { toggleJoin, toggleAppreciate } from "$lib/membership";
  import { checkComplete, recordCompletion } from "$lib/complete";
  import {
    noteColor,
    toPeople,
    sourceRef,
    isHologram,
    sourceGlow,
    sourceLabel,
    holoSeed,
  } from "$lib/data";
  import { linkify } from "$lib/linkify";
  import { resolveImage } from "$lib/image";
  import { avatarUrl, avatarInitial, hideImg, showImg } from "./Avatars.svelte";
  import {
    bookItem,
    returnItem,
    recordBorrowAccounting,
    recordReturnAccounting,
    findOverlappingBooking,
    getDisplayBookings,
    dayKey,
    getItemIcon,
    getTypeDisplayName,
    LIBRARY_TYPES,
  } from "@holons/core/library";
  import {
    applyBreakdownProposal,
    buildScheduleFields,
    questSchedule,
    scheduleToFields,
    type ApplyBreakdownResult,
    type BreakdownStep,
    type Quest,
  } from "@holons/core/tasks";
  import { breakdownAvailable, requestBreakdownProposal } from "$lib/breakdown";
  import { copySelection } from "$lib/clipboard";
  import { t, locale } from "$lib/i18n";

  // Read the quest fresh from Holosphere before a membership mutation, so the
  // participate-XOR-appreciate toggle is applied to current data (the modal's
  // `sel.quest` is a snapshot, and the local subscription can lag a write).
  async function freshQuest(q: Quest): Promise<Quest> {
    const hid = $holonId;
    if (q.id != null && hid) {
      try {
        const hs = await getHolosphere();
        const fresh = (await hs.get(hid, "quests", String(q.id))) as
          | Quest
          | null
          | undefined;
        if (fresh) return fresh;
      } catch {
        /* fall through to the local copy */
      }
    }
    const id = String(q.id ?? q.title);
    return get(rawQuests).find((x) => String(x.id ?? x.title) === id) ?? q;
  }

  $: sel = $selection;
  $: isThing = sel?.kind === "thing";
  $: quest = sel && sel.kind !== "thing" ? sel.quest : null;
  // A locally-built draft (e.g. long-press on the calendar) not yet written to
  // Holosphere: Cancel discards it and Save needs a title before it can land.
  $: isNew = !!(sel && sel.kind !== "thing" && sel.isNew);
  $: item = sel && sel.kind === "thing" ? sel.item : null;
  $: tint = isThing ? "var(--card)" : noteColor(quest?.category);

  // A hologram opens as a hologram: the zoomed card keeps the projection
  // style in the source holon's hue, and any foreign record (hologram or
  // federated) names where it came from next to its category.
  $: rec = isThing ? item : quest;
  $: holo = isHologram(rec);
  $: srcGlow = sourceGlow(rec);
  $: srcName = sourceLabel(rec, $partnerNames);
  $: seed = holo ? holoSeed(String(rec?.id ?? rec?.title ?? "")) : undefined;

  // Existing categories across all quests, for the edit-form dropdown. Sorted
  // and de-duped; the field stays a free-text input so a new one can be typed.
  $: categoryOptions = [
    ...new Set(
      $rawQuests
        .map((q) => (q.category ?? "").trim())
        .filter((c) => c.length > 0),
    ),
  ].sort((a, b) => a.localeCompare(b));

  // Edit mode lives only while its card is on screen: closing the modal or
  // switching to another record discards the form (runs before the
  // edit-on-open hook below, which may then re-enter editing for the new card).
  let selKey: string | null = null;
  $: {
    const k = !sel
      ? null
      : sel.kind === "thing"
        ? `thing:${sel.item.id}`
        : `quest:${sel.quest.id ?? sel.quest.title}`;
    if (k !== selKey) {
      selKey = k;
      editing = false;
      booking = false;
      message = "";
      cancelBreakdown();
    }
  }

  // Opened via a pen button → jump straight into edit mode.
  $: if ($selection && $selection.kind !== "thing" && $editOnOpen) {
    editOnOpen.set(false);
    startEdit();
  }

  // Whether the logged-in user is already a participant of this quest.
  $: amParticipant =
    quest != null &&
    $telegramUser != null &&
    Array.isArray(quest.participants) &&
    quest.participants.some(
      (p: any) => String(p?.id) === String($telegramUser?.id),
    );

  // Participants as display people (id + friendly name) for the chips below.
  $: people = toPeople(quest?.participants);

  // Whether the logged-in user has already appreciated this quest.
  $: appreciationCount = Array.isArray(quest?.appreciation)
    ? quest!.appreciation.length
    : 0;
  $: amAppreciating =
    quest != null &&
    $telegramUser != null &&
    Array.isArray(quest.appreciation) &&
    quest.appreciation.some(
      (a: any) => String(a?.id) === String($telegramUser?.id),
    );

  let editing = false;
  let saving = false;
  let message = "";

  // --- AI breakdown: decompose this task into steps wired as dependencies ---
  // Mirrors the web dashboard's TaskModal flow, but the LLM call runs directly
  // from the browser with this device's OpenAI key (see $lib/breakdown). The
  // proposal lands in `breakdownSteps` as an editable draft; the materialized
  // preview (ids, wiring, warnings) is rebuilt by @holons/core on every edit.
  let breakingDown = false;
  let breakdownSteps: BreakdownStep[] | null = null;
  let breakdownReasoning = "";
  let breakdownInfo = "";
  let breakdownPreview: ApplyBreakdownResult | null = null;
  let newStepTitle = "";

  // Whether ANY breakdown transport is configured — a device key, or the
  // deploy's serverless function (probed once; see $lib/breakdown).
  let aiAvailable = false;
  onMount(() => {
    breakdownAvailable().then((v) => (aiAvailable = v));
  });

  // Only the kiosk's own tasks can be broken down: the new steps are written to
  // this holon's graph, so a federated/hologram quest (owned elsewhere) is out.
  $: canBreakdown =
    quest != null &&
    !isNew &&
    aiAvailable &&
    !sourceRef(quest, String(quest.id ?? quest.title));

  /**
   * Local (non-federated) quests only — every id the proposal may reference
   * (reuse, dependencies, the cycle gate) must live in this holon's own graph.
   */
  function localQuests(): Quest[] {
    return get(rawQuests).filter((q) => !sourceRef(q, String(q.id ?? q.title)));
  }

  function breakdownInitiator() {
    const u = $telegramUser;
    if (!u) return undefined; // core falls back to the parent's initiator
    return {
      id: String(u.id),
      username: u.username || "Telegram User",
      firstName: u.first_name || "",
      lastName: u.last_name || "",
    };
  }

  /** Rebuild the materialized preview (wiring, ids, warnings) from the draft. */
  function rebuildBreakdownPreview() {
    if (!quest || !breakdownSteps || breakdownSteps.length === 0) {
      breakdownPreview = null;
      return;
    }
    try {
      breakdownPreview = applyBreakdownProposal({
        proposal: {
          atomic: false,
          reasoning: breakdownReasoning,
          steps: breakdownSteps,
        },
        parent: { ...quest, id: String(quest.id ?? quest.title) },
        allQuests: localQuests(),
        initiator: breakdownInitiator(),
      });
      message = "";
    } catch (e) {
      breakdownPreview = null;
      message = (e as Error)?.message || $t("detail.stepsUnwirable");
    }
  }

  async function requestBreakdown() {
    if (breakingDown || !quest) return;
    breakingDown = true;
    message = "";
    // The current draft stays visible while regenerating and survives a failed
    // request — only a fresh proposal replaces it.
    try {
      const proposal = await requestBreakdownProposal({
        task: { ...quest, id: String(quest.id ?? quest.title) },
        allQuests: localQuests(),
        holonContext: $holonName ? `Holon: ${$holonName}.` : undefined,
      });
      breakdownReasoning = proposal.reasoning || "";
      if (proposal.atomic || proposal.steps.length === 0) {
        // The model declined — keep the panel open, empty, so the user can
        // still add their own steps (or regenerate).
        breakdownInfo = proposal.reasoning || $t("detail.atomicStep");
        breakdownSteps = [];
        breakdownPreview = null;
      } else {
        breakdownInfo = "";
        breakdownSteps = proposal.steps;
        rebuildBreakdownPreview();
      }
    } catch (e) {
      message = (e as Error)?.message || $t("detail.breakdownFailed");
    } finally {
      breakingDown = false;
    }
  }

  /** Click a proposed piece away; step-index references shift down with it. */
  function removeBreakdownStep(index: number) {
    if (!breakdownSteps) return;
    breakdownSteps = breakdownSteps
      .filter((_, i) => i !== index)
      .map((s) => ({
        ...s,
        dependsOnSteps: s.dependsOnSteps
          .filter((j) => j !== index)
          .map((j) => (j > index ? j - 1 : j)),
      }));
    rebuildBreakdownPreview();
  }

  /** Add a user-written step (a parallel prerequisite of the goal). */
  function addBreakdownStep() {
    const title = newStepTitle.trim();
    if (!title) return;
    breakdownSteps = [
      ...(breakdownSteps ?? []),
      {
        title,
        description: "",
        existingTaskId: "",
        category: "",
        dependsOnSteps: [],
        dependsOnExisting: [],
      },
    ];
    newStepTitle = "";
    rebuildBreakdownPreview();
  }

  function cancelBreakdown() {
    breakdownSteps = null;
    breakdownPreview = null;
    breakdownReasoning = "";
    breakdownInfo = "";
    newStepTitle = "";
  }

  /** A draft step's prerequisites, as human titles (steps + existing tasks). */
  function stepDepsLabel(step: BreakdownStep): string {
    const all = localQuests();
    const names = [
      ...step.dependsOnSteps.map(
        (j) => breakdownSteps?.[j]?.title ?? $t("detail.stepN", { n: j + 1 }),
      ),
      ...step.dependsOnExisting.map(
        (id) => all.find((t) => String(t.id) === id)?.title ?? id,
      ),
    ];
    return names.join(", ");
  }

  /** The existing task a draft step reuses, as a human title ('' if new). */
  function stepReuseTitle(step: BreakdownStep): string {
    if (!step.existingTaskId) return "";
    return (
      localQuests().find((t) => String(t.id) === step.existingTaskId)?.title ??
      step.existingTaskId
    );
  }

  async function confirmBreakdown() {
    if (!breakdownPreview || !quest || !$holonId) return;
    saving = true;
    message = "";
    const preview = breakdownPreview;
    try {
      const writer = await getWriter($holonId, (m) => (message = m));
      // Steps first, parent last — a partial failure leaves the goal unwired
      // rather than depending on tasks that don't exist.
      let saved = 0;
      for (const q of preview.newQuests) {
        if (await writer.put("quests", q)) saved++;
        else break;
      }
      if (saved < preview.newQuests.length) {
        if (!message) {
          message = $t("detail.partialSteps", {
            saved,
            total: preview.newQuests.length,
          });
        }
        return;
      }
      // Link on the freshest parent copy so a concurrent edit isn't clobbered;
      // merge rather than replace its dependency list for the same reason.
      const parent = await freshQuest(quest);
      const dependencies = [
        ...new Set([
          ...((parent.dependencies as string[] | undefined) ?? []).map(String),
          ...preview.parentDependencies,
        ]),
      ];
      const ok = await writer.put("quests", { ...parent, dependencies });
      if (ok) {
        cancelBreakdown();
        closeDetail();
      } else if (!message) {
        message = $t("detail.linkStepsFailed");
      }
    } catch (e) {
      message = (e as Error)?.message || $t("detail.createStepsFailed");
    } finally {
      saving = false;
    }
  }
  let celebrate = false;
  let celebrateTimer: ReturnType<typeof setTimeout> | null = null;

  function party() {
    if (celebrateTimer) clearTimeout(celebrateTimer);
    celebrate = true;
    celebrateTimer = setTimeout(() => (celebrate = false), 1300);
  }

  // Edit form fields
  let fTitle = "";
  let fDate = "";
  let fTime = "";
  let fEndDate = "";
  let fEndTime = "";
  let fLocation = "";
  let fCategory = "";
  let fDescription = "";
  let fType = "other";
  let fValue = 0;

  // Category is a real <select> dropdown over existing categories, with a
  // sentinel entry that swaps in a free-text input so a brand-new category can
  // still be typed. (A <datalist> typeahead doesn't reliably surface a visible
  // dropdown on kiosk/touch displays.)
  const NEW_CATEGORY = "\u0000new"; // NUL sentinel: no real category can collide
  let addingCategory = false;
  function onCategorySelect(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    if (v === NEW_CATEGORY) {
      fCategory = "";
      addingCategory = true;
    } else {
      fCategory = v;
    }
  }

  // Library-thing categories work the same way: the default types first, then
  // any custom categories already used across the library (federated included),
  // then the new-category sentinel. Types are canonically lowercase.
  const DEFAULT_THING_TYPES: string[] = [
    LIBRARY_TYPES.TOOL,
    LIBRARY_TYPES.BOOK,
    LIBRARY_TYPES.EQUIPMENT,
    LIBRARY_TYPES.ACCOMMODATION,
    LIBRARY_TYPES.OTHER,
  ];
  $: thingTypeOptions = [
    ...DEFAULT_THING_TYPES,
    ...[
      ...new Set(
        [
          ...$rawLibrary.map((i) => String(i.type ?? "")),
          fType, // the item's own type always stays selectable
        ]
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 0 && !DEFAULT_THING_TYPES.includes(t)),
      ),
    ].sort((a, b) => a.localeCompare(b)),
  ];
  let addingThingType = false;
  function onThingTypeSelect(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    if (v === NEW_CATEGORY) {
      fType = "";
      addingThingType = true;
    } else {
      fType = v;
    }
  }

  function pad(n: number): string {
    return String(n).padStart(2, "0");
  }
  function toDateInput(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // ── The schedule editor ───────────────────────────────────────────────────
  // Two rows, no modes: a start (date + optional clock) and an end. An end date
  // on a later day is what makes the card a multi-day event — there is nothing
  // extra to learn or switch on. Core owns what the fields mean once stored
  // (`buildScheduleFields`); these guards only keep the pair coherent.
  //
  // Clearing the start date clears the rest: an undated card is a backlog task.
  $: if (!fDate && (fTime || fEndDate || fEndTime))
    fTime = fEndDate = fEndTime = "";
  // An end that fell behind the start is dragged along rather than stored
  // backwards. (ISO day and HH:MM strings both compare correctly as text.)
  $: if (fEndDate && fDate && fEndDate < fDate) fEndDate = fDate;
  // Within one day an end before the start is no end at all; across days the
  // two clocks are independent, so leave them be.
  $: if (
    fEndTime &&
    fTime &&
    (!fEndDate || fEndDate === fDate) &&
    fEndTime <= fTime
  )
    fEndTime = "";
  // An all-day card has no clock, so an end time can't outlive the start time
  // (core ignores one; the form shouldn't pretend otherwise).
  $: if (!fTime && fEndTime) fEndTime = "";

  /** What the two rows currently add up to; blank while the card is undated. */
  $: scheduleSummary = fDate
    ? summarize(
        buildScheduleFields({
          startDate: fDate,
          startTime: fTime,
          endDate: fEndDate,
          endTime: fEndTime,
        }),
        $locale,
      )
    : "";

  // One sentence for a stored schedule, used both on the card and live under
  // the edit fields — so what you're about to save reads exactly as it will.
  const SPAN_DAY: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
  };
  function summarize(
    q: { when?: string; ends?: string; until?: string },
    loc: string,
  ): string {
    const s = questSchedule(q);
    if (!s.start) return $t("detail.noDate");
    const clock = (d: Date) =>
      d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
    if (s.multiDay && s.end) {
      const edge = (d: Date) =>
        d.toLocaleDateString(loc, SPAN_DAY) + (s.allDay ? "" : ` ${clock(d)}`);
      return `${edge(s.start)} → ${edge(s.end)} · ${$t("detail.dayCount", {
        n: s.days,
      })}`;
    }
    const day = s.start.toLocaleDateString(loc, {
      weekday: "short",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    if (s.allDay) return day;
    return s.end
      ? `${day} · ${clock(s.start)}–${clock(s.end)}`
      : `${day} · ${clock(s.start)}`;
  }

  function whenText(loc: string): string {
    return quest ? summarize(quest, loc) : $t("detail.noDate");
  }

  function startEdit() {
    if (!sel) return;
    message = "";
    if (sel.kind === "thing") {
      fType =
        String(sel.item.type ?? "")
          .trim()
          .toLowerCase() || "other";
      addingThingType = false;
      fDescription = String(sel.item.description ?? "");
      fValue = Number(sel.item.value ?? 0);
    } else {
      const q = sel.quest;
      fTitle = q.title ?? "";
      fLocation = String(q.location ?? "");
      fCategory = String(q.category ?? "");
      addingCategory = false;
      fDescription = String(q.description ?? "");
      // Core splits the stored schedule back into the four form fields.
      ({
        startDate: fDate,
        startTime: fTime,
        endDate: fEndDate,
        endTime: fEndTime,
      } = scheduleToFields(q));
    }
    editing = true;
  }

  function requestLogin() {
    loginOpen.set(true);
  }

  async function saveQuest() {
    if (!sel || sel.kind === "thing" || !$holonId) return;
    saving = true;
    message = "";
    // Core turns the local form fields into the stored schedule: UTC instants
    // for a timed card, bare dates for an all-day one, and an inclusive end
    // date for a span. Cleared fields are blanked, never deleted (Gun merges),
    // on `ends` and its legacy `until` alias alike.
    const timing: Partial<Quest> = buildScheduleFields({
      startDate: fDate,
      startTime: fTime,
      endDate: fEndDate,
      endTime: fEndTime,
    });
    const updated = {
      ...sel.quest,
      title: fTitle.trim() || sel.quest.title,
      location: fLocation.trim() || undefined,
      category: fCategory.trim() || undefined,
      description: fDescription.trim() || undefined,
      ...timing,
    };
    const writer = await getWriter($holonId, (m) => (message = m));
    const ok = await writer.put("quests", updated);
    saving = false;
    if (ok) closeDetail();
    else if (!message) message = $t("detail.saveFailed");
  }

  async function completeQuest() {
    if (!sel || sel.kind === "thing" || !$holonId) return;
    const user = $telegramUser;
    if (!user) {
      loginOpen.set(true);
      return;
    }
    saving = true;
    message = "";
    // Permission + status guards up front, on the freshest copy.
    const result = checkComplete(await freshQuest(sel.quest), user.id);
    if (!result.ok) {
      saving = false;
      message =
        result.reason === "already-completed"
          ? $t("tasks.alreadyCompleted")
          : result.reason === "stopped"
            ? $t("tasks.stopped")
            : $t("tasks.joinFirst");
      return;
    }
    saving = false;
    const hid = $holonId;
    // Confirm participants (for REA), then record + celebrate.
    completionRequest.set({
      task: result.task,
      onConfirm: async (adjusted) => {
        try {
          const { ok } = await recordCompletion(hid, adjusted);
          if (ok) {
            closeDetail(); // close the detail card first, then celebrate
            setTimeout(party, 180);
          } else message = $t("detail.couldNotSave");
        } catch (err) {
          message = (err as Error)?.message || $t("detail.completeFailed");
        }
      },
    });
  }

  async function deleteQuest() {
    if (!sel || sel.kind === "thing" || !$holonId) return;
    const user = $telegramUser;
    if (!user) {
      loginOpen.set(true);
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        $t("detail.deleteConfirm", {
          title: quest?.title ?? $t("detail.thisTask"),
        }),
      )
    )
      return;
    saving = true;
    message = "";
    // Soft-delete: write a `_deleted: true` tombstone (the bot's convention)
    // rather than a hard `put(null)`. A hard delete leaves a husk node that Gun
    // keeps re-emitting; the live subscription forwards it (it only swallows a
    // clean null), so the board flips between the real card and an empty
    // "Untitled" phantom — re-triggering the FLIP reshuffle indefinitely. A
    // tombstone is a stable object that both `isDone` and the lens aggregator
    // drop cleanly, so the card just leaves.
    //
    // WHERE it lands depends on where the card actually lives:
    //   - a hologram (a joined task mirrored into this holon as a pointer) is
    //     deleted HERE — dropping our mirror, not the source holon's task. The
    //     write must say so: HoloSphere otherwise follows the pointer, so the
    //     tombstone would soft-delete the original for everyone while our
    //     pointer — and the card — stayed exactly where it was.
    //   - a federation-aggregated card has no local node at all; it lives in
    //     its owner's lens, so the tombstone goes there (same routing as
    //     `saveThing`) or it forks a stray local copy and the card stays.
    //   - our own task: written in place, as before.
    const localId = String(sel.quest.id ?? sel.quest.title);
    const mirrored = isHologram(sel.quest);
    const ref = mirrored ? undefined : sourceRef(sel.quest, localId);
    const tombstone: Record<string, unknown> = {
      ...sel.quest,
      id: ref?.key ?? localId,
      _deleted: true,
    };
    // Read-side provenance tags — never persist them (and `_hologram` would
    // re-route this very write to the source holon).
    delete tombstone._holon;
    delete tombstone._hologram;
    delete tombstone._federation;
    const writer = await getWriter(
      ref?.holon ?? $holonId,
      (m) => (message = m),
    );
    const ok = await writer.put("quests", tombstone, {
      disableHologramRedirection: mirrored,
    });
    saving = false;
    if (ok) closeDetail();
    else if (!message) message = $t("detail.deleteFailed");
  }

  async function joinQuest() {
    if (!sel || sel.kind === "thing" || !$holonId) return;
    const user = $telegramUser;
    if (!user) {
      loginOpen.set(true);
      return;
    }
    saving = true;
    message = "";
    try {
      // A federated/hologram quest lives in its owner's graph — membership must
      // be written there, not onto the local pointer. lib/membership resolves
      // that, reads fresh, and applies core's participate-XOR-appreciate rule.
      const id = String(sel.quest.id ?? sel.quest.title);
      const ok = await toggleJoin($holonId, id, user, sourceRef(sel.quest, id));
      if (ok) closeDetail();
      else message = $t("detail.joinFailed");
    } catch (err) {
      message = (err as Error)?.message || $t("detail.joinFailed");
    } finally {
      saving = false;
    }
  }

  async function appreciate() {
    if (!sel || sel.kind === "thing" || !$holonId) return;
    const user = $telegramUser;
    if (!user) {
      loginOpen.set(true);
      return;
    }
    saving = true;
    message = "";
    try {
      // Same owner-holon routing as joinQuest; appreciating removes you from
      // participants and feeds the REA appreciation-exchange on completion.
      const id = String(sel.quest.id ?? sel.quest.title);
      const ok = await toggleAppreciate(
        $holonId,
        id,
        user,
        sourceRef(sel.quest, id),
      );
      if (ok) closeDetail();
      else message = $t("detail.couldNotSave");
    } catch (err) {
      message = (err as Error)?.message || $t("detail.couldNotSave");
    } finally {
      saving = false;
    }
  }

  async function saveThing() {
    if (!sel || sel.kind !== "thing" || !$holonId) return;
    saving = true;
    message = "";
    // A federated/hologram item is owned by another holon — edit it there, not
    // in our own lens, or we fork a stray local copy that shadows (and unlinks)
    // the federated original. Also drop read-side provenance tags so the kiosk's
    // `_holon` marker (or a resolved `_hologram`/`_federation` envelope) is never
    // persisted onto the stored item.
    const ref = sourceRef(sel.item, String(sel.item.id));
    const holon = ref?.holon ?? $holonId;
    const clean: Record<string, unknown> = { ...sel.item };
    delete clean._holon;
    delete clean._hologram;
    delete clean._federation;
    const updated = {
      ...clean,
      id: ref?.key ?? sel.item.id,
      // Categories are canonically lowercase ('tool', 'book', …); a freshly
      // typed one is normalised the same way so it dedupes across items.
      type: fType.trim().toLowerCase() || "other",
      description: fDescription.trim(),
      value: Number(fValue) || 0,
    };
    const writer = await getWriter(holon, (m) => (message = m));
    const ok = await writer.put("library", updated);
    saving = false;
    if (ok) closeDetail();
    else if (!message) message = $t("detail.couldNotSave");
  }

  // ── Booking form (borrow for a chosen date range, like the web library) ────
  // Tapping Borrow opens a From/Until range with quick length chips instead of
  // borrowing for a hard-coded week. Core's `bookItem` owns the meaning: it
  // appends to `bookings[]` (the canonical borrow state) and rejects overlaps.
  let booking = false;
  let bStart = "";
  let bEnd = "";
  const LENGTH_CHIPS = [
    { days: 1, labelKey: "detail.len1day" },
    { days: 3, labelKey: "detail.len3days" },
    { days: 7, labelKey: "detail.len1week" },
    { days: 14, labelKey: "detail.len2weeks" },
  ] as const;

  function addDaysKey(key: string, n: number): string {
    const d = new Date(`${key}T00:00:00`);
    d.setDate(d.getDate() + n);
    return toDateInput(d);
  }

  /** Short human label for a booking day key ("Jul 27"). */
  function fmtDay(loc: string, d: string): string {
    return new Date(`${dayKey(d)}T00:00:00`).toLocaleDateString(loc, {
      day: "numeric",
      month: "short",
    });
  }

  // Upcoming/active bookings, soonest first — shown on the card so a free
  // range is easy to pick. (Recomputed per selected item; capped for space.)
  $: upcomingBookings = item
    ? getDisplayBookings(item)
        .filter((b) => dayKey(b.end) >= toDateInput(new Date()))
        .sort((a, b) => dayKey(a.start).localeCompare(dayKey(b.start)))
        .slice(0, 3)
    : [];

  function startBooking() {
    if (!item) return;
    const actor = borrowActor();
    if (!actor) return requestLogin();
    message = "";
    // Default to the first free day: today, or the day after the booking that
    // covers today (so "book ahead" on an item that's out starts sensibly).
    let start = toDateInput(new Date());
    const busy = findOverlappingBooking(item, start, start);
    if (busy) start = addDaysKey(dayKey(busy.end), 1);
    bStart = start;
    bEnd = addDaysKey(start, 7);
    booking = true;
  }

  // Moving the start past the end drags the end along (never an inverted range).
  $: if (booking && bStart && bEnd && bEnd < bStart) bEnd = bStart;

  async function confirmBooking() {
    if (!sel || sel.kind !== "thing" || !$holonId || !bStart || !bEnd) return;
    const actor = borrowActor();
    if (!actor) return requestLogin();
    saving = true;
    message = "";
    // Fast-path UX check on the on-screen copy; core re-validates against the
    // stored item on write.
    const conflict = findOverlappingBooking(sel.item, bStart, bEnd);
    if (conflict) {
      saving = false;
      message = $t("detail.overlaps", {
        who: conflict.borrower || $t("detail.someone"),
        start: fmtDay($locale, conflict.start),
        end: fmtDay($locale, conflict.end),
      });
      return;
    }
    const db = await getLibraryDb();
    // A federated/hologram item lives in its owner's graph, not ours — book
    // against the source holon + key so the write lands on the real item, not a
    // fresh local copy.
    const ref = sourceRef(sel.item, String(sel.item.id));
    const holon = ref?.holon ?? $holonId;
    const key = ref?.key ?? String(sel.item.id);
    const res = await bookItem(db, holon, key, actor, {
      start: bStart,
      end: bEnd,
    });
    saving = false;
    if (res.ok) {
      // Credits move on borrow everywhere (skipped by core for owners and
      // valueless items). No REA deps here — the bot alone emits REA events.
      if (res.item)
        await recordBorrowAccounting({ db }, holon, actor, res.item);
      closeDetail();
    } else if (res.reason === "overlaps" && res.conflict) {
      message = $t("detail.overlaps", {
        who: res.conflict.borrower || $t("detail.someone"),
        start: fmtDay($locale, res.conflict.start),
        end: fmtDay($locale, res.conflict.end),
      });
    } else if (res.reason === "invalid_range") {
      message = $t("detail.invalidRange");
    } else {
      message = $t("detail.bookFailed");
    }
  }

  async function returnThing() {
    if (!sel || sel.kind !== "thing" || !$holonId) return;
    const actor = borrowActor();
    if (!actor) return requestLogin();
    saving = true;
    message = "";
    const db = await getLibraryDb();
    const ref = sourceRef(sel.item, String(sel.item.id));
    const holon = ref?.holon ?? $holonId;
    const key = ref?.key ?? String(sel.item.id);
    const res = await returnItem(db, holon, key, actor);
    saving = false;
    if (res.ok) {
      if (res.item)
        await recordReturnAccounting({ db }, holon, actor, res.item);
      closeDetail();
    } else {
      message =
        res.reason === "forbidden"
          ? $t("detail.onlyBorrowerReturn")
          : $t("detail.returnFailed");
    }
  }

  $: borrowedByMe =
    item?.borrowed &&
    ($telegramUser?.id === item?.borrowerId ||
      ($telegramUser?.username && item?.borrower === $telegramUser.username));
</script>

{#if sel}
  <Modal {tint} {holo} glow={srcGlow} {seed} on:close={closeDetail}>
    {#if isThing && item}
      <!-- ── Library thing ─────────────────────────────────────────────── -->
      <div class="icon-big">{getItemIcon({ type: item.type })}</div>
      <h2>{item.id}</h2>
      <div class="chips">
        <span class="kind">{getTypeDisplayName(item.type)}</span>
        {#if srcName}
          <span class="srcchip" style="--src: {srcGlow}">⇄ {srcName}</span>
        {/if}
      </div>

      {#if !editing}
        {#if item.description}<p class="desc">
            {@html linkify(item.description)}
          </p>{/if}
        <dl class="facts">
          <div>
            <dt>{$t("detail.status")}</dt>
            <dd>
              {#if item.borrowed}
                {item.borrower
                  ? $t("detail.outWith", { who: item.borrower })
                  : $t("detail.out")}
              {:else}{$t("detail.availableCap")}{/if}
            </dd>
          </div>
          {#if item.value}
            <div>
              <dt>{$t("detail.value")}</dt>
              <dd>{item.value}</dd>
            </div>
          {/if}
          {#if upcomingBookings.length}
            <div>
              <dt>{$t("detail.booked")}</dt>
              <dd>
                {#each upcomingBookings as b (b.id)}
                  <span class="booking-line"
                    >{fmtDay($locale, b.start)} → {fmtDay(
                      $locale,
                      b.end,
                    )}{b.borrower ? ` · ${b.borrower}` : ""}</span
                  >
                {/each}
              </dd>
            </div>
          {/if}
        </dl>

        {#if $isLoggedIn}
          {#if booking}
            <!-- Borrow for a chosen period — same booking model as the web
                 library: an inclusive [from, until] day range on bookings[]. -->
            <div class="row2">
              <label
                >{$t("detail.from")}
                <input type="date" bind:value={bStart} />
              </label>
              <label
                >{$t("detail.until")}
                <input type="date" bind:value={bEnd} min={bStart} />
              </label>
            </div>
            <div class="lengths">
              {#each LENGTH_CHIPS as c (c.days)}
                <button
                  class="chip"
                  class:on={bStart && bEnd === addDaysKey(bStart, c.days)}
                  on:click={() => (bEnd = addDaysKey(bStart, c.days))}
                  >{$t(c.labelKey)}</button
                >
              {/each}
            </div>
            <div class="actions">
              <button
                class="primary"
                on:click={confirmBooking}
                disabled={saving || !bStart || !bEnd}
                >{saving
                  ? $t("detail.booking")
                  : $t("detail.confirmBooking")}</button
              >
              <button class="ghost" on:click={() => (booking = false)}
                >{$t("common.cancel")}</button
              >
            </div>
          {:else}
            <div class="actions">
              {#if !item.borrowed}
                <button
                  class="primary"
                  on:click={startBooking}
                  disabled={saving}>{$t("detail.borrow")}</button
                >
              {:else if borrowedByMe}
                <button class="primary" on:click={returnThing} disabled={saving}
                  >{$t("detail.return")}</button
                >
              {:else}
                <span class="note-line"
                  >{$t("detail.onLoanTo", {
                    who: item.borrower ?? $t("detail.someone"),
                  })}</span
                >
                <button class="ghost" on:click={startBooking} disabled={saving}
                  >{$t("detail.bookAhead")}</button
                >
              {/if}
              <button class="ghost" on:click={startEdit} disabled={saving}
                >{$t("detail.edit")}</button
              >
              <button
                class="ghost"
                on:click={() => copySelection(sel)}
                disabled={saving}
                title={$t("detail.copyTitle")}>⧉ {$t("detail.copy")}</button
              >
            </div>
          {/if}
        {:else}
          <div class="actions">
            <button class="primary" on:click={requestLogin}
              >{$t("detail.loginBorrowEdit")}</button
            >
            <button
              class="ghost"
              on:click={() => copySelection(sel)}
              title={$t("detail.copyTitle")}>⧉ {$t("detail.copy")}</button
            >
          </div>
        {/if}
      {:else}
        <!-- edit thing -->
        <label
          >{$t("detail.category")}
          {#if addingThingType}
            <input
              type="text"
              bind:value={fType}
              placeholder={$t("detail.newCategoryPlaceholder")}
            />
            <button
              type="button"
              class="link-btn"
              on:click={() => {
                addingThingType = false;
                fType = "other";
              }}>{$t("detail.pickFromList")}</button
            >
          {:else}
            <select value={fType} on:change={onThingTypeSelect}>
              {#each thingTypeOptions as opt (opt)}
                <option value={opt}
                  >{getItemIcon({ type: opt })}
                  {getTypeDisplayName(opt)}</option
                >
              {/each}
              <option value={NEW_CATEGORY}>＋ {$t("detail.newCategory")}</option
              >
            </select>
          {/if}
        </label>
        <label
          >{$t("detail.description")}
          <textarea bind:value={fDescription} rows="3"></textarea>
        </label>
        <label
          >{$t("detail.value")}
          <input type="number" bind:value={fValue} min="0" />
        </label>
        <div class="actions">
          <button class="primary" on:click={saveThing} disabled={saving}
            >{saving ? $t("rolesv.saving") : $t("rolesv.save")}</button
          >
          <button class="ghost" on:click={() => (editing = false)}
            >{$t("common.cancel")}</button
          >
        </div>
      {/if}
    {:else if quest}
      <!-- ── Calendar event / task ─────────────────────────────────────── -->
      {#if !editing}
        {#if quest.picture}
          <img
            class="hero"
            src={resolveImage(quest.picture)}
            alt={quest.title}
            loading="lazy"
            on:error={hideImg}
          />
        {/if}
        {#if quest.category || srcName}
          <div class="chips">
            {#if quest.category}<span class="kind">{quest.category}</span>{/if}
            {#if srcName}
              <span class="srcchip" style="--src: {srcGlow}">⇄ {srcName}</span>
            {/if}
          </div>
        {/if}
        <h2>{@html linkify(quest.title)}</h2>
        <p class="when">{whenText($locale)}</p>
        {#if quest.location}<p class="where">📍 {quest.location}</p>{/if}
        {#if quest.description}<p class="desc">
            {@html linkify(quest.description)}
          </p>{/if}
        {#if people.length || appreciationCount}
          <div class="facts-line">
            {#if people.length}
              <span class="people-label"
                >{$t("detail.participants", { n: people.length })}</span
              >
            {/if}
            {#if appreciationCount}
              <span>♥ {appreciationCount}</span>
            {/if}
          </div>
        {/if}
        {#if people.length}
          <ul class="people">
            {#each people as p (p.id)}
              <li class="person">
                <span class="pav">
                  <span class="pini">{avatarInitial(p.name)}</span>
                  <img
                    src={avatarUrl(p.id)}
                    alt=""
                    loading="lazy"
                    on:error={hideImg}
                    on:load={showImg}
                  />
                </span>
                <span class="pname">{p.name}</span>
              </li>
            {/each}
          </ul>
        {/if}

        {#if $isLoggedIn}
          <div class="actions">
            {#if amParticipant}
              <button
                class="ghost joined"
                on:click={joinQuest}
                disabled={saving}
                title={$t("detail.leaveTitle")}
                >✓ {$t("detail.joinedLeave")}</button
              >
            {:else}
              <button class="primary" on:click={joinQuest} disabled={saving}
                >{$t("swipe.joinTitle")}</button
              >
            {/if}
            <button
              class="ghost appreciate"
              class:on={amAppreciating}
              on:click={appreciate}
              disabled={saving}
              >{amAppreciating
                ? `♥ ${$t("detail.appreciatedLabel")}`
                : `♡ ${$t("tasks.appreciate")}`}{appreciationCount
                ? ` · ${appreciationCount}`
                : ""}</button
            >
            <button
              class={amParticipant ? "primary" : "ghost"}
              on:click={completeQuest}
              disabled={saving}>{$t("tasks.markComplete")}</button
            >
            <button class="ghost" on:click={startEdit} disabled={saving}
              >{$t("detail.edit")}</button
            >
            <button
              class="ghost"
              on:click={() => copySelection(sel)}
              disabled={saving}
              title={$t("detail.copyTitle")}>⧉ {$t("detail.copy")}</button
            >
            {#if canBreakdown && breakdownSteps === null}
              <button
                class="ghost"
                on:click={requestBreakdown}
                disabled={saving || breakingDown}
                title={$t("detail.breakdownTitle")}
                >{breakingDown
                  ? $t("detail.breakingDown")
                  : `✨ ${$t("detail.breakDown")}`}</button
              >
            {/if}
            <button
              class="ghost danger"
              on:click={deleteQuest}
              disabled={saving}>{$t("tasks.delete")}</button
            >
          </div>

          {#if breakdownSteps !== null}
            <div class="breakdown">
              <p class="bd-head">{$t("detail.proposedSteps")}</p>
              {#if breakdownInfo}
                <p class="bd-note">
                  {$t("detail.notBrokenDown", { reason: breakdownInfo })}
                </p>
              {:else if breakdownReasoning}
                <p class="bd-note">{breakdownReasoning}</p>
              {/if}
              {#if breakdownSteps.length > 0}
                <ul class="bd-steps">
                  {#each breakdownSteps as step, i (step.title + i)}
                    <li>
                      <span class="bd-num">{i + 1}.</span>
                      <div class="bd-body">
                        <span class="bd-title">{step.title}</span>
                        {#if step.category && step.category !== (quest?.category || "")}
                          <span class="bd-tag">{step.category}</span>
                        {/if}
                        {#if stepReuseTitle(step)}
                          <span class="bd-tag"
                            >{$t("detail.reuses", {
                              title: stepReuseTitle(step),
                            })}</span
                          >
                        {/if}
                        {#if stepDepsLabel(step)}
                          <span class="bd-tag"
                            >{$t("detail.after", {
                              deps: stepDepsLabel(step),
                            })}</span
                          >
                        {/if}
                        {#if step.description}
                          <p class="bd-desc">{step.description}</p>
                        {/if}
                      </div>
                      <button
                        class="bd-x"
                        on:click={() => removeBreakdownStep(i)}
                        aria-label={$t("detail.removeStepAria", {
                          n: i + 1,
                          title: step.title,
                        })}
                        title={$t("detail.removeStep")}>✕</button
                      >
                    </li>
                  {/each}
                </ul>
              {/if}
              <div class="bd-add">
                <input
                  type="text"
                  placeholder={$t("detail.addStepPlaceholder")}
                  bind:value={newStepTitle}
                  on:keydown={(e) => e.key === "Enter" && addBreakdownStep()}
                />
                <button
                  class="ghost bd-add-btn"
                  on:click={addBreakdownStep}
                  disabled={!newStepTitle.trim()}>{$t("tasks.add")}</button
                >
              </div>
              {#each breakdownPreview?.warnings ?? [] as warning}
                <p class="bd-warn">⚠ {warning}</p>
              {/each}
              <div class="actions">
                {#if breakdownPreview && (breakdownPreview.newQuests.length > 0 || breakdownPreview.reusedExistingIds.length > 0)}
                  <button
                    class="primary"
                    on:click={confirmBreakdown}
                    disabled={saving}
                    >{saving
                      ? $t("detail.creating")
                      : $t("detail.createSteps", {
                          n: breakdownPreview.newQuests.length,
                        })}</button
                  >
                {/if}
                <button
                  class="ghost"
                  on:click={requestBreakdown}
                  disabled={breakingDown}
                  >{breakingDown
                    ? $t("detail.regenerating")
                    : `↻ ${$t("detail.regenerate")}`}</button
                >
                <button class="ghost" on:click={cancelBreakdown}
                  >{$t("common.cancel")}</button
                >
              </div>
            </div>
          {/if}
        {:else}
          <div class="actions">
            <button class="primary" on:click={requestLogin}
              >{$t("detail.loginEdit")}</button
            >
            <button
              class="ghost"
              on:click={() => copySelection(sel)}
              title={$t("detail.copyTitle")}>⧉ {$t("detail.copy")}</button
            >
          </div>
        {/if}
      {:else}
        <!-- ── Edit a task / event ────────────────────────────────────────
             Title, then when it starts and when it ends, then the flat fields.
             Leaving the end blank keeps it a one-day card; an end date on a
             later day is what makes it a multi-day event. -->
        <label class="lead"
          >{$t("detail.title")}
          <input
            type="text"
            bind:value={fTitle}
            placeholder={$t("detail.titlePlaceholder")}
          />
        </label>

        <div class="when-row">
          <div class="edge">
            <span class="elab">{$t("detail.starts")}</span>
            <div class="pair">
              <input
                type="date"
                bind:value={fDate}
                aria-label={$t("detail.startDateAria")}
              />
              <input
                class="clock"
                type="time"
                bind:value={fTime}
                aria-label={$t("detail.startTimeAria")}
              />
            </div>
          </div>
          <div class="edge">
            <span class="elab">{$t("detail.ends")}</span>
            <div class="pair">
              <input
                type="date"
                bind:value={fEndDate}
                min={fDate}
                disabled={!fDate}
                aria-label={$t("detail.endDateAria")}
              />
              <input
                class="clock"
                type="time"
                bind:value={fEndTime}
                disabled={!fTime}
                aria-label={$t("detail.endTimeAria")}
              />
            </div>
          </div>
        </div>
        <!-- What the fields add up to, in the same words the card will use
             once saved. -->
        {#if scheduleSummary}<p class="sched-sum">{scheduleSummary}</p>{/if}

        <label
          >{$t("detail.category")}
          {#if addingCategory}
            <input
              type="text"
              bind:value={fCategory}
              placeholder={$t("detail.newCategoryPlaceholder")}
            />
            <button
              type="button"
              class="link-btn"
              on:click={() => {
                addingCategory = false;
                fCategory = "";
              }}>{$t("detail.pickFromList")}</button
            >
          {:else}
            <select value={fCategory} on:change={onCategorySelect}>
              <option value="">{$t("detail.noCategory")}</option>
              {#each categoryOptions as opt}
                <option value={opt}>{opt}</option>
              {/each}
              <option value={NEW_CATEGORY}>＋ {$t("detail.newCategory")}</option
              >
            </select>
          {/if}
        </label>
        <label
          >{$t("detail.location")}
          <input type="text" bind:value={fLocation} />
        </label>
        <label
          >{$t("detail.description")}
          <textarea bind:value={fDescription} rows="3"></textarea>
        </label>
        <div class="actions">
          <button
            class="primary"
            on:click={saveQuest}
            disabled={saving || (isNew && !fTitle.trim())}
            >{saving
              ? $t("rolesv.saving")
              : isNew
                ? $t("detail.create")
                : $t("rolesv.save")}</button
          >
          <button
            class="ghost"
            on:click={() => (isNew ? closeDetail() : (editing = false))}
            >{$t("common.cancel")}</button
          >
        </div>
      {/if}
    {/if}

    {#if message}<p class="msg">{message}</p>{/if}
  </Modal>
{/if}

{#if celebrate}
  <Confetti />
{/if}

<style>
  h2 {
    margin: 0.2rem 0 0.4rem;
    font-size: 1.55rem;
    line-height: 1.18;
    color: var(--ink);
    word-break: break-word;
  }
  h2 :global(a) {
    color: var(--teal-deep);
    text-decoration: underline;
    overflow-wrap: anywhere;
  }
  .hero {
    display: block;
    width: 100%;
    max-height: 240px;
    object-fit: cover;
    border-radius: 14px;
    margin: 0 0 0.7rem;
    background: rgba(0, 0, 0, 0.05);
  }
  .kind {
    display: inline-block;
    font-size: 0.74rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--teal-deep);
  }
  .chips {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  /* Where a foreign card came from — coloured with the source holon's glow
     hue, matching the wall's source chips and the hologram projection. */
  .srcchip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.74rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    padding: 0.12rem 0.55rem;
    border-radius: 999px;
    color: var(--src, var(--teal-deep));
    border: 1px solid
      color-mix(in srgb, var(--src, var(--teal)) 55%, transparent);
    background: color-mix(in srgb, var(--src, var(--teal)) 12%, transparent);
  }
  .icon-big {
    font-size: 3rem;
    line-height: 1;
  }
  .when {
    font-weight: 700;
    color: var(--ink);
    margin: 0 0 0.5rem;
  }
  .where {
    color: var(--ink-soft);
    margin: 0 0 0.5rem;
  }
  .facts-line {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1rem;
    color: var(--ink-soft);
    font-weight: 600;
    margin: 0 0 0.5rem;
  }

  /* Participant chips: photo (initials fallback) + name. */
  .people {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin: 0 0 0.6rem;
    padding: 0;
  }
  .person {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.25rem 0.7rem 0.25rem 0.3rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.55);
    font-weight: 700;
    color: var(--ink);
    font-size: 0.92rem;
  }
  .pav {
    position: relative;
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--teal);
    display: grid;
    place-items: center;
    flex: 0 0 auto;
  }
  .pini {
    font-size: 0.72rem;
    font-weight: 800;
    color: #fff;
  }
  .pav img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .pname {
    max-width: 11rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .desc {
    color: var(--ink-soft);
    line-height: 1.55;
    margin: 0.6rem 0 0.4rem;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .desc :global(a) {
    color: var(--teal-deep);
    text-decoration: underline;
    overflow-wrap: anywhere;
  }
  .desc :global(a:active) {
    opacity: 0.7;
  }
  .facts {
    display: flex;
    gap: 1.6rem;
    margin: 0.8rem 0 0.2rem;
  }
  .facts dt {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    font-weight: 700;
  }
  .facts dd {
    margin: 0.1rem 0 0;
    font-weight: 700;
    color: var(--ink);
  }
  .note-line {
    color: var(--ink-soft);
    font-weight: 600;
    align-self: center;
  }
  .booking-line {
    display: block;
    font-weight: 600;
    color: var(--ink-soft);
    white-space: nowrap;
  }
  /* Quick loan-length chips under the booking date range. */
  .lengths {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-top: 0.7rem;
  }
  .chip {
    min-height: 40px;
    padding: 0 0.95rem;
    border-radius: 999px;
    font-weight: 700;
    font-size: 0.92rem;
    color: var(--teal-deep);
    background: var(--card);
    border: 1.5px solid var(--line);
  }
  .chip.on {
    background: var(--teal);
    border-color: var(--teal);
    color: #fff;
  }
  .joined {
    background: #e7f3f1;
    color: var(--teal-deep);
  }

  label {
    display: block;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin-top: 0.9rem;
  }
  input,
  textarea,
  select {
    display: block;
    width: 100%;
    margin-top: 0.3rem;
    padding: 0.7rem 0.8rem;
    font-size: 1rem;
    font-family: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
    text-transform: none;
    letter-spacing: 0;
  }
  input:focus,
  textarea:focus,
  select:focus {
    outline: none;
    border-color: var(--teal);
  }
  textarea {
    resize: vertical;
  }
  /* The title leads the form — no top gap above it, and set at reading size. */
  .lead {
    margin-top: 0.6rem;
  }
  .lead input {
    font-size: 1.15rem;
    font-weight: 700;
  }

  /* ── When it starts / when it ends ───────────────────────────────────────
     Two edges side by side, each a small label over a date + clock pair. No
     panel, no accent grounds: the inputs carry the same surfaces as every
     other field, so the row reads correctly in both skins. Each control can
     shrink (min-width: 0 — native date/time controls keep an intrinsic width
     and would otherwise overflow) and the pair wraps on a narrow dialog. */
  .when-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    margin-top: 0.9rem;
  }
  .edge {
    flex: 1 1 14rem;
    min-width: 0;
  }
  .elab {
    display: block;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .pair {
    display: flex;
    gap: 0.4rem;
  }
  .pair input {
    flex: 1 1 6rem;
    min-width: 0;
    box-sizing: border-box;
  }
  .pair .clock {
    flex: 0 1 6.5rem;
  }
  .pair input:disabled {
    opacity: 0.45;
  }
  /* The sentence the card will read once saved. Ink, not accent — `--teal-deep`
     is a light-skin colour and goes near-black on the dark card. */
  .sched-sum {
    margin: 0.6rem 0 0;
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--ink-soft);
  }

  /* The booking sheet's from/until pair: each side can shrink (min-width: 0 —
     native date controls otherwise keep an intrinsic width and overflow) and
     wraps when the dialog is too narrow. */
  .row2 {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
  }
  .row2 label {
    flex: 1 1 8rem;
    min-width: 0;
  }
  .row2 input {
    box-sizing: border-box;
    max-width: 100%;
  }
  @media (max-width: 560px) {
    .row2 label {
      flex-basis: 6rem;
    }
  }
  /* "Pick from list" escape hatch under the new-category input. */
  .link-btn {
    display: inline;
    width: auto;
    margin-top: 0.4rem;
    padding: 0;
    background: none;
    border: none;
    color: var(--teal);
    font-size: 0.8rem;
    font-weight: 700;
    cursor: pointer;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 1.3rem;
  }
  .primary,
  .ghost {
    flex: 1;
    min-width: 8rem;
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
    background: rgba(255, 255, 255, 0.5);
    color: var(--ink);
  }
  .danger {
    color: #c0392b;
    background: rgba(192, 57, 43, 0.1);
  }
  .danger:active {
    transform: scale(0.97);
  }
  .primary:active,
  .ghost:active {
    transform: scale(0.97);
  }
  .primary:disabled {
    opacity: 0.6;
  }
  .appreciate.on {
    background: var(--note-coral);
    color: #9a3b2f;
  }
  .msg {
    margin-top: 0.9rem;
    color: #9a3b2f;
    font-weight: 600;
    text-align: center;
  }

  /* AI breakdown panel: the proposed-steps draft under the action row. */
  .breakdown {
    margin-top: 1rem;
    padding: 0.9rem 1rem;
    border: 1.5px solid var(--line);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.45);
  }
  .bd-head {
    margin: 0 0 0.4rem;
    font-size: 0.74rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--teal-deep);
  }
  .bd-note {
    margin: 0 0 0.5rem;
    color: var(--ink-soft);
    font-size: 0.9rem;
    font-style: italic;
  }
  .bd-steps {
    list-style: none;
    margin: 0 0 0.6rem;
    padding: 0;
    display: grid;
    gap: 0.45rem;
  }
  .bd-steps li {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
  }
  .bd-num {
    color: var(--muted);
    font-weight: 700;
  }
  .bd-body {
    flex: 1;
    min-width: 0;
    color: var(--ink);
    word-break: break-word;
  }
  .bd-title {
    font-weight: 700;
  }
  .bd-tag {
    margin-left: 0.35rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--teal-deep);
  }
  .bd-desc {
    margin: 0.15rem 0 0;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .bd-x {
    flex: 0 0 auto;
    min-width: 2.3rem;
    min-height: 2.3rem;
    border-radius: 10px;
    background: rgba(192, 57, 43, 0.08);
    color: #c0392b;
    font-weight: 700;
  }
  .bd-x:active {
    transform: scale(0.95);
  }
  .bd-add {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
  }
  .bd-add input {
    flex: 1;
    margin-top: 0;
  }
  .bd-add .bd-add-btn {
    flex: 0 0 auto;
    min-width: 4.5rem;
    min-height: 48px;
  }
  .bd-warn {
    margin: 0.2rem 0;
    font-size: 0.82rem;
    font-weight: 600;
    color: #a07908;
  }
  .breakdown .actions {
    margin-top: 0.8rem;
  }
</style>
