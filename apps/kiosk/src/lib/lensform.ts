// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The map's add form, as data. A lens carries a JSON Schema (the same ones
// the web dashboard's map sidebar renders, see apps/web/src/lib/schemas.ts);
// this turns one into the short list of fields a person can actually fill in
// on a kiosk, and turns what they filled back into a record.
//
// Two halves, both pure:
//
//   `baseRecord` — everything the form should NOT ask for because the moment
//   already knows it: the record's key, its creation stamp, who is adding it,
//   the cell it lands in and where that cell is on the earth.
//
//   `formFields` — what is left: the strings, numbers, dates, choices and
//   tags a person types. Anything the map can't honestly render — a nested
//   object, a list of objects, a pointer to another record — is left out
//   rather than shown as an empty box that writes junk.

import { cellToLatLng, isValidCell } from "h3-js";
import type { DraftField } from "@holons/core/drafting";

export type JsonField = {
  type?: string;
  title?: string;
  description?: string;
  enum?: string[];
  enumNames?: string[];
  format?: string;
  items?: { type?: string; enum?: string[]; enumNames?: string[] };
  properties?: Record<string, JsonField>;
};

export type JsonSchema = {
  title?: string;
  properties?: Record<string, JsonField>;
  required?: string[];
  metadata?: { schema?: { name?: string } };
};

export type FieldKind =
  | "text"
  | "url"
  | "long"
  | "number"
  | "datetime"
  | "select"
  | "checkbox"
  | "tags"
  | "multi";

export type FormField = {
  name: string;
  kind: FieldKind;
  /** The schema's own title for the field, when it gives one. */
  title?: string;
  /** The schema's own prose, shown under the input. */
  hint?: string;
  required: boolean;
  options?: Array<{ value: string; label: string }>;
  /** A datetime this lens stores as milliseconds, not as an ISO string. */
  epoch?: boolean;
};

/**
 * Names the form never asks for. Either the moment supplies them
 * (`baseRecord`), or they are the graph's own bookkeeping and the pointers
 * between records — a borrowing, a companion checklist, a hologram's origin —
 * which belong to the flows that own them, not to a map tap.
 */
const NEVER_ASK = new Set([
  // Supplied by the moment
  "id",
  "linked_schemas",
  "version",
  "geolocation",
  "latitude",
  "longitude",
  "geohash",
  "created",
  "created_at",
  "createdAt",
  "updated",
  "updated_at",
  "timestamp",
  "date",
  "initiator",
  "user",
  "creator",
  "createdBy",
  "createdByUsername",
  "from",
  "paidBy",
  "requester",
  "holon",
  "holonId",
  "chat",
  "message_thread_id",
  // Owned by other flows
  "to",
  "provider",
  "receiver",
  "participants",
  "appreciation",
  "stoppers",
  "dependencies",
  "dependsOn",
  "activeHolograms",
  "items",
  "data",
  "ratings",
  "issues",
  "responses",
  "source",
  "borrower",
  "borrowerId",
  "borrowerInitials",
  "borrowedAt",
  "returnedAt",
  "returnBy",
  "questId",
  "roleId",
  "checklistId",
  "parentTitle",
  "reminderId",
  "recurringTaskId",
  "orderIndex",
  "canvasId",
  "splitWith",
  "picture",
  "document",
  "where",
]);

/**
 * State the record's own flows move — completing a quest, lending a thing,
 * publishing. Asked only where the schema offers a CHOICE; never as a free
 * text box, which is how "ongoing" ends up spelled three ways.
 */
const MANAGED = new Set([
  "status",
  "type",
  "completed",
  "borrowed",
  "published",
]);

/** Fields that read as a paragraph rather than a line. */
const LONG = new Set([
  "description",
  "mission",
  "note",
  "reason",
  "content",
  "details",
]);

/** Names that mean an instant, whatever type the schema declares them. */
const TIME = new Set([
  "when",
  "until",
  "ends",
  "expires_at",
  "founding_date",
  "hasPointInTime",
]);

/**
 * The Murmurations profile schemas (projects, organizations, people,
 * communities, currencies) declare most of their fields as a `$ref` into the
 * network's remote field library — a URL this kiosk can't fetch and shouldn't
 * need to. Their shapes are stable and few, so they are named here; a ref
 * this table doesn't know is skipped rather than guessed at, which is why an
 * unfamiliar profile field simply doesn't appear on the form.
 */
