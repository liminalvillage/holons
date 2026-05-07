// Re-export of QuestTree types from @holons/core/tasks.
// Kept as a thin facade so existing call sites continue to resolve.
export type {
    QuestTreeNode,
    QuestTree,
    BackcastingSession,
    InquiryLoop,
    GenerationConfig,
} from '@holons/core/tasks';
