// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/vocabulary — what a deployment calls a holon.
//
// The domain word is always "holon"; what people READ is a deployment
// choice: hubs.network says "hub", holons.io says "holon", a company install
// may say "team" or "circle". One setting picks the noun —
// `VITE_HOLON_NOUN` in the deployment's `.env` (the bot reads the same key;
// a second bot sets it in its own `.env.<bot>`) — and when it is unset the
// serving host decides (`HOST_NOUNS`), else "holon".
//
// UI copy never hard-codes the noun. It writes `{@…}` tokens that every
// surface fills with `fillHolonNoun` (the kiosk catalog, the bot's i18next
// output, the web helpers):
//
//   {@holon} {@holons} {@Holon} {@Holons}       bare noun, singular/plural
//   {@a_holon} {@A_holon}                       indefinite article + noun
//   {@the_holon} {@The_holon}                   definite article + noun
//   {@the_holons} {@The_holons}                 definite article + plural
//   {@of_the_holon} {@in_the_holon} {@to_the_holon}
//                                               preposition + article (it/es/fr
//                                               fuse them: dell'hub, del hub, au hub)
//   {@g:masc|fem|neut}                          pick by the noun's gender, for
//                                               agreeing words (quest{@g:o|a},
//                                               nuev{@g:o|a}); a missing branch
//                                               falls back to the first
//
// `@` keeps the tokens apart from message parameters: `{holon}` is already a
// parameter (a holon's name) in the catalogs.

/** The nouns with full translations. Any other word is used as given. */
export const HOLON_NOUNS = [
  'holon',
  'hub',
  'circle',
  'team',
  'group',
  'org',
  'company',
  'membrane',
] as const;
export type HolonNounKey = (typeof HOLON_NOUNS)[number];

/** The `.env` key every surface reads. */
export const HOLON_NOUN_ENV = 'VITE_HOLON_NOUN';

/** The noun a host serves when the setting is unset (suffix match). */
export const HOST_NOUNS: Readonly<Record<string, string>> = {
  'hubs.network': 'hub',
  'holons.io': 'holon',
};

export type Gender = 'm' | 'f' | 'n';

/** One noun in one language: forms plus the article-bearing phrases. */
export interface NounForms {
  one: string;
  other: string;
  gender: Gender;
  a: string;
  the: string;
  thePl: string;
  ofThe: string;
  inThe: string;
  toThe: string;
}

type Lang = 'en' | 'it' | 'es' | 'fr' | 'de' | 'ru';

// ── Per-language builders ─────────────────────────────────────────────────

function en(one: string, other: string): NounForms {
  const an = /^[aeio]|^u(?!ni|se|sa)/i.test(one) ? 'an' : 'a';
  return {
    one,
    other,
    gender: 'n',
    a: `${an} ${one}`,
    the: `the ${one}`,
    thePl: `the ${other}`,
    ofThe: `of the ${one}`,
    inThe: `in the ${one}`,
    toThe: `to the ${one}`,
  };
}

/** Italian article class: `il` (m), `lo` (m, s+cons/z/gn/ps/x/y), `l` (vowel or mute h), `la` (f). */
function it(one: string, other: string, gender: 'm' | 'f'): NounForms {
  const vowel = /^[aeiouh]/i.test(one);
  const lo = gender === 'm' && /^(s[^aeiou]|z|gn|ps|x|y)/i.test(one);
  if (gender === 'f') {
    const sing = vowel ? "l'" : 'la ';
    return {
      one,
      other,
      gender,
      a: vowel ? `un'${one}` : `una ${one}`,
      the: `${sing}${one}`,
      thePl: `le ${other}`,
      ofThe: `${vowel ? "dell'" : 'della '}${one}`,
      inThe: `${vowel ? "nell'" : 'nella '}${one}`,
      toThe: `${vowel ? "all'" : 'alla '}${one}`,
    };
  }
  const art = vowel ? "l'" : lo ? 'lo ' : 'il ';
  const pl = vowel || lo ? 'gli ' : 'i ';
  const fuse = (p: string) => (vowel ? `${p}ll'` : lo ? `${p}llo ` : `${p}l `);
  return {
    one,
    other,
    gender,
    a: `${lo ? 'uno' : 'un'} ${one}`,
    the: `${art}${one}`,
    thePl: `${pl}${other}`,
    ofThe: `${fuse('de')}${one}`,
    inThe: `${fuse('ne')}${one}`,
    toThe: `${fuse('a')}${one}`,
  };
}

