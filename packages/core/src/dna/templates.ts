// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The starter DNA: the seven standard genes with a blurb and suggested
// alleles each, in English and Italian. An admin starts from these and
// rewrites them; nothing is stored until they save.
//
// It carries over the old default values, tools and practices; their emoji
// became semantic icon keys (`./icons.ts`).

import type { AlleleIcon } from './icons.js';
import { GENE_KIND_DEFAULTS, type Allele, type Gene, type GeneKind } from './types.js';

export type StarterLang = 'en' | 'it';
export const STARTER_LANGS: readonly StarterLang[] = Object.freeze(['en', 'it']);

type T = Record<StarterLang, string>;

interface StarterAllele {
  id: string;
  icon?: AlleleIcon;
  title: T;
  body: T;
}

interface StarterGene {
  id: string;
  kind: GeneKind;
  color: string;
  title: T;
  blurb: T;
  alleles: StarterAllele[];
}

const a = (id: string, icon: AlleleIcon | undefined, en: [string, string], it: [string, string]): StarterAllele => ({
  id,
  ...(icon ? { icon } : {}),
  title: { en: en[0], it: it[0] },
  body: { en: en[1], it: it[1] },
});

const STARTER: readonly StarterGene[] = [
  {
    id: 'purpose',
    kind: 'purpose',
    color: '#0f766e',
    title: { en: 'Purpose', it: 'Scopo' },
    blurb: {
      en: 'Why this holon exists, in two or three sentences: what it cares for, for whom, and what changes because it is here.',
      it: 'Perché esiste questo holon, in due o tre frasi: di cosa si prende cura, per chi, e cosa cambia perché c’è.',
    },
    alleles: [],
  },
  {
    id: 'values',
    kind: 'values',
    color: '#b45309',
    title: { en: 'Values', it: 'Valori' },
    blurb: {
      en: 'What we hold on to when choices get hard. Joining means agreeing to live by these.',
      it: 'Ciò a cui ci teniamo quando le scelte si fanno difficili. Entrare significa impegnarsi a viverli.',
    },
    alleles: [
      a('everyone-contributes', 'people',
        ['Everyone Contributes', 'We believe all voices matter and everyone has valuable insights to contribute to our collective intelligence.'],
        ['Tutti contribuiscono', 'Crediamo che ogni voce conti e che ognuno abbia qualcosa di prezioso da portare alla nostra intelligenza collettiva.']),
      a('self-organization', 'network',
        ['Self-Organization', 'We trust in distributed decision-making and emergent solutions over top-down control.'],
        ['Auto-organizzazione', 'Ci fidiamo delle decisioni distribuite e delle soluzioni che emergono, più che del controllo dall’alto.']),
      a('radical-inclusion', 'heart',
        ['Radical Inclusion', 'We actively create spaces where all people feel welcomed, valued, and able to fully participate.'],
        ['Inclusione radicale', 'Creiamo attivamente spazi in cui tutte le persone si sentano accolte, valorizzate e libere di partecipare pienamente.']),
      a('trust-and-safety', 'shield',
        ['Trust & Safety', 'We cultivate psychological safety where people can take risks, be vulnerable, and speak truth.'],
        ['Fiducia e sicurezza', 'Coltiviamo una sicurezza psicologica in cui si possa rischiare, mostrarsi vulnerabili e dire la verità.']),
      a('commons-stewardship', 'seedling',
        ['Commons Stewardship', 'We share resources generously and care for what we create together as common wealth.'],
        ['Cura dei beni comuni', 'Condividiamo le risorse con generosità e ci prendiamo cura di ciò che creiamo insieme come ricchezza comune.']),
      a('continuous-learning', 'book',
        ['Continuous Learning', 'We embrace experimentation, learn from failure, and adapt based on what emerges.'],
        ['Apprendimento continuo', 'Sperimentiamo, impariamo dagli errori e ci adattiamo a ciò che emerge.']),
      a('power-sharing', 'balance',
        ['Power Sharing', 'We distribute authority, rotate leadership, and actively counter concentrations of power.'],
        ['Condivisione del potere', 'Distribuiamo l’autorità, facciamo ruotare la guida e contrastiamo attivamente le concentrazioni di potere.']),
      a('wholeness', 'spa',
        ['Wholeness', 'We honor the full humanity of each person and integrate personal growth with collective purpose.'],
        ['Interezza', 'Onoriamo l’umanità piena di ogni persona e intrecciamo la crescita personale con lo scopo comune.']),
      a('gift-economy', 'gift',
        ['Gift Economy', 'We recognize abundance, practice reciprocity, and contribute based on capacity and passion.'],
        ['Economia del dono', 'Riconosciamo l’abbondanza, pratichiamo la reciprocità e contribuiamo secondo capacità e passione.']),
      a('local-wisdom', 'earth',
        ['Local Wisdom', 'We honor indigenous knowledge, place-based practices, and cultural diversity.'],
        ['Saggezza locale', 'Onoriamo i saperi indigeni, le pratiche legate ai luoghi e la diversità culturale.']),
    ],
  },
  {
    id: 'agreements',
    kind: 'agreements',
    color: '#7c3aed',
    title: { en: 'Agreements', it: 'Accordi' },
    blurb: {
      en: 'The commitments we make to each other. Anyone may propose a change; until then, we keep them.',
      it: 'Gli impegni che prendiamo l’uno con l’altro. Chiunque può proporre di cambiarli; finché non cambiano, li rispettiamo.',
    },
    alleles: [
      a('decide-by-consent', 'check',
        ['Decide by consent', 'Decisions that affect everyone pass when nobody has a reasoned objection, not when everybody is enthusiastic.'],
        ['Decidere per consenso', 'Le decisioni che riguardano tutti passano quando nessuno ha un’obiezione motivata, non quando tutti sono entusiasti.']),
      a('speak-to-the-person', 'chat',
        ['Speak to the person', 'A concern about someone goes to them first, directly and kindly, before it goes anywhere else.'],
        ['Parlare con la persona', 'Una preoccupazione su qualcuno va prima a quella persona, in modo diretto e gentile, e solo dopo altrove.']),
      a('keep-commitments-visible', 'target',
        ['Keep commitments visible', 'What we take on is written down as a task with a name on it, and released openly when we cannot do it.'],
        ['Impegni visibili', 'Ciò che ci prendiamo in carico è scritto come attività con un nome, e lo si lascia apertamente quando non si riesce a farlo.']),
      a('leave-it-better', 'broom',
        ['Leave it better', 'Shared spaces and tools are left cleaner and in better order than we found them.'],
        ['Lasciarlo meglio', 'Spazi e strumenti comuni si lasciano più puliti e in ordine di come li abbiamo trovati.']),
    ],
  },
  {
    id: 'practices',
    kind: 'practices',
    color: '#be185d',
    title: { en: 'Practices', it: 'Pratiche' },
    blurb: {
      en: 'What we actually do, week after week, to stay a living group.',
      it: 'Ciò che facciamo davvero, settimana dopo settimana, per restare un gruppo vivo.',
    },
    alleles: [
      a('weekly-community-calls', 'phone',
        ['Weekly Community Calls', 'We gather weekly to share updates, align on priorities, and strengthen connections across the network.'],
        ['Incontro settimanale', 'Ci ritroviamo ogni settimana per aggiornarci, allinearci sulle priorità e rafforzare i legami nella rete.']),
      a('monthly-retrospectives', 'search',
        ['Monthly Retrospectives', 'Once a month we look back on what worked, what did not, and what we change next.'],
        ['Retrospettiva mensile', 'Una volta al mese guardiamo indietro a cosa ha funzionato, cosa no, e cosa cambiamo.']),
      a('rotating-facilitation', 'cycle',
        ['Rotating Facilitation', 'Leadership and facilitation roles rotate regularly to distribute power and build collective capacity.'],
        ['Facilitazione a rotazione', 'I ruoli di guida e facilitazione ruotano regolarmente per distribuire il potere e far crescere le capacità di tutti.']),
      a('documentation-first', 'pencil',
        ['Documentation First', 'We document decisions, processes, and knowledge transparently for continuity and shared understanding.'],
        ['Prima la documentazione', 'Documentiamo decisioni, processi e conoscenze in modo trasparente, per continuità e comprensione condivisa.']),
      a('open-source-everything', 'code',
        ['Open Source Everything', 'We share our work openly and contribute to the commons whenever possible, building on collective intelligence.'],
        ['Tutto open source', 'Condividiamo apertamente il nostro lavoro e contribuiamo ai beni comuni ogni volta che possiamo.']),
      a('celebration-rituals', 'star',
        ['Celebration Rituals', 'We mark milestones, arrivals and departures together, and thank each other out loud.'],
        ['Rituali di celebrazione', 'Festeggiamo insieme traguardi, arrivi e partenze, e ci ringraziamo ad alta voce.']),
      a('skill-sharing-sessions', 'teach',
        ['Skill Sharing Sessions', 'Members regularly teach and learn from each other to build collective capacity and cross-pollinate knowledge.'],
        ['Scambio di competenze', 'Ci insegniamo e impariamo a vicenda con regolarità, per far crescere le capacità comuni e incrociare i saperi.']),
      a('regenerative-economics', 'leaf',
        ['Regenerative Economics', 'We practice economic models that regenerate rather than extract, using gift economy and solidarity principles.'],
        ['Economia rigenerativa', 'Pratichiamo modelli economici che rigenerano invece di estrarre, con principi di dono e solidarietà.']),
      a('non-violent-communication', 'handshake',
        ['Non-Violent Communication', 'We communicate with empathy, honesty, and respect using NVC practices in all our interactions.'],
        ['Comunicazione nonviolenta', 'Comunichiamo con empatia, onestà e rispetto, usando la CNV in tutte le nostre interazioni.']),
      a('consensus-workshops', 'community',
        ['Consensus Workshops', 'We facilitate collaborative workshops to align on vision and strategy using consent-based decision making.'],
        ['Laboratori di consenso', 'Facilitiamo laboratori collaborativi per allinearci su visione e strategia decidendo per consenso.']),
    ],
  },
  {
    id: 'roles',
    kind: 'roles',
    color: '#1d4ed8',
    title: { en: 'Roles', it: 'Ruoli' },
    blurb: {
      en: 'The roles that keep the holon running. Anyone may take one on; each is held for a while, then passed on.',
      it: 'I ruoli che fanno funzionare l’holon. Chiunque può prenderne uno; ognuno si tiene per un periodo, poi si passa.',
    },
    alleles: [
      a('facilitator', 'chat',
        ['Facilitator', 'Holds the space in meetings: keeps time, makes sure every voice is heard, and closes with clear next steps.'],
        ['Facilitatore', 'Custodisce lo spazio negli incontri: tiene i tempi, fa sì che ogni voce sia ascoltata e chiude con passi chiari.']),
      a('steward', 'home',
        ['Steward', 'Looks after the shared spaces and things, and notices what needs care before it breaks.'],
        ['Custode', 'Si prende cura degli spazi e delle cose comuni, e nota ciò che ha bisogno di attenzione prima che si rompa.']),
      a('treasurer', 'coins',
        ['Treasurer', 'Keeps the shared money in the open: what came in, what went out, and what is owed.'],
        ['Tesoriere', 'Tiene i soldi comuni alla luce del sole: cosa è entrato, cosa è uscito e cosa si deve.']),
      a('welcomer', 'hand',
        ['Welcomer', 'The first contact for someone new: answers questions and walks them through joining.'],
        ['Accoglienza', 'Il primo contatto per chi arriva: risponde alle domande e accompagna nell’ingresso.']),
    ],
  },
  {
    id: 'tools',
    kind: 'tools',
    color: '#4d7c0f',
    title: { en: 'Tools', it: 'Strumenti' },
    blurb: {
      en: 'Methods we reach for when we meet, decide and learn together.',
      it: 'I metodi a cui ricorriamo quando ci incontriamo, decidiamo e impariamo insieme.',
    },
    alleles: [
      a('1-2-4-all', 'people',
        ['1-2-4-All', 'Engage everyone simultaneously in generating questions, ideas, and suggestions through progressive rounds.'],
        ['1-2-4-Tutti', 'Coinvolge tutti allo stesso tempo nel generare domande, idee e proposte, per giri successivi.']),
      a('troika-consulting', 'handshake',
        ['Troika Consulting', 'Get practical and imaginative help from colleagues in small groups to solve challenges.'],
        ['Consulenza a tre', 'Ricevere aiuto pratico e creativo da altri, in piccoli gruppi, per affrontare una sfida.']),
      a('wise-crowds', 'idea',
        ['Wise Crowds', 'Tap collective intelligence to generate innovative ideas and strategies efficiently.'],
        ['Folle sagge', 'Attingere all’intelligenza collettiva per generare idee e strategie nuove in poco tempo.']),
      a('open-space-technology', 'earth',
        ['Open Space Technology', 'Liberate action and leadership in groups of any size through self-organizing.'],
        ['Open Space Technology', 'Liberare azione e iniziativa in gruppi di ogni dimensione attraverso l’auto-organizzazione.']),
      a('sociocracy', 'cycle',
        ['Sociocracy (Consent)', 'Make decisions using consent-based governance through circle structures.'],
        ['Sociocrazia (consenso)', 'Prendere decisioni con una governance basata sul consenso, organizzata in cerchi.']),
      a('triz', 'warning',
        ['TRIZ', 'Stop counterproductive activities by making the impossible possible.'],
        ['TRIZ', 'Smettere le attività controproducenti immaginando come ottenere il peggio, e poi evitarlo.']),
      a('what-so-what-now-what', 'search',
        ['What, So What, Now What?', 'Together look back on progress and decide on next steps.'],
        ['Cosa, e quindi, e adesso?', 'Guardare insieme ai progressi fatti e decidere i prossimi passi.']),
      a('appreciative-inquiry', 'star',
        ['Appreciative Inquiry', 'Discover and amplify what works well by asking positive questions.'],
        ['Indagine apprezzativa', 'Scoprire e amplificare ciò che funziona facendo domande positive.']),
      a('fishbowl', 'eye',
        ['Fishbowl', 'Enable diverse participants to have a transparent conversation.'],
        ['Fishbowl', 'Permettere a persone diverse di avere una conversazione trasparente davanti a tutti.']),
      a('world-cafe', 'food',
        ['World Café', 'Enable larger groups to have intimate conversations around questions that matter.'],
        ['World Café', 'Permettere a gruppi grandi di avere conversazioni raccolte su domande che contano.']),
      a('min-specs', 'scroll',
        ['Min Specs', 'Specify only absolute must-dos and must-not-dos to unleash innovation.'],
        ['Specifiche minime', 'Stabilire solo ciò che va assolutamente fatto e ciò che non va fatto, per lasciare spazio all’innovazione.']),
      a('heard-seen-respected', 'care',
        ['Heard, Seen, Respected', 'Practice deeper listening and empathy with colleagues.'],
        ['Ascoltati, visti, rispettati', 'Esercitare un ascolto più profondo e l’empatia verso gli altri.']),
    ],
  },
  {
    id: 'terms',
    kind: 'terms',
    color: '#475569',
    title: { en: 'Terms', it: 'Condizioni' },
    blurb: {
      en: 'What joining means in practice: what we ask of members, what it costs, and how to leave.',
      it: 'Cosa significa entrare, in pratica: cosa chiediamo a chi è membro, quanto costa e come si esce.',
    },
    alleles: [
      a('contribution', 'hand',
        ['Contribution', 'What each member is asked to give: time, care, money, or a mix, and how it is counted.'],
        ['Contributo', 'Cosa si chiede a ogni membro: tempo, cura, denaro o un insieme, e come viene contato.']),
      a('costs', 'coins',
        ['Costs', 'What staying or taking part costs, what is shared, and who to ask when it does not fit.'],
        ['Costi', 'Quanto costa restare o partecipare, cosa è condiviso e a chi chiedere quando non torna.']),
      a('leaving', 'walk',
        ['Leaving', 'Anyone may leave at any time. Say so, hand over what you hold, and settle what is owed.'],
        ['Uscire', 'Chiunque può uscire in qualsiasi momento. Basta dirlo, passare ad altri ciò che si tiene e saldare ciò che si deve.']),
    ],
  },
];

/**
 * The seven standard genes, written in `lang` (English when there is no
 * starter in that language). A fresh copy every call: never saved, `updated`
 * is ''.
 */
export function STARTER_GENES(lang: string = 'en'): Gene[] {
  const l: StarterLang = (STARTER_LANGS as readonly string[]).includes(lang) ? (lang as StarterLang) : 'en';
  return STARTER.map((g, order) => ({
    id: g.id,
    kind: g.kind,
    title: g.title[l],
    blurb: g.blurb[l],
    color: g.color,
    order,
    ack: GENE_KIND_DEFAULTS[g.kind].ack,
    alleles: g.alleles.map(
      (x): Allele => ({ id: x.id, title: x.title[l], body: x.body[l], ...(x.icon ? { icon: x.icon } : {}) }),
    ),
    lang: l,
    updated: '',
  }));
}
