import type { CouncilAdvisorExtended } from '../types/advisor-schema';
import { 
  isUserCreatedAdvisor, 
  isSystemStaticAdvisor, 
  isHECAdvisor 
} from './advisor-permissions';

/**
 * HOLONIC FILTER UTILITIES
 * 
 * Centralizes all advisor filtering logic to maintain consistency across the entire system.
 * These filters follow holonic principles by providing self-similar patterns that work
 * at any scale - whether filtering a single advisor or thousands.
 */

export interface FilterOptions {
  // Basic filters
  includeUserCreated?: boolean;
  includeSystemStatic?: boolean;
  includeHEC?: boolean;
  
  // Type filters
  includeReal?: boolean;
  includeMythic?: boolean;
  includeArchetype?: boolean;
  
  // Advanced filters
  excludeSeated?: string[]; // Array of advisor IDs that are already seated
  searchQuery?: string; // Text search in name/lens
  creatorUserId?: string; // Filter by specific creator
  
  // Context filters
  availableForSeating?: boolean; // Exclude advisors that can't be seated
  availableForDeletion?: boolean; // Only advisors that can be deleted
}

/**
 * HOLONIC MASTER FILTER
 * 
 * The single source of truth for all advisor filtering.
 * All other filtering functions build upon this foundation.
 */
export function filterAdvisors(
  advisors: CouncilAdvisorExtended[],
  options: FilterOptions = {}
): CouncilAdvisorExtended[] {
  
  return advisors.filter(advisor => {
    
    // CATEGORY FILTERS: Based on advisor classification
    if (options.includeUserCreated === false && isUserCreatedAdvisor(advisor)) {
      return false;
    }
    if (options.includeSystemStatic === false && isSystemStaticAdvisor(advisor)) {
      return false;
    }
    if (options.includeHEC === false && isHECAdvisor(advisor)) {
      return false;
    }
    
    // If specific inclusion flags are set, only include those types
    const hasSpecificInclusions = 
      options.includeUserCreated === true || 
      options.includeSystemStatic === true || 
      options.includeHEC === true;
    
    if (hasSpecificInclusions) {
      const isIncluded = 
        (options.includeUserCreated && isUserCreatedAdvisor(advisor)) ||
        (options.includeSystemStatic && isSystemStaticAdvisor(advisor)) ||
        (options.includeHEC && isHECAdvisor(advisor));
      
      if (!isIncluded) return false;
    }
    
    // TYPE FILTERS: Based on advisor type
    if (options.includeReal === false && advisor.type === 'real') return false;
    if (options.includeMythic === false && advisor.type === 'mythic') return false;
    if (options.includeArchetype === false && advisor.type === 'archetype') return false;
    
    // If specific type inclusions are set, only include those types
    const hasSpecificTypeInclusions = 
      options.includeReal === true || 
      options.includeMythic === true || 
      options.includeArchetype === true;
    
    if (hasSpecificTypeInclusions) {
      const isTypeIncluded = 
        (options.includeReal && advisor.type === 'real') ||
        (options.includeMythic && advisor.type === 'mythic') ||
        (options.includeArchetype && advisor.type === 'archetype');
      
      if (!isTypeIncluded) return false;
    }
    
    // SEATING FILTERS: Exclude already seated advisors
    if (options.excludeSeated && advisor.id && options.excludeSeated.includes(advisor.id)) {
      return false;
    }
    
    // SEARCH FILTERS: Text search in name and lens
    if (options.searchQuery) {
      const query = options.searchQuery.toLowerCase().trim();
      const nameMatch = advisor.name.toLowerCase().includes(query);
      const lensMatch = advisor.lens.toLowerCase().includes(query);
      if (!nameMatch && !lensMatch) return false;
    }
    
    // CREATOR FILTERS: Filter by specific creator
    if (options.creatorUserId && advisor.creatorUserId !== options.creatorUserId) {
      return false;
    }
    
    // CONTEXT FILTERS: Advanced permission-based filtering
    if (options.availableForSeating === true) {
      // All advisors can be seated, so this is always true
      // Future: could add context-specific seating restrictions
    }
    
    if (options.availableForDeletion === true) {
      // Only user-created advisors can be deleted
      if (!isUserCreatedAdvisor(advisor)) return false;
    }
    
    return true; // Advisor passes all filters
  });
}

/**
 * HOLONIC CONVENIENCE FILTERS
 * 
 * Pre-configured filter functions for common use cases.
 * These provide a clean API while building on the master filter.
 */

/**
 * Get only user-created advisors (excludes HEC and static system advisors)
 */
export function getUserCreatedAdvisors(advisors: CouncilAdvisorExtended[]): CouncilAdvisorExtended[] {
  return filterAdvisors(advisors, { includeUserCreated: true });
}

/**
 * Get only system static advisors (Joanna Macy, Quan Yin, etc.)
 */
export function getSystemStaticAdvisors(advisors: CouncilAdvisorExtended[]): CouncilAdvisorExtended[] {
  return filterAdvisors(advisors, { includeSystemStatic: true });
}

/**
 * Get only HEC (Holonic Ecosystem Council) advisors
 */
export function getHECAdvisors(advisors: CouncilAdvisorExtended[]): CouncilAdvisorExtended[] {
  return filterAdvisors(advisors, { includeHEC: true });
}

/**
 * Get advisors available for seating (excludes already seated ones)
 */
