// Re-export of the unified Quest type from @holons/core/tasks.
// Kept as a thin facade so existing call sites (`import type { Quest } from '../types/Quest'`)
// continue to work after Phase B unit `core/tasks`.
export type {
  Quest,
  QuestInitiator,
  QuestParticipant,
  QuestMeta,
} from "@holons/core/tasks";
