/**
 * @fileoverview A member's onboarding "DNA" — the answers the wizard scenes
 * collect (values, category, ikigai, LinkedIn link, hexagon, video,
 * questions, summary, booking dates). One record per user in the user's own personal holon:
 * `<userId>/dna/<userId>`. A group answering as a community gets the same
 * record in its own holon, `<chatId>/dna/<chatId>`, under `community`.
 *
 * The scenes used to write each field straight into the raw graph; every
 * read and write now goes through holosphere so the record is signed,
 * published and readable by every surface.
 *
 * @module src/dna
 */

const LENS = 'dna';

/** What a wizard run leaves on the session that belongs in the DNA. */
const SESSION_FIELDS = [
  'username',
  'first_name',
  'last_name',
  'name',
  'category',
  'values',
  'ikigai',
  'linkedin',
  'hex',
  'arrival',
  'departure',
  'requirements',
  'video',
  'summary',
];

/**
 * The DNA fields a finished wizard run collected — only what was actually
 * answered, so a partial run never blanks a field saved earlier.
 */
export function dnaFromSession(session) {
  const fields = {};
  for (const key of SESSION_FIELDS) {
    if (session[key] !== undefined && session[key] !== null) {
      fields[key] = session[key];
    }
  }
  if (Array.isArray(session.userResponses) && session.userResponses.length) {
    fields.questions = session.userResponses;
  }
  return fields;
}

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

/**
 * Put profile answers from elsewhere (an application the person said may
 * be shown) on their DNA. Marks it public unless they once kept it private:
 * this only adds fields, it never overrides that choice.
 */
export async function publishProfile(db, userId, fields) {
  if (!fields || !Object.keys(fields).length) return false;
  const current = await readDna(db, userId);
  return mergeDna(db, userId, {
    ...fields,
    ...(current?.public === false ? {} : { public: true }),
  });
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
