// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The words of a holon's front page and walk on the dashboard, in English
// and Italian. What the page says is decided in core (`buildHolonFront`);
// this only picks the language. The word is "link", never seat, roster,
// founded or accepted. Gene content is shown in the language it was written
// in — only the chrome is translated.

export type Lang = "en" | "it";

const en = {
  "dna.title": "DNA",
  "dna.apply": "Ask to join",
  "dna.pending": "Request sent: continue",
  "dna.blocked": "The DNA changed: review it",
  "dna.linked": "You're linked",
  "dna.edit": "Edit DNA",
  "dna.people": "{n} people",
  "dna.people1": "1 person",
  "dna.empty": "{holon} hasn't written its DNA yet",
  "dna.write": "Write your DNA",
  "dna.howTitle": "How joining works",
  "dna.howRead": "Read and agree ({k} parts, ~{m} min)",
  "dna.howSend": "Send your request",
  "dna.howLinked": "You're linked",
  "dna.footer": "DNA {short} · updated {date}",
  "dna.living": "A living document, kept by {holon}'s admins",
  "dna.expressedIn": "Expressed in",
  "dna.shownFrom": "From {gene}",
  "dna.termsBadge": "You'll be asked to agree to this",
  "dna.agreeBadge": "Agree",
  "dna.readMore": "Read more",
  "dna.readLess": "Show less",
  "dna.index": "Genes",
  "dna.close": "Close",
  "dna.steps": "Steps",
  "dna.loading": "Reading the DNA…",
  "dna.unreachable": "Couldn't reach {holon}",
  "dna.retry": "Retry",
  "dna.noAdmins":
    "Nobody speaks for {holon} yet, so a request could not be answered.",
  "dna.settingsNote":
    "Purpose, values and agreements are written in the DNA, not here. Open the DNA editor to change them.",
  "dna.settingsEdit": "Open the DNA editor",
  "dna.settingsView": "Read the DNA",
  "walk.intro": "Before asking to join {holon}, walk through its DNA",
  "walk.introDetail": "{k} parts, about {m} min. You can go back at any time.",
  "walk.start": "Start",
  "walk.resume": "Continue",
  "walk.part": "Part {i} of {k}",
  "walk.read": "I've read this",
  "walk.agree": "I agree to {gene}",
  "walk.continue": "Continue",
  "walk.back": "Back",
  "walk.stale": "{gene} changed since you read it",
  "walk.review": "Ready to send",
  "walk.reviewNone": "Ready to ask",
  "walk.reviewDetail": "You went through:",
  "walk.reviewMore": "Go through the parts to review",
  "walk.consent": "I agree to the DNA of {holon} ({short})",
  "walk.name": "Your name",
  "walk.nameHint": "So the admins know who is asking",
  "walk.send": "Send request",
  "walk.sending": "Sending…",
  "walk.sent": "Request sent. Next:",
  "walk.sentNone": "Request sent. An admin will link you.",
  "walk.sentOpen": "Open {holon}",
  "walk.signIn": "Sign in to send your request.",
  "walk.changed":
    "The DNA changed while you were reading. Go through the parts marked again.",
  "walk.failed": "Could not send the request: {reason}",
  "walk.handoff":
    "You arrived with the DNA ({short}) already read. It is still your call: tick the box to agree.",
  "walk.handoffStale":
    "That link was made for an older DNA. Go through the parts again.",
  "walk.pendingTitle": "Your request is in",
  "walk.pendingDetail": "It's waiting for an admin of {holon}.",
  "walk.blockedDetail":
    "The DNA changed since you agreed to it. Go through it again and send a fresh request.",
  "walk.linkedDetail": "Your key is linked to {holon}.",
  "ready.acknowledged": "DNA acknowledged",
  "ready.outdated": "DNA outdated",
  "ready.missing": "DNA not acknowledged",
  "ready.unknown": "DNA not checked",
  "kind.purpose": "Purpose",
  "kind.values": "Values",
  "kind.agreements": "Agreements",
  "kind.practices": "Practices",
  "kind.roles": "Roles",
  "kind.tools": "Tools",
  "kind.terms": "Terms",
  "kind.custom": "Gene",
} as const;

export type CopyKey = keyof typeof en;

