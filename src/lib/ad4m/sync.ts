/**
 * Data Synchronization: HoloSphere → AD4M
 *
 * Reads all data from a HoloSphere instance for a given holon and writes
 * it to an AD4M perspective. Used for one-time migration or ongoing sync.
 *
 * @module ad4m/sync
 */

import type { HoloSphere } from 'holosphere';
import { HoloSphereAd4mAdapter } from './adapter';
import { LENS_MODEL_MAP } from './models/index';
import type { Ad4mConnectionConfig } from './connection';

// =============================================================================
// Types
// =============================================================================

/** Status of a single lens sync */
export interface LensSyncResult {
  lens: string;
  itemsRead: number;
  itemsWritten: number;
  errors: string[];
  skipped: number;
  durationMs: number;
}

/** Overall sync report */
export interface SyncReport {
  holonId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  totalItemsRead: number;
  totalItemsWritten: number;
  totalErrors: number;
  lensResults: LensSyncResult[];
  status: 'completed' | 'partial' | 'failed';
}

/** Progress callback for UI updates */
export type SyncProgressCallback = (
  lens: string,
  current: number,
  total: number,
  message: string
) => void;

// =============================================================================
// Sync Function
// =============================================================================

/**
 * Synchronize all data from HoloSphere to AD4M for a given holon.
 *
 * Iterates through all known lenses, reads data from HoloSphere,
 * and writes it to the AD4M adapter. Reports progress and errors.
 *
 * @param holosphere - The source HoloSphere instance
 * @param ad4mConfig - AD4M connection configuration
 * @param holonId - The holon ID to sync
 * @param onProgress - Optional progress callback
 * @returns Detailed sync report
 *
 * @example
 * ```typescript
 * const report = await syncHolonToAd4m(
 *   holosphere,
 *   { executorUrl: 'ws://localhost:12000/graphql', token: '...' },
 *   'abc123',
 *   (lens, current, total, msg) => {
 *     console.log(`[${lens}] ${current}/${total}: ${msg}`);
 *   }
 * );
 * console.log(`Synced ${report.totalItemsWritten} items with ${report.totalErrors} errors`);
 * ```
 */
export async function syncHolonToAd4m(
  holosphere: HoloSphere,
  ad4mConfig: Ad4mConnectionConfig,
  holonId: string,
  onProgress?: SyncProgressCallback
): Promise<SyncReport> {
  const startedAt = Date.now();
  const lensResults: LensSyncResult[] = [];
  let totalRead = 0;
  let totalWritten = 0;
  let totalErrors = 0;

  // Create and connect AD4M adapter
  const adapter = new HoloSphereAd4mAdapter(ad4mConfig);

  try {
    onProgress?.('connection', 0, 1, 'Connecting to AD4M executor...');
    await adapter.connect();
    onProgress?.('connection', 1, 1, 'Connected');
  } catch (error) {
    return {
      holonId,
      startedAt,
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      totalItemsRead: 0,
      totalItemsWritten: 0,
      totalErrors: 1,
      lensResults: [],
      status: 'failed',
    };
  }

  // Get all lens names that have models
  const lensNames = Object.keys(LENS_MODEL_MAP);
  const totalLenses = lensNames.length;

  for (let i = 0; i < lensNames.length; i++) {
    const lens = lensNames[i];
    const lensStart = Date.now();
    const errors: string[] = [];
    let itemsRead = 0;
    let itemsWritten = 0;
    let skipped = 0;

    onProgress?.(lens, i, totalLenses, `Syncing ${lens}...`);

    try {
      // Read all data from HoloSphere for this lens
      const data = await holosphere.getAll(holonId, lens);

      if (!data || typeof data !== 'object') {
        lensResults.push({
          lens,
          itemsRead: 0,
          itemsWritten: 0,
          errors: [],
          skipped: 0,
          durationMs: Date.now() - lensStart,
        });
        continue;
      }

      const entries = Object.entries(data);
      itemsRead = entries.length;
      totalRead += itemsRead;

      // Write each item to AD4M
      for (const [key, value] of entries) {
        try {
          if (!value || typeof value !== 'object') {
            skipped++;
            continue;
          }

          // Ensure the item has an id
          const itemData = { ...value };
          if (!itemData.id) {
            itemData.id = key;
          }

          await adapter.put(holonId, lens, itemData);
          itemsWritten++;
          totalWritten++;
        } catch (itemError: any) {
          const errMsg = `${key}: ${itemError.message || String(itemError)}`;
          errors.push(errMsg);
          totalErrors++;
        }
      }
    } catch (lensError: any) {
      errors.push(`Failed to read lens: ${lensError.message || String(lensError)}`);
      totalErrors++;
    }

    lensResults.push({
      lens,
      itemsRead,
      itemsWritten,
      errors,
      skipped,
      durationMs: Date.now() - lensStart,
    });
  }

  // Cleanup
  await adapter.dispose();

  const completedAt = Date.now();
  const status: SyncReport['status'] =
    totalErrors === 0 ? 'completed' :
    totalWritten > 0 ? 'partial' :
    'failed';

  const report: SyncReport = {
    holonId,
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt,
    totalItemsRead: totalRead,
    totalItemsWritten: totalWritten,
    totalErrors,
    lensResults,
    status,
  };

  onProgress?.('done', totalLenses, totalLenses,
    `Sync ${status}: ${totalWritten}/${totalRead} items, ${totalErrors} errors`
  );

  return report;
}

/**
 * Sync a single lens from HoloSphere to AD4M.
 *
 * Useful for targeted sync of specific data types.
 *
 * @param holosphere - Source HoloSphere instance
 * @param adapter - Already-connected AD4M adapter
 * @param holonId - The holon ID
 * @param lens - The specific lens to sync
 * @returns Sync result for the lens
 */
export async function syncLensToAd4m(
  holosphere: HoloSphere,
  adapter: HoloSphereAd4mAdapter,
  holonId: string,
  lens: string
): Promise<LensSyncResult> {
  const start = Date.now();
  const errors: string[] = [];
  let itemsRead = 0;
  let itemsWritten = 0;
  let skipped = 0;

  try {
    const data = await holosphere.getAll(holonId, lens);

    if (data && typeof data === 'object') {
      const entries = Object.entries(data);
      itemsRead = entries.length;

      for (const [key, value] of entries) {
        try {
          if (!value || typeof value !== 'object') {
            skipped++;
            continue;
          }

          const itemData = { ...value };
          if (!itemData.id) itemData.id = key;

          await adapter.put(holonId, lens, itemData);
          itemsWritten++;
        } catch (err: any) {
          errors.push(`${key}: ${err.message || String(err)}`);
        }
      }
    }
  } catch (err: any) {
    errors.push(`Read failed: ${err.message || String(err)}`);
  }

  return {
    lens,
    itemsRead,
    itemsWritten,
    errors,
    skipped,
    durationMs: Date.now() - start,
  };
}
