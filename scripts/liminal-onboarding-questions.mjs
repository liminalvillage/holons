// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Liminal Village's website questionnaire (../website/src/apply/questions.js)
// → the profile step of Liminal's onboarding (`settings.onboarding`, see
// @holons/core/onboarding). DRY RUN ONLY: it reads the website's module,
// builds the step with core's own normalizing, and writes JSON for review.
// It never opens a relay, never reads a key, never writes a holon.
//
//   node scripts/liminal-onboarding-questions.mjs [questions.js] [out.json]
//
// Defaults: ../website/src/apply/questions.js next to this repo, and
// ./liminal-onboarding.dry.json (OUT=<path> also works).
//
// What it makes: ONE step, id `profile` ("Your application"), with one
// profile card per section of the website form (You, Story, Lunation,
// Contribution). Applied later, that step replaces a step with the same id
// in Liminal's onboarding and keeps every other step as it is.
//
// Every question outside the shared profile catalog is the holon's own and
// so SEALED (only the person and Liminal's admins read the answer). Ikigai
// and LinkedIn are catalog fields but the website asked consent before
// putting them on a public profile, so they are sealed here too. The name
// stays on the person's profile (`first_name`), as everywhere.
//
// What a profile card cannot say (yet): conditional questions. The website
// asks travel questions only of people coming in person, and "Other — tell
// us" only when Other is picked; here those questions are optional. The
// report lists each such loss under `notes`.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(process.argv[2] || resolve(here, '../../website/src/apply/questions.js'));
const OUT = resolve(process.argv[3] || process.env.OUT || 'liminal-onboarding.dry.json');
const LIMINAL = '-1003864542239';

const q = await import(pathToFileURL(SOURCE).href);
const onboarding = await import(new URL('../packages/core/dist/onboarding/index.js', import.meta.url).href);
const { normalizeOnboarding, isSealedField, PROFILE_FIELDS } = onboarding;

/** Options as a profile field keeps them: the website's id as the value. */
const opts = (list, label = (o) => o.label ?? o.value) =>
  list.map((o) => ({ value: o.id ?? o.value, label: label(o), ...(o.hint ? { hint: o.hint } : {}) }));

const notes = [];

// One entry per website answer: its `LABELS` key, the field, and where the
// website's own record (toHolonsRecord) kept it — the same keys, so web and
// Telegram applications read alike.
const SECTIONS = [
  {
    id: 'you',
    title: 'You',
    fields: [
      { from: 'name', key: 'first_name', label: 'What’s your name?', type: 'text', required: true, sealed: false },
      { from: 'email', key: 'email', label: 'E-mail', type: 'text', required: true },
      { from: 'location', key: 'location', label: 'Where are you currently located?', type: 'text', required: true },
      { from: 'age', key: 'age_range', label: 'Age range', type: 'choice', required: true, options: q.AGES.map((a) => ({ value: a, label: a })) },
      { from: 'x', key: 'x', label: 'X', type: 'text', required: false },
      { from: 'linkedin', key: 'linkedin', label: 'LinkedIn', type: 'url', required: false, sealed: true },
      { from: 'website', key: 'website', label: 'Other socials or website', type: 'text', required: false },
      { from: 'socials', key: 'social_links', label: 'Please share any websites and social media profiles', type: 'longtext', required: false },
    ],
  },
  {
    id: 'story',
    title: 'Your story',
    fields: [
      { from: 'role', key: 'role', label: 'Roles in a regenerative network', type: 'multi', required: true, options: opts(q.ROLES) },
      { from: 'roleOther', key: 'role_other', label: 'Other role (if you picked Other)', type: 'text', required: false },
      { from: 'intention', key: 'intention', label: 'What is your intention for visiting?', type: 'longtext', required: true },
      { from: 'ikigai', key: 'ikigai', label: 'Tell us something about yourself. What is your Ikigai?', type: 'longtext', required: false, sealed: true },
      { from: 'background', key: 'background', label: 'Any background you would like to share with us?', type: 'longtext', required: false },
      {
        from: 'community',
        key: 'community_experience',
        label: 'Do you have any experience living in (intentional) communities, cohousing or ecovillages?',
        type: 'longtext',
        required: true,
      },
      {
        from: 'wellbeing',
        key: 'wellbeing',
        label: 'Do you have any current wellbeing conditions (physical, emotional or psychological) we should be aware of?',
        type: 'longtext',
        required: true,
      },
      { from: 'referral', key: 'referral', label: 'Has someone referred you to Liminal Village?', type: 'text', required: false },
    ],
  },
  {
    id: 'lunation',
    title: 'The lunation',
    fields: [
      { from: 'visit', key: 'visit', label: 'Would you like to visit Liminal Village in person?', type: 'choice', required: true, options: opts(q.VISIT) },
      { from: 'arrival', key: 'arrival', label: 'Arrival', type: 'date', required: false, sealed: true },
      { from: 'departure', key: 'departure', label: 'Expected departure', type: 'date', required: false, sealed: true },
      { from: 'transport', key: 'transportation', label: 'How will you travel?', type: 'multi', required: false, options: opts(q.TRANSPORT, (o) => o.value) },
      { from: 'transportOther', key: 'transportation_other', label: 'Other transport', type: 'text', required: false },
      {
        from: 'licence',
        key: 'drivers_license',
        label: 'Do you have a driver’s licence?',
        type: 'choice',
        required: false,
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ],
      },
      { from: 'accommodation', key: 'accommodation', label: 'Where would you sleep?', type: 'choice', required: false, options: opts(q.ACCOMMODATION, (o) => o.value) },
    ],
  },
  {
    id: 'contribution',
    title: 'Contribution',
    fields: [
      {
        from: 'watched',
        key: 'watched',
        label: 'Have you watched the 2030 Vision video?',
        type: 'choice',
        required: false,
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'Not yet' },
        ],
      },
      { from: 'tasks', key: 'tasks', label: 'Which roles or tasks would you take on?', type: 'multi', required: true, options: opts(q.TASKS, (o) => o.value) },
      { from: 'tasksOther', key: 'tasks_other', label: 'Other role or task', type: 'text', required: false },
      { from: 'contribution', key: 'contribution_preference', label: 'How would you like to contribute?', type: 'choice', required: true, options: opts(q.CONTRIBUTIONS) },
      { from: 'contributionOther', key: 'contribution_preference_other', label: 'Other contribution', type: 'text', required: false },
      { from: 'capacity', key: 'capacity', label: 'What is your capacity to contribute?', type: 'longtext', required: true },
    ],
  },
];

