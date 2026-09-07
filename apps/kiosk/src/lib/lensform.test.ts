// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The map's add form as data: what each lens's real schema asks a person for,
// what the moment fills in without asking, and what the answers become. The
// schemas are the shipped ones — a field library change that would empty a
// form fails here rather than on a wall display.

import { describe, it, expect } from "vitest";
import { cellToLatLng } from "h3-js";
import {
  applyDraft,
  baseRecord,
  formFields,
  initialValues,
  optionsFromDescription,
  prettyField,
  toDraftFields,
  toLocalInput,
  valuesToRecord,
  type FormField,
} from "./lensform";
import { canAddToCell, headlineField, LENSES, type LensId } from "./maplens";
import { hasLensSchema, loadLensSchema } from "./schemas";

const CELL = "8a2a1072b59ffff"; // somewhere over New York
const USER = { id: 42, username: "ada", firstName: "Ada", lastName: "L" };
const NOW = Date.UTC(2026, 8, 7, 10, 30);

const byName = (fields: FormField[]) =>
  Object.fromEntries(fields.map((f) => [f.name, f]));

describe("field naming", () => {
  it("spaces a field name out for reading", () => {
    expect(prettyField("primary_url")).toBe("Primary url");
    expect(prettyField("returnBy")).toBe("Return By");
  });

  it("reads options out of the prose that spells them, and nothing else", () => {
    expect(optionsFromDescription("tool | book | equipment | other")).toEqual([
      "tool",
      "book",
      "equipment",
      "other",
    ]);
    expect(optionsFromDescription("Telegram file_id or URL.")).toEqual([]);
    expect(optionsFromDescription("A name | of a Thing")).toEqual([]);
    expect(optionsFromDescription(undefined)).toEqual([]);
  });
});

describe("every addable lens", () => {
  const addable = LENSES.map((l) => l.id).filter(canAddToCell);

  it("has a schema to build a form from", () => {
    for (const lens of addable) expect(hasLensSchema(lens), lens).toBe(true);
  });

  it("asks for its headline first", async () => {
    for (const lens of addable) {
      const schema = await loadLensSchema(lens);
      const fields = formFields(schema, headlineField(lens));
      expect(fields[0]?.name, lens).toBe(headlineField(lens));
      // An announcement is only ever its text, and a canvas only its name —
      // everything else on those records is the moment's to fill in.
      const least = lens === "announcements" || lens === "canvases" ? 1 : 2;
      expect(fields.length, lens).toBeGreaterThanOrEqual(least);
    }
  });

  it("never asks for the graph's bookkeeping, nor for a shape nobody can type", async () => {
    for (const lens of addable) {
      const schema = await loadLensSchema(lens);
      const names = formFields(schema, headlineField(lens)).map((f) => f.name);
      // A library thing is the exception: it is keyed BY its name, so `id`
      // is exactly what it asks for.
      for (const hidden of [
        ...(lens === "library" ? [] : ["id"]),
        "linked_schemas",
        "created",
        "date",
        "initiator",
        "geolocation",
        "latitude",
        "participants",
        "_hologram",
        "where",
      ])
        expect(names, `${lens} asks for ${hidden}`).not.toContain(hidden);
    }
  });

  it("fills in the key, the stamp, the person and the place without asking", async () => {
    for (const lens of addable) {
      const schema = await loadLensSchema(lens);
      const base = baseRecord(schema, {
        id: "n1",
        cell: CELL,
        now: NOW,
        user: USER,
      });
      expect(base.id, lens).toBe("n1");
      const asked = new Set(
        formFields(schema, headlineField(lens)).map((f) => f.name),
      );
      // Nothing is both prefilled and asked for — that is the whole contract,
      // save for the key a library thing is named by.
      for (const key of Object.keys(base)) {
        if (lens === "library" && key === "id") continue;
        expect(asked.has(key), `${lens}: ${key}`).toBe(false);
      }
    }
  });
});

describe("a project (a Murmurations profile, all $ref fields)", () => {
  it("still asks for the profile's own fields", async () => {
    const schema = await loadLensSchema("projects");
    const fields = byName(formFields(schema, headlineField("projects")));
    expect(Object.keys(fields)[0]).toBe("name");
    expect(fields.description.kind).toBe("long");
    expect(fields.primary_url.kind).toBe("url");
    expect(fields.tags.kind).toBe("tags");
    expect(fields.geographic_scope.kind).toBe("select");
    expect(fields.geographic_scope.options?.map((o) => o.value)).toEqual([
      "local",
      "regional",
      "national",
      "international",
    ]);
    expect(fields.status.kind).toBe("select");
    expect(fields.founding_date).toMatchObject({
      kind: "datetime",
      epoch: true,
    });
    // Objects and lists of objects have no honest input.
    expect(fields.urls).toBeUndefined();
    expect(fields.relationships).toBeUndefined();
  });

  it("stamps the profile with its schema name and the cell's coordinates", async () => {
    const schema = await loadLensSchema("projects");
    const base = baseRecord(schema, {
      id: "p1",
      cell: CELL,
      now: NOW,
      user: USER,
    });
    const [lat, lon] = cellToLatLng(CELL);
    expect(base.linked_schemas).toEqual(["projects_schema-v0.1.0"]);
    expect(base.geolocation).toEqual({ lat, lon });
  });
});

