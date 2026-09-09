// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Matching what someone SAID to what the holon HAS. A spoken reference is
// lossy — transcription splits and joins words, the speaker paraphrases, an
// LLM invents an id from the title — so the match is by word coverage, with a
// clear winner accepted, close calls returned as candidates for a follow-up
// question, and nothing plausible reported as no match. Pure string work,
// shared by the voice server, the kiosk and the MCP tools.

export const normTokens = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9À-ɏ]+/gi, ' ')
    .split(' ')
    .filter(Boolean);

export type FuzzyResult =
  | { id: string; title: string }
  | { candidates: Array<{ id: string; title: string }> }
  | null;

/**
 * Find the item whose title is best covered by the needle (the bogus id plus
 * the user's utterance). Coverage = fraction of the title's words present in
 * the needle; a clear winner is returned, close calls come back as
 * candidates, and no plausible match is null. STT splits and joins compound
 * words ("futurecasting" ⇄ "future casting"), so a title whose squashed form
 * appears whole in the squashed needle counts as fully covered.
 */
export function fuzzyFindByTitle(
  needle: string,
  items: Array<Record<string, unknown>>,
): FuzzyResult {
  const bag = new Set(normTokens(needle));
  const squashedNeedle = normTokens(needle).join('');
  // A short spoken reference ("the kitchen one") covers little of a long
  // title, so the title is also scored by how much of the reference's
  // meaningful words it accounts for.
  const needleWords = meaningfulWords(needle);
  const scored = items
    .map((it) => {
      const title = String(it?.title ?? '');
      const words = normTokens(title);
      const titleSet = new Set(words);
      const coverage =
        it?.id == null || words.length === 0
          ? 0
          : words.filter((w) => bag.has(w)).length / words.length;
      const precision =
        it?.id == null || needleWords.length === 0
          ? 0
          : needleWords.filter((w) => titleSet.has(w)).length / needleWords.length;
      let score = Math.max(coverage, precision);
      const squashedTitle = words.join('');
      // Length floor keeps short titles ("do") from matching everywhere.
      if (
        score < 1 &&
        it?.id != null &&
        squashedTitle.length >= 6 &&
        squashedNeedle.includes(squashedTitle)
      ) {
        score = 1;
      }
      return { id: String(it?.id), title, score };
    })
    .filter((x) => x.score >= 0.6)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  if (scored.length === 1 || scored[0].score - scored[1].score >= 0.25) {
    return { id: scored[0].id, title: scored[0].title };
  }
  return { candidates: scored.slice(0, 3).map(({ id, title }) => ({ id, title })) };
}

/** Words too generic to prove the user meant a particular title. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'for', 'in', 'on', 'at', 'and', 'or', 'my',
  'me', 'it', 'this', 'that', 'task', 'one', 'them', 'him', 'her', 'its',
  'please', 'also', 'then', 'now', 'again', 'instead',
]);

/** Meaningful words — those not on the stopword list. */
export function meaningfulWords(text: string): string[] {
  return normTokens(text).filter((w) => !STOPWORDS.has(w));
}

/**
 * Whether an utterance names any listed item at all — false for pronoun-only
 * follow-ups ("move it to five", "add Marco too") that must resolve against
 * the task in focus rather than by title.
 */
export function namesAnItem(
  utterance: string,
  items: Array<Record<string, unknown>>,
): boolean {
  const found = fuzzyFindByTitle(utterance, items);
  return found != null;
}

/**
 * Cross-check a VALID record id against the user's utterance. A weak model
 * sometimes grabs the wrong (but existing) id from the snapshot — observed
 * live: "move the future casting to tomorrow" → task_update on a valid id
 * titled "clear out external kitchen". Flag it only when the utterance
 * clearly names a DIFFERENT item AND shares not a single meaningful word
 * with the chosen title — pronoun-only follow-ups ("move it to 5") match no
 * title and never trigger, and partial overlap is trusted as intentional.
 */
export function titleMismatch(
  utterance: string,
  chosen: { id: string; title: string },
  items: Array<Record<string, unknown>>,
): { id: string; title: string } | null {
  const found = fuzzyFindByTitle(utterance, items);
  if (!found || !('id' in found) || found.id === chosen.id) return null;
  const bag = new Set(normTokens(utterance));
  const meaningful = meaningfulWords(chosen.title);
  if (meaningful.some((w) => bag.has(w))) return null;
  return found;
}

// ── People ──────────────────────────────────────────────────────────────────

/** The profile fields a person can be recognised by (users lens shape). */
export interface PersonLike {
  id?: string | number;
  username?: string;
  first_name?: string;
  last_name?: string;
  /** camelCase twins, as participant records carry them. */
  firstName?: string;
  lastName?: string;
  [key: string]: unknown;
}

export interface PersonMatch {
  id: string;
  name: string;
  person: PersonLike;
}

export type PersonResult =
  | { match: PersonMatch }
  | { candidates: PersonMatch[] }
  | null;

/** "First Last", else "@username", else "#id" — how UIs label a person. */
export function personLabel(p: PersonLike): string {
  const full = [p.first_name ?? p.firstName, p.last_name ?? p.lastName]
    .filter((s) => typeof s === 'string' && s.trim())
    .join(' ');
  if (full) return full;
  if (p.username) return `@${String(p.username).replace(/^@/, '')}`;
  return `#${String(p.id ?? '')}`;
}

/**
 * Find the person a spoken reference means. Scores each profile by how many of
 * the reference's words hit its first name, last name or handle (whole-word,
 * case-insensitive, "@" ignored) plus a prefix hit for a name said in short
 * ("Rob" → Roberto). One clear winner is returned; two people sharing a first
 * name come back as candidates so the caller can ask which.
 */
export function matchPerson(ref: string, people: PersonLike[]): PersonResult {
  const words = normTokens(ref.replace(/@/g, ' '));
  if (words.length === 0) return null;
  const scored = people
    .filter((p) => p?.id != null)
    .map((p) => {
      const parts = [
        p.first_name ?? p.firstName,
        p.last_name ?? p.lastName,
        p.username,
      ]
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .flatMap((s) => normTokens(s.replace(/^@/, '')));
      let score = 0;
      for (const w of words) {
        if (parts.includes(w)) score += 1;
        else if (w.length >= 3 && parts.some((part) => part.startsWith(w))) score += 0.6;
      }
      return { id: String(p.id), name: personLabel(p), person: p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  const strip = ({ id, name, person }: (typeof scored)[number]): PersonMatch => ({
    id,
    name,
    person,
  });
  if (scored.length === 1 || scored[0].score - scored[1].score >= 0.5) {
    return { match: strip(scored[0]) };
  }
  return { candidates: scored.slice(0, 3).map(strip) };
}