// Everything the website asks is mapped (publicProfile is the consent that
// sealing ikigai/LinkedIn answers instead).
const mapped = new Set(SECTIONS.flatMap((s) => s.fields.map((f) => f.from)));
const unmapped = Object.keys(q.LABELS).filter((k) => !mapped.has(k));
for (const k of unmapped)
  notes.push(
    k === 'publicProfile'
      ? 'publicProfile (consent to put ikigai and LinkedIn on the public profile) is dropped: both answers are sealed, so nothing is made public.'
      : `${k} (${q.LABELS[k]}) is not mapped.`,
  );
notes.push('arrival, departure, drivers_license, transportation and accommodation were required for in-person visitors only; a profile card has no conditions, so they are optional.');
notes.push('role_other, transportation_other, tasks_other and contribution_preference_other were required only when "Other" was picked; they are optional text questions.');
notes.push('email: the website validated an e-mail address; here it is a text question (no e-mail type yet).');
notes.push('The website checked departure ≥ arrival; a profile card does not compare two fields.');
notes.push('Applied, this step replaces the step with id "profile" in Liminal’s settings.onboarding and keeps every other step; `enabled` is left as it is.');

const step = {
  id: 'profile',
  title: 'Your application',
  cards: SECTIONS.map((s) => ({
    id: s.id,
    title: s.title,
    confirm: 'profile',
    fields: s.fields.map(({ from: _from, ...f }) => f),
  })),
};

// Core's own rules: what would be stored, exactly.
const normalized = normalizeOnboarding({ enabled: true, steps: [step] });
const stored = normalized.steps[0];
const lost = step.cards.flatMap((c, i) => c.fields.filter((f) => !stored.cards[i]?.fields?.some((g) => g.key === f.key)).map((f) => f.key));
if (lost.length) notes.push(`normalizing dropped: ${lost.join(', ')}`);

const fields = SECTIONS.flatMap((s) =>
  s.fields.map((f) => {
    const kept = stored.cards.find((c) => c.id === s.id)?.fields?.find((g) => g.key === f.key);
    return {
      website: f.from,
      key: f.key,
      card: s.id,
      type: kept?.type ?? null,
      required: kept?.required ?? null,
      options: kept?.options?.length ?? 0,
      sealed: kept ? isSealedField(kept) : null,
      catalog: PROFILE_FIELDS.some((c) => c.key === f.key),
    };
  }),
);

const report = {
  dryRun: true,
  holon: LIMINAL,
  source: SOURCE,
  generated: new Date().toISOString(),
  summary: {
    cards: stored.cards.length,
    fields: fields.length,
    sealed: fields.filter((f) => f.sealed).length,
    public: fields.filter((f) => f.sealed === false).map((f) => f.key),
  },
  step: stored,
  fields,
  notes,
};

writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(`dry run: ${report.summary.cards} cards, ${report.summary.fields} questions (${report.summary.sealed} sealed) → ${OUT}`);