function es(one: string, other: string, gender: 'm' | 'f'): NounForms {
  const m = gender === 'm';
  return {
    one,
    other,
    gender,
    a: `${m ? 'un' : 'una'} ${one}`,
    the: `${m ? 'el' : 'la'} ${one}`,
    thePl: `${m ? 'los' : 'las'} ${other}`,
    ofThe: `${m ? 'del' : 'de la'} ${one}`,
    inThe: `en ${m ? 'el' : 'la'} ${one}`,
    toThe: `${m ? 'al' : 'a la'} ${one}`,
  };
}

/** French: elides before a vowel or mute h; pass `elide: false` for an aspirated h (le hub). */
function fr(one: string, other: string, gender: 'm' | 'f', elide?: boolean): NounForms {
  const vowel = elide ?? /^[aeiouhàâéèêëîïôûù]/i.test(one);
  const m = gender === 'm';
  const the = vowel ? `l'${one}` : `${m ? 'le' : 'la'} ${one}`;
  return {
    one,
    other,
    gender,
    a: `${m ? 'un' : 'une'} ${one}`,
    the,
    thePl: `les ${other}`,
    ofThe: vowel ? `de l'${one}` : m ? `du ${one}` : `de la ${one}`,
    inThe: `dans ${the}`,
    toThe: vowel ? `à l'${one}` : m ? `au ${one}` : `à la ${one}`,
  };
}

/** German, nominative only (case-inflected sentences rephrase around it). */
function de(one: string, other: string, gender: Gender): NounForms {
  const the = gender === 'm' ? 'der' : gender === 'f' ? 'die' : 'das';
  const a = gender === 'f' ? 'eine' : 'ein';
  const dat = gender === 'f' ? 'der' : 'dem';
  return {
    one,
    other,
    gender,
    a: `${a} ${one}`,
    the: `${the} ${one}`,
    thePl: `die ${other}`,
    ofThe: `von ${dat} ${one}`,
    inThe: `in ${dat} ${one}`,
    toThe: `zu ${dat} ${one}`,
  };
}

/** Russian has no articles; the phrases are the bare nominative. */
function ru(one: string, other: string, gender: Gender): NounForms {
  return {
    one,
    other,
    gender,
    a: one,
    the: one,
    thePl: other,
    ofThe: one,
    inThe: `в ${one}`,
    toThe: one,
  };
}

const TABLE: Record<HolonNounKey, Record<Lang, NounForms>> = {
  holon: {
    en: en('holon', 'holons'),
    it: it('holon', 'holon', 'm'),
    es: es('holón', 'holones', 'm'),
    fr: fr('holon', 'holons', 'm'),
    de: de('Holon', 'Holons', 'n'),
    ru: ru('холон', 'холоны', 'm'),
  },
  hub: {
    en: en('hub', 'hubs'),
    it: it('hub', 'hub', 'm'),
    es: es('hub', 'hubs', 'm'),
    fr: fr('hub', 'hubs', 'm', false),
    de: de('Hub', 'Hubs', 'm'),
    ru: ru('хаб', 'хабы', 'm'),
  },
  circle: {
    en: en('circle', 'circles'),
    it: it('cerchio', 'cerchi', 'm'),
    es: es('círculo', 'círculos', 'm'),
    fr: fr('cercle', 'cercles', 'm'),
    de: de('Kreis', 'Kreise', 'm'),
    ru: ru('круг', 'круги', 'm'),
  },
  team: {
    en: en('team', 'teams'),
    it: it('team', 'team', 'm'),
    es: es('equipo', 'equipos', 'm'),
    fr: fr('équipe', 'équipes', 'f'),
    de: de('Team', 'Teams', 'n'),
    ru: ru('команда', 'команды', 'f'),
  },
  group: {
    en: en('group', 'groups'),
    it: it('gruppo', 'gruppi', 'm'),
    es: es('grupo', 'grupos', 'm'),
    fr: fr('groupe', 'groupes', 'm'),
    de: de('Gruppe', 'Gruppen', 'f'),
    ru: ru('группа', 'группы', 'f'),
  },
  org: {
    en: en('org', 'orgs'),
    it: it('organizzazione', 'organizzazioni', 'f'),
    es: es('organización', 'organizaciones', 'f'),
    fr: fr('organisation', 'organisations', 'f'),
    de: de('Organisation', 'Organisationen', 'f'),
    ru: ru('организация', 'организации', 'f'),
  },
  company: {
    en: en('company', 'companies'),
    it: it('azienda', 'aziende', 'f'),
    es: es('empresa', 'empresas', 'f'),
    fr: fr('entreprise', 'entreprises', 'f'),
    de: de('Unternehmen', 'Unternehmen', 'n'),
    ru: ru('компания', 'компании', 'f'),
  },
  membrane: {
    en: en('membrane', 'membranes'),
    it: it('membrana', 'membrane', 'f'),
    es: es('membrana', 'membranas', 'f'),
    fr: fr('membrane', 'membranes', 'f'),
    de: de('Membran', 'Membranen', 'f'),
    ru: ru('мембрана', 'мембраны', 'f'),
  },
};

