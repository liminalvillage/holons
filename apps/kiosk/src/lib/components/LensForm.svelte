<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Adding to a cell: the form the dock's "+" opens once a cell and a lens
  // are both in hand. The fields are the lens's own schema (lib/lensform),
  // and everything the moment already knows — the key, the creation stamp,
  // who is adding, the cell and where it is on the earth — is filled in
  // before the form is ever shown, so what's left to type is the short list
  // that actually needs a person. The write goes to the CELL: an H3 cell is a
  // holon, so this is an ordinary identity-aware put.
  import { createEventDispatcher, onMount } from "svelte";
  import { getWriter } from "$lib/holosphere";
  import { showNotice } from "$lib/stores";
  import { currentUser } from "$lib/auth";
  import { createTask } from "@holons/core/tasks";
  import { headlineField, lensScaffold, type LensId } from "$lib/maplens";
  import {
    baseRecord,
    cellPlace,
    formFields,
    initialValues,
    applyDraft,
    prettyField,
    toDraftFields,
    valuesToRecord,
    type FormField,
    type JsonSchema,
  } from "$lib/lensform";
  import { draftAvailable, requestDraft } from "$lib/draft";
  import { loadLensSchema } from "$lib/schemas";
  import { t, type MessageKey } from "$lib/i18n";
  import { en } from "$lib/i18n/en";

  /** The cell the record lands in — the holon it is written to. */
  export let cell: string;
  export let lens: LensId;

  const dispatch = createEventDispatcher<{
    saved: { id: string };
    close: void;
  }>();

  /** A fresh record's key, as every other kiosk add path mints one. */
  const newId = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const id = newId();
  let schema: JsonSchema | null = null;
  let fields: FormField[] = [];
  // `any` on purpose: each input binds one entry of this bag, and Svelte's
  // bindings need the value's type to be the input's, not `unknown`.
  let values: Record<string, any> = {};
  let base: Record<string, unknown> = {};
  let loading = true;
  let saving = false;
  let error = "";
  let tagDraft: Record<string, string> = {};

  // ── Describing it instead of filling it in ──────────────────────────────--
  //
  // Optional, and only offered where there is a key to ask with (one pasted
  // on this device, or one on the deploy). What comes back lands IN THE FORM,
  // never straight in the store: it is a draft someone reads before saving.
  let canDraft = false;
  let describe = "";
  let drafting = false;
  void draftAvailable().then((v) => (canDraft = v));

  async function fillFromDescription() {
    const said = describe.trim();
    if (!said || drafting) return;
    drafting = true;
    error = "";
    try {
      const drafted = await requestDraft({
        kind: $t(`lens.${lens}` as MessageKey),
        description: said,
        fields: toDraftFields(fields),
        place: cellPlace(cell),
      });
      // ONE assignment: see applyDraft — writing field by field re-runs the
      // field loop mid-flight and the rebuilding {#each} throws.
      const laid = applyDraft(fields, values, drafted);
      values = laid.values;
      if (!laid.filled) error = $t("draft.nothing");
    } catch (err) {
      console.error("[kiosk] map: drafting failed", err);
      error = err instanceof Error ? err.message : $t("draft.nothing");
    } finally {
      drafting = false;
    }
  }

  onMount(async () => {
    schema = await loadLensSchema(lens);
    const u = $currentUser;
    base = {
      ...baseRecord(schema, {
        id,
        cell,
        user: u
          ? {
              id: u.id,
              username: u.username,
              firstName: u.first_name,
              lastName: u.last_name,
            }
          : null,
      }),
      ...lensScaffold(lens),
    };
    fields = formFields(schema, headlineField(lens));
    values = {
      ...initialValues(fields, base),
      // A lens keyed by its name (the library) asks for `id`, and the base
      // carries the minted key — which must not appear in the box as the
      // suggested name. The typed line becomes the key on save.
      ...(headlineField(lens) === "id" ? { id: "" } : {}),
    };
    loading = false;
    // The headline is what the panel will list this by — start there. By id,
    // not a binding: `bind:this` inside the field loop would hold the LAST
    // input rendered, and the caret belongs in the first.
    const head = fields[0]?.name;
    if (head)
      queueMicrotask(() =>
        document.getElementById(`lf-${head}`)?.focus({ preventScroll: true }),
      );
  });

  /** A field's label: the kiosk's own word for it when it has one (the same
   *  catalog the cell panel reads by), else the schema's title, else the
   *  field name spaced out. */
  function label(f: FormField): string {
    const key = `map.field.${f.name}`;
    if (key in en) return $t(key as MessageKey);
    return f.title || prettyField(f.name);
  }

  // ── One rule for every change: assign a new bag ─────────────────────────--
  //
  // Never `values[name] = x`. Svelte compiles an in-place mutation of
  // reactive state into a call that re-reads an identifier from the wrong
  // scope — in this form's fill-from-description loop it emitted a bare `f`,
  // the field loop's variable, which does not exist there: "f is not
  // defined", thrown the moment a draft came back. Nothing else in the kiosk
  // mutates reactive state in place either, and lensform-compile.test.ts
  // holds this component to the same line.
  function setValue(f: FormField, value: unknown) {
    values = { ...values, [f.name]: value };
  }
  function setTagDraft(f: FormField, value: string) {
    tagDraft = { ...tagDraft, [f.name]: value };
  }
  function listOf(f: FormField): string[] {
    return Array.isArray(values[f.name]) ? (values[f.name] as string[]) : [];
  }
  function addTag(f: FormField) {
    const draft = (tagDraft[f.name] ?? "").trim().replace(/,/g, "");
    if (!draft) return;
    const list = listOf(f);
    if (!list.includes(draft)) setValue(f, [...list, draft]);
    setTagDraft(f, "");
  }
  function onTagKey(e: KeyboardEvent, f: FormField) {
    if (e.key !== "Enter" && e.key !== ",") return;
    e.preventDefault();
    addTag(f);
  }
  function removeTag(f: FormField, tag: string) {
    setValue(
      f,
      listOf(f).filter((v) => v !== tag),
    );
  }
  function toggleOption(f: FormField, value: string) {
    const list = listOf(f);
    setValue(
      f,
      list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
    );
  }

  async function save() {
    if (saving) return;
    const user = $currentUser;
    if (!user) return;
    const typed = valuesToRecord(fields, values);
    const head = headlineField(lens);
    if (head && !typed[head]) {
      error = $t("dock.addToInvalid");
      return;
    }
    // Some lenses are keyed BY their name — a library thing is `addItem(db,
    // holon, name)` — so there the headline someone typed IS the record's key.
    const key = head === "id" ? String(typed.id) : id;
    // A quest's shape is core's: build one and let the form's answers land on
    // top of it, so a task added on the map is the task the board reads.
    const seed =
      lens === "quests"
        ? (() => {
            const task = createTask({
              holonId: cell,
              initiator: {
                id: user.id,
                username: user.username,
                firstName: user.first_name,
                lastName: user.last_name,
              },
              title: String(typed.title ?? ""),
            }) as Record<string, unknown>;
            // A task added on the earth remembers the cell it was added on —
            // `where` is core's shape for that, and createTask leaves it blank.
            const place = cellPlace(cell);
            if (place)
              task.where = {
                latitude: String(place.lat),
                longitude: String(place.lon),
              };
            return task;
          })()
        : {};
    const record = { ...seed, ...base, ...typed, id: key };
    saving = true;
    error = "";
    try {
      const writer = await getWriter(cell, (msg) => showNotice(msg));
      const ok = await writer.put(lens, record);
      if (!ok) {
        error = $t("dock.addToFailed");
        return;
      }
      dispatch("saved", { id: key });
      dispatch("close");
    } catch (err) {
      console.error("[kiosk] map: failed to add to cell", err);
      error = $t("dock.addToFailed");
    } finally {
      saving = false;
    }
  }
