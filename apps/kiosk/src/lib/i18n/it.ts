// SPDX-License-Identifier: AGPL-3.0-or-later
// Italian catalog. Must cover exactly the keys of `en.ts`.

import type { Msg } from "./types";
import type { MessageKey } from "./en";

export const it: Record<MessageKey, Msg> = {
  // Shared
  "common.auto": "Auto",
  "common.close": "Chiudi",
  "common.cancel": "Annulla",
  "common.apply": "Applica",
  "common.send": "Invia",
  "common.untitled": "Senza titolo",

  // Relative dates
  "dates.today": "oggi",
  "dates.tomorrow": "domani",
  "dates.yesterday": "ieri",
  "dates.daysAgo": "{n}g fa",
  "dates.inDays": "tra {n}g",

  // Tasks board
  "tasks.orderSaveFailed": "Impossibile salvare il nuovo ordine — {reason}",
  "tasks.alreadyCompleted": "Già completata.",
  "tasks.stopped": "Questa attività è stata fermata.",
  "tasks.joinFirst":
    "Prima unisciti all'attività — solo chi partecipa può completarla.",
  "tasks.deleteDenied": "Impossibile eliminare — forse non hai i permessi.",
  "tasks.deleteFailed": "Impossibile eliminare questa attività.",
  "tasks.addFailed": "Impossibile aggiungere — {reason}",
  "tasks.deleteTask": "Elimina l'attività",
  "tasks.markComplete": "Segna come completata",
  "tasks.proposedBy": "Proposta da {name}",
  "tasks.waitsTitle": {
    one: "Prima c'è {n} dipendenza aperta",
    other: "Prima ci sono {n} dipendenze aperte",
  },
  "tasks.waitsOn": "aspetta {n}",
  "tasks.appreciate": "Apprezza",
  "tasks.addTask": "Aggiungi un'attività",
  "tasks.appreciateInstead": "Preferisci apprezzare?",
  "tasks.appreciateLead":
    "Partecipi a “{title}”. Apprezzandola verrai rimosso dai partecipanti.",
  "tasks.deleteTitle": "Eliminare l'attività?",
  "tasks.deleteLead": "“{title}” verrà rimossa per tutti.",
  "tasks.deleting": "Eliminazione…",
  "tasks.delete": "Elimina",
  "tasks.addTasks": "Aggiungi attività",
  "tasks.addLead": "Un'attività per riga.",
  "tasks.addPlaceholder":
    "Innaffia le piante\nRipara il cancello\nOrganizza la cena",
  "tasks.adding": "Aggiunta…",
  "tasks.add": "Aggiungi",
  "tasks.loginPersonal": "Accedi per vedere le attività di cui fai parte ✶",
  "tasks.emptyPersonal":
    "Ancora niente a tuo nome — unisciti a un'attività per vederla qui ✶",
  "tasks.emptyBacklog": "Il backlog è vuoto. ✶",

  // Swipe deck
  "swipe.participating": "Partecipi già — vale più di un mi piace ♥",
  "swipe.alreadyIn": "Già dentro ✓",
  "swipe.joinFailed": "Impossibile unirsi — riprova.",
  "swipe.alreadyAppreciated": "Già apprezzata ♥",
  "swipe.appreciateFailed": "Impossibile salvare il ♥ — riprova.",
  "swipe.deckAria":
    "Schede attività — scorri a destra per unirti, in alto per apprezzare, a sinistra per saltare",
  "swipe.join": "UNISCITI",
  "swipe.skip": "SALTA",
  "swipe.joined": "UNITO",
  "swipe.joinedRibbonAria": "Partecipi a questa attività",
  "swipe.allCaughtUp": "Tutto fatto",
  "swipe.roundSummary": "{joins} adesioni · {likes} mi piace in questo giro",
  "swipe.startOver": "Ricomincia",
  "swipe.seeMine": "Vedi le mie attività",
  "swipe.backToWall": "Torna ai post-it",
  "swipe.skipAria": "Salta questa attività",
  "swipe.skipTitle": "Salta",
  "swipe.appreciateAria": "Apprezza questa attività",
  "swipe.joinAria": "Unisciti a questa attività",
  "swipe.joinTitle": "Unisciti",

  // Calendar
  "cal.actionFailed": "Impossibile {verb} — {reason}",
  "cal.verbMove": "spostare",
  "cal.verbUnschedule": "rimuovere dal calendario",
  "cal.verbResize": "ridimensionare",
  "cal.allDay": "tutto il giorno",
  "cal.previous": "Precedente",
  "cal.next": "Successivo",
  "cal.loginEvents": "Accedi per vedere i tuoi eventi ✶",
  "cal.dropUnschedule": "Rilascia qui per togliere la data",
  "cal.unscheduledTray": "Senza data — trascina su un giorno",
  "cal.newTask": "Nuova attività",

  // Roles
  "roles.untitledRole": "Ruolo senza titolo",

  // Library status chips
  "library.available": "disponibile",
  "library.returnBy": "riconsegna {when}",
  "library.withYou": "con te",
  "library.outWith": "in prestito · {who}",
  "library.out": "in prestito",

  // Library view
  "library.loginPersonal": "Accedi per vedere cosa hai in prestito ✶",
  "library.emptyPersonal":
    "Niente in prestito al momento — tocca un oggetto per prenderlo ✶",
  "library.emptyShared": "Ancora nessun oggetto condiviso.",
  "library.prevItem": "Oggetto precedente",
  "library.nextItem": "Oggetto successivo",
  "library.shareItem": "Condividi un oggetto",
  "library.shareLead": "Qualcosa che la comunità può prendere in prestito.",
  "library.namePlaceholder": "Cos'è? (es. Trapano a batteria)",
  "library.itemTypeAria": "Tipo di oggetto",
  "library.notesPlaceholder": "Note sull'oggetto (facoltative)",
  "library.sharing": "Condivisione…",
  "library.shareBtn": "Condividi",
  "library.nameTaken": "C'è già qualcosa condiviso con questo nome.",
  "library.addFailed": "Impossibile aggiungere l'oggetto.",
  "library.type.tool": "Attrezzo",
  "library.type.book": "Libro",
  "library.type.equipment": "Attrezzatura",
  "library.type.accommodation": "Alloggio",
  "library.type.other": "Altro",

  // Tabs
  "tabs.tasks": "Attività",
  "tabs.calendar": "Calendario",
  "tabs.library": "Biblioteca",
  "tabs.checklists": "Liste",
  "tabs.roles": "Ruoli",
  "tabs.status": "Stato",

  // Pill segments
  "pills.card": "Scheda",
  "pills.list": "Elenco",
  "pills.wall": "Bacheca",
  "pills.week": "Settimana",
  "pills.day": "Giorno",
  "pills.month": "Mese",
  "pills.loved": "Preferite",
  "pills.new": "Nuove",
  "pills.manual": "Manuale",
  "pills.view": "Vista",
  "pills.sort": "Ordina",
  "pills.tasksLayout": "Disposizione delle attività",
  "pills.tasksOrder": "Ordine delle attività",
  "pills.libraryLayout": "Disposizione della biblioteca",
  "pills.rolesLayout": "Disposizione dei ruoli",
  "pills.calendarView": "Vista del calendario",

  // Show (scope) pill
  "scope.personal": "Personale",
  "scope.local": "Locale",
  "scope.global": "Globale",
  "scope.show": "Mostra",
  "scope.aria": "Quali elementi mostrare",

  // Header bar
  "tabbar.search": "Cerca…",
  "tabbar.searchAria": "Cerca nei contenuti visibili",
  "tabbar.clearSearch": "Cancella la ricerca",
  "tabbar.suggestions": "Suggerimenti di ricerca",
  "tabbar.categories": "Categorie",
  "tabbar.people": "Persone",
  "tabbar.menu": "Menu",
  "tabbar.login": "Accedi",
  "tabbar.views": "Viste",
  "tabbar.pinnedTitle": "Fissata — tieni premuto per sbloccare",
  "tabbar.pinTitle": "Tieni premuto per fissare",
  "tabbar.unpinTab": "Sblocca {tab}",
  "tabbar.pinTab": "Fissa su {tab}",
  "tabbar.unpinView": "Sblocca questa vista",
  "tabbar.pinView": "Fissa questa vista",

  // User menu
  "menu.notSignedIn": "Accesso non effettuato",
  "menu.dashboard": "Apri la dashboard completa",
  "menu.pasteCard": "Incolla la scheda copiata",
  "menu.settings": "Impostazioni",
  "menu.logout": "Esci",
  "menu.loginTelegram": "Accedi con Telegram",

  // Completion confirmation
  "complete.title": "Completare questa attività?",
  "complete.lead":
    "Conferma chi ha partecipato — verrà accreditato nella contabilità dell'holon.",
  "complete.addMemberAria": "Aggiungi un membro",
  "complete.addMember": "Aggiungi un membro…",
  "complete.confirm": "Completa",

  // Settings panel
  "settings.title": "Impostazioni del kiosk",
  "settings.holon": "Holon",
  "settings.holonPlaceholder": "id dell'holon",
  "settings.displayName": "Nome visualizzato",
  "settings.displayNamePlaceholder": "mostrato nell'intestazione",
  "settings.logo": "Logo",
  "settings.logoSub": "— facoltativo; altrimenti il nome appare come testo",
  "settings.logoPreview": "Anteprima del logo",
  "settings.namePlaceholder": "nome",
  "settings.upload": "Carica…",
  "settings.useDefault": "Usa il predefinito",
  "settings.notImage": "Scegli un file immagine.",
  "settings.imageTooLarge":
    "L'immagine è troppo grande — resta sotto i 512 KB.",
  "settings.imageReadError": "Impossibile leggere quell'immagine.",
  "settings.accent": "Colore d'accento",
  "settings.accentAria": "Accento {color}",
  "settings.customAccent": "Accento personalizzato",
  "settings.appearance": "Aspetto",
  "settings.appearanceSub": "— Auto segue il tramonto locale",
  "settings.light": "Chiaro",
  "settings.dark": "Scuro",
  "settings.language": "Lingua",
  "settings.languageSub": "— Auto segue la lingua dell'holon",
  "settings.libraryTab": "Scheda Biblioteca",
  "settings.libraryTabSub":
    "— appare da sola quando la biblioteca ha oggetti; attivala per forzarla",
  "settings.libraryTabAria": "Mostra la scheda Biblioteca",
  "settings.rolesTab": "Scheda Ruoli",
  "settings.rolesTabSub":
    "— appare da sola quando esistono ruoli; attivala per forzarla",
  "settings.rolesTabAria": "Mostra la scheda Ruoli",
  "settings.listsTab": "Scheda Liste",
  "settings.listsTabSub":
    "— appare da sola quando esistono liste; attivala per forzarla",
  "settings.listsTabAria": "Mostra la scheda Liste",
  "settings.statusTab": "Scheda Stato",
  "settings.statusTabSub": "— una classifica dei contributi",
  "settings.statusTabAria": "Mostra la scheda Stato",
  "settings.location": "Posizione",
  "settings.locationSub":
    "— la cella H3 che questo holon rivendica sulla mappa condivisa",
  "settings.checking": "Verifica…",
  "settings.change": "Cambia…",
  "settings.setLocation": "Imposta la posizione…",
  "settings.federation": "Federazione",
  "settings.federationSub":
    "— gli holon partner con cui questo schermo condivide · le modifiche si applicano subito",
  "settings.voice": "Voce",
  "settings.voiceSub":
    "— chiave API OpenAI per l'interazione vocale, conservata solo su questo dispositivo; vuota = la chiave condivisa del deploy (quella della scomposizione AI), se configurata",

  // Federation editor
  "fed.loading": "Caricamento dei partner…",
  "fed.loadError": "Impossibile caricare la federazione — riprova.",
  "fed.none":
    "Nessun partner ancora — collega un holon qui sotto per condividere le bacheche.",
  "fed.hint":
    "Ricevi = mostra qui i loro elementi · Invia = condividi i nostri con loro",
  "fed.lensAria": "Federazione {lens}",
  "fed.off": "Off",
  "fed.receive": "Ricevi",
  "fed.send": "Invia",
  "fed.both": "Entrambi",
  "fed.tapAgainUnlink": "Tocca di nuovo per scollegare",
  "fed.unlink": "Scollega {name}",
  "fed.linking": "Collegamento…",
  "fed.link": "Collega",
  "fed.selfLink": "È questo holon.",
  "fed.linkError": "Impossibile collegare quell'holon — riprova.",
  "fed.changeError": "La modifica non è stata salvata — riprova.",
  "fed.unlinkError": "Lo scollegamento non è stato salvato — riprova.",

  // Location (hex) picker
  "hex.aria": "Scegli una posizione",
  "hex.kicker": "Rivendica la tua cella",
  "hex.title": "Dove si trova questo holon?",
  "hex.hint":
    "Tocca l'esagono in cui vive il tuo holon — riduci lo zoom per una cella più ampia e riservata.",
  "hex.searchPlaceholder": "Cerca un indirizzo o un luogo…",
  "hex.searching": "ricerca…",
  "hex.locating": "Localizzazione…",
  "hex.myLocation": "La mia posizione",
  "hex.nothingSelected": "niente di selezionato",
  "hex.manualPlaceholder": "…o incolla l'id di una cella H3",
  "hex.check": "Verifica",
  "hex.claiming": "Rivendicazione…",
  "hex.thisIsHome": "Questa è casa",
  "hex.noGeo":
    "Nessuna geolocalizzazione su questo dispositivo — tocca la mappa o incolla l'id di una cella.",
  "hex.denied":
    "Posizione negata — tocca la mappa o incolla l'id di una cella.",
  "hex.invalidCell": "Non è un id di cella H3 valido.",
  "hex.claimed": "Posizione rivendicata — questo holon è sulla mappa.",
  "hex.saveError": "Impossibile salvare la posizione — riprova.",

  // Voice overlay
  "voice.unmute": "Riattiva le risposte vocali",
  "voice.mute": "Silenzia le risposte vocali",
  "voice.listening": "in ascolto…",
  "voice.thinking": "sto pensando",
  "voice.transcribing": "trascrizione",
  "voice.speaking": "sto parlando…",
  "voice.typePlaceholder": "Incolla o scrivi una trascrizione…",

  // Setup screen
  "setup.title": "Nessun holon configurato",
  "setup.body":
    "Punta questo schermo a un holon: apri Impostazioni e inserisci un id di holon, apri il kiosk su /<id holon>, aprilo una volta con il parametro ?holon=<id>, oppure imposta VITE_KIOSK_HOLON nel file .env di radice. Impostazioni e ?holon= vengono ricordati su questo dispositivo.",
  "setup.openSettings": "Apri le impostazioni",

  // Shell
  "layout.resync": "Vista live in stallo — risincronizzazione…",

  // Clipboard
  "clipboard.copied":
    "Scheda copiata — incollala in qualsiasi holon (o in qualsiasi chat).",
  "clipboard.copyFailed": "Impossibile raggiungere gli appunti.",
  "clipboard.noHolon": "Prima punta il kiosk a un holon.",
  "clipboard.loginToPaste": "Accedi per incollare la scheda copiata.",
  "clipboard.pasted": 'Incollata "{title}".',
  "clipboard.pastedLibrary": '"{title}" incollato nella biblioteca.',
  "clipboard.alreadyInLibrary": '"{title}" è già in questa biblioteca.',
  "clipboard.pasteCardFailed": "Impossibile incollare la scheda.",
  "clipboard.pasteFailed": "Impossibile incollare — {reason}",
  "clipboard.writeFailed": "scrittura non riuscita",
  "clipboard.blocked": "Appunti bloccati — premi Ctrl/Cmd+V invece.",
  "clipboard.noCard": "Nessuna scheda copiata negli appunti.",

  // AI breakdown errors
  "breakdown.badKey":
    "OpenAI ha rifiutato la chiave API di questo dispositivo.",
  "breakdown.rateLimit":
    "Limite di richieste OpenAI raggiunto — riprova tra poco.",
  "breakdown.failed": "Scomposizione AI non riuscita (HTTP {status}).",
};
