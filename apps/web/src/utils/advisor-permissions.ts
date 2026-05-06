import type { CouncilAdvisorExtended } from '../types/advisor-schema';

/**
 * HOLONIC ADVISOR PERMISSIONS UTILITY
 * 
 * Centralizes all advisor permission logic to maintain consistency across the entire system.
 * This utility ensures that advisor permissions are calculated the same way everywhere,
 * following holonic principles of single source of truth and consistent relationships.
 */

export interface AdvisorPermissions {
  canDelete: boolean;
  canEdit: boolean;
  canChat: boolean;
  canSeat: boolean;
  canAddToRitual: boolean;
  isUserCreated: boolean;
  isSystemStatic: boolean;
  isHECMember: boolean;
}

export interface PermissionContext {
  // Context where permissions are being checked
  location: 'seat_picker' | 'advisor_list' | 'ritual_modal' | 'general';
  
  // User context (for future user-specific permissions)
  currentUserId?: string;
  
  // Additional context flags
  isRitualActive?: boolean;
  isDesignStreamsActive?: boolean;
}

/**
 * HOLONIC PERMISSION CALCULATOR
 * 
 * This is the single source of truth for all advisor permissions.
 * All UI components should use this function to determine what actions are allowed.
 */
export function getAdvisorPermissions(
  advisor: CouncilAdvisorExtended, 
  context: PermissionContext = { location: 'general' }
): AdvisorPermissions {
  
  // HOLONIC CLASSIFICATION: Determine advisor category
  const isUserCreated = isUserCreatedAdvisor(advisor);
  const isSystemStatic = isSystemStaticAdvisor(advisor);
  const isHECMember = isHECAdvisor(advisor);
  
  // HOLONIC PERMISSION RULES: Based on advisor type and context
  const permissions: AdvisorPermissions = {
    // Core permissions based on advisor type
    canDelete: isUserCreated && !isSystemStatic && !isHECMember,
    canEdit: isUserCreated && !isSystemStatic && !isHECMember,
    
    // Universal permissions (all advisors can be used)
    canChat: true,
    canSeat: true,
    canAddToRitual: true,
    
    // Classification flags
    isUserCreated,
    isSystemStatic,
    isHECMember
  };
  
  // HOLONIC CONTEXT ADJUSTMENTS: Modify permissions based on context
  if (context.location === 'ritual_modal' && context.isRitualActive) {
    // In active ritual, be more restrictive about modifications
    permissions.canDelete = false;
    permissions.canEdit = false;
  }
  
  return permissions;
}

/**
 * HOLONIC ADVISOR CLASSIFICATION FUNCTIONS
 * 
 * These functions implement the core logic for determining advisor types.
 * They are the source of truth for advisor categorization.
 */

/**
 * Check if advisor is user-created (not system/HEC)
 */
export function isUserCreatedAdvisor(advisor: CouncilAdvisorExtended): boolean {
  // User-created advisors are NOT created by QBFRANK and NOT HEC members
  return !isSystemStaticAdvisor(advisor) && !isHECAdvisor(advisor);
}

/**
 * Check if advisor is a static system advisor (Joanna Macy, Quan Yin, etc.)
 */
export function isSystemStaticAdvisor(advisor: CouncilAdvisorExtended): boolean {
  // Static system advisors are created by QBFRANK
  return advisor.creatorUserId === 'QBFRANK';
}

/**
 * Check if advisor is a HEC (Holonic Ecosystem Council) member
 */
export function isHECAdvisor(advisor: CouncilAdvisorExtended): boolean {
  // HEC advisors are archetypes with council_membership === 'ai-ecosystem'
  if (advisor.type === 'archetype') {
    const archetypeSpec = advisor.characterSpec as any;
    return archetypeSpec?.council_membership === 'ai-ecosystem';
  }
  return false;
}

/**
 * HOLONIC PERMISSION CHECKER FUNCTIONS
 * 
 * Convenience functions for common permission checks.
 * These wrap the main permission calculator for specific use cases.
 */

/**
 * Check if advisor can be deleted in a given context
 */
export function canDeleteAdvisor(
  advisor: CouncilAdvisorExtended, 
  context?: PermissionContext
): boolean {
  return getAdvisorPermissions(advisor, context).canDelete;
}

/**
 * Check if advisor can be edited in a given context
 */
export function canEditAdvisor(
  advisor: CouncilAdvisorExtended, 
  context?: PermissionContext
): boolean {
  return getAdvisorPermissions(advisor, context).canEdit;
}

/**
 * Check if advisor should show in "Your Created Advisors" lists
 */
export function shouldShowInUserCreatedList(advisor: CouncilAdvisorExtended): boolean {
  return isUserCreatedAdvisor(advisor);
}

/**
 * HOLONIC BULK OPERATIONS
 * 
 * Functions for working with arrays of advisors.
 */

/**
 * Filter advisors to only user-created ones
 */
export function filterUserCreatedAdvisors(advisors: CouncilAdvisorExtended[]): CouncilAdvisorExtended[] {
  return advisors.filter(shouldShowInUserCreatedList);
}

/**
 * Filter advisors to only system static ones
 */
export function filterSystemStaticAdvisors(advisors: CouncilAdvisorExtended[]): CouncilAdvisorExtended[] {
  return advisors.filter(isSystemStaticAdvisor);
}

/**
 * Filter advisors to only HEC members
 */
export function filterHECAdvisors(advisors: CouncilAdvisorExtended[]): CouncilAdvisorExtended[] {
  return advisors.filter(isHECAdvisor);
}

/**
 * HOLONIC DEBUG UTILITY
 * 
 * Helper function for debugging permission issues.
 */
export function debugAdvisorPermissions(advisor: CouncilAdvisorExtended, context?: PermissionContext): void {
  const permissions = getAdvisorPermissions(advisor, context);
  console.log(`🔍 Advisor Permissions Debug: ${advisor.name}`, {
    advisor: {
      name: advisor.name,
      type: advisor.type,
      creatorUserId: advisor.creatorUserId,
      id: advisor.id
    },
    classifications: {
      isUserCreated: permissions.isUserCreated,
      isSystemStatic: permissions.isSystemStatic,
      isHECMember: permissions.isHECMember
    },
    permissions: {
      canDelete: permissions.canDelete,
      canEdit: permissions.canEdit,
      canChat: permissions.canChat,
      canSeat: permissions.canSeat,
      canAddToRitual: permissions.canAddToRitual
    },
    context: context || { location: 'general' }
  });
}