const SCOPE_OPTIONS = ["local", "regional", "national", "international"];
const REF_FIELDS: Record<string, JsonField> = {
  name: { type: "string" },
  description: { type: "string" },
  mission: { type: "string" },
  locality: { type: "string" },
  region: { type: "string" },
  country_name: { type: "string" },
  country_iso_3166: { type: "string" },
  primary_url: { type: "string", format: "uri" },
  image: { type: "string", format: "uri" },
  rss: { type: "string", format: "uri" },
  email: { type: "string" },
  telephone: { type: "string" },
  first_name: { type: "string" },
  last_name: { type: "string" },
  job_title: { type: "string" },
  knows_language: { type: "array", items: { type: "string" } },
  tags: { type: "array", items: { type: "string" } },
  founding_date: { type: "integer" },
  geographic_scope: { type: "string", enum: SCOPE_OPTIONS },
  area_served: { type: "string", enum: SCOPE_OPTIONS },
  status: {
    type: "string",
    enum: ["active", "completed", "cancelled", "on_hold", "in_planning"],
  },
};

/**
 * A property as this form can read it: its own declaration, or — when it is
 * only a pointer into the Murmurations field library — the shape named for
 * it above. Null when neither says anything renderable.
 */
function resolveField(name: string, field: JsonField): JsonField | null {
  if (field.type || field.enum || field.items) return field;
  if (!("$ref" in (field as Record<string, unknown>))) return null;
  const known = REF_FIELDS[name];
  if (!known) return null;
  return {
    ...known,
    ...(field.title ? { title: field.title } : {}),
    ...(field.description ? { description: field.description } : {}),
  };
}

/** Where each headline-shaped lens carries the line someone types first. */
export const HEADLINE_FIELDS = ["title", "name", "content", "description"];

