// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Catalog parity and translator mechanics. The `Record<MessageKey, Msg>` type
// on it/es already fails typecheck on a missing/extra key; these specs add
// runtime belt-and-braces plus the checks types can't express: interpolation
// placeholder parity and plural-shape parity across languages.

import { describe, it as spec, expect } from "vitest";
import type { Msg } from "./types";
import { en } from "./en";
import { it } from "./it";
import { es } from "./es";
import { formatMsg, makeTranslator, resolveLang } from "./index";

const CATALOGS: Record<string, Record<string, Msg>> = { it, es };

/** The `{slot}` names used in one branch of a message. */
function slots(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

function branches(msg: Msg): string[] {
  return typeof msg === "string" ? [msg] : [msg.one, msg.other];
}

describe("catalog parity", () => {
  for (const [name, cat] of Object.entries(CATALOGS)) {
    spec(`${name} covers exactly the en key set`, () => {
      expect(Object.keys(cat).sort()).toEqual(Object.keys(en).sort());
    });

    spec(`${name} keeps en's plural shape and {slot} names`, () => {
      for (const [key, ref] of Object.entries(en as Record<string, Msg>)) {
        const msg = cat[key];
        expect(typeof msg, key).toBe(typeof ref);
        // Every branch of a translation may only use slots en declares; the
        // union across branches must cover them all (a language may move a
        // slot between plural branches, but not invent or drop one).
        const refSlots = new Set(branches(ref).flatMap(slots));
        const msgSlots = branches(msg).flatMap(slots);
        for (const s of msgSlots)
          expect(refSlots.has(s), `${key} {${s}}`).toBe(true);
        expect(new Set(msgSlots), key).toEqual(refSlots);
      }
    });
  }
});

describe("formatMsg", () => {
  spec("interpolates named params", () => {
    expect(formatMsg("Pasted “{title}”.", { title: "Fix roof" })).toBe(
      "Pasted “Fix roof”.",
    );
  });

  spec("leaves missing params visible", () => {
    expect(formatMsg("{n} of {m}", { n: 2 })).toBe("2 of {m}");
  });

  spec("picks the plural branch by n", () => {
    const msg: Msg = { one: "{n} entry", other: "{n} entries" };
    expect(formatMsg(msg, { n: 1 })).toBe("1 entry");
    expect(formatMsg(msg, { n: 3 })).toBe("3 entries");
    expect(formatMsg(msg, { n: 0 })).toBe("0 entries");
  });
});

describe("makeTranslator", () => {
  spec("resolves keys per language", () => {
    expect(makeTranslator("en")("settings.language")).toBe("Language");
    expect(makeTranslator("it")("settings.language")).toBe("Lingua");
    expect(makeTranslator("es")("settings.language")).toBe("Idioma");
  });

  spec("falls back to English for a hole in a catalog", () => {
    const holey = makeTranslator("it");
    // Simulate a hole the types would normally forbid.
    delete (it as Record<string, Msg>)["settings.language"];
    try {
      expect(holey("settings.language")).toBe("Language");
    } finally {
      (it as Record<string, Msg>)["settings.language"] = "Lingua";
    }
  });
});

describe("resolveLang", () => {
  spec("pin wins over everything", () => {
    expect(resolveLang("es", "it", "it-IT")).toBe("es");
  });
  spec("auto prefers the holon's language", () => {
    expect(resolveLang("auto", "it", "es-MX")).toBe("it");
  });
  spec("auto falls back to the device locale", () => {
    expect(resolveLang("auto", null, "es-MX")).toBe("es");
    expect(resolveLang("auto", null, "it")).toBe("it");
  });
  spec("unsupported locales land on English", () => {
    expect(resolveLang("auto", null, "fr-FR")).toBe("en");
    expect(resolveLang("auto", null, "")).toBe("en");
  });
});
