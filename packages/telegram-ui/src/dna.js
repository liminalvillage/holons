/**
 * @fileoverview A member's onboarding "DNA" — the answers the wizard scenes
 * collect (values, category, location, hexagon, video, questions, summary,
 * booking dates). One record per user in the user's own personal holon:
 * `<userId>/dna/<userId>`.
 *
 * The scenes used to write each field straight into the raw graph; every
 * read and write now goes through holosphere so the record is signed,
 * published and readable by every surface.
 *
 * @module src/dna
 */

const LENS = 'dna';

/** The user's DNA record, or null when none exists yet. */
export async function readDna(db, userId) {
  const id = String(userId);
  try {
    const rec = await db.get(id, LENS, id);
    return rec && !rec._deleted ? rec : null;
  } catch {
    return null;
  }
}

/** Merge `fields` into the user's DNA (creating the record on first write). */
export async function mergeDna(db, userId, fields) {
  const id = String(userId);
  try {
    const current = (await readDna(db, id)) || {};
    await db.put(id, LENS, { ...current, ...fields, id });
    return true;
  } catch (e) {
    console.warn('[dna] write failed:', e?.message);
    return false;
  }
}

/** Delete the user's DNA record. */
export async function clearDna(db, userId) {
  const id = String(userId);
  try {
    await db.delete(id, LENS, id);
    return true;
  } catch (e) {
    console.warn('[dna] delete failed:', e?.message);
    return false;
  }
}