/** A field name as a person reads it: `primary_url` → "Primary url". */
export function prettyField(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Some of these schemas spell a field's options in its prose instead of an
 * `enum` — `"tool | book | equipment | other"`. Read those, and only those: a
 * description that is anything but a pipe-separated list of bare tokens is
 * left alone.
 */
export function optionsFromDescription(text: string | undefined): string[] {
  if (!text || !text.includes("|")) return [];
  const parts = text.split("|").map((s) => s.trim());
  if (parts.length < 2) return [];
  return parts.every((p) => /^[a-z][a-z0-9_]*$/.test(p)) ? parts : [];
}

function optionsOf(field: JsonField): Array<{ value: string; label: string }> {
  const values = field.enum?.length
    ? field.enum
    : optionsFromDescription(field.description);
  return values.map((value, i) => ({
    value,
    label: field.enumNames?.[i] ?? prettyField(value),
  }));
}

function kindOf(name: string, field: JsonField): FieldKind | null {
  const options = optionsOf(field);
  if (MANAGED.has(name) && !options.length) return null;
  const type = field.type ?? "string";
  if (type === "array") {
    if (field.items?.enum?.length) return "multi";
    return field.items?.type === "string" ? "tags" : null;
  }
  if (type === "boolean") return "checkbox";
  if (type === "object") return null;
  if (options.length) return "select";
  if (TIME.has(name)) return "datetime";
  if (type === "number" || type === "integer") return "number";
  if (type !== "string") return null;
  if (LONG.has(name)) return "long";
  if (field.format === "uri" || /url$/i.test(name)) return "url";
  return "text";
}

/**
 * The fields to put in front of someone adding to this cell, headline first
 * (a title or a name is what the list will show, so it is what gets asked
 * first) and the rest in the schema's own order.
 *
 * With no schema — one that failed to load — the caller still gets the one
 * field it named as the headline, so an add is never blocked by a missing
 * JSON file.
 */
export function formFields(
  schema: JsonSchema | null,
  fallbackHeadline?: string | null,
): FormField[] {
  const props = schema?.properties;
  if (!props) {
    return fallbackHeadline
      ? [{ name: fallbackHeadline, kind: "text", required: true }]
      : [];
  }
  const required = new Set(schema?.required ?? []);
  const fields: FormField[] = [];
  for (const [name, raw] of Object.entries(props)) {
    if (name.startsWith("_") || NEVER_ASK.has(name)) continue;
    const field = resolveField(name, raw);
    if (!field) continue;
    const kind = kindOf(name, field);
    if (!kind) continue;
    const options = optionsOf(field);
    fields.push({
      name,
      kind,
      ...(field.title ? { title: field.title } : {}),
      ...(kind !== "select" && kind !== "multi" && field.description
        ? { hint: field.description }
        : {}),
      required: required.has(name),
      ...(options.length ? { options } : {}),
      ...(kind === "datetime" &&
      (field.type === "integer" || field.type === "number")
        ? { epoch: true }
        : {}),
    });
  }
  // The headline comes first, and is always asked — even when the schema
  // doesn't declare it (a library thing is keyed BY its name, and `id` is
  // otherwise never asked for), because it is the line the cell panel will
  // list this record by.
  const headline =
    fallbackHeadline ??
    HEADLINE_FIELDS.find((h) => fields.some((f) => f.name === h));
  if (!headline) return fields;
  const asked = fields.find((f) => f.name === headline);
  const head: FormField = asked ?? {
    name: headline,
    kind: LONG.has(headline) ? "long" : "text",
    required: true,
  };
  return [head, ...fields.filter((f) => f.name !== headline)];
}

/** Who is adding, and where. */
export type AddContext = {
  /** The record's key — the caller mints it. */
  id: string;
  /** The H3 cell it lands in, which is also the holon it is written to. */
  cell: string;
  /** Creation stamp. Defaults to now. */
  now?: number;
  /** The signed-in editor, when there is one. */
  user?: {
    id: string | number;
    username?: string;
    firstName?: string;
    lastName?: string;
  } | null;
};

/** A stamp in the shape the schema declares for that field. */
function stamp(field: JsonField | undefined, now: number): string | number {
  const type = field?.type ?? "string";
  return type === "number" || type === "integer"
    ? now
    : new Date(now).toISOString();
}

/**
 * Everything about a new record that the moment already knows: its key, when
 * it was made, who made it, the cell it belongs to and where that cell is.
 * Only fields the schema actually declares are filled — `id` always.
 */
export function baseRecord(
  schema: JsonSchema | null,
  ctx: AddContext,
): Record<string, unknown> {
  const props = schema?.properties ?? {};
  const has = (name: string) => name in props;
  const now = ctx.now ?? Date.now();
  const out: Record<string, unknown> = { id: ctx.id };

  const linked = schema?.metadata?.schema?.name;
  if (has("linked_schemas") && linked) out.linked_schemas = [linked];

  for (const name of [
    "created",
    "created_at",
    "createdAt",
    "date",
    "timestamp",
  ])
    if (has(name)) out[name] = stamp(props[name], now);
  for (const name of ["updated", "updated_at"])
    if (has(name)) out[name] = stamp(props[name], now);

  const u = ctx.user;
  if (u) {
    const person = {
      id: u.id,
      ...(u.username ? { username: u.username } : {}),
      ...(u.firstName ? { firstName: u.firstName } : {}),
      ...(u.lastName ? { lastName: u.lastName } : {}),
    };
    for (const name of ["initiator", "user", "from"])
      if (has(name) && (props[name]?.type ?? "object") === "object")
        out[name] = person;
    for (const name of ["createdBy", "creator", "paidBy", "requester"])
      if (has(name) && props[name]?.type === "string") out[name] = String(u.id);
    if (has("createdByUsername") && u.username)
      out.createdByUsername = u.username;
  }

  for (const name of ["holon", "holonId", "chat"])
    if (has(name)) out[name] = ctx.cell;

  const centre = cellPlace(ctx.cell);
  if (centre) {
    const { lat, lon } = centre;
    if (has("geolocation")) out.geolocation = { lat, lon };
    if (has("latitude")) out.latitude = lat;
    if (has("longitude")) out.longitude = lon;
    // The quest/event shape keeps its place in a `where` pair of strings.
    if (has("where") && (props.where?.type ?? "object") === "object")
      out.where = { latitude: String(lat), longitude: String(lon) };
  }
  return out;
}

/** Where a cell sits on the earth, or null when it isn't a cell at all. */
export function cellPlace(cell: string): { lat: number; lon: number } | null {
  if (!isValidCell(cell)) return null;
  const [lat, lon] = cellToLatLng(cell);
  return { lat, lon };
}

/** What the inputs start out holding, read off the base record. */
export function initialValues(
  fields: readonly FormField[],
  base: Record<string, unknown>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    const v = base[f.name];
    if (v == null) {
      values[f.name] =
        f.kind === "checkbox"
          ? false
          : f.kind === "tags" || f.kind === "multi"
            ? []
            : "";
      continue;
    }
    if (f.kind === "datetime") values[f.name] = toLocalInput(v);
    else if (f.kind === "tags" || f.kind === "multi")
      values[f.name] = Array.isArray(v) ? [...v] : [];
    else if (f.kind === "checkbox") values[f.name] = Boolean(v);
    else values[f.name] = String(v);
  }
  return values;
}