describe("a task", () => {
  it("asks for what a person decides and nothing the board manages", async () => {
    const schema = await loadLensSchema("quests");
    const fields = byName(formFields(schema, "title"));
    expect(Object.keys(fields)[0]).toBe("title");
    expect(fields.when.kind).toBe("datetime");
    expect(fields.category.kind).toBe("text");
    // `status` and `type` are core's to set (createTask), and the schema
    // offers no choice for them — so they are never a free text box.
    expect(fields.status).toBeUndefined();
    expect(fields.type).toBeUndefined();
  });

  it("is stamped ISO, because that is how the ecosystem reads `created`", async () => {
    const schema = await loadLensSchema("quests");
    const base = baseRecord(schema, {
      id: "q1",
      cell: CELL,
      now: NOW,
      user: USER,
    });
    expect(base.created).toBe(new Date(NOW).toISOString());
    expect(base.initiator).toEqual({
      id: 42,
      username: "ada",
      firstName: "Ada",
      lastName: "L",
    });
    // `holon` and `where` are not in core's quest schema even though
    // createTask writes them — the form seeds a task with createTask and
    // fills its `where` from the cell, so the base doesn't carry either.
    expect(base.holon).toBeUndefined();
    expect(base.where).toBeUndefined();
  });
});

describe("an announcement", () => {
  it("asks for the text and takes the rest from the moment", async () => {
    const schema = await loadLensSchema("announcements");
    const fields = formFields(schema, headlineField("announcements"));
    expect(fields.map((f) => f.name)).toEqual(["content"]);
    expect(fields[0].kind).toBe("long");
    const base = baseRecord(schema, {
      id: "a1",
      cell: CELL,
      now: NOW,
      user: USER,
    });
    expect(base.user).toMatchObject({ id: 42, username: "ada" });
    expect(base.date).toBe(new Date(NOW).toISOString());
    expect(base.chat).toBe(CELL);
  });
});

describe("a library thing", () => {
  it("is named by its key, and takes its kind from the schema's prose", async () => {
    const schema = await loadLensSchema("library");
    const all = formFields(schema, headlineField("library"));
    expect(all[0]).toEqual({ name: "id", kind: "text", required: true });
    const fields = byName(all);
    expect(fields.type.kind).toBe("select");
    expect(fields.type.options?.map((o) => o.value)).toEqual([
      "tool",
      "book",
      "equipment",
      "other",
    ]);
    expect(fields.value.kind).toBe("number");
    expect(fields.borrower).toBeUndefined(); // lending's business, not the map's
  });

  it("stamps `created` as the string this lens declares", async () => {
    const schema = await loadLensSchema("library");
    const base = baseRecord(schema, {
      id: "l1",
      cell: CELL,
      now: NOW,
      user: USER,
    });
    expect(base.created).toBe(new Date(NOW).toISOString());
    expect(base.createdBy).toBe("42");
    expect(base.createdByUsername).toBe("ada");
  });
});

describe("an expense", () => {
  it("asks for the figures and nobody's identity", async () => {
    const schema = await loadLensSchema("expenses");
    const fields = byName(formFields(schema, "description"));
    expect(Object.keys(fields)[0]).toBe("description");
    expect(fields.amount).toMatchObject({ kind: "number", required: true });
    expect(fields.currency).toMatchObject({ kind: "text", required: true });
    expect(fields.paidBy).toBeUndefined();
    const base = baseRecord(schema, {
      id: "e1",
      cell: CELL,
      now: NOW,
      user: USER,
    });
    expect(base.paidBy).toBe("42"); // …because the adder paid, unasked
  });
});

