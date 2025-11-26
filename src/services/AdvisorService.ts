import type { CouncilAdvisorExtended, ArchetypeAdvisor, RealPersonAdvisor, MythicAdvisor } from '../types/advisor-schema';
import type { HoloSphere } from "holosphere";

/**
 * HOLONIC ADVISOR SERVICE
 * Single source of truth for all advisor operations
 * Replaces the fragmented advisor-library.ts approach
 */
export class AdvisorService {
  private holosphere: HoloSphere;
  private holonId: string;
  private advisorCache: Map<string, CouncilAdvisorExtended> = new Map();
  private cacheTimestamp: number = 0;
  private readonly CACHE_DURATION = 30000; // 30 seconds

  constructor(holosphere: HoloSphere, holonId: string) {
    this.holosphere = holosphere;
    this.holonId = holonId;
  }

  /**
   * Generate consistent advisor ID from name
   * Used for both new advisors and ID lookups
   */
  generateAdvisorId(name: string): string {
    return name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // Remove special chars
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Remove duplicate hyphens
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  }

  /**
   * Validate advisor data completeness
   */
  private validateAdvisor(advisor: CouncilAdvisorExtended): boolean {
    if (!advisor.id || !advisor.name || !advisor.type || !advisor.lens) {
      return false;
    }
    
    if (!advisor.characterSpec) {
      return false;
    }

    // Validate type-specific schema completeness
    switch (advisor.type) {
      case 'archetype':
        const archetype = advisor.characterSpec as ArchetypeAdvisor;
        return !!(archetype.background && archetype.purpose);
      
      case 'real':
        const real = advisor.characterSpec as RealPersonAdvisor;
        return !!(real.background_context && real.known_for);
      
      case 'mythic':
        const mythic = advisor.characterSpec as MythicAdvisor;
        return !!(mythic.mythic_domain && mythic.cultural_origin);
      
      default:
        return false;
    }
  }

