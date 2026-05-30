// Shared task / quest types used by all Holons UIs.
//
// Two historical Quest shapes existed:
//   - apps/web (TS): minimal shape (title/when/status/participants...)
//   - packages/telegram-ui (JS): rich shape with extra Telegram metadata
//     (message_thread_id, stoppers, dependencies, frequency, timeTracking,
//     activeHolograms, document, where, when, until, completed, ...).
//
// We unify under a single `Quest` interface that lists the fields each UI
// relies on as optional, and keeps an open index signature so neither UI is
// forced to discard data it currently writes.

export interface QuestInitiator {
  id: string | number;
  username?: string;
  firstName?: string;
  lastName?: string;
  [key: string]: any;
}

export interface QuestParticipant {
  username?: string;
  id?: string | number;
  role?: string;
  [key: string]: any;
}

export interface QuestMeta {
  [key: string]: any;
}

export interface Quest {
  id?: string | number;
  title: string;
  description?: string;

  // Status — historic union plus open string for forward-compat.
  status:
    | 'ongoing'
    | 'completed'
    | 'cancelled'
    | 'scheduled'
    | 'recurring'
    | 'repeating'
    | 'pending'
    | 'stopped'
    | string;

  // 'offer' | 'request' | 'need' mark marketplace items (see marketplace.ts);
  // the rest are tasks/events/recurring quests. All share the `quests` lens.
  type?: 'task' | 'quest' | 'event' | 'recurring' | 'offer' | 'request' | 'need' | string;
  category?: string;

  // Web-style schedule fields.
  when?: string;
  ends?: string;
  location?: string;

  // People.
  participants: QuestParticipant[];
  // Bot stores user objects, web stores string usernames — keep open.
  appreciation?: any[];
  // Members who have vetoed ("stopped") the quest; non-empty ⇒ status 'stopped'.
  stoppers?: QuestParticipant[];

  // Provenance.
  // Canonical creation timestamp — ISO string. Set by every writer.
  created?: string;
  initiator?: QuestInitiator;

  // Ordering / dependencies.
  orderIndex?: number;
  dependencies?: string[];

  _meta?: QuestMeta;
  _deleted?: boolean;

  // Optional pointer to a Canvas record stored at (holonId, 'canvases', canvasId).
  canvasId?: string;

  // Open shape so existing call sites that read/write extra fields keep working.
  [key: string]: any;
}

// Minimal HoloSphere surface used by the persistence helpers. Both UIs pass
// the real instance from the `holosphere` package; we only require the
// methods we actually call so this stays UI-agnostic. holonId is narrowed
// to `string` to match the runtime contract that all UIs already enforce
// (Telegraf chat ids and apps/web holon ids are both stringified upstream).
export interface HoloSphereLike {
  put: (
    holonId: string,
    bucket: string,
    value: any,
  ) => Promise<unknown>;
  get?: (
    holonId: string,
    bucket: string,
    key?: string | number,
  ) => Promise<unknown>;
}
