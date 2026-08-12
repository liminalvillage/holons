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

  // Roles
  "roles.untitledRole": "Rol sin título",

  // Library status chips
  "library.available": "disponible",
  "library.returnBy": "devolver {when}",
  "library.withYou": "contigo",
  "library.outWith": "prestado · {who}",
  "library.out": "prestado",

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

  // User menu
  "menu.notSignedIn": "Sesión no iniciada",
  "menu.dashboard": "Abrir el panel completo",
  "menu.pasteCard": "Pegar la ficha copiada",
  "menu.settings": "Ajustes",
  "menu.logout": "Cerrar sesión",
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
  "settings.location": "Ubicación",
  "settings.locationSub":
    "— la celda H3 que este holón reclama en el mapa compartido",
  "settings.checking": "Comprobando…",
  "settings.change": "Cambiar…",
  "settings.setLocation": "Fijar la ubicación…",
  "settings.federation": "Federación",
  "settings.federationSub":
    "— los holones socios con los que comparte esta pantalla · los cambios se aplican de inmediato",
  "settings.voice": "Voz",
  "settings.voiceSub":
    "— clave API de OpenAI para la interacción hablada, guardada solo en este dispositivo; vacía = la clave compartida del despliegue (la del desglose con IA), si está configurada",

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

  // Voice overlay
  "voice.unmute": "Activar las respuestas habladas",
  "voice.mute": "Silenciar las respuestas habladas",
  "voice.listening": "escuchando…",
  "voice.thinking": "pensando",
  "voice.transcribing": "transcribiendo",
  "voice.speaking": "hablando…",
  "voice.typePlaceholder": "Pega o escribe una transcripción…",

  // Setup screen
  "setup.title": "Ningún holón configurado",
  "setup.body":
    "Apunta esta pantalla a un holón: abre Ajustes e introduce un id de holón, abre el quiosco en /<id del holón>, ábrelo una vez con el parámetro ?holon=<id>, o define VITE_KIOSK_HOLON en el .env raíz. Los Ajustes y ?holon= se recuerdan en este dispositivo.",
  "setup.openSettings": "Abrir los ajustes",

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