export function getAdvisorsAvailableForSeating(
  advisors: CouncilAdvisorExtended[],
  seatedAdvisorIds: string[] = []
): CouncilAdvisorExtended[] {
  return filterAdvisors(advisors, { 
    excludeSeated: seatedAdvisorIds,
    availableForSeating: true 
  });
}

/**
 * Get advisors that can be deleted (user-created only)
 */
export function getDeletableAdvisors(advisors: CouncilAdvisorExtended[]): CouncilAdvisorExtended[] {
  return filterAdvisors(advisors, { availableForDeletion: true });
}

/**
 * Get advisors by type
 */
export function getAdvisorsByType(
  advisors: CouncilAdvisorExtended[],
  type: 'real' | 'mythic' | 'archetype'
): CouncilAdvisorExtended[] {
  const options: FilterOptions = {};
  if (type === 'real') options.includeReal = true;
  if (type === 'mythic') options.includeMythic = true;
  if (type === 'archetype') options.includeArchetype = true;
  
  return filterAdvisors(advisors, options);
}

/**
 * Search advisors by name or lens
 */
export function searchAdvisors(
  advisors: CouncilAdvisorExtended[],
  query: string
): CouncilAdvisorExtended[] {
  return filterAdvisors(advisors, { searchQuery: query });
}

/**
 * HOLONIC COMPOSITION FILTERS
 * 
 * Functions that combine multiple filtering criteria for complex use cases.
 */

/**
 * Get advisor options for seat picker modal
 * Includes HEC + user-created advisors, excludes already seated ones
 */
export function getSeatPickerOptions(
  advisors: CouncilAdvisorExtended[],
  seatedAdvisorIds: string[] = []
): CouncilAdvisorExtended[] {
  return filterAdvisors(advisors, {
    includeHEC: true,
    includeUserCreated: true,
    includeSystemStatic: true, // Include Joanna Macy, Quan Yin for seating
    excludeSeated: seatedAdvisorIds
  });
}

/**
 * Get advisor options for "Your Created Advisors" lists
 * Only user-created advisors, excludes all system advisors
 */
export function getYourCreatedAdvisorsOptions(
  advisors: CouncilAdvisorExtended[]
): CouncilAdvisorExtended[] {
  return filterAdvisors(advisors, {
    includeUserCreated: true
  });
}

/**
 * Get advisor options for ritual/council selection
 * All advisors that can participate in rituals
 */
export function getRitualAdvisorOptions(
  advisors: CouncilAdvisorExtended[],
  excludeSeated: string[] = []
): CouncilAdvisorExtended[] {
  return filterAdvisors(advisors, {
    includeHEC: true,
    includeUserCreated: true,
    includeSystemStatic: true,
    excludeSeated,
    availableForSeating: true
  });
}

/**
 * HOLONIC SORTING UTILITIES
 * 
 * Functions for sorting filtered results in consistent ways.
 */

export type SortOrder = 'name_asc' | 'name_desc' | 'type_asc' | 'type_desc' | 'created_asc' | 'created_desc';

/**
 * Sort advisors by various criteria
 */
export function sortAdvisors(
  advisors: CouncilAdvisorExtended[],
  order: SortOrder = 'name_asc'
): CouncilAdvisorExtended[] {
  const sorted = [...advisors];
  
  switch (order) {
    case 'name_asc':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'name_desc':
      return sorted.sort((a, b) => b.name.localeCompare(a.name));
    case 'type_asc':
      return sorted.sort((a, b) => a.type.localeCompare(b.type));
    case 'type_desc':
      return sorted.sort((a, b) => b.type.localeCompare(a.type));
    case 'created_asc':
      return sorted.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateA - dateB;
      });
    case 'created_desc':
      return sorted.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
    default:
      return sorted;
  }
}

/**
 * HOLONIC DEBUG UTILITY
 * 
 * Helper function for debugging filter results.
 */
export function debugFilterResults(
  originalAdvisors: CouncilAdvisorExtended[],
  filteredAdvisors: CouncilAdvisorExtended[],
  options: FilterOptions
): void {
  console.log('🔍 Holonic Filter Debug:', {
    input: {
      totalAdvisors: originalAdvisors.length,
      breakdown: {
        userCreated: originalAdvisors.filter(isUserCreatedAdvisor).length,
        systemStatic: originalAdvisors.filter(isSystemStaticAdvisor).length,
        hec: originalAdvisors.filter(isHECAdvisor).length,
        real: originalAdvisors.filter(a => a.type === 'real').length,
        mythic: originalAdvisors.filter(a => a.type === 'mythic').length,
        archetype: originalAdvisors.filter(a => a.type === 'archetype').length
      }
    },
    filter: options,
    output: {
      filteredCount: filteredAdvisors.length,
      advisorNames: filteredAdvisors.map(a => a.name),
      breakdown: {
        userCreated: filteredAdvisors.filter(isUserCreatedAdvisor).length,
        systemStatic: filteredAdvisors.filter(isSystemStaticAdvisor).length,
        hec: filteredAdvisors.filter(isHECAdvisor).length,
        real: filteredAdvisors.filter(a => a.type === 'real').length,
        mythic: filteredAdvisors.filter(a => a.type === 'mythic').length,
        archetype: filteredAdvisors.filter(a => a.type === 'archetype').length
      }
    }
  });
}
