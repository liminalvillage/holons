// SPDX-License-Identifier: AGPL-3.0-or-later
// Spanish catalog. Must cover exactly the keys of `en.ts`.

import type { Msg } from "./types";
import type { MessageKey } from "./en";

export const es: Record<MessageKey, Msg> = {
  // Shared
  "common.auto": "Auto",
  "common.close": "Cerrar",
  "common.cancel": "Cancelar",
  "common.apply": "Aplicar",
  "common.send": "Enviar",
  "common.untitled": "Sin título",

  // Relative dates
  "dates.today": "hoy",
  "dates.tomorrow": "mañana",
  "dates.yesterday": "ayer",
  "dates.daysAgo": "hace {n}d",
  "dates.inDays": "en {n}d",

  // Tasks board
  "tasks.orderSaveFailed": "No se pudo guardar el nuevo orden — {reason}",
  "tasks.alreadyCompleted": "Ya completada.",
  "tasks.stopped": "Esta tarea se detuvo.",
  "tasks.deleteDenied": "No se pudo eliminar — quizá no tienes permiso.",
  "tasks.deleteFailed": "No se pudo eliminar esta tarea.",
  "tasks.addFailed": "No se pudo añadir — {reason}",
  "tasks.deleteTask": "Eliminar la tarea",
  "tasks.markComplete": "Marcar como completada",
  "tasks.proposedBy": "Propuesta por {name}",
  "tasks.waitsTitle": {
    one: "Primero hay {n} dependencia abierta",
    other: "Primero hay {n} dependencias abiertas",
  },
  "tasks.waitsOn": "espera {n}",
  "tasks.graphAria": "Grafo de dependencias de tareas",
  "tasks.graphEmpty":
    "Aún no hay dependencias — arrastra una tarea sobre otra para decir qué va primero. ✶",
  "tasks.graphFree": "Sin enlazar todavía",
  "tasks.graphFit": "Ajustar todo el grafo",
  "tasks.linkHint": "Suelta “{title}” sobre la tarea que debe esperarla",
  "tasks.linkRefused": "Esa no — se cerraría en un bucle",
  "tasks.dropUnlink": "Suelta para liberar “{title}”",
  "tasks.dropUnlinkShort": "Suelta aquí para desenlazar",
  "tasks.unlinked": "“{title}” vuelve a estar suelta",
  "tasks.unlinkNothing": "“{title}” no tiene enlaces que cortar.",
  "tasks.linked": "“{task}” ahora espera “{dep}”",
  "tasks.linkCycle": "Ese enlace cerraría el plan en un bucle.",
  "tasks.linkForeign":
    "Esta tarjeta pertenece a otro holon — enlázala donde vive.",
  "tasks.linkFailed": "No se pudo enlazar — {reason}",
  "tasks.appreciate": "Apreciar",
  "tasks.addTask": "Añadir una tarea",
  "tasks.appreciateInstead": "¿Apreciar en su lugar?",
  "tasks.appreciateLead":
    "Participas en “{title}”. Al apreciarla dejarás de ser participante.",
  "tasks.deleteTitle": "¿Eliminar la tarea?",
  "tasks.deleteLead": "“{title}” se eliminará para todos.",
  "tasks.deleting": "Eliminando…",
  "tasks.delete": "Eliminar",
  "tasks.addTasks": "Añadir tareas",
  "tasks.addLead": "Una tarea por línea.",
  "tasks.addPlaceholder":
    "Riega las plantas\nArregla la puerta\nOrganiza la cena",
  "tasks.adding": "Añadiendo…",
  "tasks.add": "Añadir",
  "tasks.loginPersonal":
    "Inicia sesión para ver las tareas en las que participas ✶",
  "tasks.emptyPersonal":
    "Aún no hay nada a tu nombre — únete a una tarea para verla aquí ✶",
  "tasks.emptyBacklog": "No hay tareas pendientes. ✶",

  // Swipe deck
  "swipe.participating": "Ya participas — eso vale más que un me gusta ♥",
  "swipe.alreadyIn": "Ya estás dentro ✓",
  "swipe.joinFailed": "No se pudo unir — inténtalo de nuevo.",
  "swipe.alreadyAppreciated": "Ya apreciada ♥",
  "swipe.appreciateFailed": "No se pudo guardar el ♥ — inténtalo de nuevo.",
  "swipe.deckAria":
    "Fichas de tareas — desliza a la derecha para unirte, arriba para apreciar, a la izquierda para saltar",
  "swipe.join": "ÚNETE",
  "swipe.skip": "SALTAR",
  "swipe.joined": "UNIDO",
  "swipe.joinedRibbonAria": "Participas en esta tarea",
  "swipe.allCaughtUp": "Todo al día",
  "swipe.roundSummary": "{joins} uniones · {likes} me gusta en esta ronda",
  "swipe.startOver": "Empezar de nuevo",
  "swipe.seeMine": "Ver mis tareas",
  "swipe.backToWall": "Volver a los pósits",
  "swipe.skipAria": "Saltar esta tarea",
  "swipe.skipTitle": "Saltar",
  "swipe.appreciateAria": "Apreciar esta tarea",
  "swipe.joinAria": "Únete a esta tarea",
  "swipe.joinTitle": "Únete",

  // Checklists
  "lists.updateFailed": "No se pudo actualizar la lista.",
  "lists.removeItemFailed": "No se pudo quitar el elemento.",
  "lists.addItemFailed": "No se pudo añadir el elemento.",
  "lists.nothingTicked": "Aún no hay nada marcado.",
  "lists.clearFailed": "No se pudo vaciar la lista.",
  "lists.specialUndeletable":
    "Las listas de agenda y compra no se pueden eliminar.",
  "lists.deleteFailed": "No se pudo eliminar la lista.",
  "lists.nameExists": "Ya existe una lista con ese nombre.",
  "lists.nameUnderscore":
    "Los nombres de lista no pueden contener guiones bajos.",
  "lists.createFailed": "No se pudo crear la lista.",
  "lists.backAria": "Volver a las listas",
  "lists.doneCount": "{done}/{total} hechos",
  "lists.clearTicked": "Quitar los elementos marcados",
  "lists.clear": "Vaciar",
  "lists.deleteList": "Eliminar esta lista",
  "lists.tapConfirm": "Toca para confirmar",
  "lists.gone": "Esta lista ya no existe.",
  "lists.emptyOpen":
    "Aún no hay nada en esta lista — añade el primer elemento ↓",
  "lists.removeItemAria": "Quitar {item}",
  "lists.addItemPlaceholder": "Añadir un elemento…",
  "lists.newItemAria": "Nuevo elemento",
  "lists.loginPersonal": "Inicia sesión para ver tus listas ✶",
  "lists.empty": "Aún no hay listas — empieza una con ＋",
  "lists.startList": "Empezar una lista",
  "lists.startLead": "Una lista compartida que cualquiera aquí puede marcar.",
  "lists.namePlaceholder": "Nombre (p. ej., día de limpieza)",
  "lists.firstItemsPlaceholder":
    "Primeros elementos, separados por comas (opcional)",
  "lists.starting": "Creando…",
  "lists.startBtn": "Crear la lista",
  "lists.emptyStatus": "vacía",

  // Calendar
  "cal.actionFailed": "No se pudo {verb} — {reason}",
  "cal.verbMove": "mover",
  "cal.verbUnschedule": "desprogramar",
  "cal.verbResize": "redimensionar",
  "cal.allDay": "todo el día",
  "cal.dayOfSpan": "día {span}",
  "cal.previous": "Anterior",
  "cal.next": "Siguiente",
  "cal.loginEvents": "Inicia sesión para ver tus eventos ✶",
  "cal.dropUnschedule": "Suelta aquí para quitar la fecha",
  "cal.unscheduledTray": "Sin fecha — arrastra a un día",
  "cal.newTask": "Nueva tarea",

  // Roles
  "roles.untitledRole": "Rol sin título",
  "rolesv.fixedReleaseFirst": "Rol fijo — libéralo primero desde la ficha.",
  "rolesv.prevWeek": "Semana anterior",
  "rolesv.nextWeek": "Semana siguiente",
  "rolesv.today": "Hoy",
  "rolesv.loginPersonal": "Inicia sesión para ver tus roles ✶",
  "rolesv.emptyPersonal": "Aún no hay roles a tu nombre — toma un día ✪",
  "rolesv.empty": "Aún no hay roles. ✪",
  "rolesv.fixedRole": "Rol fijo",
  "rolesv.fixed": "Fijo",
  "rolesv.open": "Abierto",
  "rolesv.release": "Liberar",
  "rolesv.releaseFixed": "Liberar este rol fijo",
  "rolesv.drop": "Dejar",
  "rolesv.takeToday": "Tomar hoy",
  "rolesv.todayDrop": "Hoy · dejar",
  "rolesv.takeThisDay": "Toma este día",
  "rolesv.editAria": "Editar el rol",
  "rolesv.edit": "Editar",
  "rolesv.addRole": "Añadir un rol",
  "rolesv.addRoleTitle": "Añadir un rol",
  "rolesv.addLead": "Una responsabilidad estable que cualquiera puede asumir.",
  "rolesv.titlePlaceholder": "Título del rol",
  "rolesv.descPlaceholder": "¿Qué implica? (opcional)",
  "rolesv.fixedHolderLabel": "Titular fijo · lo tiene cada día",
  "rolesv.clearFixed": "Quitar",
  "rolesv.makeMeFixed": "Hazme el titular fijo",
  "rolesv.saving": "Guardando…",
  "rolesv.save": "Guardar",
  "rolesv.deleteRole": "Eliminar el rol",

  // Library status chips
  "library.available": "disponible",
  "library.returnBy": "devolver {when}",
  "library.withYou": "contigo",
  "library.outWith": "prestado · {who}",
  "library.out": "prestado",

  // Library view
  "library.loginPersonal": "Inicia sesión para ver lo que tienes prestado ✶",
  "library.emptyPersonal":
    "Nada prestado ahora — toca un objeto para llevártelo ✶",
  "library.emptyShared": "Aún no hay objetos compartidos.",
  "library.prevItem": "Objeto anterior",
  "library.nextItem": "Objeto siguiente",
  "library.shareItem": "Compartir un objeto",
  "library.shareLead": "Algo que la comunidad puede tomar prestado.",
  "library.namePlaceholder": "¿Qué es? (p. ej., Taladro inalámbrico)",
  "library.itemTypeAria": "Tipo de objeto",
  "library.notesPlaceholder": "Notas sobre el objeto (opcionales)",
  "library.sharing": "Compartiendo…",
  "library.shareBtn": "Compartir",
  "library.nameTaken": "Ya hay algo compartido con ese nombre.",
  "library.addFailed": "No se pudo añadir el objeto.",
  "library.type.tool": "Herramienta",
  "library.type.book": "Libro",
  "library.type.equipment": "Equipo",
  "library.type.accommodation": "Alojamiento",
  "library.type.other": "Otro",

  // Tabs
  "tabs.tasks": "Tareas",
  "tabs.calendar": "Calendario",
  "tabs.library": "Biblioteca",
  "tabs.checklists": "Listas",
  "tabs.roles": "Roles",
  "tabs.status": "Estado",

  // Pill segments
  "pills.card": "Ficha",
  "pills.list": "Lista",
  "pills.wall": "Muro",
  "pills.week": "Semana",
  "pills.graph": "Grafo",
  "pills.calendar": "Calendario",
  "pills.day": "Día",
  "pills.month": "Mes",
  "pills.loved": "Favoritas",
  "pills.new": "Nuevas",
  "pills.manual": "Manual",
  "pills.view": "Vista",
  "pills.sort": "Ordenar",
  "pills.tasksLayout": "Disposición de las tareas",
  "pills.tasksOrder": "Orden de las tareas",
  "pills.libraryLayout": "Disposición de la biblioteca",
  "pills.rolesLayout": "Disposición de los roles",
  "pills.calendarView": "Vista del calendario",

  // Show (scope) pill
  "scope.personal": "Personal",
  "scope.local": "Local",
  "scope.global": "Global",
  "scope.show": "Mostrar",
  "scope.aria": "Qué elementos mostrar",

  // Header bar
  "tabbar.search": "Buscar…",
  "tabbar.searchAria": "Buscar en el contenido visible",
  "tabbar.clearSearch": "Borrar la búsqueda",
  "tabbar.suggestions": "Sugerencias de búsqueda",
  "tabbar.categories": "Categorías",
  "tabbar.people": "Personas",
  "tabbar.menu": "Menú",
  "tabbar.login": "Entrar",
  "tabbar.views": "Vistas",
  "tabbar.pinnedTitle": "Fijada — mantén pulsado para soltar",
  "tabbar.pinTitle": "Mantén pulsado para fijar",
  "tabbar.unpinTab": "Soltar {tab}",
  "tabbar.pinTab": "Fijar en {tab}",
  "tabbar.unpinView": "Soltar esta vista",
  "tabbar.pinView": "Fijar esta vista",

  // Telegram login sheet
  "login.loggedIn": "Sesión iniciada",
  "login.signedInAs":
    "Has iniciado sesión como {name} y puedes editar lo que hay en pantalla.",
  "login.title": "Entrar con Telegram",
  "login.lead":
    "Inicia sesión para añadir y editar lo que hay en pantalla. Ver sigue abierto a todos.",

  // User menu
  "menu.notSignedIn": "Sesión no iniciada",
  "menu.dashboard": "Abrir el panel completo",
  "menu.pasteCard": "Pegar la ficha copiada",
  "menu.settings": "Ajustes",
  "menu.logout": "Cerrar sesión",
  "menu.linkKey": "Vincula tu clave de firma",
  "menu.signingAs": "Firmando como {key}",
  "keylink.title": "Vincula tu clave de firma",
  "keylink.qrAlt": "QR de emparejamiento",
  "keylink.scan":
    "Escanéalo con tu teléfono — tu clave se queda en tu Telegram.",
  "keylink.waiting": "Esperando tu teléfono…",
  "keylink.success": "Clave vinculada — tus cambios se firman como tú.",
  "keylink.mismatch": "Esa clave pertenece a otra cuenta de Telegram.",
  "keylink.timeout": "Sin respuesta — cierra e inténtalo de nuevo.",
  "keylink.failed": "No se pudo adoptar la clave — inténtalo de nuevo.",
  "keylink.noMiniapp": "No hay almacén de claves configurado para este kiosco.",
  "key.title": "Tu clave de Holons",
  "key.loading": "Cargando…",
  "key.outside":
    "Abre esta página desde Telegram — gestiona la clave guardada en tu cuenta de Telegram.",
  "key.unsupported":
    "Tu app de Telegram es demasiado antigua para el almacén de claves — actualízala.",
  "key.error": "Algo salió mal — cierra e inténtalo de nuevo.",
  "key.identity": "Tu identidad de firma:",
  "key.sending": "Enviando tu clave al kiosco…",
  "key.sent": "Clave entregada — mira la pantalla del kiosco.",
  "key.done": "Listo",
  "key.readyHint":
    "Tu clave vive en tu nube de Telegram. Escanea el QR de un kiosco para firmar allí.",
  "key.revealKey": "Mostrar clave (copia de seguridad)",
  "key.hideKey": "Ocultar clave",
  "key.backupHint":
    "Cualquiera con esta clave puede actuar como tú — guárdala en un lugar seguro y privado.",
  "menu.loginTelegram": "Entrar con Telegram",

  // Completion confirmation
  "complete.title": "¿Completar esta tarea?",
  "complete.lead":
    "Confirma quién participó — se le acreditará en la contabilidad del holón.",
  "complete.addMemberAria": "Añadir un miembro",
  "complete.addMember": "Añadir un miembro…",
  "complete.confirm": "Completar",

  // Settings panel
  "settings.title": "Ajustes del quiosco",
  "settings.holon": "Holón",
  "settings.holonPlaceholder": "id del holón",
  "settings.unpinHolon": "Borrar — mostrar la página de inicio",
  "settings.displayName": "Nombre visible",
  "settings.displayNamePlaceholder": "se muestra en la cabecera",
  "settings.logo": "Logotipo",
  "settings.logoSub": "— opcional; si no, el nombre aparece como texto",
  "settings.logoPreview": "Vista previa del logotipo",
  "settings.namePlaceholder": "nombre",
  "settings.upload": "Subir…",
  "settings.useDefault": "Usar el predeterminado",
  "settings.notImage": "Elige un archivo de imagen.",
  "settings.imageTooLarge":
    "La imagen es demasiado grande — mantenla por debajo de 512 KB.",
  "settings.imageReadError": "No se pudo leer esa imagen.",
  "settings.accent": "Color de acento",
  "settings.accentAria": "Acento {color}",
  "settings.customAccent": "Acento personalizado",
  "settings.appearance": "Apariencia",
  "settings.appearanceSub": "— Auto sigue el atardecer local",
  "settings.light": "Claro",
  "settings.dark": "Oscuro",
  "settings.language": "Idioma",
  "settings.languageSub": "— Auto sigue el idioma del holón",
  "settings.libraryTab": "Pestaña Biblioteca",
  "settings.libraryTabSub":
    "— aparece sola cuando la biblioteca tiene objetos; actívala para forzarla",
  "settings.libraryTabAria": "Mostrar la pestaña Biblioteca",
  "settings.rolesTab": "Pestaña Roles",
  "settings.rolesTabSub":
    "— aparece sola cuando existen roles; actívala para forzarla",
  "settings.rolesTabAria": "Mostrar la pestaña Roles",
  "settings.listsTab": "Pestaña Listas",
  "settings.listsTabSub":
    "— aparece sola cuando existen listas; actívala para forzarla",
  "settings.listsTabAria": "Mostrar la pestaña Listas",
  "settings.statusTab": "Pestaña Estado",
  "settings.statusTabSub": "— una clasificación de contribuciones",
  "settings.statusTabAria": "Mostrar la pestaña Estado",
  "settings.statusConfirmTitle": "¿Activar el tablero de Estado?",
  "settings.statusConfirmAccept": "Entendido — actívalo",
  "settings.valueEquation": "Ecuación de valor",
  "settings.valueEquationSub":
    "— qué cuenta el tablero, y cuánto. Decídanlo en grupo; cualquier peso puede ir a 0, y también todos.",
  "settings.eqSignals": "Señales de colaboración",
  "settings.eqCurrencies": "Monedas",
  "settings.eqReset": "Restablecer los valores por defecto",
  "settings.eqZero": "Poner todos los pesos a 0",
  "settings.eqSaving": "Guardando…",
  "settings.eqSaved": "Guardado",
  "settings.eqLoading": "Cargando la ecuación…",
  "settings.eqLess": "Bajar el peso de {metric}",
  "settings.eqMore": "Subir el peso de {metric}",
  "settings.eqValue": "Peso de {metric}",
  "settings.eqMetrics": "Contribuciones",
  "settings.eqAbout": "{section}: qué cuentan",
  "settings.eqAboutAria": "Información sobre {section}",
  "settings.eqAddCurrency": "Añadir una moneda",
  "settings.eqCurrencyPlaceholder": "euro, token…",
  "settings.eqAdd": "Añadir",
  "settings.eqCurrencyStartsAtZero":
    "Las monedas nuevas empiezan en 0 — no cambia nada hasta que el grupo suba el peso.",
  "settings.location": "Ubicación",
  "settings.locationSub":
    "— la celda H3 que este holón reclama en el mapa compartido",
  "settings.checking": "Comprobando…",
  "settings.change": "Cambiar…",
  "settings.setLocation": "Fijar la ubicación…",
  "settings.federation": "Federación",
  "settings.federationSub":
    "— los holones socios con los que comparte esta pantalla · los cambios se aplican de inmediato",

  // Federation editor
  "fed.loading": "Cargando los socios…",
  "fed.loadError": "No se pudo cargar la federación — inténtalo de nuevo.",
  "fed.none":
    "Aún no hay socios — vincula un holón abajo para compartir los tableros.",
  "fed.hint":
    "Recibir = mostrar aquí sus elementos · Enviar = compartir los nuestros con ellos",
  "fed.lensAria": "Federación de {lens}",
  "fed.off": "Off",
  "fed.receive": "Recibir",
  "fed.send": "Enviar",
  "fed.both": "Ambos",
  "fed.tapAgainUnlink": "Toca otra vez para desvincular",
  "fed.unlink": "Desvincular {name}",
  "fed.linking": "Vinculando…",
  "fed.link": "Vincular",
  "fed.selfLink": "Ese es este holón.",
  "fed.linkError": "No se pudo vincular ese holón — inténtalo de nuevo.",
  "fed.changeError": "El cambio no se guardó — inténtalo de nuevo.",
  "fed.unlinkError": "La desvinculación no se guardó — inténtalo de nuevo.",

  // Location (hex) picker
  "hex.aria": "Elige una ubicación",
  "hex.kicker": "Reclama tu celda",
  "hex.title": "¿Dónde está este holón?",
  "hex.hint":
    "Toca el hexágono donde vive tu holón — aleja el zoom para una celda más amplia y privada.",
  "hex.searchPlaceholder": "Busca una dirección o un lugar…",
  "hex.searching": "buscando…",
  "hex.locating": "Localizando…",
  "hex.myLocation": "Mi ubicación",
  "hex.nothingSelected": "nada seleccionado aún",
  "hex.manualPlaceholder": "…o pega el id de una celda H3",
  "hex.check": "Comprobar",
  "hex.claiming": "Reclamando…",
  "hex.thisIsHome": "Este es el hogar",
  "hex.noGeo":
    "Este dispositivo no tiene geolocalización — toca el mapa o pega el id de una celda.",
  "hex.denied": "Ubicación denegada — toca el mapa o pega el id de una celda.",
  "hex.invalidCell": "No es un id de celda H3 válido.",
  "hex.claimed": "Ubicación reclamada — este holón está en el mapa.",
  "hex.saveError": "No se pudo guardar la ubicación — inténtalo de nuevo.",

  // Detail modal
  "detail.stepsUnwirable": "Estos pasos no se pueden conectar.",
  "detail.atomicStep": "Esta tarea ya es un único paso ejecutable.",
  "detail.breakdownFailed": "El desglose con IA falló.",
  "detail.partialSteps":
    "Solo se guardaron {saved} de {total} pasos — el objetivo quedó sin cambios.",
  "detail.linkStepsFailed": "No se pudieron conectar los pasos.",
  "detail.createStepsFailed": "No se pudieron crear los pasos.",
  "detail.noDate": "Sin fecha",
  "detail.saveFailed": "No se pudo guardar — inténtalo de nuevo.",
  "detail.couldNotSave": "No se pudo guardar.",
  "detail.completeFailed": "No se pudo completar.",
  "detail.deleteConfirm": '¿Eliminar "{title}"? No se puede deshacer.',
  "detail.hideConfirm":
    '¿Ocultar "{title}" de este tablero? Pertenece a otro holón y permanece allí — solo desaparece de tu vista.',
  "detail.thisTask": "esta tarea",
  "detail.deleteFailed": "No se pudo eliminar — inténtalo de nuevo.",
  "detail.hideFailed": "No se pudo ocultar — inténtalo de nuevo.",
  "detail.joinFailed": "No se pudo unir.",
  "detail.overlaps": "Se solapa con la reserva de {who} ({start} → {end}).",
  "detail.someone": "alguien",
  "detail.invalidRange":
    "La fecha de devolución no puede ser anterior a la de inicio.",
  "detail.bookFailed": "No se pudo reservar.",
  "detail.onlyBorrowerReturn": "Solo quien lo tiene prestado puede devolverlo.",
  "detail.returnFailed": "No se pudo devolver.",
  "detail.stepN": "paso {n}",
  "detail.status": "Estado",
  "detail.out": "Prestado",
  "detail.outWith": "Prestado · {who}",
  "detail.viaHolonTitle": "Reservado desde un holon federado",
  "detail.availableCap": "Disponible",
  "detail.value": "Valor",
  "detail.booked": "Reservado",
  "detail.from": "Desde",
  "detail.until": "Hasta",
  "detail.len1day": "1 día",
  "detail.len3days": "3 días",
  "detail.len1week": "1 semana",
  "detail.len2weeks": "2 semanas",
  "detail.booking": "Reservando…",
  "detail.confirmBooking": "Confirmar la reserva",
  "detail.borrow": "Tomar prestado",
  "detail.return": "Devolver",
  "detail.onLoanTo": "Prestado a {who}",
  "detail.bookAhead": "Reservar con antelación",
  "detail.edit": "Editar",
  "detail.copyTitle": "Copia esta ficha — pégala en cualquier holón",
  "detail.copy": "Copiar",
  "detail.loginBorrowEdit": "Entra con Telegram para tomar prestado o editar",
  "detail.loginEdit": "Entra con Telegram para editar",
  "detail.category": "Categoría",
  "detail.newCategoryPlaceholder": "Nombre de la nueva categoría",
  "detail.pickFromList": "Elegir de la lista",
  "detail.newCategory": "Nueva categoría…",
  "detail.description": "Descripción",
  "detail.participants": {
    one: "{n} participante",
    other: "{n} participantes",
  },
  "detail.leaveTitle": "Dejar esta tarea",
  "detail.joinedLeave": "Unido · dejar",
  "detail.appreciatedLabel": "Apreciada",
  "detail.breakdownTitle": "Usa la IA para desglosar esta tarea en pasos",
  "detail.breakingDown": "Desglosando…",
  "detail.breakDown": "Desglosar",
  "detail.proposedSteps": "Pasos propuestos",
  "detail.notBrokenDown": "Sin desglosar: {reason}",
  "detail.reuses": "reutiliza “{title}”",
  "detail.after": "después de {deps}",
  "detail.removeStepAria": "Quitar el paso {n}: {title}",
  "detail.removeStep": "Quitar este paso",
  "detail.addStepPlaceholder": "Añade tu propio paso…",
  "detail.creating": "Creando…",
  "detail.createSteps": { one: "Crear {n} paso", other: "Crear {n} pasos" },
  "detail.regenerating": "Regenerando…",
  "detail.regenerate": "Regenerar",
  "detail.title": "Título",
  "detail.titlePlaceholder": "¿Qué hay que hacer?",
  "detail.starts": "Empieza",
  "detail.ends": "Termina",
  "detail.startDateAria": "Fecha de inicio",
  "detail.startTimeAria": "Hora de inicio",
  "detail.endDateAria": "Fecha de fin",
  "detail.endTimeAria": "Hora de fin",
  "detail.dayCount": { one: "{n} día", other: "{n} días" },
  "detail.noCategory": "Sin categoría",
  "detail.location": "Lugar",
  "detail.create": "Crear",

  // Status leaderboard
  "status.tallying": "Sumando contribuciones… ♛",
  "status.noActivity": "Aún no hay actividad clasificada. ♛",
  "status.seeScore": "Mira cómo se formó la puntuación de {name}",
  "status.disclaimerLead":
    "La tecnología recuerda. El sentido lo dan las personas.",
  "status.disclaimerBody":
    "Este tablero muestra lo que quedó registrado — horas dedicadas, personas acogidas, tareas completadas. Nunca decide cuánto vale alguien. No existe una puntuación humana.",
  "status.disclaimerUse":
    "Así que no actúes solo con el número: cuenta únicamente lo que alguien recordó registrar, y el cuidado, la reparación y la escucha que sostienen a un grupo casi nunca se registran. Una clasificación sirve para abrir una conversación, no para cerrarla.",
  "status.disclaimerEquation":
    "Y la ecuación detrás de estos números es del grupo, no del software: decídanla juntos, revísenla cuando deje de encajar y pongan cualquier peso — o todos — a cero si así funciona mejor.",
  "status.disclaimerMore": "Qué cuenta — y qué no puede contar",
  "status.score": "Puntuación",
  "status.share": "{pct}% de participación",
  "status.valueEquation": "Ecuación de valor",
  "status.metricCol": "Métrica",
  "status.countCol": "Cantidad",
  "status.weightCol": "Peso",
  "status.pointsCol": "Puntos",
  "status.total": "Total",
  "status.noWeighted": "Aún no hay contribuciones ponderadas.",
  "status.ledger": "Registro",
  "status.entries": { one: "{n} entrada", other: "{n} entradas" },
  "status.noEntries": "No hay entradas en el registro.",
  "status.questRef": "Tarea n.º {id}",
  "status.metric.initiated": "Tareas propuestas",
  "status.metric.completed": "Tareas completadas",
  "status.metric.sent": "Aprecios enviados",
  "status.metric.received": "Aprecios recibidos",
  "status.metric.collaboration": "Eventos de colaboración",
  "status.metric.participation": "Participación (tareas)",
  "status.metric.coParticipants": "Coparticipantes",
  "status.metric.activity": "Actividad (eventos)",
  "status.metric.groupSize": "Tamaño del grupo (media)",
  "status.metric.variance": "Varianza del tamaño del grupo",
  "status.metric.declaredHours": "Horas declaradas",
  "status.metric.currencyBalance": "Saldo {currency}",
  "status.about.initiated": "Puntos cada vez que alguien propone una tarea.",
  "status.about.completed": "Puntos cada vez que alguien termina una tarea.",
  "status.about.sent": "Puntos por cada reconocimiento que alguien regala.",
  "status.about.received": "Puntos por cada reconocimiento que alguien recibe.",
  "status.about.collaboration":
    "Puntos por cada momento registrado de trabajo con otras personas.",
  "status.about.participation":
    "Puntos por cada quest distinta en la que alguien participó — premia estar presente en muchas cosas.",
  "status.about.coParticipants":
    "Puntos por cada persona distinta con la que se trabajó — premia un círculo amplio.",
  "status.about.activity":
    "Puntos por cada evento registrado, del tipo que sea — premia el volumen puro, así que mantenlo bajo.",
  "status.about.groupSize":
    "Multiplicado por el tamaño medio de los grupos en los que se trabajó — premia trabajar acompañado.",
  "status.about.variance":
    "Multiplicado por cuánto variaron esos tamaños — premia alternar entre grandes encuentros y trabajo uno a uno.",
  "status.about.currency":
    "Cada unidad de {currency} en el saldo de alguien vale estos puntos.",
  "status.event.questInitiated": "Tarea propuesta",
  "status.event.questCompleted": "Tarea completada",
  "status.event.timeLogged": "Tiempo registrado",
  "status.event.expenseShare": "Parte del gasto",
  "status.event.expensePaid": "Gasto pagado",
  "status.event.appreciation": "Aprecio",
  "status.event.generic": "Evento",

  // Voice overlay
  "voice.unmute": "Activar las respuestas habladas",
  "voice.mute": "Silenciar las respuestas habladas",
  "voice.listening": "escuchando…",
  "voice.thinking": "pensando",
  "voice.transcribing": "transcribiendo",
  "voice.speaking": "hablando…",
  "voice.typePlaceholder": "Pega o escribe una transcripción…",
  "voice.typeAria": "Escribe o pega una transcripción",
  "voice.holdToTalk": "Mantén pulsado para hablar",
  "voice.notConfigured":
    "La voz no está configurada — pega una clave API en Ajustes, o define OPENAI_API_KEY en el despliegue.",
  "voice.keyUnreachable":
    "No se pudo conectar con OpenAI — comprueba la clave API en Ajustes y la conexión de red.",
  "voice.serviceUnreachable":
    "No se pudo conectar con el servicio de voz — comprueba la conexión de red.",

  // Home / landing page
  "home.metaTitle": "Holons — coordinar lo que ya tenemos",
  "home.metaDescription":
    "Un protocolo abierto para grupos que quieren hacer circular lo que ya tienen — tiempo, herramientas, camas, tierra, saberes, cuidado, dinero — sin convertirlo todo en mercancía. Empieza un holón en Telegram.",

  "home.heroTitle": "Hacer que las relaciones tengan sentido económico.",
  "home.heroLead":
    "Holons es un protocolo abierto para grupos que quieren hacer circular lo que ya tienen — tiempo, herramientas, camas, tierra, saberes, cuidado, dinero — sin convertirlo todo en mercancía.",
  "home.heroNote":
    "Libre y de código abierto. Local-first y peer-to-peer. Tu holón es un grupo de chat que ya tienes.",
  "home.ctaStart": "Empieza un holón",
  "home.ctaRead": "¿Qué es un holón?",

  "home.problemKicker": "Por qué",
  "home.problemTitle": "Vivimos dentro de una extraña contradicción.",
  "home.problemP1":
    "Tenemos más capacidad de producir, comunicar, coordinarnos y compartir conocimiento que en ningún otro momento de la historia. Y aun así, casi todos seguimos organizando nuestra vida en torno a la escasez.",
  "home.problemP2":
    "Hay casas vacías mientras hay personas sin dónde vivir. Quien tiene capacidad libre no encuentra fácilmente a quien la necesita. Y el dinero se ha convertido en la lengua en la que cosas radicalmente distintas — tiempo, tierra, comida, cuidado, creatividad, riesgo, conocimiento — se ven obligadas a hablarse entre sí.",
  "home.fearsTitle": "Y debajo de todo eso hay miedo.",
  "home.fear1": "Si doy demasiado, ¿quedará suficiente para mí?",
  "home.fear2": "Si dejo de ganar dinero, ¿quién cuidará de mí?",
  "home.fear3": "Si comparto lo que tengo, ¿se aprovecharán los demás?",
  "home.fear4": "Si contribuyo ahora, ¿alguien lo recordará después?",
  "home.fearsNote":
    "Estos miedos no son irracionales. Nuestras instituciones nos dan buenas razones para tenerlos.",
  "home.problemP3":
    "El capitalismo resolvió un problema de coordinación profundo: los mercados permitieron que millones de desconocidos cooperaran sin necesidad de conocerse ni confiar entre sí. Ahora tenemos delante el siguiente — ¿pueden millones de personas cooperar sin convertir en mercancía todo lo que valoran?",

  "home.holonKicker": "Qué es un holón",
  "home.holonTitle": "Un todo, y una parte de algo mayor.",
  "home.holonP1":
    "La palabra viene del griego: holos (todo) + on (parte). Tu cuerpo es un holón — un organismo entero y, a la vez, parte de una familia, una comunidad, un ecosistema. Un equipo es un holón. También lo son una casa, una cooperativa, un barrio, una biorregión.",
  "home.holonP2":
    "Cualquier grupo puede funcionar así: autónomo por dentro, componible con otros holones por fuera. Cuatro preguntas lo hacen posible, y cada una tiene una primitiva en el protocolo.",
  "home.pillar1Title": "Membrana",
  "home.pillar1Body":
    "Un límite flexible que dice quién está dentro, para qué existe el holón y qué valora. Semipermeable: personas, recursos e información lo cruzan bajo las condiciones que el propio holón se da.",
  "home.pillar2Title": "Ecuación de valor",
  "home.pillar2Body":
    "Cada holón decide qué cuenta — horas, resultados, reconocimientos, las relaciones que alguien aporta. Dos holones con el mismo software pueden hacer crecer culturas muy distintas, solo ajustando los pesos.",
  "home.pillar3Title": "Divisores y umbrales",
  "home.pillar3Body":
    "Los recursos que llegan se enrutan en vez de acumularse: primero se cubre lo que el holón realmente necesita, y después el excedente desborda hacia las personas y proyectos que lo hacen prosperar.",
  "home.pillar4Title": "Federación",
  "home.pillar4Body":
    "Los holones declaran confianza con otros holones — tan ligera como compartir reconocimientos, tan comprometida como un fondo de apoyo mutuo común. Bilateral, revocable y nunca a costa de la autonomía.",

  "home.layerKicker": "Qué hace el software",
  "home.layerTitle": "Hace visibles los flujos.",
  "home.layerP1":
    "Nada se vuelve comunal a la fuerza. Lo que ocurre es que una capa digital aprende a ver la red: dónde hay camas libres, herramientas sin usar, excedentes de comida, tierra disponible, saberes, proyectos que piden ayuda y personas que buscan trabajo.",
  "home.layerSay": "Para que cualquiera pueda decir:",
  "home.say1": "Esto lo tengo.",
  "home.say2": "Esto lo necesito.",
  "home.say3": "Esto puedo ofrecerlo.",
  "home.say4": "Esto estoy intentando crear.",
  "home.layerP2":
    "Y la IA no deja de tejer conexiones que nadie podría sostener en la cabeza. «Necesitas una contable — Sofía tiene tres horas libres esta semana.» «El mes que viene hay seis camas sin usar.» «Cuatro personas de aquí tienen los saberes que le faltan a este proyecto.»",
  "home.mapsTitle": "Qué guarda un holón",
  "home.map1": "Personas",
  "home.map2": "Lugares",
  "home.map3": "Necesidades",
  "home.map4": "Ofertas",
  "home.map5": "Proyectos",
  "home.map6": "Recursos",
  "home.map7": "Una memoria de las contribuciones",
  "home.memoryP":
    "Esta última es la que más importa. El sistema recuerda quién cuidó de los demás en los momentos difíciles, quién arregló el tejado, quién pasó tres meses haciendo viable el trabajo de otra persona — no para ponerle precio. El propósito no es un capitalismo con mejor hoja de cálculo. Es tener memoria donde antes solo había confianza o burocracia — y es la memoria la que permite que la confianza llegue más allá de quienes ya conoces.",

  "home.designKicker": "Por diseño",
  "home.designTitle": "Soberanía, no vigilancia.",
  "home.designLead":
    "Un sistema capaz de ver una red también es capaz de vigilarla. Por eso esto son restricciones sobre el software, no promesas sobre las intenciones.",
  "home.design1": "La participación es voluntaria — siempre, en cada capa.",
  "home.design2": "Cada tipo de información tiene su propia visibilidad.",
  "home.design3": "Puedes impugnar lo que el sistema dice de ti.",
  "home.design4": "La IA sugiere; las personas siguen pudiendo decir que no.",
  "home.design5": "La contribución nunca se reduce a una sola puntuación.",
  "home.design6": "El cuidado nunca se hace equivalente al dinero.",
  "home.design7":
    "Siempre queda sitio para regalos que desaparecen sin quedar registrados.",
  "home.design8":
    "La red no pertenece a quien escribió el software: código abierto, local-first, peer-to-peer. La infraestructura con la que cooperamos es ella misma un bien común.",

  "home.levelsKicker": "Cómo crece",
  "home.levelsTitle": "Lo bastante pequeño para empezar hoy.",
  "home.levelsLead":
    "Puedes parar después de cualquier paso. Cada uno te deja un holón que funciona.",
  "home.level0Tag": "Nivel 0",
  "home.level0Title": "Un grupo de chat",
  "home.level0Body":
    "Crea un grupo, escribe su propósito en la descripción, invita a la gente. Eso ya es un holón: una membrana, un propósito compartido y miembros.",
  "home.level1Tag": "Nivel 1",
  "home.level1Title": "Añade el bot",
  "home.level1Body":
    "La coordinación informal se convierte en un registro atribuible. /task nombra el trabajo, /appreciate lo reconoce, /offer y /request abren un tablón de lo que podría circular, /status muestra cómo va cada quien.",
  "home.level2Tag": "Nivel 2",
  "home.level2Title": "Di qué cuenta",
  "home.level2Body":
    "Describe vuestros valores y prácticas, y luego ajusta los pesos de la ecuación de valor. No hay una respuesta correcta universal — la ecuación es la cultura.",
  "home.level3Tag": "Nivel 3",
  "home.level3Title": "Federaos",
  "home.level3Body":
    "Encuentra un holón hermano que haga un trabajo afín y declarad la confianza. Quests, ofertas, peticiones y reconocimientos podrán cruzar la frontera — solo los que cada parte elija publicar.",
  "home.level4Tag": "Nivel 4",
  "home.level4Title": "Ábrete a los agentes",
  "home.level4Body":
    "Conecta un agente de IA y pasa a ser participante en vez de espectador: lee el estado del holón y actúa con exactamente las mismas reglas que todos los demás.",

  "home.startKicker": "Empieza",
  "home.startTitle": "Empieza un holón.",
  "home.startLead":
    "Lleva alrededor de un minuto, y ocurre donde ya habláis: Telegram.",
  "home.step1":
    "Toca el botón. Telegram se abre y te pregunta a qué grupo añadir a @{bot}.",
  "home.step2":
    "Elige un grupo que ya tengas, o crea uno nuevo con las personas con las que quieras empezar.",
  "home.step3":
    "Haz al bot administrador, escribe el propósito en la descripción del grupo y escribe /task. Eso es un holón.",
  "home.startButton": "Añadir {bot} a un grupo",
  "home.startAlt": "O abre antes un chat privado",
  "home.startAltNote":
    "Un chat directo con @{bot} te da tu propio holón personal — donde converge tu trabajo en todos los grupos.",

  "home.backTitle": "Bienvenido de vuelta.",
  "home.backLead":
    "En cuanto el bot está en tu grupo, publica un enlace directo a este tablero. Si se te pasó, escribe /dashboard en el grupo y pega aquí el enlace.",
  "home.openTitle": "¿Ya tienes un holón?",
  "home.openLead":
    "Pega su enlace o su id, y esta pantalla se convierte en su tablero.",
  "home.openPlaceholder": "-1001234567890, o un enlace a tu grupo",
  "home.openButton": "Abrir el tablero",
  "home.openInvalid":
    "Eso todavía no nombra un holón. Prueba con un id de holón, un enlace a un mensaje de tu grupo, o el enlace que te da /dashboard.",
  "home.openAria": "Id o enlace del holón",

  "home.closingKicker": "Hacia dónde va",
  "home.closingP1":
    "Quizá alguien de la red pierda sus ingresos y descubra que no ha perdido su sustento. Hay dónde vivir. Hay comida. Hay quien necesita sus saberes. Hay una comunidad que recuerda lo que ya ha dado.",
  "home.closingP2":
    "Puede que ese sea el umbral — el momento en que la seguridad se desplaza del dinero acumulado a las relaciones acumuladas.",
  "home.closingP3":
    "Y la riqueza pasa a ser algo que de verdad se puede ver: tierra sana, infraestructura útil, conocimiento, relaciones de confianza, trabajo con sentido, lugares de pertenencia, y una red que sabe cuidar de los suyos.",

  "home.footerDocs": "Documentación",
  "home.footerDashboard": "Panel web",
  "home.footerCommunity": "Chat de la comunidad",
  "home.footerSource": "Código fuente",
  "home.footerSetup": "Configurar esta pantalla",
  "home.footerLicense": "Código abierto con licencia AGPL-3.0-or-later.",
  "home.caretakerNote":
    "¿La vas a montar en la pared? Los Ajustes apuntan la pantalla a un holón y lo recuerdan en este dispositivo — o abre el quiosco en /<id del holón> y sáltate la configuración por completo.",

  // Shell
  "layout.resync": "Vista en vivo detenida — resincronizando…",

  // Clipboard
  "clipboard.copied":
    "Ficha copiada — pégala en cualquier holón (o en cualquier chat).",
  "clipboard.copyFailed": "No se pudo acceder al portapapeles.",
  "clipboard.noHolon": "Primero apunta el quiosco a un holón.",
  "clipboard.loginToPaste": "Inicia sesión para pegar la ficha copiada.",
  "clipboard.pasted": 'Pegada "{title}".',
  "clipboard.pastedLibrary": '"{title}" pegado en la biblioteca.',
  "clipboard.alreadyInLibrary": '"{title}" ya está en esta biblioteca.',
  "clipboard.pasteCardFailed": "No se pudo pegar la ficha.",
  "clipboard.pasteFailed": "No se pudo pegar — {reason}",
  "clipboard.writeFailed": "fallo de escritura",
  "clipboard.blocked": "Portapapeles bloqueado — pulsa Ctrl/Cmd+V en su lugar.",
  "clipboard.noCard": "No hay ninguna ficha copiada en el portapapeles.",

  // AI breakdown errors
  "breakdown.badKey": "OpenAI rechazó la clave API de este dispositivo.",
  "breakdown.rateLimit":
    "Límite de peticiones de OpenAI alcanzado — inténtalo en un momento.",
  "breakdown.failed": "El desglose con IA falló (HTTP {status}).",
};