  /**
   * Create and store a new advisor
   */
  async createAdvisor(
    type: 'archetype' | 'real' | 'mythic',
    advisorData: CouncilAdvisorExtended,
    creatorUserId: string = 'SYSTEM'
  ): Promise<string> {
    console.log(`🎭 Creating ${type} advisor: "${advisorData.name}"`);

    // Generate consistent ID
    const advisorId = this.generateAdvisorId(advisorData.name);
    
    // Ensure advisor has proper ID and creator tracking
    const completeAdvisor: CouncilAdvisorExtended = {
      ...advisorData,
      id: advisorId,
      type: type,
      creatorUserId: creatorUserId,
      createdAt: new Date().toISOString()
    };

    // Validate completeness with detailed logging
    console.log(`🔍 Validating advisor: ${completeAdvisor.name}`);
    const isValid = this.validateAdvisor(completeAdvisor);
    
    if (!isValid) {
      console.error(`❌ Validation failed for ${type} advisor: ${advisorData.name}`);
      console.error(`❌ Advisor data:`, {
        id: completeAdvisor.id,
        name: completeAdvisor.name,
        type: completeAdvisor.type,
        lens: completeAdvisor.lens,
        hasCharacterSpec: !!completeAdvisor.characterSpec,
        characterSpecStructure: completeAdvisor.characterSpec ? {
          keys: Object.keys(completeAdvisor.characterSpec),
          hasBackground: !!(completeAdvisor.characterSpec as any).background,
          hasPurpose: !!(completeAdvisor.characterSpec as any).purpose,
          hasBackgroundContext: !!(completeAdvisor.characterSpec as any).background_context,
          hasKnownFor: !!(completeAdvisor.characterSpec as any).known_for,
          hasMythicDomain: !!(completeAdvisor.characterSpec as any).mythic_domain,
          hasCulturalOrigin: !!(completeAdvisor.characterSpec as any).cultural_origin
        } : 'NO_CHARACTER_SPEC'
      });
      throw new Error(`Advisor validation failed: incomplete ${type} schema for "${advisorData.name}"`);
    }
    
    console.log(`✅ Advisor validation passed: ${completeAdvisor.name}`);

    try {
      // Debug log the advisor data before storing
      console.log(`🔧 About to store advisor:`, {
        id: advisorId,
        name: completeAdvisor.name,
        type: completeAdvisor.type,
        hasCharacterSpec: !!completeAdvisor.characterSpec,
        characterSpecKeys: completeAdvisor.characterSpec ? Object.keys(completeAdvisor.characterSpec) : 'NONE'
      });
      
      // Store in HoloSphere with individual ID-based key
      await this.holosphere.put(this.holonId, 'advisor_library', completeAdvisor);
      
      // Update cache
      this.advisorCache.set(advisorId, completeAdvisor);
      
      console.log(`✅ Created advisor: ${advisorData.name} with ID: ${advisorId}`);
      return advisorId;
    } catch (error) {
      console.error(`❌ Failed to create advisor: ${advisorData.name}`, error);
      console.error(`❌ Advisor data that failed:`, completeAdvisor);
      throw new Error(`Failed to create advisor: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get advisor by ID - SINGLE SOURCE OF TRUTH
   */
  async getAdvisor(advisorId: string): Promise<CouncilAdvisorExtended | null> {
    console.log(`🔍 Getting advisor by ID: "${advisorId}"`);

    // Check cache first
    if (this.advisorCache.has(advisorId)) {
      const cached = this.advisorCache.get(advisorId)!;
      console.log(`📋 Found advisor in cache: ${cached.name}`);
      return cached;
    }

    // Refresh cache if needed and search
    await this.refreshCacheIfNeeded();
    
    if (this.advisorCache.has(advisorId)) {
      const advisor = this.advisorCache.get(advisorId)!;
      console.log(`✅ Found advisor: ${advisor.name}`);
      return advisor;
    }

    console.warn(`⚠️ Advisor not found for ID: ${advisorId}`);
    return null;
  }

  /**
   * Get all advisors for this holon
   */
  async getAllAdvisors(): Promise<CouncilAdvisorExtended[]> {
    console.log(`📚 Getting all advisors for holon: ${this.holonId}`);
    
    await this.refreshCacheIfNeeded();
    const advisors = Array.from(this.advisorCache.values());
    
    console.log(`✅ Retrieved ${advisors.length} advisors`);
    return advisors;
  }

  /**
   * Get specifically HEC (Holonic Ecosystem Council) advisors
   */
  async getHECAdvisors(): Promise<CouncilAdvisorExtended[]> {
    console.log(`🏛️ Getting HEC advisors for holon: ${this.holonId}`);
    
    // Get all advisors
    const allAdvisors = await this.getAllAdvisors();
    
    // Filter for HEC advisors (those with council_membership: 'ai-ecosystem')
    const hecAdvisors = allAdvisors.filter(advisor => {
      if (advisor.type === 'archetype') {
        const archetypeSpec = advisor.characterSpec as any;
        return archetypeSpec?.council_membership === 'ai-ecosystem';
      }
      return false;
    });
    
    console.log(`✅ Retrieved ${hecAdvisors.length} HEC advisors:`, hecAdvisors.map(a => `${a.name} (${a.id})`));
    
    return hecAdvisors;
  }



  /**
   * Delete advisor by ID
   */
  async deleteAdvisor(advisorId: string): Promise<void> {
    console.log(`🗑️ Deleting advisor: ${advisorId}`);

    try {
      // Get advisor first to verify it exists and get name for logging
      const advisor = await this.getAdvisor(advisorId);
      if (!advisor) {
        throw new Error(`Advisor not found: ${advisorId}`);
      }

      // Delete from HoloSphere
      await this.holosphere.delete(this.holonId, 'advisor_library', advisorId);
      
      // Remove from cache
      this.advisorCache.delete(advisorId);
      
      console.log(`✅ Deleted advisor: ${advisor.name} (${advisorId})`);
    } catch (error) {
      console.error(`❌ Failed to delete advisor: ${advisorId}`, error);
      throw new Error(`Failed to delete advisor: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }



  /**
   * Get advisor display name by ID (synchronous, cache-only)
   */
  getAdvisorName(advisorId: string): string {
    const advisor = this.advisorCache.get(advisorId);
    return advisor ? advisor.name : advisorId;
  }

  /**
   * Search advisors by name (for migration/fallback purposes)
   */
  async findAdvisorByName(name: string): Promise<CouncilAdvisorExtended | null> {
    const allAdvisors = await this.getAllAdvisors();
    
    // Try exact match first
    let advisor = allAdvisors.find(a => a.name.toLowerCase() === name.toLowerCase());
    if (advisor) {
      console.log(`🔍 Found advisor by exact name: "${name}" → ${advisor.id}`);
      return advisor;
    }
    
    // Try partial match
    advisor = allAdvisors.find(a => 
      a.name.toLowerCase().includes(name.toLowerCase()) ||
      name.toLowerCase().includes(a.name.toLowerCase())
    );
    
    if (advisor) {
      console.log(`🔍 Found advisor by partial name: "${name}" → ${advisor.name} (${advisor.id})`);
      return advisor;
    }
    
    console.warn(`⚠️ No advisor found for name: "${name}"`);
    return null;
  }

  /**
   * Refresh advisor cache from HoloSphere
   */
  private async refreshCacheIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now - this.cacheTimestamp < this.CACHE_DURATION) {
      return; // Cache is still valid
    }

    try {
      console.log(`🔄 Refreshing advisor cache for holon: ${this.holonId}`);
      
      const advisorsData = await this.holosphere.getAll(this.holonId, 'advisor_library');
      
      // Clear and rebuild cache
      this.advisorCache.clear();
      
      if (advisorsData && typeof advisorsData === 'object') {
        const advisorsArray = Object.values(advisorsData) as CouncilAdvisorExtended[];
        
        advisorsArray.forEach(advisor => {
          if (advisor.id) {
            // Remove metadata for cache storage if present
            const { metadata, ...cleanAdvisor } = advisor as any;
            this.advisorCache.set(advisor.id, cleanAdvisor as CouncilAdvisorExtended);
          }
        });
      }
      
      this.cacheTimestamp = now;
      console.log(`✅ Cache refreshed: ${this.advisorCache.size} advisors loaded`);
    } catch (error) {
      console.error('❌ Failed to refresh advisor cache:', error);
      // Don't throw - continue with existing cache
    }
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache(): void {
    this.advisorCache.clear();
    this.cacheTimestamp = 0;
    console.log('🧹 Advisor cache cleared');
  }
}

/**
 * Factory function to create AdvisorService instance
 */
export function createAdvisorService(holosphere: HoloSphere, holonId: string): AdvisorService {
  return new AdvisorService(holosphere, holonId);
}