/**
 * The form's values with a draft laid over them — as ONE new bag, never by
 * writing into the live one field by field. A per-field write re-runs the
 * field loop mid-flight (Svelte invalidates on every assignment) and the
 * rebuilding `{#each}` throws "f is not defined"; the web dashboard's schema
 * form carries a comment about exactly this. Building the bag here and
 * assigning it once makes that structural rather than a rule to remember.
 *
 * Only asked-for fields land, each in the shape its input holds — an instant
 * comes back from the model as ISO and goes into a `datetime-local` box.
 */
export function applyDraft(
  fields: readonly FormField[],
  values: Record<string, unknown>,
  drafted: Record<string, unknown>,
): { values: Record<string, unknown>; filled: number } {
  const next = { ...values };
  let filled = 0;
  for (const f of fields) {
    if (!(f.name in drafted)) continue;
    const value = drafted[f.name];
    if (value == null) continue;
    next[f.name] = f.kind === "datetime" ? toLocalInput(value) : value;
    filled += 1;
  }
  return { values: next, filled };
}

/** An instant as a `datetime-local` input wants it: `YYYY-MM-DDTHH:mm`. */
export function toLocalInput(value: unknown): string {
  const d =
    typeof value === "number"
      ? new Date(value)
      : typeof value === "string" && value
        ? new Date(value)
        : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The filled-in fields as record fields: instants in the shape their lens
 * stores, numbers as numbers, and nothing at all for a box left empty — an
 * empty string written into a record is a lie the panel then displays.
 */
export function valuesToRecord(
  fields: readonly FormField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = values[f.name];
    if (f.kind === "checkbox") {
      if (raw === true) out[f.name] = true;
      continue;
    }
    if (f.kind === "tags" || f.kind === "multi") {
      const list = Array.isArray(raw) ? raw.filter((v) => v !== "") : [];
      if (list.length) out[f.name] = list;
      continue;
    }
    // A number box hands back a NUMBER (Svelte coerces `bind:value` on
    // `<input type="number">`), and a draft fills one in as a number too —
    // so this kind is read before the string cases, not after them.
    if (f.kind === "number") {
      const n =
        typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
      if (String(raw ?? "").trim() !== "" && Number.isFinite(n))
        out[f.name] = n;
      continue;
    }
    if (typeof raw !== "string" || !raw.trim()) continue;
    const text = raw.trim();
    if (f.kind === "datetime") {
      const d = new Date(text);
      if (Number.isNaN(d.getTime())) continue;
      out[f.name] = f.epoch ? d.getTime() : d.toISOString();
      continue;
    }
    out[f.name] = text;
  }
  return out;
}

/**
 * The same fields, described for the drafting model (@holons/core/drafting):
 * what it may fill in from a sentence someone writes. A URL is asked for as
 * plain text — the model is told never to invent one, and a "url" kind would
 * only invite it to.
 */
export function toDraftFields(fields: readonly FormField[]): DraftField[] {
  const kinds: Record<FieldKind, DraftField["kind"]> = {
    text: "text",
    url: "text",
    long: "long",
    number: "number",
    datetime: "datetime",
    select: "choice",
    checkbox: "boolean",
    tags: "list",
    multi: "list",
  };
  return fields.map((f) => ({
    name: f.name,
    kind: kinds[f.kind],
    ...(f.title ? { label: f.title } : {}),
    ...(f.hint ? { about: f.hint } : {}),
    ...(f.options?.length ? { options: f.options.map((o) => o.value) } : {}),
    ...(f.required ? { required: true } : {}),
  }));
}