const ALIASES: Readonly<Record<string, HolonNounKey>> = {
  organization: 'org',
  organisation: 'org',
};

function isKey(s: string): s is HolonNounKey {
  return (HOLON_NOUNS as readonly string[]).includes(s);
}

/**
 * The noun this deployment uses: the setting when present, else the host's
 * (`HOST_NOUNS`, matched on the host or any parent domain), else "holon".
 * A setting may be a known key (`hub`, `circle`, …) or any other word, used
 * as given — `word/plural` names an irregular plural.
 */
export function resolveHolonNoun(opts: {
  setting?: string | null;
  host?: string | null;
}): string {
  const setting = opts.setting?.trim();
  if (setting) return setting;
  const host = opts.host?.toLowerCase().replace(/:\d+$/, '') ?? '';
  for (const [domain, noun] of Object.entries(HOST_NOUNS)) {
    if (host === domain || host.endsWith(`.${domain}`)) return noun;
  }
  return 'holon';
}

/** The forms of `noun` in `lang` (unknown languages read English). */
export function holonNounForms(noun: string, lang: string): NounForms {
  const l = (['en', 'it', 'es', 'fr', 'de', 'ru'] as const).find(
    (x) => x === lang.slice(0, 2).toLowerCase(),
  ) ?? 'en';
  const raw = noun.trim() || 'holon';
  const lower = raw.toLowerCase();
  const key = isKey(lower) ? lower : ALIASES[lower];
  if (key) return TABLE[key][l];
  // A custom word: the same spelling in every language, plural by `/`.
  const [one, plural] = raw.split('/').map((s) => s.trim());
  const other = plural || `${one}s`;
  switch (l) {
    case 'it':
      return it(one, plural || one, 'm');
    case 'es':
      return es(one, other, 'm');
    case 'fr':
      return fr(one, other, 'm');
    case 'de':
      return de(one, other, 'n');
    case 'ru':
      return ru(one, other, 'm');
    default:
      return en(one, other);
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Every `{@…}` token of one noun in one language, ready to fill. */
export type HolonWords = Readonly<Record<string, string>> & {
  readonly gender: Gender;
};

export function holonWords(noun: string, lang: string): HolonWords {
  const f = holonNounForms(noun, lang);
  return {
    gender: f.gender,
    holon: f.one,
    holons: f.other,
    Holon: cap(f.one),
    Holons: cap(f.other),
    a_holon: f.a,
    A_holon: cap(f.a),
    the_holon: f.the,
    The_holon: cap(f.the),
    the_holons: f.thePl,
    The_holons: cap(f.thePl),
    of_the_holon: f.ofThe,
    in_the_holon: f.inThe,
    to_the_holon: f.toThe,
  };
}

const TOKEN = /\{@(g:[^}]*|[A-Za-z_]+)\}/g;
const GENDER_INDEX: Record<Gender, number> = { m: 0, f: 1, n: 2 };

/** Replace every `{@…}` token in `text`; unknown tokens are left as written. */
export function fillHolonNoun(text: string, words: HolonWords): string {
  if (!text.includes('{@')) return text;
  return text.replace(TOKEN, (whole, body: string) => {
    if (body.startsWith('g:')) {
      const options = body.slice(2).split('|');
      return options[GENDER_INDEX[words.gender]] ?? options[0];
    }
    return body !== 'gender' && words[body] != null ? words[body] : whole;
  });
}