</script>

<form class="lensform" on:submit|preventDefault={save}>
  <h3>{$t("dock.addTo", { lens: $t(`lens.${lens}` as MessageKey) })}</h3>
  <p class="where"><code>{cell}</code></p>

  {#if loading}
    <p class="hint">{$t("map.cellLoading")}</p>
  {:else}
    {#if canDraft}
      <!-- Say what it is in a sentence and let the assistant answer the form.
           Everything it fills stays editable — nothing is saved until Add. -->
      <div class="describe">
        <textarea
          rows="2"
          bind:value={describe}
          placeholder={$t("draft.placeholder")}
          aria-label={$t("draft.placeholder")}
        ></textarea>
        <button
          type="button"
          class="fill"
          on:click={fillFromDescription}
          disabled={drafting || !describe.trim()}
          >{drafting ? $t("draft.working") : $t("draft.go")}</button
        >
      </div>
    {/if}

    <div class="fields">
      {#each fields as f (f.name)}
        <!-- A set of chips has no single input for a <label> to point at, so
             that one field is a labelled group instead. -->
        <svelte:element
          this={f.kind === "multi" ? "div" : "label"}
          class="field"
          for={f.kind === "multi" ? undefined : `lf-${f.name}`}
          role={f.kind === "multi" ? "group" : undefined}
          aria-label={f.kind === "multi" ? label(f) : undefined}
        >
          <span class="field__name"
            >{label(f)}{#if f.required}<span class="req" aria-hidden="true"
                >*</span
              >{/if}</span
          >

          {#if f.kind === "long"}
            <textarea
              id={`lf-${f.name}`}
              rows="3"
              value={String(values[f.name] ?? "")}
              on:input={(e) => setValue(f, e.currentTarget.value)}
            ></textarea>
          {:else if f.kind === "select"}
            <select
              id={`lf-${f.name}`}
              on:change={(e) => setValue(f, e.currentTarget.value)}
            >
              <option value="" selected={!values[f.name]}>—</option>
              {#each f.options ?? [] as opt (opt.value)}
                <option
                  value={opt.value}
                  selected={values[f.name] === opt.value}>{opt.label}</option
                >
              {/each}
            </select>
          {:else if f.kind === "checkbox"}
            <input
              id={`lf-${f.name}`}
              type="checkbox"
              class="check"
              checked={values[f.name] === true}
              on:change={(e) => setValue(f, e.currentTarget.checked)}
            />
          {:else if f.kind === "multi"}
            <span class="opts">
              {#each f.options ?? [] as opt (opt.value)}
                <button
                  type="button"
                  class="opt"
                  class:on={listOf(f).includes(opt.value)}
                  aria-pressed={listOf(f).includes(opt.value)}
                  on:click={() => toggleOption(f, opt.value)}
                  >{opt.label}</button
                >
              {/each}
            </span>
          {:else if f.kind === "tags"}
            <span class="tags">
              <input
                id={`lf-${f.name}`}
                type="text"
                value={tagDraft[f.name] ?? ""}
                on:input={(e) => setTagDraft(f, e.currentTarget.value)}
                on:keydown={(e) => onTagKey(e, f)}
                on:blur={() => addTag(f)}
                placeholder={$t("dock.addToTagHint")}
              />
              <span class="chips">
                {#each listOf(f) as tag (tag)}
                  <button
                    type="button"
                    class="chip"
                    on:click={() => removeTag(f, tag)}>{tag} ×</button
                  >
                {/each}
              </span>
            </span>
          {:else}
            <input
              id={`lf-${f.name}`}
              type={f.kind === "number"
                ? "number"
                : f.kind === "datetime"
                  ? "datetime-local"
                  : f.kind === "url"
                    ? "url"
                    : "text"}
              value={String(values[f.name] ?? "")}
              on:input={(e) => setValue(f, e.currentTarget.value)}
            />
          {/if}

          {#if f.hint}
            <span class="field__hint">{f.hint}</span>
          {/if}
        </svelte:element>
      {/each}
    </div>

    {#if error}
      <p class="err" role="alert">{error}</p>
    {/if}

    <div class="actions">
      <button type="button" class="ghost" on:click={() => dispatch("close")}
        >{$t("common.cancel")}</button
      >
      <button type="submit" class="primary" disabled={saving}
        >{saving ? $t("common.saving") : $t("dock.addToSave")}</button
      >
    </div>
  {/if}
</form>

<style>
  .lensform {
    text-align: left;
  }
  h3 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--ink);
  }
  .where {
    margin: 0.15rem 0 0.9rem;
  }
  .where code {
    font-size: 0.7rem;
    color: var(--muted);
  }
  .hint {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .describe {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin-bottom: 0.9rem;
  }
  .describe textarea {
    flex: 1;
    min-width: 0;
  }
  .fill {
    flex: none;
    margin-top: 0.3rem;
    padding: 0.55rem 0.9rem;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ink-soft);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 999px;
  }
  .fill:disabled {
    opacity: 0.5;
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    /* Long schemas (a Murmurations profile) must scroll inside the sheet
       rather than push its buttons off the screen. */
    max-height: 52dvh;
    overflow-y: auto;
    padding-right: 0.2rem;
  }
  .field {
    display: block;
  }
  .field__name {
    display: block;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .req {
    color: var(--teal);
    margin-left: 0.15rem;
  }
  .field__hint {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.72rem;
    line-height: 1.35;
    color: var(--muted);
  }
  input[type="text"],
  input[type="url"],
  input[type="number"],
  input[type="datetime-local"],
  select,
  textarea {
    display: block;
    width: 100%;
    margin-top: 0.3rem;
    padding: 0.6rem 0.7rem;
    font-size: 1rem;
    font-family: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
  }
  textarea {
    resize: vertical;
    line-height: 1.4;
  }
  input:focus,
  select:focus,
  textarea:focus {
    outline: none;
    border-color: var(--teal);
  }
  .check {
    margin-top: 0.35rem;
    width: 1.4rem;
    height: 1.4rem;
    accent-color: var(--teal);
  }
  .opts,
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.35rem;
  }
  .opt,
  .chip {
    padding: 0.3rem 0.65rem;
    font-size: 0.8rem;
    color: var(--ink-soft);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 999px;
  }
  .opt.on {
    color: var(--paper);
    background: var(--teal);
    border-color: var(--teal);
  }
  .err {
    margin: 0.7rem 0 0;
    font-size: 0.85rem;
    color: var(--rose, #b4436c);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 1rem;
  }
  .actions button {
    padding: 0.6rem 1.1rem;
    font-size: 0.95rem;
    font-weight: 700;
    border-radius: 999px;
  }
  .ghost {
    color: var(--muted);
  }
  .primary {
    color: var(--paper);
    background: var(--teal);
  }
  .primary:disabled {
    opacity: 0.6;
  }
</style>
