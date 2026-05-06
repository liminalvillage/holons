import { AdvisorService } from '../services/AdvisorService';
import type { CouncilAdvisorExtended } from '../types/advisor-schema';
import type { HoloSphere } from "holosphere";

// Import all static HEC advisors for migration
import { 
  OMNIA, MOLOCH, GAIA, TECHNOS, THE_EVERYMAN, ALUNA, 
  THE_INNOCENT, THE_ORACLE, THE_ALCHEMIST, THE_FOOL, 
  THE_DEVILS_ADVOCATE, THE_WISE_OLD_MAN, JOANNA_MACY, QUAN_YIN 
} from '../data/advisor-library';

/**
 * HOLONIC ADVISOR MIGRATION UTILITY
 * 
 * Migrates static HEC advisors to HoloSphere storage using AdvisorService.
 * This should be run once per holon to populate the advisor library.
 */

// All static advisors that need to be migrated
const STATIC_ADVISORS: CouncilAdvisorExtended[] = [
  OMNIA, MOLOCH, GAIA, TECHNOS, THE_EVERYMAN, ALUNA,
  THE_INNOCENT, THE_ORACLE, THE_ALCHEMIST, THE_FOOL,
  THE_DEVILS_ADVOCATE, THE_WISE_OLD_MAN, JOANNA_MACY, QUAN_YIN
];

/**
 * Migrate all static HEC advisors to HoloSphere for a specific holon
 */
export async function migrateHECAdvisorsToHoloSphere(
  holosphere: HoloSphere, 
  holonId: string
): Promise<{success: number, failed: string[], errors: Error[]}> {
  console.log(`🚀 Starting HEC advisor migration for holon: ${holonId}`);
  
  const advisorService = new AdvisorService(holosphere, holonId);
  const results = {
    success: 0,
    failed: [] as string[],
    errors: [] as Error[]
  };

  // Check if advisors already exist to avoid duplicates
  console.log('🔍 Checking for existing advisors...');
  const existingAdvisors = await advisorService.getAllAdvisors();
  const existingIds = new Set(existingAdvisors.map(a => a.id));
  
  if (existingIds.size > 0) {
    console.log(`📋 Found ${existingIds.size} existing advisors: ${Array.from(existingIds).join(', ')}`);
  }

  for (const advisor of STATIC_ADVISORS) {
    try {
      // Skip if advisor already exists
      if (existingIds.has(advisor.id!)) {
        console.log(`⏭️ Skipping ${advisor.name} - already exists with ID: ${advisor.id}`);
        continue;
      }

      console.log(`🎭 Migrating ${advisor.type} advisor: ${advisor.name} (${advisor.id})`);
      
      // Create advisor using AdvisorService
      const createdId = await advisorService.createAdvisor(
        advisor.type as 'archetype' | 'real' | 'mythic',
        advisor,
        'QBFRANK' // HEC advisors created by QBFRANK
      );
      
      console.log(`✅ Successfully migrated: ${advisor.name} → ${createdId}`);
      results.success++;
      
    } catch (error) {
      const errorMsg = `Failed to migrate ${advisor.name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`❌ ${errorMsg}`);
      results.failed.push(advisor.name);
      results.errors.push(error instanceof Error ? error : new Error(errorMsg));
    }
  }

  console.log(`🎉 Migration complete! Success: ${results.success}, Failed: ${results.failed.length}`);
  
  if (results.failed.length > 0) {
    console.warn('⚠️ Failed migrations:', results.failed);
    results.errors.forEach(error => console.error('Error details:', error));
  }

  return results;
}

/**
 * Check migration status for a holon
 */
export async function checkMigrationStatus(
  holosphere: HoloSphere, 
  holonId: string
): Promise<{
  totalStatic: number,
  migrated: number,
  missing: string[],
  needsMigration: boolean
}> {
  console.log(`🔍 Checking migration status for holon: ${holonId}`);
  
  const advisorService = new AdvisorService(holosphere, holonId);
  const existingAdvisors = await advisorService.getAllAdvisors();
  const existingIds = new Set(existingAdvisors.map(a => a.id));
  
  const staticIds = STATIC_ADVISORS.map(a => a.id!);
  const missing = staticIds.filter(id => !existingIds.has(id));
  
  const status = {
    totalStatic: STATIC_ADVISORS.length,
    migrated: staticIds.length - missing.length,
    missing,
    needsMigration: missing.length > 0
  };
  
  console.log(`📊 Migration status:`, status);
  return status;
}

/**
 * Get HEC advisors using the new AdvisorService (replaces old static approach)
 */
export async function getHECAdvisorsFromHoloSphere(
  holosphere: HoloSphere, 
  holonId: string
): Promise<CouncilAdvisorExtended[]> {
  console.log(`🌐 Getting HEC advisors from HoloSphere for holon: ${holonId}`);
  
  const advisorService = new AdvisorService(holosphere, holonId);
  return await advisorService.getHECAdvisors();
}

/**
 * Get random HEC members (excluding Omnia) using HoloSphere data
 */
export async function getRandomHECMembers(
  holosphere: HoloSphere, 
  holonId: string,
  excludeOmnia: boolean = true
): Promise<CouncilAdvisorExtended[]> {
  console.log(`🎲 Getting random HEC members for holon: ${holonId}, excludeOmnia: ${excludeOmnia}`);
  
  const hecAdvisors = await getHECAdvisorsFromHoloSphere(holosphere, holonId);
  let availableMembers = hecAdvisors;
  
  if (excludeOmnia) {
    availableMembers = hecAdvisors.filter(member => !member.name.includes('Omnia'));
  }
  
  // Shuffle and take first 5
  const shuffled = [...availableMembers].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 5);
  
  console.log(`✅ Selected ${selected.length} random HEC members:`, selected.map(a => a.name));
  return selected;
}

/**
 * Auto-migration function to be called when AdvisorService is first used
 */
export async function ensureHECAdvisorsMigrated(
  holosphere: HoloSphere, 
  holonId: string
): Promise<boolean> {
  const status = await checkMigrationStatus(holosphere, holonId);
  
  if (status.needsMigration) {
    console.log(`🔄 Auto-migrating ${status.missing.length} missing HEC advisors...`);
    const results = await migrateHECAdvisorsToHoloSphere(holosphere, holonId);
    return results.failed.length === 0;
  }
  
  console.log(`✅ All HEC advisors already migrated for holon: ${holonId}`);
  return true;
}


