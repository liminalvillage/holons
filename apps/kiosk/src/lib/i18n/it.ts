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
  "tasks.graphAria": "Grafo delle dipendenze dei task",
  "tasks.graphEmpty":
    "Ancora nessuna dipendenza — trascina un task su un altro per dire cosa viene prima. ✶",
  "tasks.graphFree": "Non ancora collegati",
  "tasks.graphFit": "Adatta tutto il grafo",
  "tasks.linkHint": "Trascina “{title}” sul task che deve aspettarlo",
  "tasks.linkRefused": "Non quello — si chiuderebbe ad anello",
  "tasks.dropUnlink": "Rilascia per liberare “{title}”",
  "tasks.dropUnlinkShort": "Rilascia qui per scollegare",
  "tasks.unlinked": "“{title}” è di nuovo indipendente",
  "tasks.unlinkNothing": "“{title}” non ha collegamenti da tagliare.",
  "tasks.linked": "“{task}” ora aspetta “{dep}”",
  "tasks.linkCycle": "Questo collegamento chiuderebbe il piano ad anello.",
  "tasks.linkForeign":
    "Questa scheda appartiene a un altro holon — collegala dove vive.",
  "tasks.linkFailed": "Collegamento non riuscito — {reason}",
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

  // Checklists
  "lists.updateFailed": "Impossibile aggiornare la lista.",
  "lists.removeItemFailed": "Impossibile rimuovere l'elemento.",
  "lists.addItemFailed": "Impossibile aggiungere l'elemento.",
  "lists.nothingTicked": "Ancora niente di spuntato.",
  "lists.clearFailed": "Impossibile svuotare la lista.",
  "lists.specialUndeletable":
    "Le liste agenda e spesa non si possono eliminare.",
  "lists.deleteFailed": "Impossibile eliminare la lista.",
  "lists.nameExists": "Esiste già una lista con questo nome.",
  "lists.nameUnderscore":
    "I nomi delle liste non possono contenere trattini bassi.",
  "lists.createFailed": "Impossibile creare la lista.",
  "lists.backAria": "Torna alle liste",
  "lists.doneCount": "{done}/{total} fatti",
  "lists.clearTicked": "Rimuovi gli elementi spuntati",
  "lists.clear": "Svuota",
  "lists.deleteList": "Elimina questa lista",
  "lists.tapConfirm": "Tocca per confermare",
  "lists.gone": "Questa lista non esiste più.",
  "lists.emptyOpen":
    "Ancora niente in questa lista — aggiungi il primo elemento ↓",
  "lists.removeItemAria": "Rimuovi {item}",
  "lists.addItemPlaceholder": "Aggiungi un elemento…",
  "lists.newItemAria": "Nuovo elemento",
  "lists.loginPersonal": "Accedi per vedere le tue liste ✶",
  "lists.empty": "Nessuna lista — comincia con ＋",
  "lists.startList": "Inizia una lista",
  "lists.startLead": "Una lista condivisa che chiunque qui può spuntare.",
  "lists.namePlaceholder": "Nome (es. pulizie)",
  "lists.firstItemsPlaceholder":
    "Primi elementi, separati da virgole (facoltativo)",
  "lists.starting": "Creazione…",
  "lists.startBtn": "Crea la lista",
  "lists.emptyStatus": "vuota",

  // Calendar
  "cal.actionFailed": "Impossibile {verb} — {reason}",
  "cal.verbMove": "spostare",
  "cal.verbUnschedule": "rimuovere dal calendario",
  "cal.verbResize": "ridimensionare",
  "cal.allDay": "tutto il giorno",
  "cal.dayOfSpan": "giorno {span}",
  "cal.previous": "Precedente",
  "cal.next": "Successivo",
  "cal.loginEvents": "Accedi per vedere i tuoi eventi ✶",
  "cal.dropUnschedule": "Rilascia qui per togliere la data",
  "cal.unscheduledTray": "Senza data — trascina su un giorno",
  "cal.newTask": "Nuova attività",

  // Roles
  "roles.untitledRole": "Ruolo senza titolo",
  "rolesv.fixedReleaseFirst": "Ruolo fisso — prima rilascialo dalla scheda.",
  "rolesv.prevWeek": "Settimana precedente",
  "rolesv.nextWeek": "Settimana successiva",
  "rolesv.today": "Oggi",
  "rolesv.loginPersonal": "Accedi per vedere i tuoi ruoli ✶",
  "rolesv.emptyPersonal": "Ancora nessun ruolo a tuo nome — prendi un giorno ✪",
  "rolesv.empty": "Ancora nessun ruolo. ✪",
  "rolesv.fixedRole": "Ruolo fisso",
  "rolesv.fixed": "Fisso",
  "rolesv.open": "Aperto",
  "rolesv.release": "Rilascia",
  "rolesv.releaseFixed": "Rilascia questo ruolo fisso",
  "rolesv.drop": "Lascia",
  "rolesv.takeToday": "Prendi oggi",
  "rolesv.todayDrop": "Oggi · lascia",
  "rolesv.takeThisDay": "Prendi questo giorno",
  "rolesv.editAria": "Modifica il ruolo",
  "rolesv.edit": "Modifica",
  "rolesv.addRole": "Aggiungi un ruolo",
  "rolesv.addRoleTitle": "Aggiungi un ruolo",
  "rolesv.addLead": "Una responsabilità stabile che chiunque può assumersi.",
  "rolesv.titlePlaceholder": "Titolo del ruolo",
  "rolesv.descPlaceholder": "In cosa consiste? (facoltativo)",
  "rolesv.fixedHolderLabel": "Titolare fisso · lo tiene ogni giorno",
  "rolesv.clearFixed": "Rimuovi",
  "rolesv.makeMeFixed": "Rendimi il titolare fisso",
  "rolesv.saving": "Salvataggio…",
  "rolesv.save": "Salva",
  "rolesv.deleteRole": "Elimina il ruolo",

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
  "pills.graph": "Grafo",
  "pills.calendar": "Calendario",
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

  // Telegram login sheet
  "login.loggedIn": "Accesso effettuato",
  "login.signedInAs":
    "Hai effettuato l'accesso come {name} e puoi modificare ciò che è sullo schermo.",
  "login.title": "Accedi con Telegram",
  "login.lead":
    "Accedi per aggiungere e modificare ciò che è sullo schermo. La visualizzazione resta aperta a tutti.",

  // User menu
  "menu.notSignedIn": "Accesso non effettuato",
  "menu.dashboard": "Apri la dashboard completa",
  "menu.pasteCard": "Incolla la scheda copiata",
  "menu.settings": "Impostazioni",
  "menu.homePage": "Mostra la pagina iniziale",
  "menu.logout": "Esci",
  "menu.linkKey": "Collega la tua chiave di firma",
  "menu.signingAs": "Firmi come {key}",
  "keylink.title": "Collega la tua chiave di firma",
  "keylink.qrAlt": "QR di abbinamento",
  "keylink.scan": "Scansiona col telefono — la chiave resta nel tuo Telegram.",
  "keylink.waiting": "In attesa del telefono…",
  "keylink.success": "Chiave collegata — le tue modifiche sono firmate da te.",
  "keylink.mismatch": "Quella chiave appartiene a un altro account Telegram.",
  "keylink.timeout": "Nessuna risposta — chiudi e riprova.",
  "keylink.failed": "Impossibile adottare la chiave — riprova.",
  "keylink.noMiniapp": "Nessun portachiavi configurato per questo kiosk.",
  "key.title": "La tua chiave Holons",
  "key.loading": "Caricamento…",
  "key.outside":
    "Apri questa pagina da Telegram — gestisce la chiave conservata nel tuo account Telegram.",
  "key.unsupported":
    "La tua app Telegram è troppo vecchia per l'archivio chiavi — aggiornala.",
  "key.error": "Qualcosa è andato storto — chiudi e riprova.",
  "key.identity": "La tua identità di firma:",
  "key.sending": "Invio della chiave al kiosk…",
  "key.sent": "Chiave consegnata — guarda lo schermo del kiosk.",
  "key.done": "Fatto",
  "key.readyHint":
    "La chiave vive nel tuo cloud Telegram. Scansiona il QR di un kiosk per firmare lì.",
  "key.revealKey": "Mostra la chiave (backup)",
  "key.hideKey": "Nascondi la chiave",
  "key.backupHint":
    "Chiunque abbia questa chiave può agire come te — conservala in un posto sicuro e privato.",
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
  "settings.unpinHolon": "Cancella — mostra la pagina iniziale",
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
  "settings.statusConfirmTitle": "Attivare la scheda Stato?",
  "settings.statusConfirmAccept": "Abbiamo capito — attivala",
  "settings.valueEquation": "Equazione del valore",
  "settings.valueEquationSub":
    "— che cosa conta la classifica, e quanto. Decidetela insieme; ogni peso può andare a 0, e possono andarci tutti.",
  "settings.eqSignals": "Segnali di collaborazione",
  "settings.eqCurrencies": "Valute",
  "settings.eqReset": "Ripristina i valori predefiniti",
  "settings.eqZero": "Azzera tutti i pesi",
  "settings.eqSaving": "Salvataggio…",
  "settings.eqSaved": "Salvato",
  "settings.eqLoading": "Carico l'equazione…",
  "settings.eqLess": "Abbassa il peso di {metric}",
  "settings.eqMore": "Alza il peso di {metric}",
  "settings.eqValue": "Peso di {metric}",
  "settings.eqMetrics": "Contributi",
  "settings.eqAbout": "{section}: che cosa contano",
  "settings.eqAboutAria": "Informazioni su {section}",
  "settings.eqAddCurrency": "Aggiungi una valuta",
  "settings.eqCurrencyPlaceholder": "euro, token…",
  "settings.eqAdd": "Aggiungi",
  "settings.eqCurrencyStartsAtZero":
    "Le nuove valute partono da 0 — non cambia nulla finché il gruppo non alza il peso.",
  "settings.location": "Posizione",
  "settings.locationSub":
    "— la cella H3 che questo holon rivendica sulla mappa condivisa",
  "settings.checking": "Verifica…",
  "settings.change": "Cambia…",
  "settings.setLocation": "Imposta la posizione…",
  "settings.federation": "Federazione",
  "settings.federationSub":
    "— gli holon partner con cui questo schermo condivide · le modifiche si applicano subito",

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

  // Detail modal
  "detail.stepsUnwirable": "Questi passi non si possono collegare.",
  "detail.atomicStep": "Questa attività è già un singolo passo eseguibile.",
  "detail.breakdownFailed": "Scomposizione AI non riuscita.",
  "detail.partialSteps":
    "Solo {saved} passi su {total} sono stati salvati — l'obiettivo è rimasto invariato.",
  "detail.linkStepsFailed": "Impossibile collegare i passi.",
  "detail.createStepsFailed": "Impossibile creare i passi.",
  "detail.noDate": "Senza data",
  "detail.saveFailed": "Impossibile salvare — riprova.",
  "detail.couldNotSave": "Impossibile salvare.",
  "detail.completeFailed": "Impossibile completare.",
  "detail.deleteConfirm": 'Eliminare "{title}"? Non si può annullare.',
  "detail.hideConfirm":
    'Nascondere "{title}" da questa bacheca? Appartiene a un altro holon e vi rimane — sparisce solo dalla tua vista.',
  "detail.thisTask": "questa attività",
  "detail.deleteFailed": "Impossibile eliminare — riprova.",
  "detail.hideFailed": "Impossibile nascondere — riprova.",
  "detail.joinFailed": "Impossibile unirsi.",
  "detail.overlaps":
    "Si sovrappone alla prenotazione di {who} ({start} → {end}).",
  "detail.someone": "qualcuno",
  "detail.invalidRange":
    "La data di riconsegna non può precedere quella di inizio.",
  "detail.bookFailed": "Impossibile prenotare.",
  "detail.onlyBorrowerReturn": "Solo chi l'ha in prestito può restituirlo.",
  "detail.returnFailed": "Impossibile restituire.",
  "detail.stepN": "passo {n}",
  "detail.status": "Stato",
  "detail.out": "In prestito",
  "detail.outWith": "In prestito · {who}",
  "detail.viaHolonTitle": "Prenotato da un holon federato",
  "detail.availableCap": "Disponibile",
  "detail.value": "Valore",
  "detail.booked": "Prenotato",
  "detail.from": "Dal",
  "detail.until": "Al",
  "detail.len1day": "1 giorno",
  "detail.len3days": "3 giorni",
  "detail.len1week": "1 settimana",
  "detail.len2weeks": "2 settimane",
  "detail.booking": "Prenotazione…",
  "detail.confirmBooking": "Conferma la prenotazione",
  "detail.borrow": "Prendi in prestito",
  "detail.return": "Restituisci",
  "detail.onLoanTo": "In prestito a {who}",
  "detail.bookAhead": "Prenota in anticipo",
  "detail.edit": "Modifica",
  "detail.copyTitle": "Copia questa scheda — incollala in qualsiasi holon",
  "detail.copy": "Copia",
  "detail.loginBorrowEdit":
    "Accedi con Telegram per prendere in prestito o modificare",
  "detail.loginEdit": "Accedi con Telegram per modificare",
  "detail.category": "Categoria",
  "detail.newCategoryPlaceholder": "Nome della nuova categoria",
  "detail.pickFromList": "Scegli dall'elenco",
  "detail.newCategory": "Nuova categoria…",
  "detail.description": "Descrizione",
  "detail.participants": {
    one: "{n} partecipante",
    other: "{n} partecipanti",
  },
  "detail.leaveTitle": "Lascia questa attività",
  "detail.joinedLeave": "Iscritto · lascia",
  "detail.appreciatedLabel": "Apprezzata",
  "detail.breakdownTitle": "Usa l'IA per scomporre questa attività in passi",
  "detail.breakingDown": "Scomposizione…",
  "detail.breakDown": "Scomponi",
  "detail.proposedSteps": "Passi proposti",
  "detail.notBrokenDown": "Non scomposta: {reason}",
  "detail.reuses": "riusa “{title}”",
  "detail.after": "dopo {deps}",
  "detail.removeStepAria": "Rimuovi il passo {n}: {title}",
  "detail.removeStep": "Rimuovi questo passo",
  "detail.addStepPlaceholder": "Aggiungi un passo tuo…",
  "detail.creating": "Creazione…",
  "detail.createSteps": { one: "Crea {n} passo", other: "Crea {n} passi" },
  "detail.regenerating": "Rigenerazione…",
  "detail.regenerate": "Rigenera",
  "detail.title": "Titolo",
  "detail.titlePlaceholder": "Cosa c'è da fare?",
  "detail.starts": "Inizio",
  "detail.ends": "Fine",
  "detail.startDateAria": "Data di inizio",
  "detail.startTimeAria": "Ora di inizio",
  "detail.endDateAria": "Data di fine",
  "detail.endTimeAria": "Ora di fine",
  "detail.dayCount": { one: "{n} giorno", other: "{n} giorni" },
  "detail.noCategory": "Nessuna categoria",
  "detail.location": "Luogo",
  "detail.create": "Crea",

  // Status leaderboard
  "status.tallying": "Conteggio dei contributi… ♛",
  "status.noActivity": "Ancora nessuna attività in classifica. ♛",
  "status.seeScore": "Guarda come si è formato il punteggio di {name}",
  "status.disclaimerLead":
    "La tecnologia ricorda. Il significato lo danno le persone.",
  "status.disclaimerBody":
    "Questa classifica mostra ciò che è stato registrato — ore donate, persone ospitate, compiti portati a termine. Non decide quanto vale una persona. Non esiste un punteggio umano.",
  "status.disclaimerUse":
    "Quindi non agire sul numero da solo: conta soltanto ciò che qualcuno ha pensato di registrare, mentre la cura, la riparazione e l'ascolto che tengono insieme un gruppo quasi mai finiscono nel registro. Una classifica serve ad aprire una conversazione, non a chiuderla.",
  "status.disclaimerEquation":
    "E l'equazione dietro questi numeri appartiene al gruppo, non al software: discutetela insieme, rivedetela ogni volta che smette di rappresentarvi e portate qualsiasi peso — o tutti i pesi — a zero se così funziona meglio.",
  "status.disclaimerMore": "Che cosa conta — e che cosa non può contare",
  "status.score": "Punteggio",
  "status.share": "quota {pct}%",
  "status.valueEquation": "Equazione del valore",
  "status.metricCol": "Metrica",
  "status.countCol": "Conteggio",
  "status.weightCol": "Peso",
  "status.pointsCol": "Punti",
  "status.total": "Totale",
  "status.noWeighted": "Ancora nessun contributo pesato.",
  "status.ledger": "Registro",
  "status.entries": { one: "{n} voce", other: "{n} voci" },
  "status.noEntries": "Nessuna voce nel registro.",
  "status.questRef": "Attività n. {id}",
  "status.metric.initiated": "Attività proposte",
  "status.metric.completed": "Attività completate",
  "status.metric.sent": "Apprezzamenti inviati",
  "status.metric.received": "Apprezzamenti ricevuti",
  "status.metric.collaboration": "Eventi di collaborazione",
  "status.metric.participation": "Partecipazione (attività)",
  "status.metric.coParticipants": "Co-partecipanti",
  "status.metric.activity": "Attività (eventi)",
  "status.metric.groupSize": "Dimensione del gruppo (media)",
  "status.metric.variance": "Varianza della dimensione del gruppo",
  "status.metric.declaredHours": "Ore dichiarate",
  "status.metric.currencyBalance": "Saldo {currency}",
  "status.about.initiated": "Punti ogni volta che qualcuno propone un compito.",
  "status.about.completed":
    "Punti ogni volta che qualcuno porta a termine un compito.",
  "status.about.sent": "Punti per ogni riconoscimento che qualcuno dona.",
  "status.about.received": "Punti per ogni riconoscimento che qualcuno riceve.",
  "status.about.collaboration":
    "Punti per ogni momento registrato di lavoro insieme a qualcun altro.",
  "status.about.participation":
    "Punti per ogni quest distinta a cui si è preso parte — premia l'esserci in molte cose.",
  "status.about.coParticipants":
    "Punti per ogni persona diversa con cui si è lavorato — premia una cerchia ampia.",
  "status.about.activity":
    "Punti per ogni evento registrato, di qualunque tipo — premia la quantità pura, quindi tienilo basso.",
  "status.about.groupSize":
    "Moltiplicato per la dimensione media dei gruppi in cui si è lavorato — premia il lavorare in compagnia.",
  "status.about.variance":
    "Moltiplicato per quanto quelle dimensioni sono variate — premia il passare da grandi ritrovi al lavoro a due.",
  "status.about.currency":
    "Ogni unità di {currency} nel saldo di una persona vale questi punti.",
  "status.event.questInitiated": "Attività proposta",
  "status.event.questCompleted": "Attività completata",
  "status.event.timeLogged": "Tempo registrato",
  "status.event.expenseShare": "Quota di spesa",
  "status.event.expensePaid": "Spesa pagata",
  "status.event.appreciation": "Apprezzamento",
  "status.event.generic": "Evento",

  // Voice overlay
  "voice.unmute": "Riattiva le risposte vocali",
  "voice.mute": "Silenzia le risposte vocali",
  "voice.listening": "in ascolto…",
  "voice.thinking": "sto pensando",
  "voice.transcribing": "trascrizione",
  "voice.speaking": "sto parlando…",
  "voice.typePlaceholder": "Incolla o scrivi una trascrizione…",
  "voice.typeAria": "Scrivi o incolla una trascrizione",
  "voice.holdToTalk": "Tieni premuto per parlare",
  "voice.notConfigured":
    "La voce non è configurata — incolla una chiave API nelle Impostazioni, o imposta OPENAI_API_KEY sul deploy.",
  "voice.keyUnreachable":
    "Impossibile raggiungere OpenAI — controlla la chiave API nelle Impostazioni e la connessione di rete.",
  "voice.serviceUnreachable":
    "Impossibile raggiungere il servizio vocale — controlla la connessione di rete.",

  // Home / landing page
  "home.metaTitle": "Holons — coordinare ciò che già abbiamo",
  "home.metaDescription":
    "Un protocollo aperto per gruppi che vogliono far circolare ciò che già hanno — tempo, strumenti, posti letto, terra, competenze, cura, denaro — senza trasformare tutto in merce. Avvia un holon su Telegram.",

  "home.heroTitle": "Rendere le relazioni economicamente significative.",
  "home.heroLead":
    "Holons è un protocollo aperto per gruppi che vogliono far circolare ciò che già hanno — tempo, strumenti, posti letto, terra, competenze, cura, denaro — senza trasformare tutto in merce.",
  "home.heroNote":
    "Libero e open source. Local-first e peer-to-peer. Il tuo holon è una chat di gruppo che hai già.",
  "home.ctaStart": "Avvia un holon",
  "home.ctaRead": "Che cos'è un holon?",

  "home.problemKicker": "Perché",
  "home.problemTitle": "Viviamo dentro una strana contraddizione.",
  "home.problemP1":
    "Abbiamo più capacità di produrre, comunicare, coordinarci e condividere conoscenza che in qualsiasi altro momento della storia. Eppure quasi tutti continuiamo a organizzare la nostra vita intorno alla scarsità.",
  "home.problemP2":
    "Le case restano vuote mentre c'è chi non sa dove abitare. Chi ha capacità inutilizzata non riesce a incontrare chi ne ha bisogno. E il denaro è diventato la lingua in cui cose profondamente diverse — tempo, terra, cibo, cura, creatività, rischio, conoscenza — sono costrette a parlarsi.",
  "home.fearsTitle": "E sotto tutto questo c'è la paura.",
  "home.fear1": "Se do troppo, resterà abbastanza per me?",
  "home.fear2": "Se smetto di guadagnare, chi si prenderà cura di me?",
  "home.fear3": "Se condivido ciò che ho, qualcuno ne approfitterà?",
  "home.fear4": "Se contribuisco adesso, qualcuno se ne ricorderà poi?",
  "home.fearsNote":
    "Queste paure non sono irrazionali. Le nostre istituzioni ci danno buone ragioni per averle.",
  "home.problemP3":
    "Il capitalismo ha risolto un profondo problema di coordinamento: i mercati hanno permesso a milioni di sconosciuti di cooperare senza doversi conoscere o fidare. Oggi ne abbiamo davanti un altro — milioni di persone possono cooperare senza dover trasformare in merce tutto ciò a cui tengono?",

  "home.holonKicker": "Che cos'è un holon",
  "home.holonTitle": "Un tutto, e una parte di qualcosa di più grande.",
  "home.holonP1":
    "La parola viene dal greco: holos (tutto) + on (parte). Il tuo corpo è un holon — un organismo intero, e insieme parte di una famiglia, di una comunità, di un ecosistema. Una squadra è un holon. Lo sono anche una casa, una cooperativa, un quartiere, una bioregione.",
  "home.holonP2":
    "Qualsiasi gruppo può funzionare così: autonomo al proprio interno, componibile con altri holon all'esterno. Quattro domande lo rendono possibile, e ciascuna ha una primitiva nel protocollo.",
  "home.pillar1Title": "Membrana",
  "home.pillar1Body":
    "Un confine flessibile che dice chi è dentro, a cosa serve l'holon e cosa gli sta a cuore. Semipermeabile: persone, risorse e informazioni lo attraversano alle condizioni che l'holon si dà da sé.",
  "home.pillar2Title": "Equazione di valore",
  "home.pillar2Body":
    "Ogni holon decide che cosa conta — ore, risultati, apprezzamenti, le relazioni che qualcuno porta. Due holon con lo stesso software possono far crescere culture molto diverse, semplicemente regolando i pesi.",
  "home.pillar3Title": "Splitter e soglie",
  "home.pillar3Body":
    "Le risorse che arrivano vengono instradate invece che accumulate: prima si copre ciò di cui l'holon ha davvero bisogno, poi il surplus trabocca verso le persone e i progetti che lo fanno prosperare.",
  "home.pillar4Title": "Federazione",
  "home.pillar4Body":
    "Gli holon dichiarano fiducia verso altri holon — può essere leggera come condividere gli apprezzamenti o impegnativa come un fondo di mutuo aiuto comune. Bilaterale, revocabile, e mai al prezzo dell'autonomia.",

  "home.layerKicker": "Cosa fa il software",
  "home.layerTitle": "Rende visibili i flussi.",
  "home.layerP1":
    "Niente viene messo in comune per forza. Piuttosto, uno strato digitale impara a vedere la rete: dove ci sono letti liberi, attrezzi inutilizzati, eccedenze di cibo, terra disponibile, competenze, progetti che cercano aiuto e persone che cercano lavoro.",
  "home.layerSay": "Così che chiunque possa dire:",
  "home.say1": "Questo ce l'ho.",
  "home.say2": "Di questo ho bisogno.",
  "home.say3": "Questo posso offrirlo.",
  "home.say4": "Questo sto cercando di creare.",
  "home.layerP2":
    "E l'AI continua a creare connessioni che nessuno potrebbe tenere in testa. «Ti serve una contabile — Sofia ha tre ore libere questa settimana.» «Il mese prossimo ci sono sei letti liberi.» «Quattro persone qui hanno le competenze che mancano a questo progetto.»",
  "home.mapsTitle": "Cosa custodisce un holon",
  "home.map1": "Persone",
  "home.map2": "Luoghi",
  "home.map3": "Bisogni",
  "home.map4": "Offerte",
  "home.map5": "Progetti",
  "home.map6": "Risorse",
  "home.map7": "Una memoria dei contributi",
  "home.memoryP":
    "È l'ultima a contare di più. Il sistema ricorda chi si è preso cura degli altri nei momenti difficili, chi ha riparato il tetto, chi ha passato tre mesi a rendere sostenibile il lavoro di qualcun altro — non per dargli un prezzo. Lo scopo non è il capitalismo con un foglio di calcolo migliore. È avere memoria dove prima c'erano solo fiducia o burocrazia — ed è la memoria che permette alla fiducia di andare oltre le persone che già conosci.",

  "home.designKicker": "Per come è fatto",
  "home.designTitle": "Sovranità, non sorveglianza.",
  "home.designLead":
    "Un sistema capace di vedere una rete è anche capace di sorvegliarla. Perciò questi sono vincoli sul software, non promesse sulle intenzioni.",
  "home.design1": "La partecipazione è volontaria — sempre, a ogni livello.",
  "home.design2": "Informazioni diverse hanno visibilità diverse.",
  "home.design3": "Puoi contestare ciò che il sistema dice di te.",
  "home.design4": "L'AI suggerisce; le persone restano libere di dire no.",
  "home.design5": "Il contributo non si riduce mai a un unico punteggio.",
  "home.design6": "La cura non viene mai resa equivalente al denaro.",
  "home.design7":
    "Resta sempre spazio per doni che spariscono senza essere registrati.",
  "home.design8":
    "La rete non appartiene a chi ha scritto il software: open source, local-first, peer-to-peer. L'infrastruttura con cui cooperiamo è essa stessa un bene comune.",

  "home.levelsKicker": "Come cresce",
  "home.levelsTitle": "Abbastanza piccolo da iniziare oggi.",
  "home.levelsLead":
    "Puoi fermarti dopo qualsiasi passo. Ognuno ti lascia un holon funzionante.",
  "home.level0Tag": "Livello 0",
  "home.level0Title": "Una chat di gruppo",
  "home.level0Body":
    "Crea un gruppo, scrivi il suo scopo nella descrizione, invita le persone. È già un holon: una membrana, uno scopo condiviso e dei membri.",
  "home.level1Tag": "Livello 1",
  "home.level1Title": "Aggiungi il bot",
  "home.level1Body":
    "Il coordinamento informale diventa una traccia attribuibile. /task dà un nome al lavoro, /appreciate lo riconosce, /offer e /request aprono una bacheca di ciò che potrebbe circolare, /status mostra a che punto è ciascuno.",
  "home.level2Tag": "Livello 2",
  "home.level2Title": "Dì cosa conta",
  "home.level2Body":
    "Descrivi i vostri valori e le vostre pratiche, poi regola i pesi dell'equazione di valore. Non esiste una risposta giusta universale — l'equazione è la cultura.",
  "home.level3Tag": "Livello 3",
  "home.level3Title": "Federati",
  "home.level3Body":
    "Trova un holon fratello che fa un lavoro affine e dichiara la fiducia. Quest, offerte, richieste e apprezzamenti possono poi attraversare il confine — solo quelli che ciascuno sceglie di pubblicare.",
  "home.level4Tag": "Livello 4",
  "home.level4Title": "Apri agli agenti",
  "home.level4Body":
    "Collega un agente AI e diventa un partecipante invece che uno spettatore: legge lo stato dell'holon e agisce esattamente con le stesse regole di tutti gli altri.",

  "home.startKicker": "Inizia",
  "home.startTitle": "Avvia un holon.",
  "home.startLead":
    "Ci vuole circa un minuto, e succede dove già parlate: Telegram.",
  "home.step1":
    "Tocca il pulsante. Telegram si apre e ti chiede in quale gruppo aggiungere @{bot}.",
  "home.step2":
    "Scegli un gruppo che hai già, o creane uno nuovo con le persone con cui vuoi cominciare.",
  "home.step3":
    "Rendi il bot amministratore, scrivi lo scopo nella descrizione del gruppo e digita /task. Quello è un holon.",
  "home.startButton": "Aggiungi {bot} a un gruppo",
  "home.startAlt": "Oppure apri prima una chat privata",
  "home.startAltNote":
    "Una chat diretta con @{bot} ti dà il tuo holon personale — dove converge il tuo lavoro in tutti i gruppi.",

  "home.backTitle": "Bentornato.",
  "home.backLead":
    "Appena il bot è nel gruppo, pubblica un link diretto a questa bacheca. Se te lo sei perso, digita /dashboard nel gruppo e incolla qui il link.",
  "home.openTitle": "Hai già un holon?",
  "home.openLead":
    "Incolla il suo link o il suo id, e questo schermo diventa la sua bacheca.",
  "home.openPlaceholder": "-1001234567890, o un link al tuo gruppo",
  "home.openButton": "Apri la bacheca",
  "home.openInvalid":
    "Questo non indica ancora un holon. Prova con un id di holon, un link a un messaggio del tuo gruppo, o il link che ti dà /dashboard.",
  "home.openAria": "Id o link dell'holon",

  "home.closingKicker": "Dove porta",
  "home.closingP1":
    "Forse qualcuno nella rete perderà il proprio reddito e scoprirà di non aver perso il proprio sostentamento. C'è un posto dove stare. C'è del cibo. C'è chi ha bisogno delle sue competenze. C'è una comunità che ricorda ciò che ha già dato.",
  "home.closingP2":
    "Potrebbe essere quella la soglia — il momento in cui la sicurezza si sposta dal denaro accumulato alle relazioni accumulate.",
  "home.closingP3":
    "E la ricchezza diventa qualcosa che si può davvero vedere: terra sana, infrastrutture utili, conoscenza, relazioni di fiducia, lavoro che ha senso, luoghi di appartenenza, e una rete che sa prendersi cura dei suoi.",

  "home.footerDocs": "Documentazione",
  "home.footerDashboard": "Dashboard web",
  "home.footerCommunity": "Chat della comunità",
  "home.footerSource": "Codice sorgente",
  "home.footerSetup": "Configura questo schermo",
  "home.footerLicense": "Open source con licenza AGPL-3.0-or-later.",
  "home.caretakerNote":
    "Lo stai montando a parete? Le Impostazioni puntano lo schermo su un holon e lo ricordano su questo dispositivo — oppure apri il kiosk su /<id holon> e salti del tutto la configurazione.",

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