const it: Record<CopyKey, string> = {
  "dna.title": "DNA",
  "dna.apply": "Chiedi di unirti",
  "dna.pending": "Richiesta inviata: continua",
  "dna.blocked": "Il DNA è cambiato: rivedilo",
  "dna.linked": "Sei collegato",
  "dna.edit": "Modifica il DNA",
  "dna.people": "{n} persone",
  "dna.people1": "1 persona",
  "dna.empty": "{holon} non ha ancora scritto il suo DNA",
  "dna.write": "Scrivi il vostro DNA",
  "dna.howTitle": "Come ci si unisce",
  "dna.howRead": "Leggi e accetta ({k} parti, ~{m} min)",
  "dna.howSend": "Invia la richiesta",
  "dna.howLinked": "Sei collegato",
  "dna.footer": "DNA {short} · aggiornato il {date}",
  "dna.living": "Un documento vivo, curato dagli admin di {holon}",
  "dna.expressedIn": "Espresso in",
  "dna.shownFrom": "Da {gene}",
  "dna.termsBadge": "Ti verrà chiesto di accettarlo",
  "dna.agreeBadge": "Accetta",
  "dna.readMore": "Leggi di più",
  "dna.readLess": "Mostra meno",
  "dna.index": "Geni",
  "dna.close": "Chiudi",
  "dna.steps": "Passi",
  "dna.loading": "Leggo il DNA…",
  "dna.unreachable": "Non riesco a raggiungere {holon}",
  "dna.retry": "Riprova",
  "dna.noAdmins":
    "Nessuno parla ancora per {holon}: una richiesta non avrebbe risposta.",
  "dna.settingsNote":
    "Scopo, valori e accordi si scrivono nel DNA, non qui. Apri l’editor del DNA per cambiarli.",
  "dna.settingsEdit": "Apri l’editor del DNA",
  "dna.settingsView": "Leggi il DNA",
  "walk.intro": "Prima di chiedere di unirti a {holon}, percorri il suo DNA",
  "walk.introDetail":
    "{k} parti, circa {m} min. Puoi tornare indietro in qualsiasi momento.",
  "walk.start": "Inizia",
  "walk.resume": "Continua",
  "walk.part": "Parte {i} di {k}",
  "walk.read": "Ho letto",
  "walk.agree": "Accetto: {gene}",
  "walk.continue": "Continua",
  "walk.back": "Indietro",
  "walk.stale": "{gene} è cambiato da quando l’hai letto",
  "walk.review": "Pronto per l’invio",
  "walk.reviewNone": "Pronto per chiedere",
  "walk.reviewDetail": "Hai percorso:",
  "walk.reviewMore": "Rivedi le parti segnate",
  "walk.consent": "Accetto il DNA di {holon} ({short})",
  "walk.name": "Il tuo nome",
  "walk.nameHint": "Così gli admin sanno chi chiede",
  "walk.send": "Invia richiesta",
  "walk.sending": "Invio…",
  "walk.sent": "Richiesta inviata. Prossimi passi:",
  "walk.sentNone": "Richiesta inviata. Un admin ti collegherà.",
  "walk.sentOpen": "Apri {holon}",
  "walk.signIn": "Accedi per inviare la richiesta.",
  "walk.changed":
    "Il DNA è cambiato mentre leggevi. Ripercorri le parti segnate.",
  "walk.failed": "Impossibile inviare la richiesta: {reason}",
  "walk.handoff":
    "Sei arrivato con il DNA ({short}) già letto. La scelta resta tua: spunta la casella per accettare.",
  "walk.handoffStale":
    "Quel link era per un DNA precedente. Ripercorri le parti.",
  "walk.pendingTitle": "La tua richiesta è arrivata",
  "walk.pendingDetail": "Aspetta un admin di {holon}.",
  "walk.blockedDetail":
    "Il DNA è cambiato da quando l’hai accettato. Ripercorrilo e invia una nuova richiesta.",
  "walk.linkedDetail": "La tua chiave è collegata a {holon}.",
  "ready.acknowledged": "DNA accettato",
  "ready.outdated": "DNA non aggiornato",
  "ready.missing": "DNA non accettato",
  "ready.unknown": "DNA non verificato",
  "kind.purpose": "Scopo",
  "kind.values": "Valori",
  "kind.agreements": "Accordi",
  "kind.practices": "Pratiche",
  "kind.roles": "Ruoli",
  "kind.tools": "Strumenti",
  "kind.terms": "Condizioni",
  "kind.custom": "Gene",
};

export const CATALOGS: Record<Lang, Record<CopyKey, string>> = { en, it };

/** `it` when the browser's first language that is one of ours is Italian, else `en`. */
export function pickLang(
  preferred: readonly string[] | undefined | null,
): Lang {
  for (const tag of preferred ?? []) {
    const base = String(tag).toLowerCase().split("-")[0];
    if (base === "it") return "it";
    if (base === "en") return "en";
  }
  return "en";
}

/** The words for `key` in `lang`, `{name}` placeholders filled from `vars`. */
export function t(
  lang: Lang,
  key: CopyKey,
  vars: Record<string, string | number> = {},
): string {
  return CATALOGS[lang][key].replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

/** The label of a gene kind. */
export function kindLabel(lang: Lang, kind: string): string {
  const key = `kind.${kind}` as CopyKey;
  return key in en ? t(lang, key) : t(lang, "kind.custom");
}

/** "{n} people", with the singular when it is one. */
export function peopleLabel(lang: Lang, n: number): string {
  return n === 1 ? t(lang, "dna.people1") : t(lang, "dna.people", { n });
}

/** A date for the footer, in the language of the page; '' when `iso` is not a date. */
export function formatDate(lang: Lang, iso: string | null | undefined): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return "";
  return new Date(at).toLocaleDateString(lang === "it" ? "it-IT" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