describe("answers back into a record", () => {
  const fields: FormField[] = [
    { name: "title", kind: "text", required: true },
    { name: "amount", kind: "number", required: false },
    { name: "when", kind: "datetime", required: false },
    { name: "date", kind: "datetime", required: false, epoch: true },
    { name: "tags", kind: "tags", required: false },
    { name: "open", kind: "checkbox", required: false },
  ];

  it("keeps what was filled in, in the shape its lens stores", () => {
    const record = valuesToRecord(fields, {
      title: "  Orchard  ",
      amount: "12.5",
      when: "2026-09-07T10:30",
      date: "2026-09-07T10:30",
      tags: ["food", ""],
      open: true,
    });
    expect(record.title).toBe("Orchard");
    expect(record.amount).toBe(12.5);
    expect(record.when).toBe(new Date("2026-09-07T10:30").toISOString());
    expect(record.date).toBe(new Date("2026-09-07T10:30").getTime());
    expect(record.tags).toEqual(["food"]);
    expect(record.open).toBe(true);
  });

  it("takes a number as a number — which is what the input hands back", () => {
    // `bind:value` on <input type="number"> writes a number, not a string,
    // and so does a drafted value.
    const record = valuesToRecord(fields, { title: "t", amount: 12.5 });
    expect(record).toEqual({ title: "t", amount: 12.5 });
  });

  it("writes nothing at all for a box left alone", () => {
    const record = valuesToRecord(fields, {
      title: "Orchard",
      amount: "",
      when: "",
      tags: [],
      open: false,
    });
    expect(record).toEqual({ title: "Orchard" });
  });

  it("drops an unreadable number or date rather than storing NaN", () => {
    const record = valuesToRecord(fields, {
      title: "t",
      amount: "twelve",
      when: "not a date",
    });
    expect(record).toEqual({ title: "t" });
  });

  it("starts the inputs on what the base record already knows", () => {
    const values = initialValues(fields, {
      title: "Seeded",
      when: NOW,
      tags: ["a"],
    });
    expect(values.title).toBe("Seeded");
    expect(values.when).toBe(toLocalInput(NOW));
    expect(values.tags).toEqual(["a"]);
    expect(values.amount).toBe("");
    expect(values.open).toBe(false);
  });
});

describe("with no schema at all", () => {
  it("still asks for the headline, so an add is never blocked", () => {
    expect(formFields(null, "title")).toEqual([
      { name: "title", kind: "text", required: true },
    ]);
    expect(formFields(null, null)).toEqual([]);
  });

  it("has no schema for the lenses the map doesn't add to", () => {
    for (const lens of ["appreciations", "rea_events"] as LensId[])
      expect(hasLensSchema(lens), lens).toBe(false);
  });
});

describe("describing it instead of filling it in", () => {
  it("hands the drafting model every field, in terms it can answer", async () => {
    const schema = await loadLensSchema("projects");
    const fields = formFields(schema, headlineField("projects"));
    const draft = Object.fromEntries(
      toDraftFields(fields).map((f) => [f.name, f]),
    );
    expect(Object.keys(draft)).toEqual(fields.map((f) => f.name));
    expect(draft.name.kind).toBe("text");
    expect(draft.description.kind).toBe("long");
    // A URL is asked for as plain text: the model is told never to invent
    // one, and a "url" kind would only invite it to.
    expect(draft.primary_url.kind).toBe("text");
    expect(draft.tags.kind).toBe("list");
    expect(draft.geographic_scope).toMatchObject({
      kind: "choice",
      options: ["local", "regional", "national", "international"],
    });
    expect(draft.founding_date.kind).toBe("datetime");
  });

  it("maps every kind a form can render", () => {
    const kinds = toDraftFields([
      { name: "a", kind: "text", required: false },
      { name: "b", kind: "url", required: false },
      { name: "c", kind: "long", required: false },
      { name: "d", kind: "number", required: false },
      { name: "e", kind: "datetime", required: false },
      { name: "f", kind: "select", required: false },
      { name: "g", kind: "checkbox", required: false },
      { name: "h", kind: "tags", required: false },
      { name: "i", kind: "multi", required: false },
    ]).map((f) => f.kind);
    expect(kinds).toEqual([
      "text",
      "text",
      "long",
      "number",
      "datetime",
      "choice",
      "boolean",
      "list",
      "list",
    ]);
  });
});

describe("laying a draft over the form", () => {
  const fields: FormField[] = [
    { name: "title", kind: "text", required: true },
    { name: "amount", kind: "number", required: false },
    { name: "when", kind: "datetime", required: false },
    { name: "tags", kind: "tags", required: false },
  ];

  it("returns a NEW bag rather than writing into the live one", () => {
    // Writing field by field re-runs the form's {#each} mid-flight, which
    // throws "f is not defined" — so the merge must never touch `values`.
    const values = { title: "", amount: "", when: "", tags: [] };
    const { values: next, filled } = applyDraft(fields, values, {
      title: "Orchard",
      amount: 12.5,
    });
    expect(next).not.toBe(values);
    expect(values).toEqual({ title: "", amount: "", when: "", tags: [] });
    expect(next).toMatchObject({ title: "Orchard", amount: 12.5 });
    expect(filled).toBe(2);
  });

  it("puts an instant in the shape the date box holds", () => {
    const iso = new Date(NOW).toISOString();
    const { values: next } = applyDraft(fields, {}, { when: iso });
    expect(next.when).toBe(toLocalInput(iso));
  });

  it("keeps what the draft was silent about, and ignores what nobody asked for", () => {
    const { values: next, filled } = applyDraft(
      fields,
      { title: "Typed by hand", tags: ["kept"] },
      { amount: null, secret: "x" },
    );
    expect(next).toEqual({ title: "Typed by hand", tags: ["kept"] });
    expect(filled).toBe(0);
  });
});
